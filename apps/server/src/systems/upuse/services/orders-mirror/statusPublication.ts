import type { OrdersMirrorEntitySyncStatus } from "./types.js";

const entitySyncSubscribers = new Set<(status: OrdersMirrorEntitySyncStatus) => void>();

export function publishEntitySyncStatus(status: OrdersMirrorEntitySyncStatus) {
  for (const subscriber of entitySyncSubscribers) {
    try {
      subscriber(status);
    } catch (error) {
      console.error("Orders mirror subscriber failed", error);
    }
  }
}

export function subscribeOrdersMirrorEntitySync(fn: (status: OrdersMirrorEntitySyncStatus) => void) {
  entitySyncSubscribers.add(fn);
  return () => {
    entitySyncSubscribers.delete(fn);
  };
}
