import { initializeRuntime } from "./app/bootstrap/initializeRuntime.js";
import { createApp } from "./app/server/createApp.js";
import { getEnv } from "./config/env.js";
import { getServerSystems } from "./core/systems/registry/index.js";

const runtime = initializeRuntime();
const app = createApp(runtime);
const port = Number(getEnv("PORT", "8080"));
const server = app.listen(port, () => {
  console.log(`UPuse server listening on http://localhost:${port}`);
});

for (const system of getServerSystems()) {
  system.registerWebSockets?.({
    ...runtime,
    app,
    server,
  });
}
