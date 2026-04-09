import path from "node:path";
import { resolveDataDir, resolveDbFilePath } from "../config/paths.js";
import { writeUserDataBackupSnapshot } from "../services/userDataBackup.js";

function resolveLabel(argv: string[]) {
  const flag = argv.find((value) => value.startsWith("--label="));
  if (flag) {
    return flag.slice("--label=".length);
  }

  const positional = argv.find((value) => !value.startsWith("--"));
  return positional;
}

const dataDir = resolveDataDir({ env: process.env });
const dbFilePath = resolveDbFilePath({ env: process.env });
const outputDir = path.join(dataDir, "backups", "user-migration");
const label = resolveLabel(process.argv.slice(2));

const result = writeUserDataBackupSnapshot({
  dbFilePath,
  outputDir,
  label,
});

console.log(`Created one-time user data backup at ${result.filePath}`);
console.log(`SHA-256 manifest written to ${result.checksumFilePath}`);
console.log(
  `Rows captured: users=${result.snapshot.counts.users}, states=${result.snapshot.counts.performanceStates}, groups=${result.snapshot.counts.performanceGroups}, views=${result.snapshot.counts.performanceViews}`,
);
console.log("Sessions are intentionally excluded from this backup.");
console.log("This backup contains password hashes and saved user preferences. Keep it private.");
