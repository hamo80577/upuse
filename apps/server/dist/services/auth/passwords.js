import crypto from "node:crypto";
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
export function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
    }).toString("hex");
    return `scrypt$${salt}$${derived}`;
}
export function verifyPassword(password, payload) {
    const [scheme, salt, expected] = payload.split("$");
    if (scheme !== "scrypt" || !salt || !expected)
        return false;
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
    });
    const expectedBuffer = Buffer.from(expected, "hex");
    if (derived.length !== expectedBuffer.length)
        return false;
    return crypto.timingSafeEqual(derived, expectedBuffer);
}
export function createSessionToken() {
    return crypto.randomBytes(32).toString("hex");
}
export function hashSessionToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}
