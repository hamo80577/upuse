import type BetterSqlite3 from "better-sqlite3";
import { db } from "../config/db.js";
import { resolveSecurityConfig } from "../config/security.js";

interface LoginAttemptRow {
  key: string;
  count: number;
  windowStartedAt: string;
  blockedUntil: string | null;
  updatedAt: string;
}

export interface LoginThrottleAttemptState {
  count: number;
  blockedUntilMs: number | null;
}

export interface LoginThrottleStore {
  initialize(): void;
  pruneLoginAttempts(nowMs?: number): void;
  getBlockedUntil(key: string, nowMs?: number): number | null;
  registerFailedLoginAttempt(key: string, nowMs?: number): LoginThrottleAttemptState;
  clearLoginAttempts(key: string): void;
  resetLoginRateLimitStateForTests(): void;
}

export interface SqliteLoginThrottleStoreOptions {
  maxKeys: number;
  maxAttempts: number;
  windowMs: number;
  blockMs: number;
  now: () => number;
}

interface LoginThrottleStatements {
  countRowsStatement: BetterSqlite3.Statement<[], { count: number }>;
  selectByKeyStatement: BetterSqlite3.Statement<[string], LoginAttemptRow>;
  upsertStatement: BetterSqlite3.Statement;
  deleteByKeyStatement: BetterSqlite3.Statement<[string]>;
  deleteOldestStatement: BetterSqlite3.Statement<[number]>;
  deleteExpiredStatement: BetterSqlite3.Statement<[string, string]>;
  deleteAllStatement: BetterSqlite3.Statement;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_BLOCK_MS = 15 * 60 * 1000;

function toIso(value: number) {
  return new Date(value).toISOString();
}

function toMs(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function createSqliteLoginThrottleStore(
  database: BetterSqlite3.Database,
  options: Partial<SqliteLoginThrottleStoreOptions> = {},
): LoginThrottleStore {
  const resolvedOptions: SqliteLoginThrottleStoreOptions = {
    maxKeys: options.maxKeys ?? resolveSecurityConfig().loginRateLimitMaxKeys,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
    blockMs: options.blockMs ?? DEFAULT_BLOCK_MS,
    now: options.now ?? (() => Date.now()),
  };

  function resolveNow(nowMs?: number) {
    return nowMs ?? resolvedOptions.now();
  }

  let statements: LoginThrottleStatements | null = null;

  function getStatements(): LoginThrottleStatements {
    if (statements) {
      return statements;
    }

    statements = {
      countRowsStatement: database.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM login_attempts"),
      selectByKeyStatement: database.prepare<[string], LoginAttemptRow>(`
        SELECT key, count, windowStartedAt, blockedUntil, updatedAt
        FROM login_attempts
        WHERE key = ?
        LIMIT 1
      `),
      upsertStatement: database.prepare(`
        INSERT INTO login_attempts (key, count, windowStartedAt, blockedUntil, updatedAt)
        VALUES (@key, @count, @windowStartedAt, @blockedUntil, @updatedAt)
        ON CONFLICT(key) DO UPDATE SET
          count = excluded.count,
          windowStartedAt = excluded.windowStartedAt,
          blockedUntil = excluded.blockedUntil,
          updatedAt = excluded.updatedAt
      `),
      deleteByKeyStatement: database.prepare<[string]>("DELETE FROM login_attempts WHERE key = ?"),
      deleteOldestStatement: database.prepare<[number]>(`
        DELETE FROM login_attempts
        WHERE key IN (
          SELECT key
          FROM login_attempts
          ORDER BY datetime(updatedAt) ASC, key ASC
          LIMIT ?
        )
      `),
      deleteExpiredStatement: database.prepare<[string, string]>(`
        DELETE FROM login_attempts
        WHERE windowStartedAt < ?
          AND (blockedUntil IS NULL OR blockedUntil <= ?)
      `),
      deleteAllStatement: database.prepare("DELETE FROM login_attempts"),
    };

    return statements;
  }

  function pruneLoginAttempts(nowMs?: number) {
    const effectiveNowMs = resolveNow(nowMs);
    const nowIso = toIso(effectiveNowMs);
    const oldestWindowIso = toIso(effectiveNowMs - resolvedOptions.windowMs);
    getStatements().deleteExpiredStatement.run(oldestWindowIso, nowIso);
  }

  function enforceCapacity() {
    const { countRowsStatement, deleteOldestStatement } = getStatements();
    const row = countRowsStatement.get();
    const overflow = Math.max(0, (row?.count ?? 0) - resolvedOptions.maxKeys);
    if (overflow > 0) {
      deleteOldestStatement.run(overflow);
    }
  }

  return {
    initialize() {
      pruneLoginAttempts();
    },

    pruneLoginAttempts,

    getBlockedUntil(key: string, nowMs?: number) {
      const effectiveNowMs = resolveNow(nowMs);
      pruneLoginAttempts(effectiveNowMs);

      const { deleteByKeyStatement, selectByKeyStatement, upsertStatement } = getStatements();
      const row = selectByKeyStatement.get(key);
      if (!row) {
        return null;
      }

      const blockedUntilMs = toMs(row.blockedUntil);
      if (blockedUntilMs === null) {
        return null;
      }

      if (blockedUntilMs <= effectiveNowMs) {
        deleteByKeyStatement.run(key);
        return null;
      }

      upsertStatement.run({
        ...row,
        updatedAt: toIso(effectiveNowMs),
      });

      return blockedUntilMs;
    },

    registerFailedLoginAttempt(key: string, nowMs?: number) {
      const effectiveNowMs = resolveNow(nowMs);
      pruneLoginAttempts(effectiveNowMs);
      const { selectByKeyStatement, upsertStatement } = getStatements();

      return database.transaction((attemptKey: string, transactionNowMs: number) => {
        const existing = selectByKeyStatement.get(attemptKey);
        const existingWindowStartedAtMs = toMs(existing?.windowStartedAt);
        const withinWindow =
          existing &&
          existingWindowStartedAtMs !== null &&
          transactionNowMs - existingWindowStartedAtMs <= resolvedOptions.windowMs;
        const count = withinWindow ? existing.count + 1 : 1;
        const blockedUntilMs = count >= resolvedOptions.maxAttempts ? transactionNowMs + resolvedOptions.blockMs : null;
        const nextState = {
          key: attemptKey,
          count,
          windowStartedAt: withinWindow ? existing.windowStartedAt : toIso(transactionNowMs),
          blockedUntil: blockedUntilMs === null ? null : toIso(blockedUntilMs),
          updatedAt: toIso(transactionNowMs),
        };

        upsertStatement.run(nextState);
        enforceCapacity();

        return {
          count,
          blockedUntilMs,
        } satisfies LoginThrottleAttemptState;
      })(key, effectiveNowMs);
    },

    clearLoginAttempts(key: string) {
      getStatements().deleteByKeyStatement.run(key);
    },

    resetLoginRateLimitStateForTests() {
      getStatements().deleteAllStatement.run();
    },
  };
}

const { loginRateLimitMaxKeys } = resolveSecurityConfig();

export const loginThrottleStore = createSqliteLoginThrottleStore(db, {
  maxKeys: loginRateLimitMaxKeys,
});

export function initializeLoginThrottleStore() {
  loginThrottleStore.initialize();
}
