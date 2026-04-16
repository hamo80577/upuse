import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getSettings, updateSettings } from "../../../services/settingsStore.js";
import { getSettingsTokenTestSnapshot, startSettingsTokenTestJob } from "../../../services/settingsTokenTestStore.js";
import { testScanoCatalogConnection } from "../../../services/scanoCatalogClient.js";
import { getScanoSettings, updateScanoSettings } from "../../../services/scanoSettingsStore.js";
import { notifyScanoMasterProductEnrichmentConfigChanged } from "../../../services/scanoMasterProductEnrichmentRuntime.js";

const TokenValueSchema = z.string().trim().min(1).max(4096);
const OpsTokenTargetSchema = z.enum(["upuse", "scano"]);

const OpsTokenPatchSchema = z.object({
  upuseOrdersToken: TokenValueSchema.optional(),
  upuseAvailabilityToken: TokenValueSchema.optional(),
  scanoCatalogToken: TokenValueSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one token value is required.",
});

const OpsTokenTestSchema = z.object({
  upuseOrdersToken: TokenValueSchema.optional(),
  upuseAvailabilityToken: TokenValueSchema.optional(),
  scanoCatalogToken: TokenValueSchema.optional(),
  targets: z.array(OpsTokenTargetSchema).min(1).max(2).optional(),
}).strict();

const TokenTestParamSchema = z.object({
  jobId: z.string().trim().uuid(),
});

function maskToken(token: string) {
  if (!token) return "";
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function listOpsTokenStatuses() {
  const upuseSettings = getSettings();
  const scanoSettings = getScanoSettings();

  return [
    {
      id: "upuse_orders" as const,
      label: "UPuse Orders API",
      system: "upuse" as const,
      description: "Order lookup, branch metrics, and cancellation-owner probes.",
      configured: upuseSettings.ordersToken.trim().length > 0,
      mask: maskToken(upuseSettings.ordersToken),
      updatedAt: null,
    },
    {
      id: "upuse_availability" as const,
      label: "UPuse Availability API",
      system: "upuse" as const,
      description: "Branch availability checks and monitor-controlled closure state.",
      configured: upuseSettings.availabilityToken.trim().length > 0,
      mask: maskToken(upuseSettings.availabilityToken),
      updatedAt: null,
    },
    {
      id: "scano_catalog" as const,
      label: "Scano Catalog API",
      system: "scano" as const,
      description: "Chain, branch, external product, and enrichment catalog access.",
      configured: scanoSettings.catalogToken.trim().length > 0,
      mask: maskToken(scanoSettings.catalogToken),
      updatedAt: scanoSettings.updatedAt,
    },
  ];
}

function createScanoTestFailure(error: unknown) {
  const typedError = error as { status?: unknown; message?: unknown };
  return {
    ok: false as const,
    status: typeof typedError.status === "number" ? typedError.status : null,
    message: typeof typedError.message === "string" && typedError.message.trim()
      ? typedError.message
      : "Scano catalog token test failed.",
    baseUrl: null,
  };
}

export function createOpsTokensRoute() {
  return (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        ok: true,
        tokens: listOpsTokenStatuses(),
      });
    } catch (error) {
      next(error);
    }
  };
}

export function createOpsUpdateTokensRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const patch = OpsTokenPatchSchema.parse(req.body ?? {});

      if (patch.upuseOrdersToken || patch.upuseAvailabilityToken) {
        updateSettings({
          ...(patch.upuseOrdersToken ? { ordersToken: patch.upuseOrdersToken } : {}),
          ...(patch.upuseAvailabilityToken ? { availabilityToken: patch.upuseAvailabilityToken } : {}),
        });
      }

      if (patch.scanoCatalogToken) {
        updateScanoSettings({
          catalogToken: patch.scanoCatalogToken,
        });
        notifyScanoMasterProductEnrichmentConfigChanged();
      }

      res.json({
        ok: true,
        tokens: listOpsTokenStatuses(),
      });
    } catch (error) {
      next(error);
    }
  };
}

export function createOpsTokenTestRoute() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = OpsTokenTestSchema.parse(req.body ?? {});
      const targets = new Set(payload.targets ?? ["upuse", "scano"]);
      const response: {
        ok: true;
        upuse?: ReturnType<typeof startSettingsTokenTestJob>;
        scano?: Awaited<ReturnType<typeof testScanoCatalogConnection>> | ReturnType<typeof createScanoTestFailure>;
      } = { ok: true };

      if (targets.has("upuse")) {
        const overrides = {
          ...(payload.upuseOrdersToken ? { ordersToken: payload.upuseOrdersToken } : {}),
          ...(payload.upuseAvailabilityToken ? { availabilityToken: payload.upuseAvailabilityToken } : {}),
        };
        response.upuse = startSettingsTokenTestJob(Object.keys(overrides).length > 0 ? overrides : undefined);
      }

      if (targets.has("scano")) {
        try {
          response.scano = await testScanoCatalogConnection(
            payload.scanoCatalogToken ? { catalogToken: payload.scanoCatalogToken } : undefined,
          );
        } catch (error) {
          response.scano = createScanoTestFailure(error);
        }
      }

      res.status(response.upuse ? 202 : 200).json(response);
    } catch (error) {
      next(error);
    }
  };
}

export function createOpsTokenTestSnapshotRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jobId } = TokenTestParamSchema.parse(req.params);
      const snapshot = getSettingsTokenTestSnapshot(jobId);
      if (!snapshot) {
        res.status(404).json({
          ok: false,
          message: "Token test job not found",
          code: "OPS_TOKEN_TEST_NOT_FOUND",
          errorOrigin: "validation",
        });
        return;
      }

      res.json({
        ok: true,
        snapshot,
      });
    } catch (error) {
      next(error);
    }
  };
}
