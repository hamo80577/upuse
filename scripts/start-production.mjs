import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export function getWorkspaceRoot(scriptUrl = import.meta.url) {
  const scriptPath = fileURLToPath(scriptUrl);
  return path.resolve(path.dirname(scriptPath), "..");
}

export function parseEnvFile(contents) {
  const result = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    const quoted =
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

export function loadDotEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  return parseEnvFile(fs.readFileSync(envPath, "utf8"));
}

export function resolveProductionPaths(workspaceRoot) {
  return {
    envFilePath: path.join(workspaceRoot, ".env"),
    serverEntryPath: path.join(workspaceRoot, "apps", "server", "dist", "index.js"),
    webIndexPath: path.join(workspaceRoot, "apps", "web", "dist", "index.html"),
  };
}

export function validateProductionArtifacts({ serverEntryPath, webIndexPath }, existsSync = fs.existsSync) {
  if (!existsSync(serverEntryPath)) {
    throw new Error(`Missing server build output at ${serverEntryPath}. Run "npm run build" before "npm run start".`);
  }

  if (!existsSync(webIndexPath)) {
    throw new Error(`Missing web build output at ${webIndexPath}. Run "npm run build" before "npm run start".`);
  }
}

export function buildProductionChildEnv(baseEnv, envFromFile) {
  return {
    ...baseEnv,
    ...envFromFile,
    NODE_ENV: "production",
  };
}

export function createProductionStartPlan({
  workspaceRoot = getWorkspaceRoot(),
  baseEnv = process.env,
  existsSync = fs.existsSync,
} = {}) {
  const paths = resolveProductionPaths(workspaceRoot);
  validateProductionArtifacts(paths, existsSync);
  const envFromFile = loadDotEnvFile(paths.envFilePath);

  return {
    workspaceRoot,
    serverEntryPath: paths.serverEntryPath,
    webIndexPath: paths.webIndexPath,
    childEnv: buildProductionChildEnv(baseEnv, envFromFile),
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

export function runProductionStart() {
  let plan;
  try {
    plan = createProductionStartPlan();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const child = spawn(process.execPath, [plan.serverEntryPath], {
    cwd: plan.workspaceRoot,
    env: plan.childEnv,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runProductionStart();
}
