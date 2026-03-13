import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEV_SECRET_FILE_NAME,
  LEGACY_DEV_SECRET,
  resolveDevSecretFilePath,
  resolveEncryptionSecret,
} from "./secret.js";

function createMemoryFs(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));

  return {
    files,
    existsSync(filePath: string) {
      return files.has(filePath);
    },
    readFileSync(filePath: string, _options?: { encoding: BufferEncoding }) {
      const value = files.get(filePath);
      if (typeof value !== "string") {
        throw new Error(`Missing file: ${filePath}`);
      }
      return value;
    },
    writeFileSync(filePath: string, data: string, _options?: { encoding?: BufferEncoding }) {
      files.set(filePath, data);
    },
  };
}

function encryptWithSecret(plain: string, secret: string) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(secret).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

describe("secret.resolveEncryptionSecret", () => {
  it("uses the explicit UPUSE_SECRET when provided", () => {
    const secret = resolveEncryptionSecret({
      env: { UPUSE_SECRET: "custom-secret", NODE_ENV: "production" },
      dataDir: "/tmp/upuse",
      fileSystem: createMemoryFs(),
      warn: () => {
        throw new Error("warn should not be called");
      },
    });

    expect(secret).toBe("custom-secret");
  });

  it("fails fast in production when UPUSE_SECRET is missing", () => {
    expect(() =>
      resolveEncryptionSecret({
        env: { NODE_ENV: "production" },
        dataDir: "/tmp/upuse",
        fileSystem: createMemoryFs(),
      }),
    ).toThrow(/UPUSE_SECRET is required in production/i);
  });

  it("rejects the legacy development secret in production even when explicitly configured", () => {
    expect(() =>
      resolveEncryptionSecret({
        env: { NODE_ENV: "production", UPUSE_SECRET: LEGACY_DEV_SECRET },
        dataDir: "/tmp/upuse",
        fileSystem: createMemoryFs(),
      }),
    ).toThrow(/must not use the legacy development secret in production/i);
  });

  it("reuses the persisted development secret and warns in non-production", () => {
    const dataDir = "/tmp/upuse";
    const secretFilePath = resolveDevSecretFilePath(dataDir);
    const warnings: string[] = [];
    const fs = createMemoryFs({
      [secretFilePath]: "persisted-dev-secret\n",
    });

    const secret = resolveEncryptionSecret({
      env: { NODE_ENV: "development" },
      dataDir,
      fileSystem: fs,
      warn: (message) => warnings.push(message),
    });

    expect(secret).toBe("persisted-dev-secret");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(DEV_SECRET_FILE_NAME);
  });

  it("fails when the persisted development secret cannot decrypt existing settings", () => {
    const dataDir = "/tmp/upuse";
    const secretFilePath = resolveDevSecretFilePath(dataDir);
    const fs = createMemoryFs({
      [secretFilePath]: "wrong-secret\n",
    });

    expect(() =>
      resolveEncryptionSecret({
        env: { NODE_ENV: "development" },
        dataDir,
        existingEncryptedSettings: [encryptWithSecret("orders-token", "real-secret")],
        fileSystem: fs,
      }),
    ).toThrow(/cannot decrypt the current stored tokens/i);
  });

  it("generates and persists a development secret when none exists", () => {
    const dataDir = "/tmp/upuse";
    const secretFilePath = resolveDevSecretFilePath(dataDir);
    const warnings: string[] = [];
    const fs = createMemoryFs();

    const secret = resolveEncryptionSecret({
      env: { NODE_ENV: "development" },
      dataDir,
      fileSystem: fs,
      warn: (message) => warnings.push(message),
      randomBytes: (size) => Buffer.alloc(size, 7),
    });

    expect(secret).toBe("0707070707070707070707070707070707070707070707070707070707070707");
    expect(fs.files.get(secretFilePath)).toBe(`${secret}\n`);
    expect(warnings).toHaveLength(1);
  });

  it("adopts the legacy development secret when existing encrypted settings require it", () => {
    const dataDir = "/tmp/upuse";
    const secretFilePath = resolveDevSecretFilePath(dataDir);
    const warnings: string[] = [];
    const fs = createMemoryFs();

    const secret = resolveEncryptionSecret({
      env: { NODE_ENV: "development" },
      dataDir,
      existingEncryptedSettings: [
        encryptWithSecret("orders-token", LEGACY_DEV_SECRET),
        encryptWithSecret("availability-token", LEGACY_DEV_SECRET),
      ],
      fileSystem: fs,
      warn: (message) => warnings.push(message),
    });

    expect(secret).toBe(LEGACY_DEV_SECRET);
    expect(fs.files.get(secretFilePath)).toBe(`${LEGACY_DEV_SECRET}\n`);
    expect(warnings).toHaveLength(1);
  });
});
