import { db } from "../../../config/db.js";
import type { AuthSession } from "../../../types/models.js";
import { createSessionToken, hashSessionToken } from "../../../services/auth/passwords.js";
import { nowIso, plusHoursIso } from "./clock.js";
import { toAppUser } from "./helpers.js";
import type { SessionRow, UserRow } from "./rows.js";

const SESSION_TTL_HOURS = 12;

export function deleteAuthSessionsForUser(userId: number) {
  return db.prepare<[number]>("DELETE FROM sessions WHERE userId = ?").run(userId).changes;
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
