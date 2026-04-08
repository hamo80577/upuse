import type { AppUserRole } from "../types/models.js";

export type AppCapability =
  | "manage_users"
  | "manage_monitor"
  | "refresh_monitor_orders"
  | "manage_branch_mappings"
  | "delete_branch_mappings"
  | "manage_thresholds"
  | "manage_settings"
  | "manage_settings_tokens"
  | "test_settings_tokens"
  | "clear_logs";

const roleCapabilities: Record<AppUserRole, ReadonlySet<AppCapability>> = {
  admin: new Set<AppCapability>([
    "manage_users",
    "manage_monitor",
    "refresh_monitor_orders",
    "manage_branch_mappings",
    "delete_branch_mappings",
    "manage_thresholds",
    "manage_settings",
    "manage_settings_tokens",
    "test_settings_tokens",
    "clear_logs",
  ]),
  user: new Set<AppCapability>([
    "manage_monitor",
    "manage_branch_mappings",
    "delete_branch_mappings",
    "manage_thresholds",
    "manage_settings_tokens",
    "test_settings_tokens",
  ]),
};

export function hasCapability(role: AppUserRole | undefined, capability: AppCapability, upuseAccess = true) {
  if (!role || !upuseAccess) return false;
  return roleCapabilities[role]?.has(capability) ?? false;
}
