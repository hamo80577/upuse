import { createCryptoBox, createEncryptionKeyring, parseEncryptionSecretList } from "../../config/encryption.js";
import { resolveEncryptionSecret } from "../../config/secret.js";
import { dataDir, db } from "./connection.js";

function readExistingEncryptedSettings() {
  const hasSettingsTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings' LIMIT 1")
    .get();
  const encryptedValues: string[] = [];

  if (hasSettingsTable) {
    const row = db.prepare("SELECT ordersTokenEnc, availabilityTokenEnc FROM settings WHERE id = 1").get() as
      | { ordersTokenEnc?: string; availabilityTokenEnc?: string }
      | undefined;

    if (row?.ordersTokenEnc) encryptedValues.push(row.ordersTokenEnc);
    if (row?.availabilityTokenEnc) encryptedValues.push(row.availabilityTokenEnc);
  }

  const hasScanoSettingsTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scano_settings' LIMIT 1")
    .get();

  if (hasScanoSettingsTable) {
    const row = db.prepare("SELECT catalogTokenEnc FROM scano_settings WHERE id = 1").get() as
      | { catalogTokenEnc?: string }
      | undefined;

    if (row?.catalogTokenEnc) encryptedValues.push(row.catalogTokenEnc);
  }

  return encryptedValues.filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

const existingEncryptedSettings = readExistingEncryptedSettings();
const secret = resolveEncryptionSecret({
  env: process.env,
  dataDir,
  existingEncryptedSettings,
});
const previousSecrets = parseEncryptionSecretList(process.env.UPUSE_SECRET_PREVIOUS);

export const cryptoBox = createCryptoBox(createEncryptionKeyring(secret, previousSecrets));

cryptoBox.assertCanDecryptAll(existingEncryptedSettings);

export function rotateStoredSettingsSecretsToPrimary() {
  const settingsRow = db.prepare("SELECT ordersTokenEnc, availabilityTokenEnc FROM settings WHERE id = 1").get() as
    | { ordersTokenEnc?: string; availabilityTokenEnc?: string }
    | undefined;
  let rotated = false;

  if (settingsRow?.ordersTokenEnc && settingsRow.availabilityTokenEnc) {
    const orders = cryptoBox.decryptWithMetadata(settingsRow.ordersTokenEnc);
    const availability = cryptoBox.decryptWithMetadata(settingsRow.availabilityTokenEnc);

    if (orders.needsReencrypt || availability.needsReencrypt) {
      db.prepare(`
        UPDATE settings
        SET ordersTokenEnc = ?, availabilityTokenEnc = ?
        WHERE id = 1
      `).run(
        orders.needsReencrypt ? cryptoBox.encrypt(orders.value) : settingsRow.ordersTokenEnc,
        availability.needsReencrypt ? cryptoBox.encrypt(availability.value) : settingsRow.availabilityTokenEnc,
      );
      rotated = true;
    }
  }

  const hasScanoSettingsTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scano_settings' LIMIT 1")
    .get();

  if (hasScanoSettingsTable) {
    const scanoRow = db.prepare("SELECT catalogTokenEnc FROM scano_settings WHERE id = 1").get() as
      | { catalogTokenEnc?: string }
      | undefined;

    if (scanoRow?.catalogTokenEnc) {
      const catalog = cryptoBox.decryptWithMetadata(scanoRow.catalogTokenEnc);
      if (catalog.needsReencrypt) {
        db.prepare(`
          UPDATE scano_settings
          SET catalogTokenEnc = ?
          WHERE id = 1
        `).run(cryptoBox.encrypt(catalog.value));
        rotated = true;
      }
    }
  }

  if (!rotated) return;

  console.warn(
    "Re-encrypted stored settings tokens with the current UPUSE_SECRET. After verifying startup, you can remove old secrets from UPUSE_SECRET_PREVIOUS.",
  );
}
