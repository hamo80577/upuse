export interface ScanoCatalogConfig {
  baseUrl: string;
  token: string;
  pageSize: number;
  requestTimeoutMs: number;
}

const DEFAULT_BASE_URL = "https://catalog-backlog-eg.deliveryhero.io";
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function parsePositiveInteger(raw: string | undefined, fallback: number, options: { min: number; max: number }) {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < options.min || parsed > options.max) return fallback;
  return parsed;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function resolveScanoCatalogConfig(env: NodeJS.ProcessEnv = process.env): ScanoCatalogConfig | null {
  const token = env.UPUSE_SCANO_CATALOG_TOKEN?.trim() ?? "";
  if (!token) return null;

  const baseUrl = trimTrailingSlash(env.UPUSE_SCANO_CATALOG_BASE_URL?.trim() || DEFAULT_BASE_URL);

  return {
    baseUrl,
    token,
    pageSize: parsePositiveInteger(env.UPUSE_SCANO_CATALOG_PAGE_SIZE, DEFAULT_PAGE_SIZE, {
      min: 1,
      max: 200,
    }),
    requestTimeoutMs: parsePositiveInteger(env.UPUSE_SCANO_CATALOG_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, {
      min: 1_000,
      max: 60_000,
    }),
  };
}
