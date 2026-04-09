import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { db } from "../config/db.js";
import type { ScanoTaskId } from "../types/models.js";

interface ScanoRunnerSessionRow {
  token: string;
  taskId: ScanoTaskId;
  actorUserId: number;
  teamMemberId: number;
  chainId: number;
  vendorId: number;
  globalEntityId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScanoRunnerSession {
  token: string;
  taskId: ScanoTaskId;
  actorUserId: number;
  teamMemberId: number;
  chainId: number;
  vendorId: number;
  globalEntityId: string;
  expiresAt: number;
}

export interface CreateScanoRunnerSessionInput {
  taskId: ScanoTaskId;
  actorUserId: number;
  teamMemberId: number;
  chainId: number;
  vendorId: number;
  globalEntityId: string;
}

export interface ScanoRunnerSessionStore {
  initialize(): void;
  pruneRunnerSessions(nowMs?: number): void;
  createRunnerSession(input: CreateScanoRunnerSessionInput, nowMs?: number): ScanoRunnerSession;
  readRunnerSession(taskId: ScanoTaskId, actorUserId: number, token: string, nowMs?: number): ScanoRunnerSession | null;
  clearRunnerSessionsForTask(taskId: ScanoTaskId): void;
  resetRunnerSessionStateForTests(): void;
}

export interface SqliteScanoRunnerSessionStoreOptions {
  sessionTtlMs: number;
  now: () => number;
}

interface ScanoRunnerSessionStatements {
  insertStatement: BetterSqlite3.Statement;
  selectByTokenStatement: BetterSqlite3.Statement<[string], ScanoRunnerSessionRow>;
  updateExpiryStatement: BetterSqlite3.Statement<[string, string, string]>;
  deleteByTokenStatement: BetterSqlite3.Statement<[string]>;
  deleteExpiredStatement: BetterSqlite3.Statement<[string]>;
  deleteByTaskStatement: BetterSqlite3.Statement<[ScanoTaskId]>;
  deleteAllStatement: BetterSqlite3.Statement;
}

export const DEFAULT_SCANO_RUNNER_SESSION_TTL_MS = 30 * 60 * 1000;

function toIso(value: number) {
  return new Date(value).toISOString();
}

function toMs(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function createSqliteScanoRunnerSessionStore(
  database: BetterSqlite3.Database,
  options: Partial<SqliteScanoRunnerSessionStoreOptions> = {},
): ScanoRunnerSessionStore {
  const resolvedOptions: SqliteScanoRunnerSessionStoreOptions = {
    sessionTtlMs: options.sessionTtlMs ?? DEFAULT_SCANO_RUNNER_SESSION_TTL_MS,
    now: options.now ?? (() => Date.now()),
  };

  function resolveNow(nowMs?: number) {
    return nowMs ?? resolvedOptions.now();
  }

  function toPublicSession(row: ScanoRunnerSessionRow): ScanoRunnerSession {
    return {
      token: row.token,
      taskId: row.taskId,
      actorUserId: row.actorUserId,
      teamMemberId: row.teamMemberId,
      chainId: row.chainId,
      vendorId: row.vendorId,
      globalEntityId: row.globalEntityId,
      expiresAt: toMs(row.expiresAt) ?? 0,
    };
  }

  let statements: ScanoRunnerSessionStatements | null = null;

  function getStatements(): ScanoRunnerSessionStatements {
    if (statements) {
      return statements;
    }

    statements = {
      insertStatement: database.prepare(`
        INSERT INTO scano_runner_sessions (
          token,
          taskId,
          actorUserId,
          teamMemberId,
          chainId,
          vendorId,
          globalEntityId,
          expiresAt,
          createdAt,
          updatedAt
        ) VALUES (
          @token,
          @taskId,
          @actorUserId,
          @teamMemberId,
          @chainId,
          @vendorId,
          @globalEntityId,
          @expiresAt,
          @createdAt,
          @updatedAt
        )
      `),
      selectByTokenStatement: database.prepare<[string], ScanoRunnerSessionRow>(`
        SELECT
          token,
          taskId,
          actorUserId,
          teamMemberId,
          chainId,
          vendorId,
          globalEntityId,
          expiresAt,
          createdAt,
          updatedAt
        FROM scano_runner_sessions
        WHERE token = ?
        LIMIT 1
      `),
      updateExpiryStatement: database.prepare<[string, string, string]>(`
        UPDATE scano_runner_sessions
        SET
          expiresAt = ?,
          updatedAt = ?
        WHERE token = ?
      `),
      deleteByTokenStatement: database.prepare<[string]>("DELETE FROM scano_runner_sessions WHERE token = ?"),
      deleteExpiredStatement: database.prepare<[string]>(`
        DELETE FROM scano_runner_sessions
        WHERE expiresAt <= ?
      `),
      deleteByTaskStatement: database.prepare<[ScanoTaskId]>("DELETE FROM scano_runner_sessions WHERE taskId = ?"),
      deleteAllStatement: database.prepare("DELETE FROM scano_runner_sessions"),
    };

    return statements;
  }

  function pruneRunnerSessions(nowMs?: number) {
    getStatements().deleteExpiredStatement.run(toIso(resolveNow(nowMs)));
  }

  return {
    initialize() {
      pruneRunnerSessions();
    },

    pruneRunnerSessions,

    createRunnerSession(input, nowMs?: number) {
      const effectiveNowMs = resolveNow(nowMs);
      pruneRunnerSessions(effectiveNowMs);

      const { insertStatement } = getStatements();
      const createdAt = toIso(effectiveNowMs);
      const session: ScanoRunnerSessionRow = {
        token: randomUUID(),
        taskId: input.taskId,
        actorUserId: input.actorUserId,
        teamMemberId: input.teamMemberId,
        chainId: input.chainId,
        vendorId: input.vendorId,
        globalEntityId: input.globalEntityId,
        expiresAt: toIso(effectiveNowMs + resolvedOptions.sessionTtlMs),
        createdAt,
        updatedAt: createdAt,
      };

      insertStatement.run(session);
      return toPublicSession(session);
    },

    readRunnerSession(taskId, actorUserId, token, nowMs?: number) {
      const effectiveNowMs = resolveNow(nowMs);
      pruneRunnerSessions(effectiveNowMs);

      const normalizedToken = token.trim();
      if (!normalizedToken) {
        return null;
      }

      const { deleteByTokenStatement, selectByTokenStatement, updateExpiryStatement } = getStatements();
      const session = selectByTokenStatement.get(normalizedToken);
      if (!session || session.taskId !== taskId || session.actorUserId !== actorUserId) {
        return null;
      }

      const expiresAtMs = toMs(session.expiresAt);
      if (expiresAtMs === null || expiresAtMs <= effectiveNowMs) {
        deleteByTokenStatement.run(session.token);
        return null;
      }

      const refreshedExpiresAt = toIso(effectiveNowMs + resolvedOptions.sessionTtlMs);
      const refreshedUpdatedAt = toIso(effectiveNowMs);
      updateExpiryStatement.run(refreshedExpiresAt, refreshedUpdatedAt, session.token);

      return toPublicSession({
        ...session,
        expiresAt: refreshedExpiresAt,
        updatedAt: refreshedUpdatedAt,
      });
    },

    clearRunnerSessionsForTask(taskId) {
      getStatements().deleteByTaskStatement.run(taskId);
    },

    resetRunnerSessionStateForTests() {
      getStatements().deleteAllStatement.run();
    },
  };
}

export const scanoRunnerSessionStore = createSqliteScanoRunnerSessionStore(db);

export function initializeScanoRunnerSessionStore() {
  scanoRunnerSessionStore.initialize();
}
