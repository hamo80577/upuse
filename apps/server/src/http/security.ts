export function parseCorsOrigins(raw: string | undefined) {
  if (!raw) return [];

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

function isDefaultLocalOrigin(origin: string) {
  return /^https?:\/\/localhost(?::\d+)?$/i.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin);
}

export function isAllowedOrigin(origin: string | undefined, configuredOrigins: string[]) {
  if (!origin) return true;

  if (configuredOrigins.length > 0) {
    return configuredOrigins.includes(origin);
  }

  return isDefaultLocalOrigin(origin);
}

export function createCorsOptions() {
  const configuredOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS);

  return {
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (isAllowedOrigin(origin, configuredOrigins)) {
        callback(null, true);
        return;
      }

      callback(new Error("CORS origin not allowed"));
    },
    credentials: true,
  };
}
