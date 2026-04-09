export interface ConnectionQuotaAcquireResult {
  ok: true;
}

export interface ConnectionQuotaRejectResult {
  ok: false;
  statusCode: 429;
  message: string;
}

export interface ConnectionQuotaOptions {
  maxConnectionsPerUser: number;
  maxConnectionsTotal: number;
  perUserLimitMessage: string;
  globalLimitMessage: string;
}

export interface ConnectionQuota {
  acquire(userId: number): ConnectionQuotaAcquireResult | ConnectionQuotaRejectResult;
  release(userId: number): void;
}

export function createConnectionQuota(options: ConnectionQuotaOptions): ConnectionQuota {
  const activeConnectionsByUserId = new Map<number, number>();
  let activeConnectionsTotal = 0;

  return {
    acquire(userId) {
      const userConnectionCount = activeConnectionsByUserId.get(userId) ?? 0;
      if (userConnectionCount >= options.maxConnectionsPerUser) {
        return {
          ok: false,
          statusCode: 429,
          message: options.perUserLimitMessage,
        };
      }

      if (activeConnectionsTotal >= options.maxConnectionsTotal) {
        return {
          ok: false,
          statusCode: 429,
          message: options.globalLimitMessage,
        };
      }

      activeConnectionsByUserId.set(userId, userConnectionCount + 1);
      activeConnectionsTotal += 1;
      return { ok: true };
    },

    release(userId) {
      const currentUserCount = activeConnectionsByUserId.get(userId);
      if (!currentUserCount) {
        return;
      }

      if (currentUserCount > 1) {
        activeConnectionsByUserId.set(userId, currentUserCount - 1);
      } else {
        activeConnectionsByUserId.delete(userId);
      }

      activeConnectionsTotal = Math.max(0, activeConnectionsTotal - 1);
    },
  };
}
