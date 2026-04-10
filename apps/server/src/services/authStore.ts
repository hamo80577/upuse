import { db } from "../config/db.js";
import type { AppUserRole, ScanoRole } from "../types/models.js";
import { hashPassword, normalizeEmail, verifyPassword } from "./auth/passwords.js";
import { AuthStoreError } from "../shared/persistence/auth/errors.js";
import { nowIso } from "../shared/persistence/auth/clock.js";
import { getUserSelectQuery, toAppUser } from "../shared/persistence/auth/helpers.js";
import type { UserRow } from "../shared/persistence/auth/rows.js";
import {
  createAuthSession,
  deleteAuthSession,
  deleteAuthSessionsForUser,
  getSessionUserByToken,
  pruneExpiredSessions,
} from "../shared/persistence/auth/sessionStore.js";
import { assertUserAccessRevocationAllowed, syncUserAccess } from "../shared/persistence/auth/userAccessService.js";

export { AuthStoreError, createAuthSession, deleteAuthSession, getSessionUserByToken, pruneExpiredSessions };

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

    const userId = Number(info.lastInsertRowid);
    syncUserAccess({
      userId,
      name: trimmedName,
      upuseAccess: input.upuseAccess,
      upuseRole: nextRole,
      scanoAccessRole: input.scanoAccessRole,
    });

    return userId;
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
  const existingUser = toAppUser(existing);
  if (!existing.active) {
    throw new AuthStoreError("Archived users cannot be edited.", 409, "USER_ARCHIVED");
  }

  const normalizedEmail = normalizeEmail(input.email);
  const trimmedName = input.name.trim();
  const trimmedPassword = input.password?.trim() || undefined;
  const nextRole: AppUserRole = input.upuseAccess
    ? (input.upuseRole ?? existingUser.role)
    : (existing.isPrimaryAdmin ? "admin" : "user");

  if (existing.isPrimaryAdmin && (!input.upuseAccess || nextRole !== "admin")) {
    throw new AuthStoreError("The primary admin must keep UPuse admin access.", 409, "PRIMARY_ADMIN_UPUSE_ACCESS_REQUIRED");
  }

  if (input.actorUserId === input.id && (!input.upuseAccess || nextRole !== "admin")) {
    throw new AuthStoreError("You cannot remove UPuse admin access from your current session.", 409, "SELF_ROLE_CHANGE_FORBIDDEN");
  }

  if (existing.upuseAccess && existing.role === "admin" && (!input.upuseAccess || nextRole !== "admin") && countActiveAdminUsers(existing.id) === 0) {
    throw new AuthStoreError("At least one admin user must remain.", 409, "LAST_ADMIN_REQUIRED");
  }

  assertUserAccessRevocationAllowed({
    userId: input.id,
    currentUpuseAccess: existingUser.upuseAccess,
    currentUpuseRole: existingUser.role,
    currentScanoAccessRole: existingUser.scanoRole,
    nextUpuseAccess: input.upuseAccess,
    nextUpuseRole: nextRole,
    nextScanoAccessRole: input.scanoAccessRole,
  });

  db.transaction(() => {
    if (trimmedPassword) {
      db.prepare(`
        UPDATE users
        SET email = ?, name = ?, role = ?, upuseAccess = ?, passwordHash = ?
        WHERE id = ?
      `).run(normalizedEmail, trimmedName, nextRole, input.upuseAccess ? 1 : 0, hashPassword(trimmedPassword), input.id);
      deleteAuthSessionsForUser(input.id);
    } else {
      db.prepare(`
        UPDATE users
        SET email = ?, name = ?, role = ?, upuseAccess = ?
        WHERE id = ?
      `).run(normalizedEmail, trimmedName, nextRole, input.upuseAccess ? 1 : 0, input.id);
    }

    syncUserAccess({
      userId: input.id,
      name: trimmedName,
      upuseAccess: input.upuseAccess,
      upuseRole: nextRole,
      scanoAccessRole: input.scanoAccessRole,
    });
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
  const existingUser = toAppUser(existing);
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

  assertUserAccessRevocationAllowed({
    userId: input.id,
    currentUpuseAccess: existingUser.upuseAccess,
    currentUpuseRole: existingUser.role,
    currentScanoAccessRole: existingUser.scanoRole,
    nextUpuseAccess: false,
    nextUpuseRole: existingUser.role,
    nextScanoAccessRole: undefined,
    errorOverrides: {
      scano: {
        message: "This user cannot be archived while assigned to non-completed Scano tasks.",
        code: "USER_ARCHIVE_ACTIVE_TASKS",
      },
    },
  });

  const archivedAt = nowIso();
  const result = db.transaction(() => {
    const updated = db.prepare<[number]>(`
      UPDATE users
      SET active = 0, upuseAccess = 0
      WHERE id = ?
    `).run(input.id);

    syncUserAccess({
      userId: input.id,
      name: existingUser.name,
      upuseAccess: false,
      upuseRole: existingUser.role,
      scanoAccessRole: undefined,
    });

    db.prepare<[string, number]>(`
      UPDATE scano_team_members
      SET updatedAt = ?
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
