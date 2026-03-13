import crypto from "node:crypto";

const ENCRYPTION_PAYLOAD_PREFIX = "upuse:v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_ID_LENGTH = 16;

export interface EncryptionKey {
  id: string;
  secret: string;
}

export interface EncryptionKeyring {
  primaryKey: EncryptionKey;
  decryptionKeys: EncryptionKey[];
}

export interface DecryptedPayload {
  value: string;
  keyId: string;
  legacy: boolean;
  usedPrimaryKey: boolean;
  needsReencrypt: boolean;
}

function deriveCipherKey(secret: string) {
  return crypto.createHash("sha256").update(secret).digest();
}

export function deriveEncryptionKeyId(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex").slice(0, KEY_ID_LENGTH);
}

export function parseEncryptionSecretList(raw: string | undefined) {
  if (!raw) return [];

  return raw
    .split(/[\r\n,]+/)
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

export function createEncryptionKeyring(primarySecret: string, fallbackSecrets: string[] = []): EncryptionKeyring {
  const secrets = [primarySecret, ...fallbackSecrets]
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);

  if (!secrets.length) {
    throw new Error("At least one encryption secret is required.");
  }

  const keys = secrets.map((secret) => ({
    id: deriveEncryptionKeyId(secret),
    secret,
  }));

  return {
    primaryKey: keys[0],
    decryptionKeys: keys,
  };
}

function encryptWithKey(plain: string, key: EncryptionKey) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveCipherKey(key.secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptWithKey(payload: string, key: EncryptionKey) {
  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveCipherKey(key.secret), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

function parseVersionedPayload(payload: string) {
  const prefix = `${ENCRYPTION_PAYLOAD_PREFIX}:`;
  if (!payload.startsWith(prefix)) return null;

  const separatorIndex = payload.indexOf(":", prefix.length);
  if (separatorIndex <= prefix.length) {
    throw new Error("Encrypted payload has an invalid key identifier.");
  }

  const keyId = payload.slice(prefix.length, separatorIndex).trim();
  const body = payload.slice(separatorIndex + 1).trim();
  if (!keyId || !body) {
    throw new Error("Encrypted payload is malformed.");
  }

  return {
    keyId,
    body,
  };
}

function orderDecryptionKeys(keys: EncryptionKey[], keyId: string) {
  const exactMatch = keys.find((key) => key.id === keyId);
  if (!exactMatch) {
    return keys;
  }

  return [exactMatch, ...keys.filter((key) => key.id !== keyId)];
}

export function createCryptoBox(keyring: EncryptionKeyring) {
  const decryptWithMetadata = (payload: string): DecryptedPayload => {
    const parsedPayload = parseVersionedPayload(payload);
    const encryptedBody = parsedPayload ? parsedPayload.body : payload;
    const candidateKeys = parsedPayload
      ? orderDecryptionKeys(keyring.decryptionKeys, parsedPayload.keyId)
      : keyring.decryptionKeys;

    let lastError: unknown;
    for (const key of candidateKeys) {
      try {
        const value = decryptWithKey(encryptedBody, key);
        const usedPrimaryKey = key.id === keyring.primaryKey.id;
        return {
          value,
          keyId: key.id,
          legacy: !parsedPayload,
          usedPrimaryKey,
          needsReencrypt: !parsedPayload || !usedPrimaryKey,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      parsedPayload
        ? `Unable to decrypt encrypted settings with the configured keyring (payload key id: ${parsedPayload.keyId}).`
        : "Unable to decrypt legacy encrypted settings with the configured keyring.",
      { cause: lastError instanceof Error ? lastError : undefined },
    );
  };

  const encrypt = (plain: string) => {
    const encrypted = encryptWithKey(plain, keyring.primaryKey);
    return `${ENCRYPTION_PAYLOAD_PREFIX}:${keyring.primaryKey.id}:${encrypted}`;
  };

  return {
    primaryKeyId: keyring.primaryKey.id,
    encrypt,
    decrypt(payload: string) {
      return decryptWithMetadata(payload).value;
    },
    decryptWithMetadata,
    canDecrypt(payload: string) {
      try {
        decryptWithMetadata(payload);
        return true;
      } catch {
        return false;
      }
    },
    assertCanDecryptAll(payloads: string[]) {
      for (const payload of payloads) {
        if (!this.canDecrypt(payload)) {
          throw new Error(
            "Configured UPUSE_SECRET values cannot decrypt the existing stored settings. Restore the previous secret or include it in UPUSE_SECRET_PREVIOUS.",
          );
        }
      }
    },
  };
}
