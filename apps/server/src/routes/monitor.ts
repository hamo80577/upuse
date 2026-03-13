import type { Request, Response } from "express";
import type { MonitorEngine } from "../services/monitorEngine.js";

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
  const activeConnectionsByUserId = new Map<number, number>();
  let activeConnectionsTotal = 0;

  return (req: Request, res: Response) => {
    const userId = req.authUser?.id;
    if (typeof userId !== "number") {
      res.status(401).json({
        ok: false,
        message: "Unauthorized",
      });
      return;
    }

    const userConnectionCount = activeConnectionsByUserId.get(userId) ?? 0;
    if (userConnectionCount >= options.maxConnectionsPerUser) {
      res.status(429).json({
        ok: false,
        message: "Too many active dashboard streams for the current user.",
      });
      return;
    }

    if (activeConnectionsTotal >= options.maxTotalConnections) {
      res.status(429).json({
        ok: false,
        message: "Too many active dashboard streams.",
      });
      return;
    }

    activeConnectionsByUserId.set(userId, userConnectionCount + 1);
    activeConnectionsTotal += 1;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (eventName: "snapshot" | "ping", data: any) => {
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
      const nextUserCount = (activeConnectionsByUserId.get(userId) ?? 1) - 1;
      if (nextUserCount > 0) {
        activeConnectionsByUserId.set(userId, nextUserCount);
      } else {
        activeConnectionsByUserId.delete(userId);
      }
      activeConnectionsTotal = Math.max(0, activeConnectionsTotal - 1);
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
