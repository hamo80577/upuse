import type { AppUser } from "../../../types/models.js";
import { hasScanoAccess } from "../../../systems/scano/policies/access.js";
import { canAccessUpuseSystem } from "../../../systems/upuse/services/userAccess.js";

const systemAccessAuthorizers: Record<string, (user: AppUser | null | undefined) => boolean> = {
  upuse: canAccessUpuseSystem,
  scano: hasScanoAccess,
};

export function canUserAccessSystem(systemId: string, user: AppUser | null | undefined) {
  return systemAccessAuthorizers[systemId]?.(user) ?? false;
}
