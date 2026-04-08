import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockGetScanoCatalogRuntimeConfig = vi.hoisted(() => vi.fn());
const mockResolveScanoCatalogRuntimeConfig = vi.hoisted(() => vi.fn());

vi.mock("axios", () => ({
  default: {
    get: mockAxiosGet,
  },
}));

vi.mock("./scanoSettingsStore.js", () => ({
  getScanoCatalogRuntimeConfig: mockGetScanoCatalogRuntimeConfig,
  resolveScanoCatalogRuntimeConfig: mockResolveScanoCatalogRuntimeConfig,
}));

import { getScanoProductAssignmentCheck, searchScanoBranches, searchScanoChains, testScanoCatalogConnection } from "./scanoCatalogClient.js";

describe("scanoCatalogClient", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockGetScanoCatalogRuntimeConfig.mockReset();
    mockResolveScanoCatalogRuntimeConfig.mockReset();
    mockGetScanoCatalogRuntimeConfig.mockReturnValue({
      baseUrl: "https://catalog.example.com",
      token: "test-token",
      pageSize: 50,
      requestTimeoutMs: 12000,
    });
    mockResolveScanoCatalogRuntimeConfig.mockImplementation((overrides?: { catalogBaseUrl?: string; catalogToken?: string }) => ({
      baseUrl: (overrides?.catalogBaseUrl ?? "https://catalog.example.com").replace(/\/+$/, ""),
      token: overrides?.catalogToken ?? "test-token",
      pageSize: 50,
      requestTimeoutMs: 12000,
    }));
  });

  it("normalizes chain search results from the Scano catalog response", async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 1037,
            active: true,
            name: "Carrefour",
            globalId: "chain-global-1037",
            type: "chain",
          },
        ],
        pageIndex: 1,
        totalPages: 4,
        totalRecords: 31,
      },
    });

    const result = await searchScanoChains("car");

    expect(mockAxiosGet).toHaveBeenCalledWith("https://catalog.example.com/api/v2/chains", expect.objectContaining({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer test-token",
      },
      params: {
        page: 1,
        pageSize: 50,
        name: "car",
      },
      timeout: 12000,
      httpAgent: expect.anything(),
      httpsAgent: expect.anything(),
    }));
    expect(result).toEqual({
      items: [
        {
          id: 1037,
          active: true,
          name: "Carrefour",
          globalId: "chain-global-1037",
          type: "chain",
        },
      ],
      pageIndex: 1,
      totalPages: 4,
      totalRecords: 31,
    });
  });

  it("normalizes branch search results and prefers the first active platform", async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 4594,
            globalId: "vendor-global-4594",
            name: "Nasr City",
            chainId: 1037,
            chainName: "Carrefour",
            platforms: [
              {
                active: false,
                globalEntityId: "legacy-entity",
                countryCode: "EG",
                additionalRemoteId: "old-branch-id",
              },
              {
                active: true,
                globalEntityId: "TB_EG",
                countryCode: "EG",
                additionalRemoteId: "branch-4594",
              },
            ],
          },
        ],
        pageIndex: 1,
        totalPages: 1,
        totalRecords: 1,
      },
    });

    const result = await searchScanoBranches({
      chainId: 1037,
      query: "nasr",
    });

    expect(mockAxiosGet).toHaveBeenCalledWith("https://catalog.example.com/api/v3/vendors", expect.objectContaining({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer test-token",
      },
      params: {
        page: 1,
        pageSize: 50,
        chainIds: 1037,
        text: "nasr",
      },
      timeout: 12000,
      httpAgent: expect.anything(),
      httpsAgent: expect.anything(),
    }));
    expect(result).toEqual({
      items: [
        {
          id: 4594,
          globalId: "vendor-global-4594",
          name: "Nasr City",
          chainId: 1037,
          chainName: "Carrefour",
          globalEntityId: "TB_EG",
          countryCode: "EG",
          additionalRemoteId: "branch-4594",
        },
      ],
      pageIndex: 1,
      totalPages: 1,
      totalRecords: 1,
    });
  });

  it("tests the Scano catalog token against the chains endpoint", async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        data: [],
        pageIndex: 1,
        totalPages: 0,
        totalRecords: 0,
      },
    });

    const result = await testScanoCatalogConnection({
      catalogBaseUrl: "https://catalog.next.example.com/",
      catalogToken: "next-token-value",
    });

    expect(mockAxiosGet).toHaveBeenCalledWith("https://catalog.next.example.com/api/v2/chains", expect.objectContaining({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer next-token-value",
      },
      params: {
        page: 1,
        pageSize: 1,
        name: "a",
      },
      timeout: 12000,
      httpAgent: expect.anything(),
      httpsAgent: expect.anything(),
    }));
    expect(result).toEqual({
      ok: true,
      message: "Scano catalog token is valid.",
      baseUrl: "https://catalog.next.example.com",
    });
  });

  it("reuses cached assignment checks for repeated product-chain-vendor lookups", async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        data: [
          {
            vendorId: 4594,
            chainId: 1037,
            sku: "SKU-1",
            price: 100,
          },
        ],
      },
    });

    const params = {
      productId: "QAR4F19C",
      chainId: 1037,
      vendorId: 4594,
    };

    const first = await getScanoProductAssignmentCheck(params);
    const second = await getScanoProductAssignmentCheck(params);

    expect(first).toEqual({
      chain: "yes",
      vendor: "yes",
      sku: "SKU-1",
      price: "100",
    });
    expect(second).toEqual(first);
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });
});
