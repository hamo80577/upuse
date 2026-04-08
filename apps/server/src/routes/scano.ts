import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import {
  completeScanoTask,
  createScanoTask,
  createScanoTaskProduct,
  deleteScanoTask,
  endScanoTask,
  getScanoRunnerBootstrap,
  getScanoTaskExportDownload,
  getScanoTaskProductDetail,
  getScanoTaskProductImageDownload,
  getScanoTaskDetail,
  hydrateScanoRunnerExternalProduct,
  listScanoTaskProducts,
  listScanoTaskScans,
  listScanoTasks,
  resolveScanoTaskScan,
  resumeScanoTask,
  searchScanoRunnerExternalProducts,
  ScanoTaskStoreError,
  startScanoTask,
  confirmScanoTaskExportDownload,
  createScanoTaskExport,
  updateScanoTaskAssignees,
  updateScanoTaskProduct,
  updateScanoTask,
} from "../services/scanoTaskStore.js";
import {
  deleteScanoMasterProduct,
  getScanoMasterProduct,
  listScanoMasterProducts,
  previewScanoMasterProductCsv,
  ScanoMasterProductStoreError,
  upsertScanoMasterProduct,
} from "../services/scanoMasterProductStore.js";
import {
  createScanoTeamMember,
  deleteScanoTeamMember,
  listScanoTeamMembers,
  ScanoTeamStoreError,
  updateScanoTeamMember,
} from "../services/scanoTeamStore.js";
import { searchScanoBranches, ScanoCatalogClientError, searchScanoChains, testScanoCatalogConnection } from "../services/scanoCatalogClient.js";
import { getScanoSettings, updateScanoSettings } from "../services/scanoSettingsStore.js";

const IsoDateTimeSchema = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Invalid ISO date-time value.",
});

const PositiveIntSchema = z.coerce.number().int().positive();
const ScanoRoleSchema = z.enum(["team_lead", "scanner"]);

const ScanoQuerySchema = z.object({
  query: z.string().trim().max(120).optional().default(""),
});

const ScanoBranchesQuerySchema = z.object({
  chainId: PositiveIntSchema,
  query: z.string().trim().max(120).optional().default(""),
});

const ScanoTasksQuerySchema = z.object({
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});

const ScanoTaskProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(50).optional().default(10),
  query: z.string().trim().max(120).optional().default(""),
  source: z.enum(["all", "vendor", "chain", "master", "manual"]).optional().default("all"),
});

const ScanoTaskScansQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(50).optional().default(10),
});

const ScanoTaskBodySchema = z.object({
  chainId: PositiveIntSchema,
  chainName: z.string().trim().min(1).max(120),
  branch: z.object({
    id: PositiveIntSchema,
    globalId: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(180),
    globalEntityId: z.string().trim().min(1).max(32),
    countryCode: z.string().trim().min(2).max(8),
    additionalRemoteId: z.string().trim().min(1).max(64),
  }),
  assigneeIds: z.array(PositiveIntSchema).min(1),
  scheduledAt: IsoDateTimeSchema,
});

const ScanoTaskAssigneesBodySchema = z.object({
  assigneeIds: z.array(PositiveIntSchema).min(1),
});

const ScanoTaskScanBodySchema = z.object({
  barcode: z.string().trim().min(1).max(180),
  source: z.enum(["manual", "scanner", "camera"]),
  selectedExternalProductId: z.string().trim().min(1).optional(),
});

const ScanoRunnerSearchBodySchema = z.object({
  runnerToken: z.string().trim().min(1).max(120),
  barcode: z.string().trim().min(1).max(180),
}).strict();

const ScanoRunnerHydrateBodySchema = z.object({
  runnerToken: z.string().trim().min(1).max(120),
  productId: z.string().trim().min(1).max(120),
}).strict();

const ScanoTaskProductBodySchema = z.object({
  externalProductId: z.string().trim().min(1).nullable().optional(),
  barcode: z.string().trim().min(1).max(180),
  barcodes: z.array(z.string().trim().min(1).max(180)).default([]),
  sku: z.string().trim().min(1).max(180),
  price: z.string().trim().min(1).max(180).nullable().optional(),
  itemNameEn: z.string().trim().min(1).max(180),
  itemNameAr: z.string().trim().min(1).max(180).nullable().optional(),
  sourceMeta: z.object({
    sourceType: z.enum(["vendor", "chain", "master", "manual"]),
    chain: z.enum(["yes", "no"]),
    vendor: z.enum(["yes", "no"]),
    masterfile: z.enum(["yes", "no"]),
    new: z.enum(["yes", "no"]),
  }),
  imageUrls: z.array(z.string().trim().url()).optional(),
  existingImageIds: z.array(z.string().trim().min(1)).optional(),
}).strict();

const ScanoTeamCreateBodySchema = z.object({
  linkedUserId: PositiveIntSchema,
  role: ScanoRoleSchema,
  active: z.boolean().default(true),
});

const ScanoTeamUpdateBodySchema = z.object({
  linkedUserId: PositiveIntSchema,
  role: ScanoRoleSchema,
  active: z.boolean(),
});

const ScanoSettingsPatchSchema = z.object({
  catalogBaseUrl: z.string().trim().url().optional(),
  catalogToken: z.string().trim().min(1).optional(),
}).strict();

const ScanoSettingsTestSchema = z.object({
  catalogBaseUrl: z.string().trim().url().optional(),
  catalogToken: z.string().trim().min(1).optional(),
}).strict();

const TaskIdParamSchema = z.object({
  id: z.string().trim().uuid(),
});

const TaskProductParamSchema = z.object({
  id: z.string().trim().uuid(),
  productId: z.string().trim().uuid(),
});

const TaskExportParamSchema = z.object({
  id: z.string().trim().uuid(),
  exportId: z.string().trim().uuid(),
});

const TaskProductImageParamSchema = z.object({
  id: z.string().trim().uuid(),
  productId: z.string().trim().uuid(),
  imageId: z.string().trim().min(1),
});

const TeamIdParamSchema = z.object({
  id: PositiveIntSchema,
});

const ChainIdParamSchema = z.object({
  chainId: PositiveIntSchema,
});

const ScanoMasterProductMappingSchema = z.object({
  barcode: z.string().trim().min(1).max(180).nullable().optional(),
  sku: z.string().trim().min(1).max(180).nullable().optional(),
  price: z.string().trim().min(1).max(180).nullable().optional(),
  itemNameEn: z.string().trim().min(1).max(180).nullable().optional(),
  itemNameAr: z.string().trim().min(1).max(180).nullable().optional(),
  image: z.string().trim().min(1).max(180).nullable().optional(),
}).strict();

const ScanoMasterProductFormSchema = z.object({
  chainId: PositiveIntSchema,
  chainName: z.string().trim().min(1).max(120),
  mappingJson: z.string().trim().min(2),
});

const masterProductUpload = multer({
  storage: multer.memoryStorage(),
});
const scanoTaskProductUpload = multer({
  storage: multer.memoryStorage(),
});

export const scanoMasterProductUpload = masterProductUpload.single("file");
export const scanoTaskProductImagesUpload = scanoTaskProductUpload.array("images");

function getActorContext(req: Request) {
  const actorUserId = req.authUser?.id;
  if (!actorUserId) {
    throw new ScanoTaskStoreError("Unauthorized", 401, "SCANO_UNAUTHORIZED");
  }

  return {
    actorUserId,
    canViewAllTasks: req.authUser?.isPrimaryAdmin === true || req.authUser?.scanoRole === "team_lead",
    canManageTasks: req.authUser?.isPrimaryAdmin === true || req.authUser?.scanoRole === "team_lead",
    canReviewTasks: req.authUser?.isPrimaryAdmin === true || req.authUser?.scanoRole === "team_lead",
  };
}

function normalizeScanoError(error: unknown) {
  if (
    error instanceof ScanoTaskStoreError ||
    error instanceof ScanoTeamStoreError ||
    error instanceof ScanoMasterProductStoreError ||
    error instanceof ScanoCatalogClientError
  ) {
    return error;
  }

  throw error;
}

function parseMasterProductFormBody(req: Request) {
  const payload = ScanoMasterProductFormSchema.parse(req.body ?? {});
  let mappingJson: unknown;
  try {
    mappingJson = JSON.parse(payload.mappingJson);
  } catch {
    throw new ScanoMasterProductStoreError(
      "Master product mapping JSON is invalid.",
      400,
      "SCANO_MASTER_PRODUCT_MAPPING_JSON_INVALID",
    );
  }

  return {
    chainId: payload.chainId,
    chainName: payload.chainName,
    mapping: (() => {
      const parsed = ScanoMasterProductMappingSchema.parse(mappingJson);
      return {
        barcode: parsed.barcode ?? null,
        sku: parsed.sku ?? null,
        price: parsed.price ?? null,
        itemNameEn: parsed.itemNameEn ?? null,
        itemNameAr: parsed.itemNameAr ?? null,
        image: parsed.image ?? null,
      };
    })(),
  };
}

function readUploadedCsv(req: Request) {
  const file = req.file;
  if (!file?.buffer?.length) {
    throw new ScanoMasterProductStoreError("CSV file is required.", 400, "SCANO_MASTER_PRODUCT_FILE_REQUIRED");
  }

  const normalizedName = file.originalname.trim().toLowerCase();
  const normalizedMimeType = file.mimetype.trim().toLowerCase();
  const looksLikeCsv =
    normalizedName.endsWith(".csv") ||
    normalizedMimeType.includes("csv") ||
    normalizedMimeType === "text/plain" ||
    normalizedMimeType === "application/vnd.ms-excel";

  if (!looksLikeCsv) {
    throw new ScanoMasterProductStoreError("Only CSV files are supported.", 400, "SCANO_MASTER_PRODUCT_FILE_INVALID");
  }

  return file.buffer.toString("utf8");
}

function parseScanoTaskProductBody(req: Request) {
  let payloadJson: unknown;
  try {
    payloadJson = typeof req.body?.payloadJson === "string" ? JSON.parse(req.body.payloadJson) : req.body ?? {};
  } catch {
    throw new ScanoTaskStoreError("Task product payload JSON is invalid.", 400, "SCANO_TASK_PRODUCT_PAYLOAD_INVALID");
  }

  const parsed = ScanoTaskProductBodySchema.parse(payloadJson);
  return {
    ...parsed,
    externalProductId: parsed.externalProductId ?? null,
    price: parsed.price ?? null,
    itemNameAr: parsed.itemNameAr ?? null,
    sourceMeta: {
      sourceType: parsed.sourceMeta.sourceType,
      chain: parsed.sourceMeta.chain,
      vendor: parsed.sourceMeta.vendor,
      masterfile: parsed.sourceMeta.masterfile,
      new: parsed.sourceMeta.new,
    },
    imageUrls: parsed.imageUrls ?? [],
    existingImageIds: parsed.existingImageIds ?? [],
  };
}

function readTaskProductUploads(req: Request) {
  const files = Array.isArray(req.files) ? req.files : [];
  return files
    .filter((file): file is Express.Multer.File => !!file?.buffer?.length)
    .map((file) => ({
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    }));
}

export function listScanoChainsRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const query = ScanoQuerySchema.parse(req.query);
    void searchScanoChains(query.query)
      .then((result) => {
        res.json(result);
      })
      .catch((error) => {
        next(normalizeScanoError(error));
      });
  } catch (error) {
    next(normalizeScanoError(error));
  }
}

export function listScanoBranchesRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const query = ScanoBranchesQuerySchema.parse(req.query);
    void searchScanoBranches({
      chainId: query.chainId,
      query: query.query,
    })
      .then((result) => {
        res.json(result);
      })
      .catch((error) => {
        next(normalizeScanoError(error));
      });
  } catch (error) {
    next(normalizeScanoError(error));
  }
}

export function listScanoTasksRoute(req: Request, res: Response) {
  try {
    const query = ScanoTasksQuerySchema.parse(req.query);
    const actor = getActorContext(req);
    res.json({
      items: listScanoTasks({
        from: query.from,
        to: query.to,
        actorUserId: actor.actorUserId,
        canViewAllTasks: actor.canViewAllTasks,
        canManageTasks: actor.canManageTasks,
        canReviewTasks: actor.canReviewTasks,
      }),
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function getScanoTaskDetailRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    res.json({
      item: getScanoTaskDetail(id, actor.actorUserId, actor.canViewAllTasks, actor.canManageTasks, actor.canReviewTasks),
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function getScanoRunnerBootstrapRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    res.json({
      ok: true,
      item: getScanoRunnerBootstrap(id, actor.actorUserId, actor.canManageTasks, actor.canReviewTasks),
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function searchScanoRunnerExternalProductsRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const body = ScanoRunnerSearchBodySchema.parse(req.body);
    void searchScanoRunnerExternalProducts(id, body, actor.actorUserId)
      .then((payload) => {
        res.json({
          ok: true,
          ...payload,
        });
      })
      .catch((error) => {
        next(normalizeScanoError(error));
      });
  } catch (error) {
    next(normalizeScanoError(error));
  }
}

export function hydrateScanoRunnerExternalProductRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const body = ScanoRunnerHydrateBodySchema.parse(req.body);
    void hydrateScanoRunnerExternalProduct(id, body, actor.actorUserId)
      .then((item) => {
        res.json({
          ok: true,
          item,
        });
      })
      .catch((error) => {
        next(normalizeScanoError(error));
      });
  } catch (error) {
    next(normalizeScanoError(error));
  }
}

export function listScanoTaskProductsRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const query = ScanoTaskProductsQuerySchema.parse(req.query);
    res.json(
      listScanoTaskProducts(id, {
        actorUserId: actor.actorUserId,
        canViewAllTasks: actor.canViewAllTasks,
        canManageTasks: actor.canManageTasks,
        canReviewTasks: actor.canReviewTasks,
        page: query.page,
        pageSize: query.pageSize,
        query: query.query,
        source: query.source,
      }),
    );
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function listScanoTaskScansRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const query = ScanoTaskScansQuerySchema.parse(req.query);
    res.json(
      listScanoTaskScans(id, {
        actorUserId: actor.actorUserId,
        canViewAllTasks: actor.canViewAllTasks,
        canManageTasks: actor.canManageTasks,
        canReviewTasks: actor.canReviewTasks,
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function createScanoTaskRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const body = ScanoTaskBodySchema.parse(req.body);
    const item = createScanoTask(body, actor.actorUserId, actor.canManageTasks, actor.canReviewTasks);
    res.status(201).json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function updateScanoTaskRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const body = ScanoTaskBodySchema.parse(req.body);
    const item = updateScanoTask(id, body, actor.actorUserId, actor.canManageTasks, actor.canReviewTasks);
    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function deleteScanoTaskRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const item = deleteScanoTask(
      id,
      actor.actorUserId,
      req.authUser?.isPrimaryAdmin === true || req.authUser?.scanoRole === "team_lead",
    );
    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function startScanoTaskRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const item = startScanoTask(id, actor.actorUserId, actor.canManageTasks, actor.canReviewTasks);
    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function endScanoTaskRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const item = endScanoTask(id, actor.actorUserId, actor.canManageTasks, actor.canReviewTasks);
    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function resumeScanoTaskRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const item = resumeScanoTask(id, actor.actorUserId, actor.canManageTasks, actor.canReviewTasks);
    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function completeScanoTaskRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const item = completeScanoTask(id, actor.actorUserId, actor.canManageTasks, actor.canReviewTasks);
    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function updateScanoTaskAssigneesRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const body = ScanoTaskAssigneesBodySchema.parse(req.body);
    const item = updateScanoTaskAssignees(id, body, actor.actorUserId, actor.canManageTasks, actor.canReviewTasks);
    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function createScanoTaskScanRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const body = ScanoTaskScanBodySchema.parse(req.body);
    void resolveScanoTaskScan(id, body, actor.actorUserId, actor.canManageTasks, actor.canReviewTasks)
      .then((payload) => {
        res.status(200).json({
          ok: true,
          ...payload,
        });
      })
      .catch((error) => {
        next(normalizeScanoError(error));
      });
  } catch (error) {
    next(normalizeScanoError(error));
  }
}

export function createScanoTaskProductRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    const body = parseScanoTaskProductBody(req);
    const result = createScanoTaskProduct(id, body, readTaskProductUploads(req), actor.actorUserId, actor.canManageTasks, actor.canReviewTasks);
    res.status(201).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function updateScanoTaskProductRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id, productId } = TaskProductParamSchema.parse(req.params);
    const body = parseScanoTaskProductBody(req);
    const result = updateScanoTaskProduct(id, productId, body, readTaskProductUploads(req), actor.actorUserId, actor.canManageTasks, actor.canReviewTasks);
    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function getScanoTaskProductRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id, productId } = TaskProductParamSchema.parse(req.params);
    res.json({
      item: getScanoTaskProductDetail(id, productId, actor.actorUserId, actor.canViewAllTasks, actor.canManageTasks, actor.canReviewTasks),
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function getScanoTaskProductImageRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id, productId, imageId } = TaskProductImageParamSchema.parse(req.params);
    const result = getScanoTaskProductImageDownload(id, productId, imageId, actor.actorUserId, actor.canViewAllTasks, actor.canManageTasks, actor.canReviewTasks);
    if (result.kind === "redirect") {
      res.redirect(result.url);
      return;
    }
    res.type(result.mimeType);
    res.setHeader("Content-Disposition", `inline; filename=\"${result.fileName}\"`);
    res.sendFile(result.filePath);
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function createScanoTaskExportRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = getActorContext(req);
    const { id } = TaskIdParamSchema.parse(req.params);
    void createScanoTaskExport(id, actor.actorUserId, actor.canReviewTasks, actor.canManageTasks)
      .then((result) => {
        res.status(201).json({
          ok: true,
          ...result,
        });
      })
      .catch((error) => {
        next(normalizeScanoError(error));
      });
  } catch (error) {
    next(normalizeScanoError(error));
  }
}

export function downloadScanoTaskExportRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id, exportId } = TaskExportParamSchema.parse(req.params);
    const result = getScanoTaskExportDownload(id, exportId, actor.canReviewTasks);
    res.download(result.filePath, result.fileName);
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function confirmScanoTaskExportDownloadRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { id, exportId } = TaskExportParamSchema.parse(req.params);
    const result = confirmScanoTaskExportDownload(id, exportId, actor.actorUserId, actor.canReviewTasks, actor.canManageTasks);
    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function listScanoTeamRoute(_req: Request, res: Response) {
  res.json({
    items: listScanoTeamMembers(),
  });
}

export function getScanoSettingsRoute(_req: Request, res: Response) {
  const settings = getScanoSettings();
  res.json({
    catalogBaseUrl: settings.catalogBaseUrl,
    catalogToken: maskToken(settings.catalogToken),
    updatedAt: settings.updatedAt,
  });
}

function maskToken(token: string) {
  if (!token) return "";
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function createScanoTeamRoute(req: Request, res: Response) {
  try {
    const body = ScanoTeamCreateBodySchema.parse(req.body);
    const item = createScanoTeamMember(body);
    res.status(201).json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function updateScanoTeamRoute(req: Request, res: Response) {
  try {
    const { id } = TeamIdParamSchema.parse(req.params);
    const body = ScanoTeamUpdateBodySchema.parse(req.body);
    const item = updateScanoTeamMember(id, body);
    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function deleteScanoTeamRoute(req: Request, res: Response) {
  try {
    const { id } = TeamIdParamSchema.parse(req.params);
    deleteScanoTeamMember(id);
    res.json({
      ok: true,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function updateScanoSettingsRoute(req: Request, res: Response) {
  try {
    const patch = ScanoSettingsPatchSchema.parse(req.body ?? {});
    const updated = updateScanoSettings(patch);
    res.json({
      ok: true,
      settings: {
        catalogBaseUrl: updated.catalogBaseUrl,
        catalogToken: maskToken(updated.catalogToken),
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function testScanoSettingsRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = ScanoSettingsTestSchema.parse(req.body ?? {});
    void testScanoCatalogConnection(payload)
      .then((result) => {
        res.json(result);
      })
      .catch((error) => {
        next(normalizeScanoError(error));
      });
  } catch (error) {
    next(normalizeScanoError(error));
  }
}

export function listScanoMasterProductsRoute(_req: Request, res: Response) {
  try {
    res.json({
      items: listScanoMasterProducts(),
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function previewScanoMasterProductsRoute(req: Request, res: Response) {
  try {
    const csv = readUploadedCsv(req);
    res.json(previewScanoMasterProductCsv(csv));
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function createScanoMasterProductRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const body = parseMasterProductFormBody(req);
    const csv = readUploadedCsv(req);
    const item = upsertScanoMasterProduct({
      chainId: body.chainId,
      chainName: body.chainName,
      mapping: body.mapping,
      csv,
      actorUserId: actor.actorUserId,
    });
    res.status(201).json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function getScanoMasterProductRoute(req: Request, res: Response) {
  try {
    const { chainId } = ChainIdParamSchema.parse(req.params);
    res.json({
      item: getScanoMasterProduct(chainId),
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function updateScanoMasterProductRoute(req: Request, res: Response) {
  try {
    const actor = getActorContext(req);
    const { chainId } = ChainIdParamSchema.parse(req.params);
    const body = parseMasterProductFormBody(req);
    const csv = readUploadedCsv(req);
    if (body.chainId !== chainId) {
      throw new ScanoMasterProductStoreError(
        "Chain ID in the form data does not match the target record.",
        400,
        "SCANO_MASTER_PRODUCT_CHAIN_ID_MISMATCH",
      );
    }
    const item = upsertScanoMasterProduct({
      chainId,
      chainName: body.chainName,
      mapping: body.mapping,
      csv,
      actorUserId: actor.actorUserId,
    });
    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}

export function deleteScanoMasterProductRoute(req: Request, res: Response) {
  try {
    const { chainId } = ChainIdParamSchema.parse(req.params);
    deleteScanoMasterProduct(chainId);
    res.json({
      ok: true,
    });
  } catch (error) {
    throw normalizeScanoError(error);
  }
}
