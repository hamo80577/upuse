import type { AppUser, AppUserRole } from "../../../types/models.js";
import type { UserRow } from "./rows.js";

export function normalizeUserRole(role: string): AppUserRole {
  return role.trim().toLowerCase() === "admin" ? "admin" : "user";
}

export function normalizeScanoRole(role: string | null | undefined) {
  return role === "team_lead" || role === "scanner" ? role : undefined;
}

export function normalizeBooleanFlag(value: number | null | undefined, fallback = false) {
  if (typeof value === "number") {
    return value === 1;
  }
  return fallback;
}

export function toAppUser(row: Pick<UserRow, "id" | "email" | "name" | "role" | "active" | "createdAt">): AppUser {
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

export function getUserSelectQuery(whereClause: string) {
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
