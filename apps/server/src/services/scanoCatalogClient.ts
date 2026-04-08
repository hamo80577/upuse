import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import axios from "axios";
import type {
  ScanoBranchOption,
  ScanoCatalogPage,
  ScanoChainOption,
  ScanoExternalProductDetail,
  ScanoExternalProductSearchResult,
  ScanoProductAssignmentCheck,
  ScanoYesNoFlag,
} from "../types/models.js";
import { getScanoCatalogRuntimeConfig, resolveScanoCatalogRuntimeConfig } from "./scanoSettingsStore.js";

interface RawScanoCatalogPage<TItem> {
  data?: TItem[];
  pageIndex?: number;
  totalPages?: number;
  totalRecords?: number;
}

interface RawScanoChain {
  id?: number;
  active?: boolean;
  name?: string;
  globalId?: string;
  type?: string;
}

interface RawScanoPlatform {
  active?: boolean;
  globalEntityId?: string;
  countryCode?: string;
  additionalRemoteId?: string;
}

interface RawScanoBranch {
  id?: number;
  globalId?: string;
  name?: string;
  chainId?: number;
  chainName?: string;
  platforms?: RawScanoPlatform[];
}

interface RawLocaleValue {
  locale?: string;
  value?: string | null;
}

interface RawMasterProductSearchItem {
  id?: string;
  names?: RawLocaleValue[];
  barcodes?: unknown;
  images?: string[];
}

interface RawMasterProductsData {
  masterProducts?: {
    masterProducts?: RawMasterProductSearchItem[];
    totalCount?: number;
  };
}

interface RawGraphQlResponse<TData> {
  data?: TData;
  errors?: Array<{ message?: string }>;
}

interface RawAssignmentItem {
  vendorId?: number;
  chainId?: number;
  price?: number | string | null;
  originalPrice?: number | string | null;
  sku?: string | null;
}

interface RawAssignmentsPayload {
  data?: RawAssignmentItem[];
}

export class ScanoCatalogClientError extends Error {
  status: number;
  code?: string;
  errorOrigin?: "integration";
  integration?: "scano_catalog";
  exposeMessage?: boolean;

  constructor(
    message: string,
    status = 500,
    options?: {
      code?: string;
      errorOrigin?: "integration";
      integration?: "scano_catalog";
      exposeMessage?: boolean;
    },
  ) {
    super(message);
    this.name = "ScanoCatalogClientError";
    this.status = status;
    this.code = options?.code;
    this.errorOrigin = options?.errorOrigin;
    this.integration = options?.integration;
    this.exposeMessage = options?.exposeMessage;
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const SCANO_LOOKUP_CACHE_TTL_MS = 10 * 60 * 1000;
const SCANO_LOOKUP_CACHE_LIMIT = 300;
const keepAliveHttpAgent = new HttpAgent({ keepAlive: true });
const keepAliveHttpsAgent = new HttpsAgent({ keepAlive: true });
const barcodeSearchCache = new Map<string, CacheEntry<ScanoExternalProductSearchResult[]>>();
const barcodeSearchInFlight = new Map<string, Promise<ScanoExternalProductSearchResult[]>>();
const productDetailCache = new Map<string, CacheEntry<ScanoExternalProductDetail>>();
const productDetailInFlight = new Map<string, Promise<ScanoExternalProductDetail>>();
const assignmentCheckCache = new Map<string, CacheEntry<ScanoProductAssignmentCheck>>();
const assignmentCheckInFlight = new Map<string, Promise<ScanoProductAssignmentCheck>>();

function getConfig(overrides?: {
  catalogBaseUrl?: string;
  catalogToken?: string;
}) {
  const config = overrides
    ? resolveScanoCatalogRuntimeConfig(overrides)
    : getScanoCatalogRuntimeConfig();
  if (!config) {
    throw new ScanoCatalogClientError("Scano catalog integration is not configured.", 503);
  }
  return config;
}

function buildAuthorizationHeader(token: string) {
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function selectLocaleValue(values: RawLocaleValue[] | undefined, preferredLocalePrefix: string) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }

  const preferred = values.find((entry) =>
    typeof entry.locale === "string" &&
    entry.locale.toLowerCase().startsWith(preferredLocalePrefix.toLowerCase()) &&
    typeof entry.value === "string" &&
    entry.value.trim().length > 0,
  );
  if (preferred?.value) {
    return preferred.value.trim();
  }

  const fallback = values.find((entry) => typeof entry.value === "string" && entry.value.trim().length > 0);
  return fallback?.value?.trim() ?? null;
}

function normalizePage<TPayloadItem, TOutputItem>(
  payload: RawScanoCatalogPage<TPayloadItem> | undefined,
  items: TOutputItem[],
): ScanoCatalogPage<TOutputItem> {
  return {
    items,
    pageIndex: typeof payload?.pageIndex === "number" ? payload.pageIndex : 1,
    totalPages: typeof payload?.totalPages === "number" ? payload.totalPages : (items.length ? 1 : 0),
    totalRecords: typeof payload?.totalRecords === "number" ? payload.totalRecords : items.length,
  };
}

function normalizeChain(item: RawScanoChain): ScanoChainOption {
  if (
    typeof item.id !== "number" ||
    typeof item.name !== "string" ||
    typeof item.globalId !== "string" ||
    typeof item.type !== "string"
  ) {
    throw new ScanoCatalogClientError("Scano catalog chain response is missing required fields.", 502);
  }

  return {
    id: item.id,
    active: item.active !== false,
    name: item.name,
    globalId: item.globalId,
    type: item.type,
  };
}

function selectPlatform(platforms: RawScanoPlatform[] | undefined) {
  if (!Array.isArray(platforms) || !platforms.length) {
    throw new ScanoCatalogClientError("Scano catalog branch response is missing platform data.", 502);
  }

  return platforms.find((platform) => platform.active) ?? platforms[0];
}

function normalizeBranch(item: RawScanoBranch): ScanoBranchOption {
  if (
    typeof item.id !== "number" ||
    typeof item.globalId !== "string" ||
    typeof item.name !== "string" ||
    typeof item.chainId !== "number" ||
    typeof item.chainName !== "string"
  ) {
    throw new ScanoCatalogClientError("Scano catalog branch response is missing required fields.", 502);
  }

  const platform = selectPlatform(item.platforms);
  if (
    typeof platform?.globalEntityId !== "string" ||
    typeof platform.countryCode !== "string" ||
    typeof platform.additionalRemoteId !== "string"
  ) {
    throw new ScanoCatalogClientError("Scano catalog branch platform is missing required fields.", 502);
  }

  return {
    id: item.id,
    globalId: item.globalId,
    name: item.name,
    chainId: item.chainId,
    chainName: item.chainName,
    globalEntityId: platform.globalEntityId,
    countryCode: platform.countryCode,
    additionalRemoteId: platform.additionalRemoteId,
  };
}

function normalizeGraphQlErrors<TData>(response: RawGraphQlResponse<TData>, fallbackMessage: string) {
  if (!Array.isArray(response.errors) || !response.errors.length) {
    return;
  }

  const message = response.errors
    .map((entry) => (typeof entry.message === "string" ? entry.message.trim() : ""))
    .find((value) => value.length > 0) ?? fallbackMessage;
  throw new ScanoCatalogClientError(message, 502, {
    code: "SCANO_UPSTREAM_REQUEST_FAILED",
    errorOrigin: "integration",
    integration: "scano_catalog",
    exposeMessage: true,
  });
}

function buildLookupCacheKey(parts: Array<string | number>) {
  return parts.join("::");
}

function getAxiosTransportOptions(timeout: number) {
  return {
    timeout,
    httpAgent: keepAliveHttpAgent,
    httpsAgent: keepAliveHttpsAgent,
  };
}

function readCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function writeCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + SCANO_LOOKUP_CACHE_TTL_MS,
  });

  if (cache.size > SCANO_LOOKUP_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === "string") {
      cache.delete(oldestKey);
    }
  }

  return value;
}

async function getCachedAsync<T>(params: {
  key: string;
  cache: Map<string, CacheEntry<T>>;
  inFlight: Map<string, Promise<T>>;
  loader: () => Promise<T>;
}) {
  const cached = readCacheValue(params.cache, params.key);
  if (cached !== null) {
    return cached;
  }

  const pending = params.inFlight.get(params.key);
  if (pending) {
    return pending;
  }

  const promise = params.loader()
    .then((value) => writeCacheValue(params.cache, params.key, value))
    .finally(() => {
      params.inFlight.delete(params.key);
    });

  params.inFlight.set(params.key, promise);
  return promise;
}

function toClientError(error: unknown) {
  if (error instanceof ScanoCatalogClientError) {
    return error;
  }

  const axiosError = error as {
    response?: { status?: number; data?: unknown };
    message?: string;
  };
  const status = typeof axiosError.response?.status === "number" ? axiosError.response.status : 502;
  const responseMessage =
    typeof (axiosError.response?.data as { message?: unknown } | undefined)?.message === "string"
      ? ((axiosError.response?.data as { message: string }).message)
      : "";
  if (status === 401 || status === 403) {
    return new ScanoCatalogClientError("Scano catalog token is invalid.", 502, {
      code: "SCANO_UPSTREAM_AUTH_REJECTED",
      errorOrigin: "integration",
      integration: "scano_catalog",
      exposeMessage: true,
    });
  }
  const fallbackMessage =
    status >= 500
      ? "Scano catalog upstream request failed."
      : "Scano catalog request was rejected.";

  return new ScanoCatalogClientError(responseMessage || axiosError.message || fallbackMessage, status, {
    code: "SCANO_UPSTREAM_REQUEST_FAILED",
    errorOrigin: "integration",
    integration: "scano_catalog",
    exposeMessage: true,
  });
}

export async function searchScanoChains(query: string): Promise<ScanoCatalogPage<ScanoChainOption>> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      items: [],
      pageIndex: 1,
      totalPages: 0,
      totalRecords: 0,
    };
  }

  const config = getConfig();

  try {
    const response = await axios.get<RawScanoCatalogPage<RawScanoChain>>(`${config.baseUrl}/api/v2/chains`, {
      headers: {
        Accept: "application/json",
        Authorization: buildAuthorizationHeader(config.token),
      },
      params: {
        page: 1,
        pageSize: config.pageSize,
        name: normalizedQuery,
      },
      ...getAxiosTransportOptions(config.requestTimeoutMs),
    });

    const items = Array.isArray(response.data?.data) ? response.data.data.map(normalizeChain) : [];
    return normalizePage(response.data, items);
  } catch (error) {
    throw toClientError(error);
  }
}

export async function searchScanoBranches(params: {
  chainId: number;
  query?: string;
}): Promise<ScanoCatalogPage<ScanoBranchOption>> {
  const config = getConfig();

  try {
    const response = await axios.get<RawScanoCatalogPage<RawScanoBranch>>(`${config.baseUrl}/api/v3/vendors`, {
      headers: {
        Accept: "application/json",
        Authorization: buildAuthorizationHeader(config.token),
      },
      params: {
        page: 1,
        pageSize: config.pageSize,
        chainIds: params.chainId,
        text: params.query?.trim() ?? "",
      },
      ...getAxiosTransportOptions(config.requestTimeoutMs),
    });

    const items = Array.isArray(response.data?.data) ? response.data.data.map(normalizeBranch) : [];
    return normalizePage(response.data, items);
  } catch (error) {
    throw toClientError(error);
  }
}

export async function testScanoCatalogConnection(overrides?: {
  catalogBaseUrl?: string;
  catalogToken?: string;
}) {
  const config = getConfig(overrides);

  try {
    await axios.get<RawScanoCatalogPage<RawScanoChain>>(`${config.baseUrl}/api/v2/chains`, {
      headers: {
        Accept: "application/json",
        Authorization: buildAuthorizationHeader(config.token),
      },
      params: {
        page: 1,
        pageSize: 1,
        name: "a",
      },
      ...getAxiosTransportOptions(config.requestTimeoutMs),
    });

    return {
      ok: true as const,
      message: "Scano catalog token is valid.",
      baseUrl: config.baseUrl,
    };
  } catch (error) {
    throw toClientError(error);
  }
}

const MASTER_PRODUCTS_QUERY = `
  query MasterProducts($filter: MasterProductFilterInput!, $pagination: PageInput!) {
    masterProducts(filter: $filter, pagination: $pagination) {
      masterProducts {
        id
        names {
          locale
          value
        }
        barcodes
        images
      }
      totalCount
    }
  }
`;

const MASTER_PRODUCT_DETAIL_QUERY = `
  query MasterProduct($filter: MasterProductFilterInput!, $pagination: PageInput!) {
    masterProducts(filter: $filter, pagination: $pagination) {
      masterProducts {
        id
        names {
          locale
          value
        }
        descriptions {
          locale
          value
        }
        barcodes
        images
      }
      totalCount
    }
  }
`;

const GRAPHQL_ENDPOINT = "https://qc-internal-supergraph-me.deliveryhero.io/graphql";

function toPlainPrice(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return trimToNull(typeof value === "string" ? value : null);
}

function normalizeAssignmentFlag(value: boolean): ScanoYesNoFlag {
  return value ? "yes" : "no";
}

export async function searchScanoProductsByBarcode(params: {
  barcode: string;
  globalEntityId: string;
}): Promise<ScanoExternalProductSearchResult[]> {
  const config = getConfig();
  const trimmedBarcode = params.barcode.trim();
  const trimmedGlobalEntityId = params.globalEntityId.trim();
  const cacheKey = buildLookupCacheKey(["search", config.baseUrl, trimmedGlobalEntityId, trimmedBarcode.toLowerCase()]);

  return getCachedAsync({
    key: cacheKey,
    cache: barcodeSearchCache,
    inFlight: barcodeSearchInFlight,
    loader: async () => {
      try {
        const response = await axios.post<RawGraphQlResponse<RawMasterProductsData>>(
          GRAPHQL_ENDPOINT,
          {
            operationName: "MasterProducts",
            variables: {
              filter: {
                search: {
                  locale: "en_EG",
                  term: trimmedBarcode,
                },
              },
              pagination: {
                mode: "OFFSET_BASED",
                offsetPagination: {
                  offset: 0,
                  limit: 10,
                },
              },
            },
            query: MASTER_PRODUCTS_QUERY,
          },
          {
            headers: {
              Accept: "application/graphql-response+json, application/json",
              Authorization: buildAuthorizationHeader(config.token),
              "Content-Type": "application/json",
              "x-global-entity-id": trimmedGlobalEntityId,
            },
            ...getAxiosTransportOptions(config.requestTimeoutMs),
          },
        );

        normalizeGraphQlErrors(response.data, "Scano product search failed.");
        const items = Array.isArray(response.data?.data?.masterProducts?.masterProducts)
          ? response.data.data.masterProducts.masterProducts
          : [];

        return items
          .filter((item): item is RawMasterProductSearchItem & { id: string } => typeof item.id === "string" && item.id.trim().length > 0)
          .map((item) => {
            const barcodes = normalizeStringArray(item.barcodes);
            return {
              id: item.id.trim(),
              barcode: barcodes[0] ?? trimmedBarcode,
              barcodes,
              itemNameEn: selectLocaleValue(item.names, "en"),
              itemNameAr: selectLocaleValue(item.names, "ar"),
              image: normalizeStringArray(item.images)[0] ?? null,
            };
          });
      } catch (error) {
        throw toClientError(error);
      }
    },
  });
}

export async function getScanoProductDetail(params: {
  productId: string;
  globalEntityId: string;
}): Promise<ScanoExternalProductDetail> {
  const config = getConfig();
  const trimmedProductId = params.productId.trim();
  const trimmedGlobalEntityId = params.globalEntityId.trim();
  const cacheKey = buildLookupCacheKey(["detail", config.baseUrl, trimmedGlobalEntityId, trimmedProductId]);

  return getCachedAsync({
    key: cacheKey,
    cache: productDetailCache,
    inFlight: productDetailInFlight,
    loader: async () => {
      try {
        const response = await axios.post<RawGraphQlResponse<RawMasterProductsData>>(
          GRAPHQL_ENDPOINT,
          {
            operationName: "MasterProduct",
            variables: {
              filter: {
                ids: [trimmedProductId],
              },
              pagination: {
                mode: "OFFSET_BASED",
                offsetPagination: {
                  offset: 0,
                  limit: 1,
                },
              },
            },
            query: MASTER_PRODUCT_DETAIL_QUERY,
          },
          {
            headers: {
              Accept: "application/graphql-response+json, application/json",
              Authorization: buildAuthorizationHeader(config.token),
              "Content-Type": "application/json",
              "x-global-entity-id": trimmedGlobalEntityId,
            },
            ...getAxiosTransportOptions(config.requestTimeoutMs),
          },
        );

        normalizeGraphQlErrors(response.data, "Scano product detail request failed.");
        const item = Array.isArray(response.data?.data?.masterProducts?.masterProducts)
          ? response.data.data.masterProducts.masterProducts[0]
          : null;
        if (!item?.id) {
          throw new ScanoCatalogClientError("Scano product was not found.", 404, {
            code: "SCANO_PRODUCT_NOT_FOUND",
            errorOrigin: "integration",
            integration: "scano_catalog",
            exposeMessage: true,
          });
        }

        const barcodes = normalizeStringArray((item as { barcodes?: unknown }).barcodes);
        return {
          id: item.id.trim(),
          sku: null,
          price: null,
          barcode: barcodes[0] ?? "",
          barcodes,
          itemNameEn: selectLocaleValue(item.names, "en"),
          itemNameAr: selectLocaleValue(item.names, "ar"),
          images: normalizeStringArray(item.images),
        };
      } catch (error) {
        throw toClientError(error);
      }
    },
  });
}

export async function getScanoProductAssignmentCheck(params: {
  productId: string;
  chainId: number;
  vendorId: number;
}): Promise<ScanoProductAssignmentCheck> {
  const config = getConfig();
  const trimmedProductId = params.productId.trim();
  const cacheKey = buildLookupCacheKey(["assignment", config.baseUrl, trimmedProductId, params.chainId, params.vendorId]);

  return getCachedAsync({
    key: cacheKey,
    cache: assignmentCheckCache,
    inFlight: assignmentCheckInFlight,
    loader: async () => {
      try {
        const response = await axios.get<RawAssignmentsPayload | RawAssignmentItem[]>(
          `${config.baseUrl}/api/v2/products/${encodeURIComponent(trimmedProductId)}/assignments`,
          {
            headers: {
              Accept: "application/json",
              Authorization: buildAuthorizationHeader(config.token),
            },
            ...getAxiosTransportOptions(config.requestTimeoutMs),
          },
        );

        const assignments = Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.data)
            ? response.data.data
            : [];
        const vendorAssignment = assignments.find((item) => item.vendorId === params.vendorId) ?? null;
        const chainAssignment = vendorAssignment ?? assignments.find((item) => item.chainId === params.chainId) ?? null;

        return {
          chain: normalizeAssignmentFlag(!!chainAssignment || !!vendorAssignment),
          vendor: normalizeAssignmentFlag(!!vendorAssignment),
          sku: trimToNull(vendorAssignment?.sku ?? chainAssignment?.sku ?? null),
          price: toPlainPrice(vendorAssignment?.price ?? vendorAssignment?.originalPrice ?? chainAssignment?.price ?? chainAssignment?.originalPrice ?? null),
        };
      } catch (error) {
        throw toClientError(error);
      }
    },
  });
}
