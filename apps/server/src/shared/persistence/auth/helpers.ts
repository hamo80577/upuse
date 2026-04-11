import type { AppUser, AppUserRole } from "../../../types/models.js";
import { applySystemUserProjections } from "../../../core/systems/auth/registry/index.js";
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

  return applySystemUserProjections(user);
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
      u.isPrimaryAdmin
    FROM users u
    ${whereClause}
  `;
}
