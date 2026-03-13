export interface SecurityConfig {
  trustProxy: false | true | number | string | string[];
  loginRateLimitMaxKeys: number;
  maxStreamConnectionsPerUser: number;
  maxStreamConnectionsTotal: number;
}

const DEFAULT_LOGIN_RATE_LIMIT_MAX_KEYS = 5_000;
const DEFAULT_MAX_STREAM_CONNECTIONS_PER_USER = 3;
const DEFAULT_MAX_STREAM_CONNECTIONS_TOTAL = 100;

function parseBoundedInteger(raw: string | undefined, fallback: number, options: { min: number; max: number }) {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < options.min || parsed > options.max) return fallback;
  return parsed;
}

export function parseTrustProxy(raw: string | undefined): false | true | number | string | string[] {
  const value = raw?.trim();
  if (!value) return false;

  const normalized = value.toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") {
    return false;
  }

  if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes") {
    return true;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (!parts.length) return false;
  return parts.length === 1 ? parts[0] : parts;
}

export function resolveSecurityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  return {
    trustProxy: parseTrustProxy(env.UPUSE_TRUST_PROXY),
    loginRateLimitMaxKeys: parseBoundedInteger(env.UPUSE_LOGIN_RATE_LIMIT_MAX_KEYS, DEFAULT_LOGIN_RATE_LIMIT_MAX_KEYS, {
      min: 100,
      max: 100_000,
    }),
    maxStreamConnectionsPerUser: parseBoundedInteger(
      env.UPUSE_STREAM_MAX_CONNECTIONS_PER_USER,
      DEFAULT_MAX_STREAM_CONNECTIONS_PER_USER,
      {
        min: 1,
        max: 20,
      },
    ),
    maxStreamConnectionsTotal: parseBoundedInteger(
      env.UPUSE_STREAM_MAX_CONNECTIONS_TOTAL,
      DEFAULT_MAX_STREAM_CONNECTIONS_TOTAL,
      {
        min: 1,
        max: 1_000,
      },
    ),
  };
}
