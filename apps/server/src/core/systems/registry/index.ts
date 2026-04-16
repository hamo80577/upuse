import type { ServerSystemModule } from "../types.js";
import { opsSystemModule } from "../../../systems/ops/module.js";
import { scanoSystemModule } from "../../../systems/scano/module.js";
import { upuseSystemModule } from "../../../systems/upuse/module.js";

const serverSystems: ServerSystemModule[] = [
  upuseSystemModule,
  scanoSystemModule,
  opsSystemModule,
];

export function getServerSystems() {
  return serverSystems;
}
