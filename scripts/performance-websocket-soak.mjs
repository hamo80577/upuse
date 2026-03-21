import { WebSocket } from "ws";

function getArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function requireArg(name) {
  const value = getArg(name);
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

async function main() {
  const baseUrl = getArg("base", "http://localhost:8080").replace(/\/$/, "");
  const cookie = requireArg("cookie");
  const connections = Number(getArg("connections", "5"));
  const durationMs = Number(getArg("duration", "30000"));
  const wsUrl = `${baseUrl.replace(/^http/, "ws")}/api/ws/performance`;
  const origin = baseUrl;

  let opened = 0;
  let closed = 0;
  let errors = 0;
  let syncMessages = 0;
  let pingMessages = 0;

  const sockets = Array.from({ length: connections }, () =>
    new Promise((resolve) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          Cookie: cookie,
          Origin: origin,
        },
      });

      ws.on("open", () => {
        opened += 1;
        resolve(ws);
      });

      ws.on("message", (raw) => {
        try {
          const payload = JSON.parse(String(raw));
          if (payload?.type === "sync") syncMessages += 1;
          if (payload?.type === "ping") pingMessages += 1;
        } catch {}
      });

      ws.on("close", () => {
        closed += 1;
      });

      ws.on("error", () => {
        errors += 1;
      });

      ws.on("unexpected-response", (_request, response) => {
        errors += 1;
        console.error(`unexpected websocket response: ${response.statusCode}`);
        response.resume();
        resolve(null);
      });
    }),
  );

  const resolvedSockets = (await Promise.all(sockets)).filter(Boolean);

  await new Promise((resolve) => setTimeout(resolve, durationMs));

  await Promise.all(
    resolvedSockets.map((socket) =>
      new Promise((resolve) => {
        socket.once("close", () => resolve());
        socket.close();
      })),
  );

  console.log(JSON.stringify({
    target: "performance-websocket",
    baseUrl,
    connections,
    durationMs,
    opened,
    closed,
    errors,
    syncMessages,
    pingMessages,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
