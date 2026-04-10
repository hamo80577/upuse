import { createCryptoBox, createEncryptionKeyring, parseEncryptionSecretList } from "../../config/encryption.js";
import { resolveEncryptionSecret } from "../../config/secret.js";
import { dataDir, db } from "./connection.js";

function readExistingEncryptedSettings() {
  const hasSettingsTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings' LIMIT 1")
    .get();

  if (!hasSettingsTable) return [];

  const row = db.prepare("SELECT ordersTokenEnc, availabilityTokenEnc FROM settings WHERE id = 1").get() as
    | { ordersTokenEnc?: string; availabilityTokenEnc?: string }
    | undefined;

  if (!row) return [];

  return [row.ordersTokenEnc, row.availabilityTokenEnc].filter(
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
  const row = db.prepare("SELECT ordersTokenEnc, availabilityTokenEnc FROM settings WHERE id = 1").get() as
    | { ordersTokenEnc?: string; availabilityTokenEnc?: string }
    | undefined;

  if (!row?.ordersTokenEnc || !row.availabilityTokenEnc) return;

  const orders = cryptoBox.decryptWithMetadata(row.ordersTokenEnc);
  const availability = cryptoBox.decryptWithMetadata(row.availabilityTokenEnc);

  if (!orders.needsReencrypt && !availability.needsReencrypt) {
    return;
  }

  db.prepare(`
    UPDATE settings
    SET ordersTokenEnc = ?, availabilityTokenEnc = ?
    WHERE id = 1
  `).run(
    orders.needsReencrypt ? cryptoBox.encrypt(orders.value) : row.ordersTokenEnc,
    availability.needsReencrypt ? cryptoBox.encrypt(availability.value) : row.availabilityTokenEnc,
  );

  console.warn(
    "Re-encrypted stored settings tokens with the current UPUSE_SECRET. After verifying startup, you can remove old secrets from UPUSE_SECRET_PREVIOUS.",
  );
}
