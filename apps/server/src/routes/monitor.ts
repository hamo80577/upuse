import type { Request, Response } from "express";
import { createConnectionQuota } from "../http/connectionQuota.js";
import type { MonitorEngine } from "../monitor/engine/MonitorEngine.js";

interface StreamRouteSecurityOptions {
  maxConnectionsPerUser: number;
  maxTotalConnections: number;
}

export function startMonitorRoute(engine: MonitorEngine) {
  return async (_req: Request, res: Response) => {
    await engine.start();
    res.json({ ok: true, running: engine.isRunning(), snapshot: engine.getSnapshot() });
  };
}

export function stopMonitorRoute(engine: MonitorEngine) {
  return (_req: Request, res: Response) => {
    engine.stop();
    res.json({ ok: true, running: engine.isRunning(), snapshot: engine.getSnapshot() });
  };
}

export function monitorStatusRoute(engine: MonitorEngine) {
  return (_req: Request, res: Response) => {
    res.json(engine.getSnapshot().monitoring);
  };
}

export function refreshOrdersNowRoute(engine: MonitorEngine) {
  return async (_req: Request, res: Response) => {
    const result = await engine.refreshOrdersNow();
    if (!result.ok && !result.running) {
      return res.status(409).json(result);
    }
    if (!result.ok) {
      return res.status(502).json(result);
    }
    return res.json(result);
  };
}

// Server-Sent Events stream for live dashboard updates
export function streamRoute(engine: MonitorEngine, options: StreamRouteSecurityOptions) {
  const connectionQuota = createConnectionQuota({
    maxConnectionsPerUser: options.maxConnectionsPerUser,
    maxConnectionsTotal: options.maxTotalConnections,
    perUserLimitMessage: "Too many active dashboard streams for the current user.",
    globalLimitMessage: "Too many active dashboard streams.",
  });

  return (req: Request, res: Response) => {
    const userId = req.authUser?.id;
    if (typeof userId !== "number") {
      res.status(401).json({
        ok: false,
        message: "Unauthorized",
      });
      return;
    }

    const acquireResult = connectionQuota.acquire(userId);
    if (!acquireResult.ok) {
      res.status(429).json({
        ok: false,
        message: acquireResult.message,
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (eventName: "snapshot" | "ping", data: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    const unsubscribe = engine.subscribe((snap) => send("snapshot", snap));
    const heartbeat = setInterval(() => {
      send("ping", { at: new Date().toISOString() });
    }, 20_000);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
      connectionQuota.release(userId);
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.end();
        } catch {}
      }
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
    res.on("error", cleanup);
  };
}
