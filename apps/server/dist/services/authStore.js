import { db } from "../config/db.js";
import { createSessionToken, hashPassword, hashSessionToken, normalizeEmail, verifyPassword } from "./auth/passwords.js";
const SESSION_TTL_HOURS = 12;
function nowIso() {
    return new Date().toISOString();
}
function plusHoursIso(hours) {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}
function normalizeUserRole(role) {
    return role.trim().toLowerCase() === "admin" ? "admin" : "user";
}
function toAppUser(row) {
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        role: normalizeUserRole(row.role),
        active: !!row.active,
        createdAt: row.createdAt,
    };
}
export function ensureUserSeed(input) {
    const email = normalizeEmail(input.email);
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing)
        return existing.id;
    const createdAt = nowIso();
    const info = db.prepare(`
    INSERT INTO users (email, name, role, passwordHash, active, createdAt)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(email, input.name.trim(), input.role, hashPassword(input.password), createdAt);
    return Number(info.lastInsertRowid);
}
export function getUserByEmail(email) {
    const normalized = normalizeEmail(email);
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalized);
    return row ?? null;
}
export function getUserById(id) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ?? null;
}
export function listUsers() {
    const rows = db.prepare("SELECT * FROM users ORDER BY createdAt ASC, email ASC").all();
    return rows.map(toAppUser);
}
export function createUser(input) {
    const normalizedEmail = normalizeEmail(input.email);
    const createdAt = nowIso();
    const info = db.prepare(`
    INSERT INTO users (email, name, role, passwordHash, active, createdAt)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(normalizedEmail, input.name.trim(), input.role, hashPassword(input.password), createdAt);
    return toAppUser({
        id: Number(info.lastInsertRowid),
        email: normalizedEmail,
        name: input.name.trim(),
        role: input.role,
        active: 1,
        createdAt,
    });
}
export function verifyUserCredentials(email, password) {
    const row = getUserByEmail(email);
    if (!row || !row.active)
        return null;
    if (!verifyPassword(password, row.passwordHash))
        return null;
    return toAppUser(row);
}
export function createAuthSession(userId) {
    const token = createSessionToken();
    const persistedToken = hashSessionToken(token);
    const createdAt = nowIso();
    const expiresAt = plusHoursIso(SESSION_TTL_HOURS);
    db.prepare(`
    INSERT INTO sessions (token, userId, expiresAt, createdAt)
    VALUES (?, ?, ?, ?)
  `).run(persistedToken, userId, expiresAt, createdAt);
    return {
        token,
        userId,
        expiresAt,
        createdAt,
    };
}
export function deleteAuthSession(token) {
    return db.prepare("DELETE FROM sessions WHERE token = ?").run(hashSessionToken(token)).changes;
}
export function pruneExpiredSessions() {
    return db.prepare("DELETE FROM sessions WHERE expiresAt <= ?").run(nowIso()).changes;
}
export function getSessionUserByToken(token) {
    pruneExpiredSessions();
    const persistedToken = hashSessionToken(token);
    const row = db.prepare(`
    SELECT
      s.token,
      s.userId,
      s.expiresAt,
      s.createdAt AS sessionCreatedAt,
      u.id,
      u.email,
      u.name,
      u.role,
      u.passwordHash,
      u.active,
      u.createdAt
    FROM sessions s
    INNER JOIN users u ON u.id = s.userId
    WHERE s.token = ? AND s.expiresAt > ?
  `).get(persistedToken, nowIso());
    if (!row || !row.active)
        return null;
    return {
        user: toAppUser(row),
        session: {
            token: row.token,
            userId: row.userId,
            expiresAt: row.expiresAt,
            createdAt: row.sessionCreatedAt,
        },
    };
}
