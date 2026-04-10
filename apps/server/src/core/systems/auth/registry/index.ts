import type { SystemUserAccessSynchronizer } from "../types.js";
import { scanoUserAccessSynchronizer } from "../../../../systems/scano/services/userAccessSynchronizer.js";

const synchronizers: SystemUserAccessSynchronizer[] = [
  scanoUserAccessSynchronizer,
];

export function listSystemUserAccessSynchronizers() {
  return synchronizers;
}
