import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createCryptoBox, createEncryptionKeyring } from "./encryption.js";

export const DEV_SECRET_FILE_NAME = ".dev-secret";
export const LEGACY_DEV_SECRET = "dev-secret";

interface SecretFileFs {
  existsSync(path: fs.PathLike): boolean;
  readFileSync(path: fs.PathOrFileDescriptor, options: { encoding: BufferEncoding }): string;
  writeFileSync(path: fs.PathOrFileDescriptor, data: string, options?: { encoding?: BufferEncoding }): void;
}

export function resolveDevSecretFilePath(dataDir: string) {
  return path.join(dataDir, DEV_SECRET_FILE_NAME);
}

export function resolveEncryptionSecret(options: {
  env?: NodeJS.ProcessEnv;
  dataDir: string;
  existingEncryptedSettings?: string[];
  fileSystem?: SecretFileFs;
  warn?: (message: string) => void;
  randomBytes?: (size: number) => Buffer;
}) {
  const env = options.env ?? process.env;
  const explicitSecret = env.UPUSE_SECRET?.trim();
  if (explicitSecret) {
    if (env.NODE_ENV?.trim().toLowerCase() === "production" && explicitSecret === LEGACY_DEV_SECRET) {
      throw new Error("UPUSE_SECRET must not use the legacy development secret in production.");
    }
    return explicitSecret;
  }

  if (env.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new Error("UPUSE_SECRET is required in production. Refusing to start without an explicit encryption key.");
  }

  const fileSystem = options.fileSystem ?? fs;
  const warn = options.warn ?? console.warn;
  const secretFilePath = resolveDevSecretFilePath(options.dataDir);
  const encryptedSettings = (options.existingEncryptedSettings ?? []).filter((payload) => typeof payload === "string" && payload.trim().length > 0);
  const persistedSecret = readPersistedDevSecret(secretFilePath, fileSystem);

  if (persistedSecret) {
    if (encryptedSettings.length > 0 && !canDecryptAllWithSecret(encryptedSettings, persistedSecret)) {
      throw new Error(
        `${secretFilePath} exists but cannot decrypt the current stored tokens. Restore the original UPUSE_SECRET or replace ${DEV_SECRET_FILE_NAME} with the correct secret.`,
      );
    }

    warn(
      `WARNING: UPUSE_SECRET is not set. Using the persisted development key at ${secretFilePath}. Configure UPUSE_SECRET to silence this warning.`,
    );
    return persistedSecret;
  }

  if (encryptedSettings.length > 0) {
    if (canDecryptAllWithSecret(encryptedSettings, LEGACY_DEV_SECRET)) {
      fileSystem.writeFileSync(secretFilePath, `${LEGACY_DEV_SECRET}\n`, { encoding: "utf8" });
      warn(
        `WARNING: UPUSE_SECRET is not set. Adopted the legacy development key and persisted it to ${secretFilePath} for compatibility. Set UPUSE_SECRET to use an explicit key.`,
      );
      return LEGACY_DEV_SECRET;
    }

    throw new Error(
      `UPUSE_SECRET is missing and no ${DEV_SECRET_FILE_NAME} file exists. Existing encrypted settings cannot be safely decrypted without the original key. Restore UPUSE_SECRET or create ${secretFilePath} with the previous secret.`,
    );
  }

  const generatedSecret = (options.randomBytes ?? crypto.randomBytes)(32).toString("hex");
  fileSystem.writeFileSync(secretFilePath, `${generatedSecret}\n`, { encoding: "utf8" });
  warn(
    `WARNING: UPUSE_SECRET is not set. Generated a development-only key at ${secretFilePath}. This keeps localhost usable, but production must always set UPUSE_SECRET explicitly.`,
  );
  return generatedSecret;
}

function readPersistedDevSecret(secretFilePath: string, fileSystem: SecretFileFs) {
  if (!fileSystem.existsSync(secretFilePath)) return "";

  const persisted = fileSystem.readFileSync(secretFilePath, { encoding: "utf8" }).trim();
  return persisted;
}

function canDecryptAllWithSecret(payloads: string[], secret: string) {
  const cryptoBox = createCryptoBox(createEncryptionKeyring(secret));
  return payloads.every((payload) => cryptoBox.canDecrypt(payload));
}

function canDecryptWithSecret(payload: string, secret: string) {
  try {
    decryptWithSecret(payload, secret);
    return true;
  } catch {
    return false;
  }
}

function decryptWithSecret(payload: string, secret: string) {
  const key = crypto.createHash("sha256").update(secret).digest();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
