import { db, cryptoBox } from "../config/db.js";
import { resolveScanoCatalogConfig } from "../config/scanoCatalog.js";
import type { ScanoCatalogConfig } from "../config/scanoCatalog.js";
import type { ScanoSettings } from "../types/models.js";

interface ScanoSettingsRow {
  catalogBaseUrl: string;
  catalogTokenEnc: string;
  updatedAt: string;
}

const DEFAULT_SCANO_CATALOG_BASE_URL = "https://catalog-backlog-eg.deliveryhero.io";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function nowIso() {
  return new Date().toISOString();
}

function getFallbackConfig(env: NodeJS.ProcessEnv = process.env) {
  const envConfig = resolveScanoCatalogConfig(env);
  return {
    baseUrl: trimTrailingSlash(envConfig?.baseUrl || env.UPUSE_SCANO_CATALOG_BASE_URL?.trim() || DEFAULT_SCANO_CATALOG_BASE_URL),
    token: envConfig?.token ?? env.UPUSE_SCANO_CATALOG_TOKEN?.trim() ?? "",
    pageSize: envConfig?.pageSize ?? 50,
    requestTimeoutMs: envConfig?.requestTimeoutMs ?? 15_000,
  };
}

function getScanoSettingsRow() {
  const row = db.prepare<[], ScanoSettingsRow>(`
    SELECT
      catalogBaseUrl,
      catalogTokenEnc,
      updatedAt
    FROM scano_settings
    WHERE id = 1
  `).get();

  if (!row) {
    throw new Error("Scano settings row not found");
  }

  return row;
}

export function getScanoSettings(): ScanoSettings {
  const row = getScanoSettingsRow();
  const fallback = getFallbackConfig();
  const decryptedToken = row.catalogTokenEnc ? cryptoBox.decrypt(row.catalogTokenEnc) : "";

  return {
    catalogBaseUrl: trimTrailingSlash(row.catalogBaseUrl.trim() || fallback.baseUrl),
    catalogToken: decryptedToken.trim() || fallback.token,
    updatedAt: row.updatedAt,
  };
}

export function updateScanoSettings(patch: {
  catalogBaseUrl?: string;
  catalogToken?: string;
}) {
  const current = getScanoSettings();
  const next: ScanoSettings = {
    catalogBaseUrl: trimTrailingSlash((patch.catalogBaseUrl ?? current.catalogBaseUrl).trim() || DEFAULT_SCANO_CATALOG_BASE_URL),
    catalogToken: (patch.catalogToken ?? current.catalogToken).trim(),
    updatedAt: nowIso(),
  };

  db.prepare(`
    UPDATE scano_settings
    SET
      catalogBaseUrl = ?,
      catalogTokenEnc = ?,
      updatedAt = ?
    WHERE id = 1
  `).run(
    next.catalogBaseUrl,
    cryptoBox.encrypt(next.catalogToken),
    next.updatedAt,
  );

  return next;
}

export function resolveScanoCatalogRuntimeConfig(overrides?: {
  catalogBaseUrl?: string;
  catalogToken?: string;
}): ScanoCatalogConfig | null {
  const settings = getScanoSettings();
  const token = (overrides?.catalogToken ?? settings.catalogToken).trim();
  if (!token) {
    return null;
  }

  const fallback = getFallbackConfig();
  return {
    baseUrl: trimTrailingSlash((overrides?.catalogBaseUrl ?? settings.catalogBaseUrl).trim() || fallback.baseUrl),
    token,
    pageSize: fallback.pageSize,
    requestTimeoutMs: fallback.requestTimeoutMs,
  };
}

export function getScanoCatalogRuntimeConfig(): ScanoCatalogConfig | null {
  return resolveScanoCatalogRuntimeConfig();
}
