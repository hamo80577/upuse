export function getEnv(name: string, fallback?: string) {
  const v = process.env[name];
  if (v && v.length) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env var: ${name}`);
}
