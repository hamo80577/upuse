import { db } from "../config/db.js";
import type { AppUser, AppUserRole, AuthSession } from "../types/models.js";
import { createSessionToken, hashPassword, hashSessionToken, normalizeEmail, verifyPassword } from "./auth/passwords.js";

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: string;
  passwordHash: string;
  active: number;
  createdAt: string;
}

interface SessionRow {
  token: string;
  userId: number;
  expiresAt: string;
  createdAt: string;
}

const SESSION_TTL_HOURS = 12;

function nowIso() {
  return new Date().toISOString();
}

function plusHoursIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function normalizeUserRole(role: string): AppUserRole {
  return role.trim().toLowerCase() === "admin" ? "admin" : "user";
}

function toAppUser(row: Pick<UserRow, "id" | "email" | "name" | "role" | "active" | "createdAt">): AppUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: normalizeUserRole(row.role),
    active: !!row.active,
    createdAt: row.createdAt,
  };
}

export function ensureUserSeed(input: {
  email: string;
  name: string;
  role: AppUserRole;
  password: string;
}) {
  const email = normalizeEmail(input.email);
  const existing = db.prepare<[string], Pick<UserRow, "id">>("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return existing.id;

  const createdAt = nowIso();
  const info = db.prepare(`
    INSERT INTO users (email, name, role, passwordHash, active, createdAt)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(email, input.name.trim(), input.role, hashPassword(input.password), createdAt);

  return Number(info.lastInsertRowid);
}

export function getUserByEmail(email: string) {
  const normalized = normalizeEmail(email);
  const row = db.prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?").get(normalized);
  return row ?? null;
}

export function getUserById(id: number) {
  const row = db.prepare<[number], UserRow>("SELECT * FROM users WHERE id = ?").get(id);
  return row ?? null;
}

export function listUsers() {
  const rows = db.prepare<[], UserRow>("SELECT * FROM users ORDER BY createdAt ASC, email ASC").all();
  return rows.map(toAppUser);
}

export function createUser(input: {
  email: string;
  name: string;
  role: AppUserRole;
  password: string;
}) {
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

export function verifyUserCredentials(email: string, password: string) {
  const row = getUserByEmail(email);
  if (!row || !row.active) return null;
  if (!verifyPassword(password, row.passwordHash)) return null;
  return toAppUser(row);
}

export function createAuthSession(userId: number): AuthSession {
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

export function deleteAuthSession(token: string) {
  return db.prepare<[string]>("DELETE FROM sessions WHERE token = ?").run(hashSessionToken(token)).changes;
}

export function pruneExpiredSessions() {
  return db.prepare<[string]>("DELETE FROM sessions WHERE expiresAt <= ?").run(nowIso()).changes;
}

export function getSessionUserByToken(token: string) {
  pruneExpiredSessions();
  const persistedToken = hashSessionToken(token);
  const row = db.prepare<[string, string], UserRow & SessionRow & { sessionCreatedAt: string }>(`
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

  if (!row || !row.active) return null;

  return {
    user: toAppUser(row),
    session: {
      token: row.token,
      userId: row.userId,
      expiresAt: row.expiresAt,
      createdAt: row.sessionCreatedAt,
    } satisfies AuthSession,
  };
}
