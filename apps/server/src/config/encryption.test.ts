import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createCryptoBox,
  createEncryptionKeyring,
  deriveEncryptionKeyId,
  parseEncryptionSecretList,
} from "./encryption.js";

function encryptLegacyPayload(plain: string, secret: string) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(secret).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

describe("encryption.parseEncryptionSecretList", () => {
  it("normalizes and deduplicates comma and newline separated secrets", () => {
    expect(
      parseEncryptionSecretList(" first-secret,\nsecond-secret \r\n first-secret ,, third-secret "),
    ).toEqual(["first-secret", "second-secret", "third-secret"]);
  });
});

describe("encryption.createCryptoBox", () => {
  it("encrypts and decrypts versioned payloads with the primary key", () => {
    const cryptoBox = createCryptoBox(createEncryptionKeyring("primary-secret"));

    const payload = cryptoBox.encrypt("orders-token");
    const decrypted = cryptoBox.decryptWithMetadata(payload);

    expect(payload).toContain(`upuse:v1:${deriveEncryptionKeyId("primary-secret")}:`);
    expect(decrypted).toMatchObject({
      value: "orders-token",
      keyId: deriveEncryptionKeyId("primary-secret"),
      legacy: false,
      usedPrimaryKey: true,
      needsReencrypt: false,
    });
  });

  it("decrypts legacy payloads with a fallback key and marks them for re-encryption", () => {
    const cryptoBox = createCryptoBox(
      createEncryptionKeyring("new-primary-secret", ["old-secret"]),
    );

    const decrypted = cryptoBox.decryptWithMetadata(encryptLegacyPayload("availability-token", "old-secret"));

    expect(decrypted).toMatchObject({
      value: "availability-token",
      keyId: deriveEncryptionKeyId("old-secret"),
      legacy: true,
      usedPrimaryKey: false,
      needsReencrypt: true,
    });
  });

  it("decrypts versioned payloads encrypted with a previous key and marks them for re-encryption", () => {
    const previousBox = createCryptoBox(createEncryptionKeyring("old-secret"));
    const currentBox = createCryptoBox(createEncryptionKeyring("new-secret", ["old-secret"]));

    const payload = previousBox.encrypt("orders-token");
    const decrypted = currentBox.decryptWithMetadata(payload);

    expect(decrypted).toMatchObject({
      value: "orders-token",
      keyId: deriveEncryptionKeyId("old-secret"),
      legacy: false,
      usedPrimaryKey: false,
      needsReencrypt: true,
    });
  });

  it("fails fast when none of the configured keys can decrypt the payload", () => {
    const cryptoBox = createCryptoBox(createEncryptionKeyring("new-primary-secret"));

    expect(() => cryptoBox.assertCanDecryptAll([encryptLegacyPayload("orders-token", "old-secret")])).toThrow(
      /cannot decrypt the existing stored settings/i,
    );
  });
});
