import type { SystemUserAccessAssignmentResolver } from "../../../core/systems/auth/types.js";
import type { AppUser } from "../../../types/models.js";

export const upuseUserAccessAssignmentResolver: SystemUserAccessAssignmentResolver = {
  systemId: "upuse",
  resolveUserAccessAssignment(input) {
    return input.upuseAccess
      ? {
          enabled: true,
          role: input.upuseRole ?? "user",
        }
      : {
          enabled: false,
        };
  },
};

export function canAccessUpuseSystem(user: AppUser | null | undefined) {
  return !!user && user.upuseAccess === true;
}
