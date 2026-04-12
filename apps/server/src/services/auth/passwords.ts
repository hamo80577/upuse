import crypto from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function deriveScrypt(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey as Buffer);
      },
    );
  });
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = (await deriveScrypt(password, salt)).toString("hex");

  return `scrypt$${salt}$${derived}`;
}

export async function verifyPassword(password: string, payload: string) {
  const [scheme, salt, expected] = payload.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;

  const derived = await deriveScrypt(password, salt);
  const expectedBuffer = Buffer.from(expected, "hex");

  if (derived.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuffer);
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
