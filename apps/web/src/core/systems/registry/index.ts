import type { WebSystemModule } from "../types";
import { scanoSystemModule } from "../../../systems/scano/routes/systemModule";
import { upuseSystemModule } from "../../../systems/upuse/routes/systemModule";

const webSystems = [upuseSystemModule, scanoSystemModule] satisfies WebSystemModule[];

export function getWebSystems() {
  return webSystems;
}

export function getWebSystemById(systemId: string | null | undefined) {
  if (!systemId) return null;
  return webSystems.find((system) => system.id === systemId) ?? null;
}

export function getDefaultWebSystem() {
  return webSystems[0];
}
