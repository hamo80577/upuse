import type { AppUser } from "../../../../types/models.js";
import type {
  SystemUserAccessAssignmentResolver,
  SystemUserAccessSynchronizer,
  SystemUserProjection,
} from "../types.js";
import { getServerSystems } from "../../registry/index.js";

function flatMapSystemAuth<T>(selector: (auth: NonNullable<ReturnType<typeof getServerSystems>[number]["auth"]>) => T[] | undefined) {
  return getServerSystems().flatMap((system) => system.auth ? (selector(system.auth) ?? []) : []);
}

export function listSystemUserAccessSynchronizers() {
  return flatMapSystemAuth<SystemUserAccessSynchronizer>((auth) => auth.userAccessSynchronizers);
}

export function listSystemUserAccessAssignmentResolvers() {
  return flatMapSystemAuth<SystemUserAccessAssignmentResolver>((auth) => auth.userAccessAssignmentResolvers);
}

export function listSystemUserProjections() {
  return flatMapSystemAuth<SystemUserProjection>((auth) => auth.userProjections);
}

export function applySystemUserProjections(user: AppUser) {
  return listSystemUserProjections().reduce((current, projection) => projection.enrichUser(current), user);
}

export function canUserAccessSystem(systemId: string, user: AppUser | null | undefined) {
  const system = getServerSystems().find((item) => item.id === systemId);
  return system?.auth?.canAccessUser?.(user) ?? false;
}
