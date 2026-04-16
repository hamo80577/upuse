import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPS_TELEMETRY_BATCH_SIZE,
  OPS_TELEMETRY_FLUSH_MS,
  OPS_TELEMETRY_IDLE_AFTER_MS,
  OPS_TELEMETRY_QUEUE_CAP,
  OPS_TELEMETRY_SESSION_STORAGE_KEY,
  OpsTelemetryClient,
} from "./opsTelemetryClient";
import type { OpsTelemetryIngestPayload, OpsTelemetrySessionPayload } from "../api/types";
import type { OpsTelemetryRouteContext } from "./routeContext";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function route(path: string, system: OpsTelemetryRouteContext["system"] = "upuse"): OpsTelemetryRouteContext {
  return {
    system,
    path,
    routePattern: path,
    pageTitle: "UPuse",
  };
}

function createClient() {
  const heartbeat = vi.fn<(payload: OpsTelemetrySessionPayload) => Promise<{ sessionId: string }>>()
    .mockResolvedValue({ sessionId: SESSION_ID });
  const end = vi.fn().mockResolvedValue({ ok: true });
  const ingest = vi.fn<(payload: OpsTelemetryIngestPayload) => Promise<unknown>>()
    .mockResolvedValue({ ok: true });
  const sendBeacon = vi.fn().mockReturnValue(false);
  const client = new OpsTelemetryClient({ heartbeat, end, ingest, sendBeacon });
  return {
    client,
    heartbeat,
    end,
    ingest,
    sendBeacon,
  };
}

describe("OpsTelemetryClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    window.sessionStorage.clear();
    window.sessionStorage.setItem(OPS_TELEMETRY_SESSION_STORAGE_KEY, SESSION_ID);
  });

  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it("starts with a persisted session id and flushes the first route as a page view", () => {
    const { client, heartbeat, ingest } = createClient();

    client.start(route("/"));
    vi.advanceTimersByTime(OPS_TELEMETRY_FLUSH_MS);

    expect(heartbeat).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: SESSION_ID,
      system: "upuse",
      path: "/",
      state: "active",
    }));
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ sessionId: SESSION_ID }),
      events: [
        expect.objectContaining({
          type: "page_view",
          system: "upuse",
          path: "/",
        }),
      ],
    }));

    client.resetForTests();
  });

  it("tracks route changes with previous path and system metadata", () => {
    const { client, ingest } = createClient();

    client.start(route("/", "upuse"));
    client.setRouteContext(route("/scano/assign-task", "scano"));
    vi.advanceTimersByTime(OPS_TELEMETRY_FLUSH_MS);

    const payload = ingest.mock.calls[0]?.[0] as OpsTelemetryIngestPayload;
    expect(payload.events).toEqual([
      expect.objectContaining({ type: "page_view", path: "/", system: "upuse" }),
      expect.objectContaining({
        type: "route_change",
        path: "/scano/assign-task",
        system: "scano",
        metadata: {
          previousPath: "/",
          previousSystem: "upuse",
        },
      }),
    ]);

    client.resetForTests();
  });

  it("transitions idle and active from activity signals", async () => {
    const { client, heartbeat, ingest } = createClient();

    client.start(route("/performance"));
    await vi.advanceTimersByTimeAsync(OPS_TELEMETRY_IDLE_AFTER_MS + 1);
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(OPS_TELEMETRY_FLUSH_MS);

    const events = ingest.mock.calls.flatMap(([payload]) => payload.events);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "user_idle" }),
      expect.objectContaining({ type: "user_active" }),
    ]));
    expect(heartbeat).toHaveBeenCalledWith(expect.objectContaining({ state: "idle" }));
    expect(heartbeat).toHaveBeenCalledWith(expect.objectContaining({ state: "active" }));

    client.resetForTests();
  });

  it("caps the queue and flushes batches of 25 events", () => {
    const { client, ingest } = createClient();

    client.start(route("/"));
    for (let index = 0; index < OPS_TELEMETRY_QUEUE_CAP + 10; index += 1) {
      client.track("dashboard_opened", { metadata: { index } });
    }

    expect(client.getQueuedEventCountForTests()).toBe(OPS_TELEMETRY_QUEUE_CAP);
    vi.advanceTimersByTime(OPS_TELEMETRY_FLUSH_MS);

    const payload = ingest.mock.calls[0]?.[0] as OpsTelemetryIngestPayload;
    expect(payload.events).toHaveLength(OPS_TELEMETRY_BATCH_SIZE);

    client.resetForTests();
  });

  it("sanitizes metadata, paths, endpoints, and error stacks before ingest", () => {
    const { client, ingest } = createClient();

    client.start(route("/settings?token=abc"));
    client.track("api_error", {
      endpoint: "/api/settings/test?token=abc",
      statusCode: 500,
      metadata: {
        safe: "visible",
        token: "must-not-send",
        nested: { value: true },
      },
      error: {
        message: "Boom token=abc",
        stack: "Error: Boom\n    at token=abc",
        metadata: {
          apiKey: "must-not-send",
          feature: "settings",
        },
      },
    });
    vi.advanceTimersByTime(OPS_TELEMETRY_FLUSH_MS);

    const payload = ingest.mock.calls[0]?.[0] as OpsTelemetryIngestPayload;
    const apiError = payload.events.find((event) => event.type === "api_error");
    expect(apiError).toMatchObject({
      path: "/settings",
      endpoint: "/api/settings/test",
      metadata: {
        safe: "visible",
      },
      error: {
        message: "Boom token=[redacted]",
        metadata: {
          feature: "settings",
        },
      },
    });
    expect(apiError?.error?.stack).toContain("token=[redacted]");

    client.resetForTests();
  });

  it("deduplicates obvious repeated runtime errors", () => {
    const { client, ingest } = createClient();

    client.start(route("/"));
    const error = new Error("Repeated failure");
    window.dispatchEvent(new ErrorEvent("error", { message: error.message, error }));
    window.dispatchEvent(new ErrorEvent("error", { message: error.message, error }));
    vi.advanceTimersByTime(OPS_TELEMETRY_FLUSH_MS);

    const payload = ingest.mock.calls[0]?.[0] as OpsTelemetryIngestPayload;
    expect(payload.events.filter((event) => event.type === "js_error")).toHaveLength(1);

    client.resetForTests();
  });

  it("disables telemetry after write-side authorization failures", async () => {
    const { client, heartbeat, ingest } = createClient();
    heartbeat.mockRejectedValueOnce(new Error("Forbidden"));

    client.start(route("/"));
    await Promise.resolve();
    client.track("dashboard_opened");
    vi.advanceTimersByTime(OPS_TELEMETRY_FLUSH_MS);

    expect(ingest).not.toHaveBeenCalled();
    client.resetForTests();
  });
});
