import { migrate } from "../../config/db.js";
import { resolveSecurityConfig } from "../../config/security.js";
import { MonitorEngine } from "../../services/monitorEngine.js";
import { initializeLoginThrottleStore } from "../../services/loginThrottleStore.js";
import { getSettings } from "../../services/settingsStore.js";

export function initializeRuntime() {
  migrate();
  initializeLoginThrottleStore();
  getSettings();

  return {
    engine: new MonitorEngine(),
    securityConfig: resolveSecurityConfig(),
  };
}
