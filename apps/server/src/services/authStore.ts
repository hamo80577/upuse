import { db } from "../config/db.js";
import type { AppUser, AppUserRole, AuthSession, ScanoRole } from "../types/models.js";
import { createSessionToken, hashPassword, hashSessionToken, normalizeEmail, verifyPassword } from "./auth/passwords.js";

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: string;
  passwordHash: string;
  active: number;
  createdAt: string;
  upuseAccess: number;
  isPrimaryAdmin: number;
  scanoMemberId?: number | null;
  scanoRole?: string | null;
}

interface SessionRow {
  token: string;
  userId: number;
  expiresAt: string;
  createdAt: string;
}

const SESSION_TTL_HOURS = 12;

export class AuthStoreError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "AuthStoreError";
    this.status = status;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function plusHoursIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function deleteAuthSessionsForUser(userId: number) {
  return db.prepare<[number]>("DELETE FROM sessions WHERE userId = ?").run(userId).changes;
}

function normalizeUserRole(role: string): AppUserRole {
  return role.trim().toLowerCase() === "admin" ? "admin" : "user";
}

function normalizeScanoRole(role: string | null | undefined) {
  return role === "team_lead" || role === "scanner" ? role : undefined;
}

function normalizeBooleanFlag(value: number | null | undefined, fallback = false) {
  if (typeof value === "number") {
    return value === 1;
  }
  return fallback;
}

function toAppUser(row: Pick<UserRow, "id" | "email" | "name" | "role" | "active" | "createdAt">): AppUser {
  const user: AppUser = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: normalizeUserRole(row.role),
    active: !!row.active,
    createdAt: row.createdAt,
    upuseAccess: normalizeBooleanFlag((row as UserRow).upuseAccess, true),
    isPrimaryAdmin: normalizeBooleanFlag((row as UserRow).isPrimaryAdmin, false),
  };

  const scanoRole = normalizeScanoRole((row as UserRow).scanoRole);
  const scanoMemberId = typeof (row as UserRow).scanoMemberId === "number" ? (row as UserRow).scanoMemberId : undefined;
  if (scanoRole && scanoMemberId) {
    user.scanoRole = scanoRole;
    user.scanoMemberId = scanoMemberId;
  }

  return user;
}

function getUserSelectQuery(whereClause: string) {
  return `
    SELECT
      u.id,
      u.email,
      u.name,
      u.role,
      u.passwordHash,
      u.active,
      u.createdAt,
      u.upuseAccess,
      u.isPrimaryAdmin,
      stm.id AS scanoMemberId,
      stm.role AS scanoRole
    FROM users u
    LEFT JOIN scano_team_members stm
      ON stm.linkedUserId = u.id AND stm.active = 1
    ${whereClause}
  `;
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
  const row = db.prepare<[string], UserRow>(getUserSelectQuery("WHERE u.email = ?")).get(normalized);
  return row ?? null;
}

export function getUserById(id: number) {
  const row = db.prepare<[number], UserRow>(getUserSelectQuery("WHERE u.id = ?")).get(id);
  return row ?? null;
}

export function listUsers() {
  const rows = db.prepare<[], UserRow>(`${getUserSelectQuery("")} ORDER BY u.active DESC, u.createdAt ASC, u.email ASC`).all();
  return rows.map(toAppUser);
}

function countActiveAdminUsers(excludingUserId?: number) {
  if (typeof excludingUserId === "number") {
    const row = db.prepare<[number], { count: number }>(`
      SELECT COUNT(*) AS count
      FROM users
      WHERE active = 1 AND upuseAccess = 1 AND LOWER(TRIM(role)) = 'admin' AND id != ?
    `).get(excludingUserId);
    return Number(row?.count ?? 0);
  }

  const row = db.prepare<[], { count: number }>(`
    SELECT COUNT(*) AS count
    FROM users
    WHERE active = 1 AND upuseAccess = 1 AND LOWER(TRIM(role)) = 'admin'
  `).get();
  return Number(row?.count ?? 0);
}

export function createUser(input: {
  email: string;
  name: string;
  upuseAccess: boolean;
  upuseRole?: AppUserRole;
  scanoAccessRole?: ScanoRole;
  password: string;
}) {
  const normalizedEmail = normalizeEmail(input.email);
  const createdAt = nowIso();
  const trimmedName = input.name.trim();
  const nextRole = input.upuseAccess ? (input.upuseRole ?? "user") : "user";

  const createdUserId = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO users (email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
      VALUES (?, ?, ?, ?, 1, ?, ?, 0)
    `).run(normalizedEmail, trimmedName, nextRole, hashPassword(input.password), createdAt, input.upuseAccess ? 1 : 0);

    syncScanoAccessForUser(Number(info.lastInsertRowid), trimmedName, input.scanoAccessRole);
    return Number(info.lastInsertRowid);
  })();

  const created = getUserById(createdUserId);
  if (!created) {
    throw new AuthStoreError("User not found after create", 500, "USER_CREATE_MISSING");
  }

  return toAppUser(created);
}

export function updateUser(input: {
  id: number;
  email: string;
  name: string;
  upuseAccess: boolean;
  upuseRole?: AppUserRole;
  scanoAccessRole?: ScanoRole;
  password?: string;
  actorUserId?: number | null;
}) {
  const existing = getUserById(input.id);
  if (!existing) {
    throw new AuthStoreError("User not found", 404, "USER_NOT_FOUND");
  }
  if (!existing.active) {
    throw new AuthStoreError("Archived users cannot be edited.", 409, "USER_ARCHIVED");
  }

  const normalizedEmail = normalizeEmail(input.email);
  const trimmedName = input.name.trim();
  const trimmedPassword = input.password?.trim() || undefined;
  const nextRole = input.upuseAccess
    ? (input.upuseRole ?? existing.role)
    : (existing.isPrimaryAdmin ? "admin" : "user");
  const isRevokingScanoAccess = !!existing.scanoRole && !input.scanoAccessRole;

  if (existing.isPrimaryAdmin && (!input.upuseAccess || nextRole !== "admin")) {
    throw new AuthStoreError("The primary admin must keep UPuse admin access.", 409, "PRIMARY_ADMIN_UPUSE_ACCESS_REQUIRED");
  }

  if (input.actorUserId === input.id && (!input.upuseAccess || nextRole !== "admin")) {
    throw new AuthStoreError("You cannot remove UPuse admin access from your current session.", 409, "SELF_ROLE_CHANGE_FORBIDDEN");
  }

  if (existing.upuseAccess && existing.role === "admin" && (!input.upuseAccess || nextRole !== "admin") && countActiveAdminUsers(existing.id) === 0) {
    throw new AuthStoreError("At least one admin user must remain.", 409, "LAST_ADMIN_REQUIRED");
  }
  if (isRevokingScanoAccess) {
    assertNoIncompleteScanoTaskAssignments(input.id, "Scano access cannot be removed while this user is assigned to non-completed Scano tasks.", "SCANO_ACCESS_ACTIVE_TASKS");
  }

  db.transaction(() => {
    if (trimmedPassword) {
      db.prepare(`
        UPDATE users
        SET email = ?, name = ?, role = ?, upuseAccess = ?, passwordHash = ?
        WHERE id = ?
      `).run(normalizedEmail, trimmedName, nextRole, input.upuseAccess ? 1 : 0, hashPassword(trimmedPassword), input.id);
      // Permission changes are read live from the DB, but password changes must revoke existing bearer sessions.
      deleteAuthSessionsForUser(input.id);
    } else {
      db.prepare(`
        UPDATE users
        SET email = ?, name = ?, role = ?, upuseAccess = ?
        WHERE id = ?
      `).run(normalizedEmail, trimmedName, nextRole, input.upuseAccess ? 1 : 0, input.id);
    }

    syncScanoAccessForUser(input.id, trimmedName, input.scanoAccessRole);
  })();

  const updated = getUserById(input.id);
  if (!updated) {
    throw new AuthStoreError("User not found after update", 500, "USER_UPDATE_MISSING");
  }

  return toAppUser(updated);
}

export function deleteUserById(input: { id: number; actorUserId?: number | null }) {
  const existing = getUserById(input.id);
  if (!existing) {
    throw new AuthStoreError("User not found", 404, "USER_NOT_FOUND");
  }
  if (!existing.active) {
    throw new AuthStoreError("This user is already archived.", 409, "USER_ALREADY_ARCHIVED");
  }

  if (existing.isPrimaryAdmin) {
    throw new AuthStoreError("The primary admin account cannot be archived.", 409, "PRIMARY_ADMIN_DELETE_FORBIDDEN");
  }

  if (input.actorUserId === input.id) {
    throw new AuthStoreError("You cannot archive your current account.", 409, "SELF_DELETE_FORBIDDEN");
  }

  if (existing.upuseAccess && existing.role === "admin" && countActiveAdminUsers(existing.id) === 0) {
    throw new AuthStoreError("At least one admin user must remain.", 409, "LAST_ADMIN_REQUIRED");
  }
  assertNoIncompleteScanoTaskAssignments(input.id, "This user cannot be archived while assigned to non-completed Scano tasks.", "USER_ARCHIVE_ACTIVE_TASKS");

  const archivedAt = nowIso();
  const result = db.transaction(() => {
    const updated = db.prepare<[number]>(`
      UPDATE users
      SET active = 0, upuseAccess = 0
      WHERE id = ?
    `).run(input.id);

    db.prepare<[string, number]>(`
      UPDATE scano_team_members
      SET active = 0, updatedAt = ?
      WHERE linkedUserId = ?
    `).run(archivedAt, input.id);

    deleteAuthSessionsForUser(input.id);
    return updated.changes > 0;
  })();

  return result;
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
      u.createdAt,
      u.upuseAccess,
      u.isPrimaryAdmin,
      stm.id AS scanoMemberId,
      stm.role AS scanoRole
    FROM sessions s
    INNER JOIN users u ON u.id = s.userId
    LEFT JOIN scano_team_members stm
      ON stm.linkedUserId = u.id AND stm.active = 1
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

interface ExistingScanoMemberRow {
  id: number;
  active?: number;
}

function syncScanoAccessForUser(userId: number, name: string, scanoAccessRole?: ScanoRole) {
  const existingMember = db.prepare<[number], ExistingScanoMemberRow>(`
    SELECT id
    FROM scano_team_members
    WHERE linkedUserId = ?
  `).get(userId);

  if (scanoAccessRole) {
    if (existingMember) {
      db.prepare(`
        UPDATE scano_team_members
        SET
          name = ?,
          role = ?,
          active = 1,
          updatedAt = ?
        WHERE linkedUserId = ?
      `).run(name, scanoAccessRole, nowIso(), userId);
      return;
    }

    const createdAt = nowIso();
    db.prepare(`
      INSERT INTO scano_team_members (name, linkedUserId, role, active, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(name, userId, scanoAccessRole, createdAt, createdAt);
    return;
  }

  if (existingMember) {
    db.prepare(`
      UPDATE scano_team_members
      SET
        name = ?,
        active = 0,
        updatedAt = ?
      WHERE linkedUserId = ?
    `).run(name, nowIso(), userId);
  }
}

function assertNoIncompleteScanoTaskAssignments(userId: number, message: string, code: string) {
  const activeAssignment = db.prepare<[number], { taskId: string }>(`
    SELECT t.id AS taskId
    FROM scano_team_members m
    INNER JOIN scano_task_assignees a
      ON a.teamMemberId = m.id
    INNER JOIN scano_tasks t
      ON t.id = a.taskId
    WHERE m.linkedUserId = ?
      AND t.status IN ('pending', 'in_progress', 'awaiting_review')
    LIMIT 1
  `).get(userId);

  if (activeAssignment) {
    throw new AuthStoreError(message, 409, code);
  }
}
