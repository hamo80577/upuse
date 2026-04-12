import type Database from "better-sqlite3";
import { hashPassword, normalizeEmail } from "../../../services/auth/passwords.js";

function isProduction() {
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}

function resolveBootstrapAdmin(env: NodeJS.ProcessEnv) {
  const email = env.UPUSE_BOOTSTRAP_ADMIN_EMAIL?.trim() || "";
  const password = env.UPUSE_BOOTSTRAP_ADMIN_PASSWORD?.trim() || "";
  const name = env.UPUSE_BOOTSTRAP_ADMIN_NAME?.trim() || "Administrator";
  const hasAnyValue = [email, password, env.UPUSE_BOOTSTRAP_ADMIN_NAME?.trim() || ""].some((value) => value.length > 0);

  if (!hasAnyValue) return null;
  if (!email || !password) {
    throw new Error(
      "UPUSE_BOOTSTRAP_ADMIN_EMAIL and UPUSE_BOOTSTRAP_ADMIN_PASSWORD must both be set when bootstrapping the first admin user.",
    );
  }
  if (password.length < 12) {
    throw new Error("UPUSE_BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters long.");
  }

  return {
    email: normalizeEmail(email),
    password,
    name,
    role: "admin" as const,
  };
}

export async function maybeSeedBootstrapAdmin(db: Database.Database, env: NodeJS.ProcessEnv) {
  const usersCountRow = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  const bootstrapAdmin = resolveBootstrapAdmin(env);

  if (!bootstrapAdmin) {
    if (!usersCountRow.count) {
      const message =
        "No application users exist. Set UPUSE_BOOTSTRAP_ADMIN_EMAIL and UPUSE_BOOTSTRAP_ADMIN_PASSWORD to create the first admin account.";
      if (isProduction()) {
        throw new Error(message);
      }
      console.warn(`WARNING: ${message}`);
    }
    return;
  }

  const existingUser = db
    .prepare<[string], { id: number }>("SELECT id FROM users WHERE email = ?")
    .get(bootstrapAdmin.email);
  if (existingUser) return;

  const passwordHash = await hashPassword(bootstrapAdmin.password);
  db.prepare(`
    INSERT INTO users (email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
    VALUES (?, ?, ?, ?, 1, ?, 1, ?)
  `).run(
    bootstrapAdmin.email,
    bootstrapAdmin.name,
    bootstrapAdmin.role,
    passwordHash,
    new Date().toISOString(),
    usersCountRow.count === 0 ? 1 : 0,
  );

  console.warn(`Created bootstrap admin user for ${bootstrapAdmin.email}. Rotate bootstrap credentials after first use.`);
}
