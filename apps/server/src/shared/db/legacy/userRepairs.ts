import type Database from "better-sqlite3";

export function ensurePrimaryAdminUser(db: Database.Database) {
  const primaryRows = db.prepare(`
    SELECT id
    FROM users
    WHERE isPrimaryAdmin = 1
    ORDER BY datetime(createdAt) ASC, id ASC
  `).all() as Array<{ id: number }>;

  const keepPrimaryId = primaryRows[0]?.id ?? (
    db.prepare(`
      SELECT id
      FROM users
      WHERE LOWER(TRIM(role)) = 'admin' AND active = 1 AND upuseAccess = 1
      ORDER BY datetime(createdAt) ASC, id ASC
      LIMIT 1
    `).get() as { id: number } | undefined
  )?.id;

  if (typeof keepPrimaryId !== "number") {
    return;
  }

  db.prepare(`
    UPDATE users
    SET
      isPrimaryAdmin = CASE WHEN id = ? THEN 1 ELSE 0 END,
      upuseAccess = CASE WHEN id = ? THEN 1 ELSE upuseAccess END,
      role = CASE WHEN id = ? THEN 'admin' ELSE role END
  `).run(keepPrimaryId, keepPrimaryId, keepPrimaryId);
}

export function migrateLegacyUserRoles(db: Database.Database) {
  const usersTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1")
    .get() as { sql?: string } | undefined;

  if (!usersTable) return;

  const hasLegacyConstraint = typeof usersTable.sql === "string" && usersTable.sql.includes("'viewer'");
  const hasUnsupportedRoles = Boolean(
    db.prepare("SELECT 1 FROM users WHERE LOWER(TRIM(role)) NOT IN ('admin', 'user') LIMIT 1").get(),
  );

  if (!hasLegacyConstraint && !hasUnsupportedRoles) return;

  const runMigration = db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS users_next;

      CREATE TABLE users_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        passwordHash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        upuseAccess INTEGER NOT NULL DEFAULT 1,
        isPrimaryAdmin INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO users_next (id, email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
      SELECT
        id,
        email,
        name,
        CASE
          WHEN LOWER(TRIM(role)) = 'admin' THEN 'admin'
          ELSE 'user'
        END,
        passwordHash,
        active,
        createdAt,
        1,
        0
      FROM users;

      DROP TABLE users;
      ALTER TABLE users_next RENAME TO users;
    `);
  });

  db.pragma("foreign_keys = OFF");
  try {
    runMigration();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
