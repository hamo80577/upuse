import { db } from "../config/db.js";
import { createSessionToken, hashPassword, hashSessionToken, normalizeEmail, verifyPassword } from "./auth/passwords.js";
const SESSION_TTL_HOURS = 12;
export class AuthStoreError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.name = "AuthStoreError";
        this.status = status;
        this.code = code;
    }
}
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
function countActiveAdminUsers(excludingUserId) {
    if (typeof excludingUserId === "number") {
        const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM users
      WHERE active = 1 AND LOWER(TRIM(role)) = 'admin' AND id != ?
    `).get(excludingUserId);
        return Number(row?.count ?? 0);
    }
    const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM users
    WHERE active = 1 AND LOWER(TRIM(role)) = 'admin'
  `).get();
    return Number(row?.count ?? 0);
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
export function updateUser(input) {
    const existing = getUserById(input.id);
    if (!existing) {
        throw new AuthStoreError("User not found", 404, "USER_NOT_FOUND");
    }
    const normalizedEmail = normalizeEmail(input.email);
    const trimmedName = input.name.trim();
    const trimmedPassword = input.password?.trim() || undefined;
    if (input.actorUserId === input.id && input.role !== "admin") {
        throw new AuthStoreError("You cannot remove admin access from your current session.", 409, "SELF_ROLE_CHANGE_FORBIDDEN");
    }
    if (existing.role === "admin" && input.role !== "admin" && countActiveAdminUsers(existing.id) === 0) {
        throw new AuthStoreError("At least one admin user must remain.", 409, "LAST_ADMIN_REQUIRED");
    }
    if (trimmedPassword) {
        db.prepare(`
      UPDATE users
      SET email = ?, name = ?, role = ?, passwordHash = ?
      WHERE id = ?
    `).run(normalizedEmail, trimmedName, input.role, hashPassword(trimmedPassword), input.id);
    }
    else {
        db.prepare(`
      UPDATE users
      SET email = ?, name = ?, role = ?
      WHERE id = ?
    `).run(normalizedEmail, trimmedName, input.role, input.id);
    }
    const updated = getUserById(input.id);
    if (!updated) {
        throw new AuthStoreError("User not found after update", 500, "USER_UPDATE_MISSING");
    }
    return toAppUser(updated);
}
export function deleteUserById(input) {
    const existing = getUserById(input.id);
    if (!existing) {
        throw new AuthStoreError("User not found", 404, "USER_NOT_FOUND");
    }
    if (input.actorUserId === input.id) {
        throw new AuthStoreError("You cannot delete your current account.", 409, "SELF_DELETE_FORBIDDEN");
    }
    if (existing.role === "admin" && countActiveAdminUsers(existing.id) === 0) {
        throw new AuthStoreError("At least one admin user must remain.", 409, "LAST_ADMIN_REQUIRED");
    }
    const result = db.prepare("DELETE FROM users WHERE id = ?").run(input.id);
    return result.changes > 0;
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
