import { describe, expect, it } from "vitest";
import { parseTrustProxy, resolveSecurityConfig } from "./security.js";

describe("security config", () => {
  it("parses trust proxy booleans, counts, and lists", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy("loopback, linklocal")).toEqual(["loopback", "linklocal"]);
  });

  it("falls back to safe defaults for invalid values", () => {
    expect(resolveSecurityConfig({
      UPUSE_LOGIN_RATE_LIMIT_MAX_KEYS: "abc",
      UPUSE_STREAM_MAX_CONNECTIONS_PER_USER: "0",
      UPUSE_STREAM_MAX_CONNECTIONS_TOTAL: "999999",
      UPUSE_SCANO_CSV_UPLOAD_MAX_FILE_SIZE_BYTES: "0",
      UPUSE_SCANO_CSV_UPLOAD_MAX_PARTS: "999",
      UPUSE_SCANO_IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES: "abc",
      UPUSE_SCANO_IMAGE_UPLOAD_MAX_FILES: "0",
      UPUSE_SCANO_IMAGE_UPLOAD_MAX_PARTS: "1",
    })).toEqual({
      trustProxy: false,
      loginRateLimitMaxKeys: 5_000,
      maxStreamConnectionsPerUser: 3,
      maxStreamConnectionsTotal: 100,
      scanoCsvUploadMaxFileSizeBytes: 5 * 1024 * 1024,
      scanoCsvUploadMaxParts: 5,
      scanoImageUploadMaxFileSizeBytes: 5 * 1024 * 1024,
      scanoImageUploadMaxFiles: 5,
      scanoImageUploadMaxParts: 10,
    });
  });

  it("reads valid security overrides from env", () => {
    expect(resolveSecurityConfig({
      UPUSE_TRUST_PROXY: "1",
      UPUSE_LOGIN_RATE_LIMIT_MAX_KEYS: "1500",
      UPUSE_STREAM_MAX_CONNECTIONS_PER_USER: "5",
      UPUSE_STREAM_MAX_CONNECTIONS_TOTAL: "250",
      UPUSE_SCANO_CSV_UPLOAD_MAX_FILE_SIZE_BYTES: "2097152",
      UPUSE_SCANO_CSV_UPLOAD_MAX_PARTS: "4",
      UPUSE_SCANO_IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES: "3145728",
      UPUSE_SCANO_IMAGE_UPLOAD_MAX_FILES: "4",
      UPUSE_SCANO_IMAGE_UPLOAD_MAX_PARTS: "8",
    })).toEqual({
      trustProxy: true,
      loginRateLimitMaxKeys: 1_500,
      maxStreamConnectionsPerUser: 5,
      maxStreamConnectionsTotal: 250,
      scanoCsvUploadMaxFileSizeBytes: 2 * 1024 * 1024,
      scanoCsvUploadMaxParts: 4,
      scanoImageUploadMaxFileSizeBytes: 3 * 1024 * 1024,
      scanoImageUploadMaxFiles: 4,
      scanoImageUploadMaxParts: 8,
    });
  });
});
