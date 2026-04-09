export interface SecurityConfig {
  trustProxy: false | true | number | string | string[];
  loginRateLimitMaxKeys: number;
  maxStreamConnectionsPerUser: number;
  maxStreamConnectionsTotal: number;
  scanoCsvUploadMaxFileSizeBytes: number;
  scanoCsvUploadMaxParts: number;
  scanoImageUploadMaxFileSizeBytes: number;
  scanoImageUploadMaxFiles: number;
  scanoImageUploadMaxParts: number;
}

const DEFAULT_LOGIN_RATE_LIMIT_MAX_KEYS = 5_000;
const DEFAULT_MAX_STREAM_CONNECTIONS_PER_USER = 3;
const DEFAULT_MAX_STREAM_CONNECTIONS_TOTAL = 100;
const DEFAULT_SCANO_CSV_UPLOAD_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_SCANO_CSV_UPLOAD_MAX_PARTS = 5;
const DEFAULT_SCANO_IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_SCANO_IMAGE_UPLOAD_MAX_FILES = 5;
const DEFAULT_SCANO_IMAGE_UPLOAD_MAX_PARTS = 10;

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
    scanoCsvUploadMaxFileSizeBytes: parseBoundedInteger(
      env.UPUSE_SCANO_CSV_UPLOAD_MAX_FILE_SIZE_BYTES,
      DEFAULT_SCANO_CSV_UPLOAD_MAX_FILE_SIZE_BYTES,
      {
        min: 1_024,
        max: 50 * 1024 * 1024,
      },
    ),
    scanoCsvUploadMaxParts: parseBoundedInteger(
      env.UPUSE_SCANO_CSV_UPLOAD_MAX_PARTS,
      DEFAULT_SCANO_CSV_UPLOAD_MAX_PARTS,
      {
        min: 1,
        max: 20,
      },
    ),
    scanoImageUploadMaxFileSizeBytes: parseBoundedInteger(
      env.UPUSE_SCANO_IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES,
      DEFAULT_SCANO_IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES,
      {
        min: 1_024,
        max: 20 * 1024 * 1024,
      },
    ),
    scanoImageUploadMaxFiles: parseBoundedInteger(
      env.UPUSE_SCANO_IMAGE_UPLOAD_MAX_FILES,
      DEFAULT_SCANO_IMAGE_UPLOAD_MAX_FILES,
      {
        min: 1,
        max: 20,
      },
    ),
    scanoImageUploadMaxParts: parseBoundedInteger(
      env.UPUSE_SCANO_IMAGE_UPLOAD_MAX_PARTS,
      DEFAULT_SCANO_IMAGE_UPLOAD_MAX_PARTS,
      {
        min: 2,
        max: 40,
      },
    ),
  };
}
