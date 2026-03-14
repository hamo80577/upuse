import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildProductionChildEnv,
  createProductionStartPlan,
  getWorkspaceRoot,
  parseEnvFile,
} from "./start-production.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("root npm start points at the production launcher", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.start, "node scripts/start-production.mjs");
});

test("README documents production start semantics", () => {
  const readme = fs.readFileSync(path.join(workspaceRoot, "README.md"), "utf8");
  assert.match(readme, /## Run server \(prod\)/);
  assert.match(readme, /`npm run start` now:/);
  assert.match(readme, /loads root `.env` if present/);
  assert.match(readme, /forces `NODE_ENV=production`/);
  assert.match(readme, /refuses to start if `apps\/server\/dist\/index\.js` or `apps\/web\/dist\/index\.html` is missing/);
});

test("launcher resolves workspace root from the script location instead of cwd", () => {
  const originalCwd = process.cwd();
  process.chdir(os.tmpdir());
  try {
    assert.equal(getWorkspaceRoot(), workspaceRoot);
  } finally {
    process.chdir(originalCwd);
  }
});

test("parseEnvFile handles comments and quoted values", () => {
  const parsed = parseEnvFile(`
# comment
UPUSE_SECRET="abc123"
UPUSE_CORS_ORIGINS='https://upuse.org'
EMPTY=
INVALID
`);

  assert.deepEqual(parsed, {
    UPUSE_SECRET: "abc123",
    UPUSE_CORS_ORIGINS: "https://upuse.org",
    EMPTY: "",
  });
});

test("production child env always forces NODE_ENV=production", () => {
  const childEnv = buildProductionChildEnv({ NODE_ENV: "development", PORT: "8080" }, { PORT: "9090" });
  assert.equal(childEnv.NODE_ENV, "production");
  assert.equal(childEnv.PORT, "9090");
});

test("launcher refuses to start without both server and web build outputs", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "upuse-prod-start-"));
  fs.mkdirSync(path.join(tempRoot, "apps", "server", "dist"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "apps", "server", "dist", "index.js"), "console.log('ok');");

  assert.throws(
    () => createProductionStartPlan({ workspaceRoot: tempRoot }),
    /Missing web build output/,
  );
});

test("launcher loads root .env and validates build outputs before spawning", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "upuse-prod-start-"));
  fs.mkdirSync(path.join(tempRoot, "apps", "server", "dist"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "apps", "web", "dist"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "apps", "server", "dist", "index.js"), "console.log('ok');");
  fs.writeFileSync(path.join(tempRoot, "apps", "web", "dist", "index.html"), "<html></html>");
  fs.writeFileSync(path.join(tempRoot, ".env"), "PORT=9090\nUPUSE_SECRET=from-dotenv\n");

  const plan = createProductionStartPlan({
    workspaceRoot: tempRoot,
    baseEnv: { PORT: "8080" },
  });

  assert.equal(plan.workspaceRoot, tempRoot);
  assert.equal(plan.childEnv.PORT, "9090");
  assert.equal(plan.childEnv.UPUSE_SECRET, "from-dotenv");
  assert.equal(plan.childEnv.NODE_ENV, "production");
  assert.equal(plan.serverEntryPath, path.join(tempRoot, "apps", "server", "dist", "index.js"));
});
