import { migrate } from "../../config/db.js";
import { resolveSecurityConfig } from "../../config/security.js";
import { MonitorEngine } from "../../monitor/engine/MonitorEngine.js";
import { initializeLoginThrottleStore } from "../../services/loginThrottleStore.js";
import { getSettings } from "../../services/settingsStore.js";
import { initializeSessionStore } from "../../shared/persistence/auth/sessionStore.js";

export async function initializeRuntime() {
  await migrate();
  initializeLoginThrottleStore();
  initializeSessionStore();
  getSettings();

  return {
    engine: new MonitorEngine(),
    securityConfig: resolveSecurityConfig(),
  };
}
