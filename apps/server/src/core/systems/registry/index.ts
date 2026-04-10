import type { ServerSystemModule } from "../types.js";
import { scanoSystemModule } from "../../../systems/scano/module.js";
import { upuseSystemModule } from "../../../systems/upuse/module.js";

const serverSystems: ServerSystemModule[] = [
  upuseSystemModule,
  scanoSystemModule,
];

export function getServerSystems() {
  return serverSystems;
}
