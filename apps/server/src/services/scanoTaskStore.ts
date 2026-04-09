import archiver from "archiver";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { db } from "../config/db.js";
import { resolveDataDir } from "../config/paths.js";
import {
  getScanoProductAssignmentCheck,
  getScanoProductDetail,
  normalizeBarcodeForExternalLookup,
  searchScanoProductsByBarcode,
} from "./scanoCatalogClient.js";
import { findScanoMasterProductMatch, listScanoMasterProductIndex } from "./scanoMasterProductStore.js";
import {
  scanoTaskProductRepository,
  type StoredScanoTaskProduct as StoredTaskProduct,
  type StoredScanoTaskProductImage as StoredTaskProductImage,
} from "./scanoTaskProductRepository.js";
import { scanoRunnerSessionStore } from "./scanoRunnerSessionStore.js";
import type {
  CreateScanoTaskInput,
  ResolveScanoTaskScanInput,
  SaveScanoTaskProductInput,
  ScanoRunnerAssignmentResponse,
  ScanoRunnerBootstrapResponse,
  ScanoRunnerExternalSearchResponse,
  ScanoRunnerHydrateInput,
  ScanoRunnerSearchInput,
  ScanoExternalProductSearchResult,
  ScanoTaskId,
  ScanoTaskAssignee,
  ScanoTaskCounters,
  ScanoTaskDetail,
  ScanoTaskExport,
  ScanoTaskListItem,
  ScanoTaskProductListSourceFilter,
  ScanoTaskParticipantState,
  ScanoPaginationMeta,
  ScanoTaskProduct,
  ScanoTaskProductDraft,
  ScanoTaskProductEditLog,
  ScanoTaskProductImage,
  ScanoTaskProductSnapshot,
  ScanoTaskProductSource,
  ScanoTaskProductsPageResponse,
  ScanoTaskScanItem,
  ScanoTaskScanOutcome,
  ScanoTaskScansPageResponse,
  ScanoTaskScanResolveResponse,
  ScanoTaskSummaryPatch,
  ScanoTaskStatus,
  ScanoYesNoFlag,
  UpdateScanoTaskAssigneesInput,
  UpdateScanoTaskInput,
} from "../types/models.js";

interface ScanoTaskRow {
  id: ScanoTaskId;
  chainId: number;
  chainName: string;
  branchId: number;
  branchGlobalId: string;
  branchName: string;
  globalEntityId: string;
  countryCode: string;
  additionalRemoteId: string;
  scheduledAt: string;
  status: ScanoTaskStatus;
  startedAt: string | null;
  startedByUserId: number | null;
  startedByTeamMemberId: number | null;
}

interface ScanoTaskAssigneeRow {
  taskId: ScanoTaskId;
  id: number;
  name: string;
  linkedUserId: number;
}

interface ScanoTaskParticipantRow {
  taskId: ScanoTaskId;
  id: number;
  name: string;
  linkedUserId: number;
  startedAt: string | null;
  lastEnteredAt: string | null;
  endedAt: string | null;
}

interface ScanoTaskScanRow {
  id: number;
  taskId: ScanoTaskId;
  teamMemberId: number;
  barcode: string;
  source: "manual" | "scanner" | "camera";
  lookupStatus: "pending_integration";
  outcome: ScanoTaskScanOutcome;
  taskProductId: string | null;
  resolvedProductJson: string | null;
  scannedAt: string;
  name: string;
  linkedUserId: number;
}

interface TaskProgressRow {
  totalCount: number;
  startedCount: number | null;
  endedCount: number | null;
}

interface TaskCountersRow {
  scannedProductsCount: number | null;
  vendorCount: number | null;
  vendorEditedCount: number | null;
  chainCount: number | null;
  chainEditedCount: number | null;
  masterCount: number | null;
  manualCount: number | null;
}

interface ListScanoTasksParams {
  from?: string;
  to?: string;
  actorUserId: number;
  canViewAllTasks: boolean;
  canManageTasks: boolean;
  canReviewTasks: boolean;
}

interface ActorContext {
  actorUserId: number;
  canViewAllTasks: boolean;
  canManageTasks: boolean;
  canReviewTasks: boolean;
}

interface StoredTaskExportState {
  id: string;
  fileName: string;
  filePath: string;
  createdAt: string;
  confirmedDownloadAt: string | null;
  imagesPurgedAt: string | null;
}

type ExcelImageExtension = "png" | "gif" | "jpeg";

const SCANO_STORAGE_DIR = path.join(resolveDataDir(), "scano");
const SCANO_PRODUCT_IMAGES_DIR = path.join(SCANO_STORAGE_DIR, "product-images");
const SCANO_EXPORTS_DIR = path.join(SCANO_STORAGE_DIR, "exports");

export class ScanoTaskStoreError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ScanoTaskStoreError";
    this.status = status;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function ensureScanoStorageDir() {
  fs.mkdirSync(SCANO_PRODUCT_IMAGES_DIR, { recursive: true });
}

function buildPlaceholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function dedupeIds(values: number[]) {
  return Array.from(new Set(values));
}

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function isExternalBarcodeExactMatch(item: ScanoExternalProductSearchResult, barcode: string) {
  const lookupBarcode = normalizeBarcodeForExternalLookup(barcode).toLowerCase();
  if (!lookupBarcode) return false;
  return dedupeStrings([item.barcode, ...(item.barcodes ?? [])])
    .some((value) => normalizeBarcodeForExternalLookup(value).toLowerCase() === lookupBarcode);
}

function normalizePagination(page: number | undefined, pageSize: number | undefined, defaultPageSize = 10) {
  const safePage = Number.isFinite(page) && (page ?? 0) > 0 ? Math.trunc(page ?? 1) : 1;
  const safePageSize = Number.isFinite(pageSize) && (pageSize ?? 0) > 0
    ? Math.min(Math.trunc(pageSize ?? defaultPageSize), 50)
    : defaultPageSize;
  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize,
  };
}

function buildPaginationMeta(page: number, pageSize: number, total: number): ScanoPaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function sanitizeFileName(value: string) {
  return value.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "image";
}

function getFileExtension(fileName: string | null | undefined, mimeType: string | null | undefined) {
  const fileNameExtension = path.extname(fileName ?? "").replace(/^\./, "").trim().toLowerCase();
  if (fileNameExtension) {
    return fileNameExtension;
  }
  return guessExtensionFromMimeType(mimeType);
}

function buildSkuImageFileName(sku: string, index: number, extension: string) {
  const safeSku = sanitizeFileName(sku.trim() || "image");
  const suffix = index <= 0 ? "" : `-${index + 1}`;
  return `${safeSku}${suffix}.${extension}`;
}

function guessExtensionFromMimeType(mimeType: string | null | undefined) {
  const normalized = mimeType?.trim().toLowerCase() ?? "";
  if (normalized === "image/png") return "png" as const;
  if (normalized === "image/gif") return "gif" as const;
  return "jpeg" as const;
}

function guessMimeTypeFromFileName(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function normalizeYesNoFlag(value: ScanoYesNoFlag): ScanoYesNoFlag {
  return value === "yes" ? "yes" : "no";
}

function normalizeSourceMeta(value: {
  sourceType: ScanoTaskProductSource;
  chain: ScanoYesNoFlag;
  vendor: ScanoYesNoFlag;
  masterfile: ScanoYesNoFlag;
  new: ScanoYesNoFlag;
}) {
  return {
    sourceType: value.sourceType,
    chain: normalizeYesNoFlag(value.chain),
    vendor: normalizeYesNoFlag(value.vendor),
    masterfile: normalizeYesNoFlag(value.masterfile),
    new: normalizeYesNoFlag(value.new),
  };
}

function determineSourceType(flags: {
  vendor: ScanoYesNoFlag;
  chain: ScanoYesNoFlag;
  masterfile: ScanoYesNoFlag;
}): ScanoTaskProductSource {
  if (flags.vendor === "yes") return "vendor";
  if (flags.chain === "yes") return "chain";
  if (flags.masterfile === "yes") return "master";
  return "manual";
}

function parseIsoOrThrow(value: string, field: string) {
  const timeMs = Date.parse(value);
  if (Number.isNaN(timeMs)) {
    throw new ScanoTaskStoreError(`Invalid ${field}.`, 400, "SCANO_TASK_INVALID_DATE");
  }

  return new Date(timeMs).toISOString();
}

function ensureTaskInput(input: CreateScanoTaskInput | UpdateScanoTaskInput) {
  if (!input.assigneeIds.length) {
    throw new ScanoTaskStoreError("At least one assignee is required.", 400, "SCANO_TASK_ASSIGNEES_REQUIRED");
  }

  return {
    ...input,
    chainName: input.chainName.trim(),
    branch: {
      ...input.branch,
      name: input.branch.name.trim(),
      globalId: input.branch.globalId.trim(),
      globalEntityId: input.branch.globalEntityId.trim(),
      countryCode: input.branch.countryCode.trim(),
      additionalRemoteId: input.branch.additionalRemoteId.trim(),
    },
    assigneeIds: dedupeIds(input.assigneeIds),
    scheduledAt: parseIsoOrThrow(input.scheduledAt, "scheduledAt"),
  };
}

function ensureAssigneeUpdateInput(input: UpdateScanoTaskAssigneesInput) {
  if (!input.assigneeIds.length) {
    throw new ScanoTaskStoreError("At least one assignee is required.", 400, "SCANO_TASK_ASSIGNEES_REQUIRED");
  }

  return {
    assigneeIds: dedupeIds(input.assigneeIds),
  };
}

function ensureResolveInput(input: ResolveScanoTaskScanInput) {
  const barcode = input.barcode.trim();
  if (!barcode) {
    throw new ScanoTaskStoreError("Barcode is required.", 400, "SCANO_TASK_SCAN_BARCODE_REQUIRED");
  }

  if (barcode.length > 180) {
    throw new ScanoTaskStoreError("Barcode is too long.", 400, "SCANO_TASK_SCAN_BARCODE_TOO_LONG");
  }

  return {
    barcode,
    source: input.source,
    selectedExternalProductId: trimToNull(input.selectedExternalProductId ?? null),
  };
}

function normalizeProductInput(input: SaveScanoTaskProductInput) {
  const barcode = input.barcode.trim();
  const sku = input.sku.trim();
  const itemNameEn = input.itemNameEn.trim();
  if (!barcode) {
    throw new ScanoTaskStoreError("Barcode is required.", 400, "SCANO_TASK_PRODUCT_BARCODE_REQUIRED");
  }
  if (!sku) {
    throw new ScanoTaskStoreError("SKU is required.", 400, "SCANO_TASK_PRODUCT_SKU_REQUIRED");
  }
  if (!itemNameEn) {
    throw new ScanoTaskStoreError("English item name is required.", 400, "SCANO_TASK_PRODUCT_NAME_REQUIRED");
  }

  const barcodes = dedupeStrings([barcode, ...(input.barcodes ?? [])]);

  return {
    externalProductId: trimToNull(input.externalProductId ?? null),
    barcode,
    barcodes,
    sku,
    price: trimToNull(input.price ?? null),
    itemNameEn,
    itemNameAr: trimToNull(input.itemNameAr ?? null),
    imageUrls: dedupeStrings(input.imageUrls ?? []),
    existingImageIds: dedupeStrings(input.existingImageIds ?? []),
  };
}

function ensureProductSourceRequirements(params: {
  sourceType: ScanoTaskProductSource;
  price: string | null;
  hasImage: boolean;
}) {
  if (params.sourceType !== "manual" && params.sourceType !== "master") {
    return;
  }

  if (!params.price?.trim()) {
    throw new ScanoTaskStoreError(
      params.sourceType === "master"
        ? "Master products require a price."
        : "Manual products require a price.",
      400,
      "SCANO_TASK_PRODUCT_PRICE_REQUIRED",
    );
  }

  if (!params.hasImage) {
    throw new ScanoTaskStoreError(
      params.sourceType === "master"
        ? "Master products require at least one image."
        : "Manual products require at least one image.",
      400,
      "SCANO_TASK_PRODUCT_IMAGE_REQUIRED",
    );
  }
}

function mapAssigneeRows(rows: ScanoTaskAssigneeRow[]): ScanoTaskAssignee[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    linkedUserId: row.linkedUserId,
  }));
}

function mapParticipantRows(rows: ScanoTaskParticipantRow[]): ScanoTaskParticipantState[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    linkedUserId: row.linkedUserId,
    startedAt: row.startedAt,
    lastEnteredAt: row.lastEnteredAt,
    endedAt: row.endedAt,
  }));
}

function mapScanRows(rows: ScanoTaskScanRow[]): ScanoTaskScanItem[] {
  return rows.map((row) => ({
    id: row.id,
    barcode: row.barcode,
    source: row.source,
    outcome: row.outcome,
    scannedAt: row.scannedAt,
    taskProductId: row.taskProductId,
    scannedBy: {
      id: row.teamMemberId,
      name: row.name,
      linkedUserId: row.linkedUserId,
    },
  }));
}

function buildProductSnapshot(product: Pick<
  ScanoTaskProductSnapshot,
  "externalProductId" | "previewImageUrl" | "barcode" | "barcodes" | "sku" | "price" | "itemNameEn" | "itemNameAr" | "chain" | "vendor" | "masterfile" | "new"
>) {
  return {
    externalProductId: product.externalProductId,
    previewImageUrl: product.previewImageUrl,
    barcode: product.barcode,
    barcodes: product.barcodes,
    sku: product.sku,
    price: product.price,
    itemNameEn: product.itemNameEn,
    itemNameAr: product.itemNameAr,
    chain: product.chain,
    vendor: product.vendor,
    masterfile: product.masterfile,
    new: product.new,
  } satisfies ScanoTaskProductSnapshot;
}

function canActorEditTaskProducts(taskId: ScanoTaskId, actorUserId: number, taskStatus: ScanoTaskStatus) {
  if (taskStatus !== "in_progress") {
    return false;
  }

  return !!findAssignedScanner(taskId, actorUserId);
}

function buildCounters(taskId: ScanoTaskId): ScanoTaskCounters {
  const row = db.prepare<[ScanoTaskId], TaskCountersRow>(`
    SELECT
      COUNT(*) AS scannedProductsCount,
      SUM(CASE WHEN sourceType = 'vendor' THEN 1 ELSE 0 END) AS vendorCount,
      SUM(CASE WHEN sourceType = 'vendor' AND edited = 1 THEN 1 ELSE 0 END) AS vendorEditedCount,
      SUM(CASE WHEN sourceType = 'chain' THEN 1 ELSE 0 END) AS chainCount,
      SUM(CASE WHEN sourceType = 'chain' AND edited = 1 THEN 1 ELSE 0 END) AS chainEditedCount,
      SUM(CASE WHEN sourceType = 'master' THEN 1 ELSE 0 END) AS masterCount,
      SUM(CASE WHEN sourceType = 'manual' THEN 1 ELSE 0 END) AS manualCount
    FROM scano_task_products
    WHERE taskId = ?
  `).get(taskId);

  return {
    scannedProductsCount: row?.scannedProductsCount ?? 0,
    vendorCount: row?.vendorCount ?? 0,
    vendorEditedCount: row?.vendorEditedCount ?? 0,
    chainCount: row?.chainCount ?? 0,
    chainEditedCount: row?.chainEditedCount ?? 0,
    masterCount: row?.masterCount ?? 0,
    manualCount: row?.manualCount ?? 0,
  };
}

function buildTaskSummaryPatch(item: ScanoTaskListItem): ScanoTaskSummaryPatch {
  return {
    status: item.status,
    progress: item.progress,
    counters: item.counters,
    viewerState: item.viewerState,
    permissions: item.permissions,
    latestExport: item.latestExport,
  };
}

function getLatestExport(taskId: ScanoTaskId, canReviewTasks: boolean): ScanoTaskExport | null {
  const row = db.prepare<[ScanoTaskId], StoredTaskExportState>(`
    SELECT
      id,
      fileName,
      filePath,
      createdAt,
      confirmedDownloadAt,
      imagesPurgedAt
    FROM scano_task_exports
    WHERE taskId = ?
    ORDER BY datetime(createdAt) DESC, id DESC
    LIMIT 1
  `).get(taskId);
  if (!row) return null;

  return {
    id: row.id,
    fileName: row.fileName,
    createdAt: row.createdAt,
    confirmedDownloadAt: row.confirmedDownloadAt,
    imagesPurgedAt: row.imagesPurgedAt,
    canDownload: canReviewTasks,
    requiresConfirmation: canReviewTasks && !row.confirmedDownloadAt,
  };
}

function buildTaskItem(
  row: ScanoTaskRow,
  assignees: ScanoTaskAssignee[],
  participants: ScanoTaskParticipantState[],
  context: ActorContext,
): ScanoTaskListItem {
  const counters = buildCounters(row.id);
  const participantsByMemberId = new Map(participants.map((participant) => [participant.id, participant]));
  const actorAssignee = assignees.find((assignee) => assignee.linkedUserId === context.actorUserId) ?? null;
  const actorParticipant = actorAssignee ? participantsByMemberId.get(actorAssignee.id) ?? null : null;
  const totalCount = assignees.length;
  const startedCount = assignees.reduce(
    (count, assignee) => count + (participantsByMemberId.get(assignee.id)?.startedAt ? 1 : 0),
    0,
  );
  const endedCount = assignees.reduce(
    (count, assignee) => count + (participantsByMemberId.get(assignee.id)?.endedAt ? 1 : 0),
    0,
  );
  const hasStarted = !!actorParticipant?.startedAt;
  const hasEnded = !!actorParticipant?.endedAt;
  const canStart = !!actorAssignee && (row.status === "pending" || row.status === "in_progress") && !hasStarted;
  const canEnter = !!actorAssignee && row.status === "in_progress" && hasStarted && !hasEnded;
  const canResume = !!actorAssignee && row.status === "in_progress" && hasStarted && hasEnded;
  const latestExport = getLatestExport(row.id, context.canReviewTasks);

  return {
    id: row.id,
    chainId: row.chainId,
    chainName: row.chainName,
    branchId: row.branchId,
    branchGlobalId: row.branchGlobalId,
    branchName: row.branchName,
    globalEntityId: row.globalEntityId,
    countryCode: row.countryCode,
    additionalRemoteId: row.additionalRemoteId,
    scheduledAt: row.scheduledAt,
    status: row.status,
    assignees,
    progress: {
      startedCount,
      endedCount,
      totalCount,
    },
    counters,
    viewerState: {
      hasStarted,
      hasEnded,
      canEnter,
      canEnd: !!actorAssignee && row.status === "in_progress" && hasStarted && !hasEnded,
      canResume,
    },
    permissions: {
      canEdit: context.canManageTasks && row.status === "pending",
      canStart,
      canManageAssignees: context.canManageTasks && (row.status === "pending" || row.status === "in_progress"),
      canComplete: context.canReviewTasks && row.status === "awaiting_review" && !!latestExport?.confirmedDownloadAt,
      canDownloadReviewPackage: context.canReviewTasks && (row.status === "awaiting_review" || row.status === "completed"),
      canConfirmReviewExport: context.canReviewTasks && !!latestExport && !latestExport.confirmedDownloadAt,
    },
    latestExport,
  };
}

function getTaskByIdRow(id: ScanoTaskId) {
  const row = db.prepare<[ScanoTaskId], ScanoTaskRow>(`
    SELECT
      id,
      chainId,
      chainName,
      branchId,
      branchGlobalId,
      branchName,
      globalEntityId,
      countryCode,
      additionalRemoteId,
      scheduledAt,
      status,
      startedAt,
      startedByUserId,
      startedByTeamMemberId
    FROM scano_tasks
    WHERE id = ?
  `).get(id);

  if (!row) {
    throw new ScanoTaskStoreError("Scano task not found.", 404, "SCANO_TASK_NOT_FOUND");
  }

  return row;
}

function getAssigneesByTaskIds(taskIds: ScanoTaskId[]) {
  if (!taskIds.length) {
    return new Map<ScanoTaskId, ScanoTaskAssignee[]>();
  }

  const rows = db.prepare(`
    SELECT
      a.taskId,
      m.id,
      m.name,
      m.linkedUserId
    FROM scano_task_assignees a
    INNER JOIN scano_team_members m ON m.id = a.teamMemberId
    WHERE a.taskId IN (${buildPlaceholders(taskIds.length)})
    ORDER BY LOWER(m.name) ASC, m.id ASC
  `).all(...taskIds) as ScanoTaskAssigneeRow[];

  const grouped = new Map<ScanoTaskId, ScanoTaskAssignee[]>();
  for (const row of rows) {
    const current = grouped.get(row.taskId) ?? [];
    current.push({
      id: row.id,
      name: row.name,
      linkedUserId: row.linkedUserId,
    });
    grouped.set(row.taskId, current);
  }

  return grouped;
}

function getParticipantsByTaskIds(taskIds: ScanoTaskId[]) {
  if (!taskIds.length) {
    return new Map<ScanoTaskId, ScanoTaskParticipantState[]>();
  }

  const rows = db.prepare(`
    SELECT
      p.taskId,
      m.id,
      m.name,
      m.linkedUserId,
      p.startedAt,
      p.lastEnteredAt,
      p.endedAt
    FROM scano_task_participants p
    INNER JOIN scano_team_members m ON m.id = p.teamMemberId
    WHERE p.taskId IN (${buildPlaceholders(taskIds.length)})
    ORDER BY LOWER(m.name) ASC, m.id ASC
  `).all(...taskIds) as ScanoTaskParticipantRow[];

  const grouped = new Map<ScanoTaskId, ScanoTaskParticipantState[]>();
  for (const row of rows) {
    const current = grouped.get(row.taskId) ?? [];
    current.push({
      id: row.id,
      name: row.name,
      linkedUserId: row.linkedUserId,
      startedAt: row.startedAt,
      lastEnteredAt: row.lastEnteredAt,
      endedAt: row.endedAt,
    });
    grouped.set(row.taskId, current);
  }

  return grouped;
}

function getTaskItemsByIds(taskIds: ScanoTaskId[], context: ActorContext) {
  if (!taskIds.length) return [];

  const rows = db.prepare(`
    SELECT
      id,
      chainId,
      chainName,
      branchId,
      branchGlobalId,
      branchName,
      globalEntityId,
      countryCode,
      additionalRemoteId,
      scheduledAt,
      status,
      startedAt,
      startedByUserId,
      startedByTeamMemberId
    FROM scano_tasks
    WHERE id IN (${buildPlaceholders(taskIds.length)})
    ORDER BY scheduledAt ASC, datetime(createdAt) DESC, id DESC
  `).all(...taskIds) as ScanoTaskRow[];

  const assigneesByTaskId = getAssigneesByTaskIds(rows.map((row) => row.id));
  const participantsByTaskId = getParticipantsByTaskIds(rows.map((row) => row.id));
  return rows.map((row) =>
    buildTaskItem(
      row,
      assigneesByTaskId.get(row.id) ?? [],
      participantsByTaskId.get(row.id) ?? [],
      context,
    ),
  );
}

function getTaskProgress(taskId: ScanoTaskId) {
  const row = db.prepare<[ScanoTaskId], TaskProgressRow>(`
    SELECT
      COUNT(*) AS totalCount,
      SUM(CASE WHEN p.startedAt IS NOT NULL THEN 1 ELSE 0 END) AS startedCount,
      SUM(CASE WHEN p.endedAt IS NOT NULL THEN 1 ELSE 0 END) AS endedCount
    FROM scano_task_assignees a
    LEFT JOIN scano_task_participants p
      ON p.taskId = a.taskId AND p.teamMemberId = a.teamMemberId
    WHERE a.taskId = ?
  `).get(taskId);

  return {
    totalCount: row?.totalCount ?? 0,
    startedCount: row?.startedCount ?? 0,
    endedCount: row?.endedCount ?? 0,
  };
}

function getTaskScans(taskId: ScanoTaskId) {
  const rows = db.prepare<[ScanoTaskId], ScanoTaskScanRow>(`
    SELECT
      s.id,
      s.taskId,
      s.teamMemberId,
      s.barcode,
      s.source,
      s.lookupStatus,
      s.outcome,
      s.taskProductId,
      s.resolvedProductJson,
      s.scannedAt,
      m.name,
      m.linkedUserId
    FROM scano_task_scans s
    INNER JOIN scano_team_members m ON m.id = s.teamMemberId
    WHERE s.taskId = ?
    ORDER BY datetime(s.scannedAt) DESC, s.id DESC
  `).all(taskId);

  return mapScanRows(rows);
}

function ensureAssignableMembersExist(memberIds: number[]) {
  const deduped = dedupeIds(memberIds);
  if (!deduped.length) {
    throw new ScanoTaskStoreError("At least one assignee is required.", 400, "SCANO_TASK_ASSIGNEES_REQUIRED");
  }

  const rows = db.prepare(`
    SELECT id, active, role
    FROM scano_team_members
    WHERE id IN (${buildPlaceholders(deduped.length)})
  `).all(...deduped) as Array<{ id: number; active: number; role: string }>;

  if (rows.length !== deduped.length) {
    throw new ScanoTaskStoreError("One or more assignees were not found.", 404, "SCANO_TASK_ASSIGNEE_NOT_FOUND");
  }

  if (rows.some((row) => row.active !== 1)) {
    throw new ScanoTaskStoreError("All assignees must be active Scano team members.", 409, "SCANO_TASK_ASSIGNEE_INACTIVE");
  }
  if (rows.some((row) => row.role !== "scanner")) {
    throw new ScanoTaskStoreError("Only Scano scanners can be assigned to tasks.", 409, "SCANO_TASK_ASSIGNEE_ROLE_INVALID");
  }

  return deduped;
}

function replaceTaskAssignees(taskId: ScanoTaskId, assigneeIds: number[]) {
  db.prepare<[ScanoTaskId]>("DELETE FROM scano_task_assignees WHERE taskId = ?").run(taskId);
  const assignedAt = nowIso();
  const insert = db.prepare(`
    INSERT INTO scano_task_assignees (
      taskId,
      teamMemberId,
      assignedAt
    ) VALUES (?, ?, ?)
  `);

  for (const assigneeId of assigneeIds) {
    insert.run(taskId, assigneeId, assignedAt);
  }
}

function ensurePendingTaskContext(id: ScanoTaskId) {
  const task = getTaskByIdRow(id);
  if (task.status !== "pending") {
    throw new ScanoTaskStoreError("Only pending tasks can be modified.", 409, "SCANO_TASK_NOT_PENDING");
  }
  return task;
}

function ensureManagerEditableTask(id: ScanoTaskId) {
  const task = getTaskByIdRow(id);
  if (task.status !== "pending" && task.status !== "in_progress") {
    throw new ScanoTaskStoreError("This task can no longer be updated.", 409, "SCANO_TASK_LOCKED");
  }
  return task;
}

function findAssignedScanner(taskId: ScanoTaskId, actorUserId: number) {
  return db.prepare<[ScanoTaskId, number], { teamMemberId: number }>(`
    SELECT a.teamMemberId
    FROM scano_task_assignees a
    INNER JOIN scano_team_members m ON m.id = a.teamMemberId
    WHERE a.taskId = ? AND m.linkedUserId = ? AND m.active = 1 AND m.role = 'scanner'
    LIMIT 1
  `).get(taskId, actorUserId);
}

function ensureAssignedScannerAccess(taskId: ScanoTaskId, actorUserId: number) {
  const task = getTaskByIdRow(taskId);
  const assignee = findAssignedScanner(taskId, actorUserId);

  if (!assignee) {
    throw new ScanoTaskStoreError("Only assigned Scano scanners can access this task.", 403, "SCANO_TASK_ACCESS_FORBIDDEN");
  }

  return {
    task,
    teamMemberId: assignee.teamMemberId,
  };
}

function ensureTaskReadable(id: ScanoTaskId, context: ActorContext) {
  const task = getTaskByIdRow(id);
  if (!context.canViewAllTasks) {
    const assignee = findAssignedScanner(id, context.actorUserId);
    if (!assignee) {
      throw new ScanoTaskStoreError("You cannot access this Scano task.", 403, "SCANO_TASK_ACCESS_FORBIDDEN");
    }
  }
  return task;
}

function getParticipantState(taskId: ScanoTaskId, teamMemberId: number) {
  return db.prepare<[ScanoTaskId, number], { startedAt: string | null; endedAt: string | null }>(`
    SELECT startedAt, endedAt
    FROM scano_task_participants
    WHERE taskId = ? AND teamMemberId = ?
    LIMIT 1
  `).get(taskId, teamMemberId) ?? null;
}

function touchParticipantStart(taskId: ScanoTaskId, teamMemberId: number) {
  const timestamp = nowIso();
  const existing = getParticipantState(taskId, teamMemberId);

  if (existing) {
    db.prepare(`
      UPDATE scano_task_participants
      SET
        startedAt = COALESCE(startedAt, ?),
        lastEnteredAt = ?,
        endedAt = NULL,
        updatedAt = ?
      WHERE taskId = ? AND teamMemberId = ?
    `).run(timestamp, timestamp, timestamp, taskId, teamMemberId);
    return;
  }

  db.prepare(`
    INSERT INTO scano_task_participants (
      taskId,
      teamMemberId,
      startedAt,
      lastEnteredAt,
      endedAt,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, NULL, ?, ?)
  `).run(taskId, teamMemberId, timestamp, timestamp, timestamp, timestamp);
}

function ensureStartedParticipant(taskId: ScanoTaskId, teamMemberId: number) {
  const participant = getParticipantState(taskId, teamMemberId);
  if (!participant?.startedAt) {
    throw new ScanoTaskStoreError("Start the task first.", 409, "SCANO_TASK_NOT_STARTED_BY_SCANNER");
  }
  return participant;
}

function refreshTaskStatusAfterProgress(taskId: ScanoTaskId, nextStatusWhenComplete: "awaiting_review" | "in_progress" = "awaiting_review") {
  const progress = getTaskProgress(taskId);
  const timestamp = nowIso();
  const nextStatus = progress.totalCount > 0 && progress.endedCount === progress.totalCount ? nextStatusWhenComplete : "in_progress";
  db.prepare(`
    UPDATE scano_tasks
    SET
      status = ?,
      updatedAt = ?
    WHERE id = ?
  `).run(nextStatus, timestamp, taskId);
}

function ensureRemovableAssignees(taskId: ScanoTaskId, removedAssigneeIds: number[]) {
  if (!removedAssigneeIds.length) return;

  const startedRows = db.prepare(`
    SELECT teamMemberId
    FROM scano_task_participants
    WHERE taskId = ?
      AND teamMemberId IN (${buildPlaceholders(removedAssigneeIds.length)})
      AND startedAt IS NOT NULL
    LIMIT 1
  `).all(taskId, ...removedAssigneeIds) as Array<{ teamMemberId: number }>;

  if (startedRows.length) {
    throw new ScanoTaskStoreError(
      "You cannot remove scanners who already started this task.",
      409,
      "SCANO_TASK_ASSIGNEE_ALREADY_STARTED",
    );
  }
}

function getActiveAssigneeIds(taskId: ScanoTaskId) {
  return db.prepare<[ScanoTaskId], { teamMemberId: number }>(`
    SELECT teamMemberId
    FROM scano_task_assignees
    WHERE taskId = ?
  `).all(taskId).map((row) => row.teamMemberId);
}

function updateTaskStartedMetadata(id: ScanoTaskId, actorUserId: number, teamMemberId: number) {
  const timestamp = nowIso();
  db.prepare(`
    UPDATE scano_tasks
    SET
      status = 'in_progress',
      startedAt = COALESCE(startedAt, ?),
      startedByUserId = COALESCE(startedByUserId, ?),
      startedByTeamMemberId = COALESCE(startedByTeamMemberId, ?),
      updatedAt = ?
    WHERE id = ?
  `).run(timestamp, actorUserId, teamMemberId, timestamp, id);
}

function insertScanRecord(taskId: ScanoTaskId, teamMemberId: number, input: ResolveScanoTaskScanInput, outcome: ScanoTaskScanOutcome = "manual_only", taskProductId: string | null = null, resolvedProductJson: string | null = null) {
  const normalized = ensureResolveInput(input);
  const timestamp = nowIso();

  const result = db.prepare(`
    INSERT INTO scano_task_scans (
      taskId,
      teamMemberId,
      barcode,
      source,
      lookupStatus,
      outcome,
      taskProductId,
      resolvedProductJson,
      scannedAt,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, 'pending_integration', ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    teamMemberId,
    normalized.barcode,
    normalized.source,
    outcome,
    taskProductId,
    resolvedProductJson,
    timestamp,
    timestamp,
    timestamp,
  );

  const insertedId = Number(result.lastInsertRowid);
  const row = db.prepare<[number], ScanoTaskScanRow>(`
    SELECT
      s.id,
      s.taskId,
      s.teamMemberId,
      s.barcode,
      s.source,
      s.lookupStatus,
      s.outcome,
      s.taskProductId,
      s.resolvedProductJson,
      s.scannedAt,
      m.name,
      m.linkedUserId
    FROM scano_task_scans s
    INNER JOIN scano_team_members m ON m.id = s.teamMemberId
    WHERE s.id = ?
    LIMIT 1
  `).get(insertedId);

  if (!row) {
    throw new ScanoTaskStoreError("Failed to save barcode scan.", 500, "SCANO_TASK_SCAN_INSERT_FAILED");
  }

  return mapScanRows([row])[0]!;
}

function getProductEditLogs(productId: string): ScanoTaskProductEditLog[] {
  const rows = db.prepare<[string], { id: number; editedAt: string; editedByTeamMemberId: number; editedByName: string; editedByLinkedUserId: number; beforeJson: string; afterJson: string }>(`
    SELECT
      e.id,
      e.editedAt,
      e.editedByTeamMemberId,
      editor.name AS editedByName,
      editor.linkedUserId AS editedByLinkedUserId,
      e.beforeJson,
      e.afterJson
    FROM scano_task_product_edits e
    INNER JOIN scano_team_members editor ON editor.id = e.editedByTeamMemberId
    WHERE e.productId = ?
    ORDER BY datetime(e.editedAt) DESC, e.id DESC
  `).all(productId);

  return rows.map((row) => ({
    id: row.id,
    editedAt: row.editedAt,
    editedBy: {
      id: row.editedByTeamMemberId,
      name: row.editedByName,
      linkedUserId: row.editedByLinkedUserId,
    },
    before: JSON.parse(row.beforeJson) as ScanoTaskProductSnapshot,
    after: JSON.parse(row.afterJson) as ScanoTaskProductSnapshot,
  }));
}

function removeStoredLocalImages(images: StoredTaskProductImage[]) {
  for (const image of images) {
    if (!image.filePath) continue;
    if (!fs.existsSync(image.filePath)) continue;
    fs.rmSync(image.filePath, { force: true });
  }
}

function isScanoStoragePath(targetPath: string) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedStorage = path.resolve(SCANO_STORAGE_DIR);
  return resolvedTarget === resolvedStorage || resolvedTarget.startsWith(`${resolvedStorage}${path.sep}`);
}

function removeScanoFileIfExists(filePath: string | null | undefined) {
  if (!filePath) return;
  if (!isScanoStoragePath(filePath)) return;
  if (!fs.existsSync(filePath)) return;
  fs.rmSync(filePath, { force: true });
}

function removeScanoDirIfExists(dirPath: string | null | undefined) {
  if (!dirPath) return;
  if (!isScanoStoragePath(dirPath)) return;
  if (!fs.existsSync(dirPath)) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function getTaskLocalProductImagePaths(taskId: ScanoTaskId) {
  const rows = db.prepare<[ScanoTaskId], { filePath: string | null }>(`
    SELECT i.filePath
    FROM scano_task_product_images i
    INNER JOIN scano_task_products p ON p.id = i.productId
    WHERE p.taskId = ?
      AND i.storageKind = 'local'
      AND i.filePath IS NOT NULL
  `).all(taskId);
  return rows.map((row) => row.filePath).filter((filePath): filePath is string => !!filePath);
}

function getTaskExportFilePaths(taskId: ScanoTaskId) {
  const rows = db.prepare<[ScanoTaskId], { filePath: string }>(`
    SELECT filePath
    FROM scano_task_exports
    WHERE taskId = ?
  `).all(taskId);
  return rows.map((row) => row.filePath);
}

function renameStoredLocalImages(taskId: ScanoTaskId, productId: string, sku: string, images: StoredTaskProductImage[]) {
  if (!images.length) {
    return images;
  }

  ensureScanoStorageDir();
  const taskDir = path.join(SCANO_PRODUCT_IMAGES_DIR, taskId, productId);
  fs.mkdirSync(taskDir, { recursive: true });

  const staged = images.map((image, index) => {
    if (!image.filePath) {
      return {
        ...image,
        index,
        stagedPath: null,
        finalPath: null,
        finalFileName: image.fileName,
      };
    }

    const extension = getFileExtension(image.fileName, null);
    const stagedPath = path.join(taskDir, `.rename-${image.id}.${extension}`);
    const finalFileName = buildSkuImageFileName(sku, index, extension);
    const finalPath = path.join(taskDir, finalFileName);
    if (fs.existsSync(image.filePath) && image.filePath !== stagedPath) {
      fs.renameSync(image.filePath, stagedPath);
    }

    return {
      ...image,
      index,
      stagedPath,
      finalPath,
      finalFileName,
    };
  });

  for (const image of staged) {
    if (!image.stagedPath || !image.finalPath) {
      continue;
    }
    if (fs.existsSync(image.finalPath)) {
      fs.rmSync(image.finalPath, { force: true });
    }
    if (fs.existsSync(image.stagedPath)) {
      fs.renameSync(image.stagedPath, image.finalPath);
    }
  }

  return staged.map((image) => ({
    id: image.id,
    fileName: image.finalFileName,
    url: image.url,
    filePath: image.finalPath,
    mimeType: guessMimeTypeFromFileName(image.finalFileName),
  } satisfies StoredTaskProductImage));
}

function createStoredImageFromUpload(
  taskId: ScanoTaskId,
  productId: string,
  sku: string,
  index: number,
  file: { buffer: Buffer; originalname?: string; mimetype?: string },
) {
  ensureScanoStorageDir();
  const imageId = randomUUID();
  const extension = getFileExtension(file.originalname, file.mimetype);
  const fileName = buildSkuImageFileName(sku, index, extension);
  const taskDir = path.join(SCANO_PRODUCT_IMAGES_DIR, taskId, productId);
  fs.mkdirSync(taskDir, { recursive: true });
  const filePath = path.join(taskDir, fileName);
  fs.writeFileSync(filePath, file.buffer);
  return {
    id: imageId,
    fileName,
    url: `/api/scano/tasks/${taskId}/products/${productId}/images/${imageId}`,
    filePath,
    mimeType: guessMimeTypeFromFileName(fileName),
  } satisfies StoredTaskProductImage;
}

function toStoredImages(
  taskId: ScanoTaskId,
  productId: string,
  sku: string,
  uploadedFiles: Array<{ buffer: Buffer; originalname?: string; mimetype?: string }>,
  startIndex = 0,
) {
  return uploadedFiles.map((file, index) => createStoredImageFromUpload(taskId, productId, sku, startIndex + index, file));
}

function buildStoredTaskProduct(params: {
  taskId: ScanoTaskId;
  productId: string;
  input: ReturnType<typeof normalizeProductInput>;
  sourceMeta: ReturnType<typeof normalizeSourceMeta>;
  actor: { id: number; name: string; linkedUserId: number };
  confirmedAt: string;
  updatedAt: string;
  images: StoredTaskProductImage[];
}): StoredTaskProduct {
  return {
    id: params.productId,
    externalProductId: params.input.externalProductId,
    previewImageUrl: params.input.imageUrls[0] ?? null,
    barcode: params.input.barcode,
    barcodes: params.input.barcodes,
    sku: params.input.sku,
    price: params.input.price,
    itemNameEn: params.input.itemNameEn,
    itemNameAr: params.input.itemNameAr,
    chain: params.sourceMeta.chain,
    vendor: params.sourceMeta.vendor,
    masterfile: params.sourceMeta.masterfile,
    new: params.sourceMeta.new,
    sourceType: params.sourceMeta.sourceType,
    edited: false,
    images: params.images,
    createdBy: params.actor,
    confirmedAt: params.confirmedAt,
    updatedAt: params.updatedAt,
  };
}

function saveStoredTaskProductScan(params: {
  taskId: ScanoTaskId;
  teamMemberId: number;
  input: ResolveScanoTaskScanInput;
  product: StoredTaskProduct;
  outcome: ScanoTaskScanOutcome;
}) {
  return insertScanRecord(
    params.taskId,
    params.teamMemberId,
    params.input,
    params.outcome,
    params.product.id,
    JSON.stringify(params.product),
  );
}

async function buildResolveDraft(task: ScanoTaskRow, barcode: string, selectedExternalProductId: string | null) {
  const externalMatches = await searchScanoProductsByBarcode({
    barcode,
    globalEntityId: task.globalEntityId,
  });

  if (externalMatches.length > 1 && !selectedExternalProductId) {
    return {
      kind: "selection" as const,
      items: externalMatches,
    };
  }

  if (externalMatches.length) {
    const selected = selectedExternalProductId
      ? externalMatches.find((item) => item.id === selectedExternalProductId) ?? null
      : externalMatches[0] ?? null;
    if (!selected) {
      throw new ScanoTaskStoreError("Selected Scano product was not found.", 400, "SCANO_TASK_PRODUCT_SELECTION_INVALID");
    }
    const externalBarcodes = dedupeStrings([selected.barcode, ...(selected.barcodes ?? [])]);
    const primaryExternalBarcode = externalBarcodes[0] ?? barcode;

    const [{ images, previewImageUrl }, assignment] = await Promise.all([
      getExternalDraftImages(task, selected),
      getScanoProductAssignmentCheck({
        productId: selected.id,
        chainId: task.chainId,
        vendorId: task.branchId,
      }),
    ]);

    return {
      kind: "draft" as const,
      outcome: "matched_external" as const,
      draft: {
        externalProductId: selected.id,
        previewImageUrl,
        barcode: primaryExternalBarcode,
        barcodes: externalBarcodes.length ? externalBarcodes : [barcode],
        sku: assignment.sku,
        price: assignment.price,
        itemNameEn: selected.itemNameEn,
        itemNameAr: selected.itemNameAr,
        chain: assignment.chain,
        vendor: assignment.vendor,
        masterfile: "no" as const,
        new: assignment.vendor === "yes" || assignment.chain === "yes" ? "no" as const : "yes" as const,
        sourceType: determineSourceType({
          vendor: assignment.vendor,
          chain: assignment.chain,
          masterfile: "no",
        }),
        images,
        warning: null,
      } satisfies ScanoTaskProductDraft,
    };
  }

  const masterMatch = findScanoMasterProductMatch(task.chainId, barcode);
  if (masterMatch) {
    return {
      kind: "draft" as const,
      outcome: "matched_master" as const,
      draft: {
        externalProductId: null,
        previewImageUrl: masterMatch.image ?? null,
        barcode,
        barcodes: [barcode],
        sku: masterMatch.sku,
        price: masterMatch.price,
        itemNameEn: masterMatch.itemNameEn,
        itemNameAr: masterMatch.itemNameAr,
        chain: "no" as const,
        vendor: "no" as const,
        masterfile: "yes" as const,
        new: "yes" as const,
        sourceType: "master" as const,
        images: masterMatch.image ? [masterMatch.image] : [],
        warning: null,
      } satisfies ScanoTaskProductDraft,
    };
  }

  return {
    kind: "draft" as const,
    outcome: "manual_only" as const,
    draft: {
      externalProductId: null,
      previewImageUrl: null,
      barcode,
      barcodes: [barcode],
      sku: null,
      price: null,
      itemNameEn: null,
      itemNameAr: null,
      chain: "no" as const,
      vendor: "no" as const,
      masterfile: "no" as const,
      new: "yes" as const,
      sourceType: "manual" as const,
      images: [],
      warning: "Not found in chain master file. Continue manually.",
    } satisfies ScanoTaskProductDraft,
  };
}

async function getExternalDraftImages(task: ScanoTaskRow, selected: ScanoExternalProductSearchResult) {
  const fallbackPreviewImageUrl = selected.image ?? null;
  try {
    const detail = await getScanoProductDetail({
      productId: selected.id,
      globalEntityId: task.globalEntityId,
    });
    const images = dedupeStrings(detail.images);
    return {
      previewImageUrl: images[0] ?? fallbackPreviewImageUrl,
      images,
    };
  } catch {
    return {
      previewImageUrl: fallbackPreviewImageUrl,
      images: [],
    };
  }
}

async function readStoredImageAsset(image: StoredTaskProductImage): Promise<{ buffer: Buffer; extension: ExcelImageExtension }> {
  if (image.filePath && fs.existsSync(image.filePath)) {
    const fileMimeType = guessMimeTypeFromFileName(image.fileName);
    return {
      buffer: Buffer.from(fs.readFileSync(image.filePath)) as unknown as Buffer,
      extension: guessExtensionFromMimeType(fileMimeType),
    };
  }

  const response = await fetch(image.url);
  if (!response.ok) {
    throw new ScanoTaskStoreError("Failed to load a task product image.", 502, "SCANO_TASK_EXPORT_IMAGE_DOWNLOAD_FAILED");
  }
  const responseMimeType = response.headers.get("content-type");
  if ((responseMimeType ?? "").trim().toLowerCase() === "image/webp") {
    throw new ScanoTaskStoreError("WEBP images are not supported in review export embedding.", 415, "SCANO_TASK_EXPORT_IMAGE_UNSUPPORTED");
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()) as unknown as Buffer,
    extension: guessExtensionFromMimeType(responseMimeType),
  };
}

export function listScanoTasks(params: ListScanoTasksParams) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (params.from) {
    clauses.push("scheduledAt >= ?");
    values.push(parseIsoOrThrow(params.from, "from"));
  }
  if (params.to) {
    clauses.push("scheduledAt <= ?");
    values.push(parseIsoOrThrow(params.to, "to"));
  }
  if (!params.canViewAllTasks) {
    clauses.push(`
      id IN (
        SELECT a.taskId
        FROM scano_task_assignees a
        INNER JOIN scano_team_members m ON m.id = a.teamMemberId
        WHERE m.linkedUserId = ? AND m.active = 1 AND m.role = 'scanner'
      )
    `);
    values.push(params.actorUserId);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT
      id,
      chainId,
      chainName,
      branchId,
      branchGlobalId,
      branchName,
      globalEntityId,
      countryCode,
      additionalRemoteId,
      scheduledAt,
      status,
      startedAt,
      startedByUserId,
      startedByTeamMemberId
    FROM scano_tasks
    ${whereClause}
    ORDER BY scheduledAt ASC, datetime(createdAt) DESC, id DESC
  `).all(...values) as ScanoTaskRow[];

  const assigneesByTaskId = getAssigneesByTaskIds(rows.map((row) => row.id));
  const participantsByTaskId = getParticipantsByTaskIds(rows.map((row) => row.id));
  return rows.map((row) =>
    buildTaskItem(
      row,
      assigneesByTaskId.get(row.id) ?? [],
      participantsByTaskId.get(row.id) ?? [],
      {
        actorUserId: params.actorUserId,
        canViewAllTasks: params.canViewAllTasks,
        canManageTasks: params.canManageTasks,
        canReviewTasks: params.canReviewTasks,
      },
    ),
  );
}

export function getScanoTaskDetail(id: ScanoTaskId, actorUserId: number, canViewAllTasks: boolean, canManageTasks: boolean, canReviewTasks = canManageTasks): ScanoTaskDetail {
  ensureTaskReadable(id, { actorUserId, canViewAllTasks, canManageTasks, canReviewTasks });
  const item = getTaskItemsByIds([id], { actorUserId, canViewAllTasks, canManageTasks, canReviewTasks })[0];
  if (!item) {
    throw new ScanoTaskStoreError("Scano task not found.", 404, "SCANO_TASK_NOT_FOUND");
  }

  const participants = getParticipantsByTaskIds([id]).get(id) ?? [];
  return {
    ...item,
    participants,
  };
}

export function getScanoRunnerBootstrap(
  taskId: ScanoTaskId,
  actorUserId: number,
  canManageTasks: boolean,
  canReviewTasks = canManageTasks,
): ScanoRunnerBootstrapResponse {
  const { task, teamMemberId } = ensureAssignedScannerAccess(taskId, actorUserId);
  if (task.status !== "in_progress") {
    throw new ScanoTaskStoreError("Only in-progress tasks can load the scanner runner.", 409, "SCANO_TASK_RUNNER_FORBIDDEN");
  }

  const participant = ensureStartedParticipant(taskId, teamMemberId);
  if (participant.endedAt) {
    throw new ScanoTaskStoreError("Resume the task before scanning more products.", 409, "SCANO_TASK_RUNNER_RESUME_REQUIRED");
  }

  const runnerSession = scanoRunnerSessionStore.createRunnerSession({
    taskId: task.id,
    actorUserId,
    teamMemberId,
    chainId: task.chainId,
    vendorId: task.branchId,
    globalEntityId: task.globalEntityId,
  });
  const confirmedProducts = scanoTaskProductRepository.listTaskProducts(
    taskId,
    canActorEditTaskProducts(taskId, actorUserId, task.status),
  );

  return {
    runnerToken: runnerSession.token,
    confirmedBarcodes: dedupeStrings(confirmedProducts.flatMap((product) => product.barcodes)),
    confirmedProducts,
    masterIndex: listScanoMasterProductIndex(task.chainId),
  };
}

export async function searchScanoRunnerExternalProducts(
  taskId: ScanoTaskId,
  input: ScanoRunnerSearchInput,
  actorUserId: number,
): Promise<ScanoRunnerExternalSearchResponse> {
  const normalizedBarcode = ensureResolveInput({
    barcode: input.barcode,
    source: "manual",
  }).barcode;
  const runnerSession = scanoRunnerSessionStore.readRunnerSession(taskId, actorUserId, input.runnerToken);
  if (!runnerSession) {
    throw new ScanoTaskStoreError("Runner session is invalid. Reload the task runner.", 401, "SCANO_RUNNER_SESSION_INVALID");
  }
  const items = await searchScanoProductsByBarcode({
    barcode: normalizedBarcode,
    globalEntityId: runnerSession.globalEntityId,
  });
  const exactMatches = items.filter((item) => isExternalBarcodeExactMatch(item, normalizedBarcode));

  if (exactMatches.length === 1) {
    return {
      kind: "match",
      item: exactMatches[0],
    };
  }

  if (items.length > 0) {
    return {
      kind: "multiple",
      items: exactMatches.length > 1 ? exactMatches : items,
    };
  }

  return {
    kind: "miss",
  };
}

export async function hydrateScanoRunnerExternalProduct(
  taskId: ScanoTaskId,
  input: ScanoRunnerHydrateInput,
  actorUserId: number,
): Promise<ScanoRunnerAssignmentResponse> {
  const runnerSession = scanoRunnerSessionStore.readRunnerSession(taskId, actorUserId, input.runnerToken);
  if (!runnerSession) {
    throw new ScanoTaskStoreError("Runner session is invalid. Reload the task runner.", 401, "SCANO_RUNNER_SESSION_INVALID");
  }
  const productId = trimToNull(input.productId);
  if (!productId) {
    throw new ScanoTaskStoreError("Product id is required.", 400, "SCANO_RUNNER_PRODUCT_ID_REQUIRED");
  }

  return getScanoProductAssignmentCheck({
    productId,
    chainId: runnerSession.chainId,
    vendorId: runnerSession.vendorId,
  });
}

export function listScanoTaskProducts(
  taskId: ScanoTaskId,
  params: {
    actorUserId: number;
    canViewAllTasks: boolean;
    canManageTasks: boolean;
    canReviewTasks: boolean;
    page?: number;
    pageSize?: number;
    query?: string;
    source?: ScanoTaskProductListSourceFilter;
  },
): ScanoTaskProductsPageResponse {
  ensureTaskReadable(taskId, params);
  const taskStatus = getTaskByIdRow(taskId).status;
  return scanoTaskProductRepository.listTaskProductPage({
    taskId,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 10,
    query: params.query,
    source: params.source,
    canEdit: canActorEditTaskProducts(taskId, params.actorUserId, taskStatus),
  });
}

export function listScanoTaskScans(
  taskId: ScanoTaskId,
  params: {
    actorUserId: number;
    canViewAllTasks: boolean;
    canManageTasks: boolean;
    canReviewTasks: boolean;
    page?: number;
    pageSize?: number;
  },
): ScanoTaskScansPageResponse {
  ensureTaskReadable(taskId, params);
  const meta = normalizePagination(params.page ?? 1, params.pageSize ?? 10);
  const totalRow = db.prepare<[ScanoTaskId], { total: number }>(`
    SELECT COUNT(*) AS total
    FROM scano_task_scans
    WHERE taskId = ?
  `).get(taskId);

  const rows = db.prepare<[ScanoTaskId, number, number], ScanoTaskScanRow>(`
    SELECT
      s.id,
      s.taskId,
      s.teamMemberId,
      s.barcode,
      s.source,
      s.lookupStatus,
      s.outcome,
      s.taskProductId,
      s.resolvedProductJson,
      s.scannedAt,
      m.name,
      m.linkedUserId
    FROM scano_task_scans s
    INNER JOIN scano_team_members m ON m.id = s.teamMemberId
    WHERE s.taskId = ?
    ORDER BY datetime(s.scannedAt) DESC, s.id DESC
    LIMIT ? OFFSET ?
  `).all(taskId, meta.pageSize, meta.offset);

  return {
    ...buildPaginationMeta(meta.page, meta.pageSize, totalRow?.total ?? 0),
    items: mapScanRows(rows),
  };
}

export function createScanoTask(input: CreateScanoTaskInput, actorUserId: number, canManageTasks: boolean, canReviewTasks = canManageTasks) {
  if (!canManageTasks) {
    throw new ScanoTaskStoreError("Only Scano task managers can create tasks.", 403, "SCANO_TASK_CREATE_FORBIDDEN");
  }

  const normalized = ensureTaskInput(input);
  const assigneeIds = ensureAssignableMembersExist(normalized.assigneeIds);
  const timestamp = nowIso();

  const taskId = randomUUID();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO scano_tasks (
        id,
        chainId,
        chainName,
        branchId,
        branchGlobalId,
        branchName,
        globalEntityId,
        countryCode,
        additionalRemoteId,
        scheduledAt,
        status,
        createdByUserId,
        createdAt,
        updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      taskId,
      normalized.chainId,
      normalized.chainName,
      normalized.branch.id,
      normalized.branch.globalId,
      normalized.branch.name,
      normalized.branch.globalEntityId,
      normalized.branch.countryCode,
      normalized.branch.additionalRemoteId,
      normalized.scheduledAt,
      actorUserId,
      timestamp,
      timestamp,
    );

    replaceTaskAssignees(taskId, assigneeIds);
  })();

  return getTaskItemsByIds([taskId], { actorUserId, canViewAllTasks: true, canManageTasks, canReviewTasks })[0]!;
}

export function updateScanoTask(id: ScanoTaskId, input: UpdateScanoTaskInput, actorUserId: number, canManageTasks: boolean, canReviewTasks = canManageTasks) {
  if (!canManageTasks) {
    throw new ScanoTaskStoreError("Only Scano task managers can update tasks.", 403, "SCANO_TASK_UPDATE_FORBIDDEN");
  }

  ensurePendingTaskContext(id);
  const normalized = ensureTaskInput(input);
  const assigneeIds = ensureAssignableMembersExist(normalized.assigneeIds);

  db.transaction(() => {
    db.prepare(`
      UPDATE scano_tasks
      SET
        chainId = ?,
        chainName = ?,
        branchId = ?,
        branchGlobalId = ?,
        branchName = ?,
        globalEntityId = ?,
        countryCode = ?,
        additionalRemoteId = ?,
        scheduledAt = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      normalized.chainId,
      normalized.chainName,
      normalized.branch.id,
      normalized.branch.globalId,
      normalized.branch.name,
      normalized.branch.globalEntityId,
      normalized.branch.countryCode,
      normalized.branch.additionalRemoteId,
      normalized.scheduledAt,
      nowIso(),
      id,
    );

    replaceTaskAssignees(id, assigneeIds);
  })();

  return getTaskItemsByIds([id], { actorUserId, canViewAllTasks: true, canManageTasks, canReviewTasks })[0]!;
}

export function updateScanoTaskAssignees(
  id: ScanoTaskId,
  input: UpdateScanoTaskAssigneesInput,
  actorUserId: number,
  canManageTasks: boolean,
  canReviewTasks = canManageTasks,
) {
  if (!canManageTasks) {
    throw new ScanoTaskStoreError("Only Scano task managers can update assignees.", 403, "SCANO_TASK_UPDATE_FORBIDDEN");
  }

  const task = ensureManagerEditableTask(id);
  const normalized = ensureAssigneeUpdateInput(input);
  const assigneeIds = ensureAssignableMembersExist(normalized.assigneeIds);
  const currentAssigneeIds = getActiveAssigneeIds(id);
  const removedAssigneeIds = currentAssigneeIds.filter((memberId) => !assigneeIds.includes(memberId));
  ensureRemovableAssignees(id, removedAssigneeIds);

  db.transaction(() => {
    replaceTaskAssignees(id, assigneeIds);
    if (task.status === "in_progress") {
      refreshTaskStatusAfterProgress(id);
    }
  })();

  return getTaskItemsByIds([id], { actorUserId, canViewAllTasks: true, canManageTasks, canReviewTasks })[0]!;
}

export function startScanoTask(id: ScanoTaskId, actorUserId: number, canManageTasks: boolean, canReviewTasks = canManageTasks) {
  const { task, teamMemberId } = ensureAssignedScannerAccess(id, actorUserId);

  if (task.status === "awaiting_review" || task.status === "completed") {
    throw new ScanoTaskStoreError("This task can no longer be started.", 409, "SCANO_TASK_CLOSED");
  }

  db.transaction(() => {
    touchParticipantStart(id, teamMemberId);
    updateTaskStartedMetadata(id, actorUserId, teamMemberId);
  })();

  return getTaskItemsByIds([id], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!;
}

export function endScanoTask(id: ScanoTaskId, actorUserId: number, canManageTasks: boolean, canReviewTasks = canManageTasks) {
  const { task, teamMemberId } = ensureAssignedScannerAccess(id, actorUserId);
  if (task.status !== "in_progress") {
    throw new ScanoTaskStoreError("Only in-progress tasks can be ended.", 409, "SCANO_TASK_NOT_IN_PROGRESS");
  }

  const participant = ensureStartedParticipant(id, teamMemberId);
  if (participant.endedAt) {
    throw new ScanoTaskStoreError("This task is already ended for the current scanner.", 409, "SCANO_TASK_ALREADY_ENDED");
  }

  const timestamp = nowIso();
  db.transaction(() => {
    db.prepare(`
      UPDATE scano_task_participants
      SET
        endedAt = ?,
        updatedAt = ?
      WHERE taskId = ? AND teamMemberId = ?
    `).run(timestamp, timestamp, id, teamMemberId);
    refreshTaskStatusAfterProgress(id, "awaiting_review");
  })();

  return getTaskItemsByIds([id], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!;
}

export function resumeScanoTask(id: ScanoTaskId, actorUserId: number, canManageTasks: boolean, canReviewTasks = canManageTasks) {
  const { task, teamMemberId } = ensureAssignedScannerAccess(id, actorUserId);
  if (task.status !== "in_progress") {
    throw new ScanoTaskStoreError("Only active in-progress tasks can be resumed.", 409, "SCANO_TASK_NOT_RESUMABLE");
  }

  const participant = ensureStartedParticipant(id, teamMemberId);
  if (!participant.endedAt) {
    throw new ScanoTaskStoreError("This scanner is already active on the task.", 409, "SCANO_TASK_ALREADY_ACTIVE");
  }

  const timestamp = nowIso();
  db.prepare(`
    UPDATE scano_task_participants
    SET
      endedAt = NULL,
      lastEnteredAt = ?,
      updatedAt = ?
    WHERE taskId = ? AND teamMemberId = ?
  `).run(timestamp, timestamp, id, teamMemberId);

  return getTaskItemsByIds([id], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!;
}

export function completeScanoTask(id: ScanoTaskId, actorUserId: number, canManageTasks: boolean, canReviewTasks = canManageTasks) {
  if (!canReviewTasks) {
    throw new ScanoTaskStoreError("Only Scano reviewers can complete tasks.", 403, "SCANO_TASK_COMPLETE_FORBIDDEN");
  }

  const task = getTaskByIdRow(id);
  if (task.status !== "awaiting_review") {
    throw new ScanoTaskStoreError("Only tasks awaiting review can be completed.", 409, "SCANO_TASK_NOT_AWAITING_REVIEW");
  }

  const latestExport = getLatestExport(id, canReviewTasks);
  if (!latestExport?.confirmedDownloadAt) {
    throw new ScanoTaskStoreError("Download and confirm the review package before completing the task.", 409, "SCANO_TASK_EXPORT_REQUIRED");
  }

  db.prepare(`
    UPDATE scano_tasks
    SET
      status = 'completed',
      updatedAt = ?
    WHERE id = ?
  `).run(nowIso(), id);

  return getTaskItemsByIds([id], { actorUserId, canViewAllTasks: true, canManageTasks, canReviewTasks })[0]!;
}

export function createScanoTaskScan(id: ScanoTaskId, input: ResolveScanoTaskScanInput, actorUserId: number, canManageTasks: boolean, canReviewTasks = canManageTasks) {
  const { task, teamMemberId } = ensureAssignedScannerAccess(id, actorUserId);
  if (task.status !== "in_progress") {
    throw new ScanoTaskStoreError("Only in-progress tasks accept barcode scans.", 409, "SCANO_TASK_SCAN_FORBIDDEN");
  }

  const participant = ensureStartedParticipant(id, teamMemberId);
  if (participant.endedAt) {
    throw new ScanoTaskStoreError("Resume the task before adding more scans.", 409, "SCANO_TASK_SCAN_AFTER_END");
  }

  const item = insertScanRecord(id, teamMemberId, input);
  return {
    item,
    counters: getTaskItemsByIds([id], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!.counters,
    task: getTaskItemsByIds([id], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!,
  };
}

export async function resolveScanoTaskScan(id: ScanoTaskId, input: ResolveScanoTaskScanInput, actorUserId: number, canManageTasks: boolean, canReviewTasks = canManageTasks): Promise<ScanoTaskScanResolveResponse> {
  const { task, teamMemberId } = ensureAssignedScannerAccess(id, actorUserId);
  if (task.status !== "in_progress") {
    throw new ScanoTaskStoreError("Only in-progress tasks accept barcode scans.", 409, "SCANO_TASK_SCAN_FORBIDDEN");
  }

  const participant = ensureStartedParticipant(id, teamMemberId);
  if (participant.endedAt) {
    throw new ScanoTaskStoreError("Resume the task before adding more scans.", 409, "SCANO_TASK_SCAN_AFTER_END");
  }

  const normalized = ensureResolveInput(input);
  const existingProduct = scanoTaskProductRepository.findDuplicateTaskProduct(id, normalized.barcode, {
    canEdit: canActorEditTaskProducts(id, actorUserId, task.status),
  });
  if (existingProduct) {
    const rawScan = insertScanRecord(id, teamMemberId, normalized, "duplicate_blocked", existingProduct.id, null);
    return {
      kind: "duplicate",
      message: "This barcode was already scanned before.",
      existingProduct: {
        ...existingProduct,
        edits: getProductEditLogs(existingProduct.id),
        edited: getProductEditLogs(existingProduct.id).length > 0,
      },
      existingScannerName: existingProduct.createdBy.name,
      existingScannedAt: existingProduct.confirmedAt,
      rawScan,
      task: getTaskItemsByIds([id], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!,
      counters: getTaskItemsByIds([id], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!.counters,
    };
  }

  const resolution = await buildResolveDraft(task, normalized.barcode, normalized.selectedExternalProductId);
  if (resolution.kind === "selection") {
    return resolution;
  }

  const rawScan = insertScanRecord(id, teamMemberId, normalized, resolution.outcome, null, null);
  return {
    kind: "draft",
    draft: resolution.draft,
    rawScan,
    task: getTaskItemsByIds([id], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!,
    counters: getTaskItemsByIds([id], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!.counters,
  };
}

export function createScanoTaskProduct(
  taskId: ScanoTaskId,
  input: SaveScanoTaskProductInput,
  uploadedFiles: Array<{ buffer: Buffer; originalname?: string; mimetype?: string }>,
  actorUserId: number,
  canManageTasks: boolean,
  canReviewTasks = canManageTasks,
) {
  const { task, teamMemberId } = ensureAssignedScannerAccess(taskId, actorUserId);
  if (task.status !== "in_progress") {
    throw new ScanoTaskStoreError("Only in-progress tasks accept product confirmations.", 409, "SCANO_TASK_PRODUCT_FORBIDDEN");
  }

  const participant = ensureStartedParticipant(taskId, teamMemberId);
  if (participant.endedAt) {
    throw new ScanoTaskStoreError("Resume the task before confirming products.", 409, "SCANO_TASK_PRODUCT_AFTER_END");
  }

  const normalized = normalizeProductInput(input);
  const sourceMeta = normalizeSourceMeta(input.sourceMeta);
  ensureProductSourceRequirements({
    sourceType: sourceMeta.sourceType,
    price: normalized.price,
    hasImage: uploadedFiles.length > 0 || normalized.imageUrls.length > 0,
  });
  for (const barcode of normalized.barcodes) {
    if (scanoTaskProductRepository.findDuplicateTaskProduct(taskId, barcode, { canEdit: false })) {
      throw new ScanoTaskStoreError("This barcode already exists on another product in the task.", 409, "SCANO_TASK_PRODUCT_DUPLICATE_BARCODE");
    }
  }

  const actor = db.prepare<[number], { id: number; name: string; linkedUserId: number }>(`
    SELECT id, name, linkedUserId
    FROM scano_team_members
    WHERE id = ?
    LIMIT 1
  `).get(teamMemberId);
  if (!actor) {
    throw new ScanoTaskStoreError("Assigned scanner was not found.", 404, "SCANO_TASK_ASSIGNEE_NOT_FOUND");
  }

  const productId = randomUUID();
  const timestamp = nowIso();
  const product = buildStoredTaskProduct({
    taskId,
    productId,
    input: normalized,
    sourceMeta,
    actor,
    confirmedAt: timestamp,
    updatedAt: timestamp,
    images: toStoredImages(taskId, productId, normalized.sku, uploadedFiles),
  });
  scanoTaskProductRepository.syncTaskProductProjection(taskId, product, false);

  const rawScan = saveStoredTaskProductScan({
    taskId,
    teamMemberId,
    input: {
      barcode: normalized.barcode,
      source: "manual",
    },
    product,
    outcome: sourceMeta.sourceType === "master" ? "matched_master" : sourceMeta.sourceType === "manual" ? "manual_only" : "matched_external",
  });

  const item = scanoTaskProductRepository.getTaskProductById(
    taskId,
    productId,
    canActorEditTaskProducts(taskId, actorUserId, task.status),
  );
  if (!item) {
    throw new ScanoTaskStoreError("Scano task product was not found.", 404, "SCANO_TASK_PRODUCT_NOT_FOUND");
  }

  return {
    rawScan,
    item: { ...item, edits: [], edited: false },
    taskSummary: buildTaskSummaryPatch(
      getTaskItemsByIds([taskId], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!,
    ),
  };
}

export function updateScanoTaskProduct(
  taskId: ScanoTaskId,
  productId: string,
  input: SaveScanoTaskProductInput,
  uploadedFiles: Array<{ buffer: Buffer; originalname?: string; mimetype?: string }>,
  actorUserId: number,
  canManageTasks: boolean,
  canReviewTasks = canManageTasks,
) {
  const { task, teamMemberId } = ensureAssignedScannerAccess(taskId, actorUserId);
  if (task.status !== "in_progress") {
    throw new ScanoTaskStoreError("Only in-progress tasks allow product edits.", 409, "SCANO_TASK_PRODUCT_FORBIDDEN");
  }

  const participant = ensureStartedParticipant(taskId, teamMemberId);
  if (participant.endedAt) {
    throw new ScanoTaskStoreError("Resume the task before editing products.", 409, "SCANO_TASK_PRODUCT_AFTER_END");
  }

  const current = scanoTaskProductRepository.getTaskProductById(
    taskId,
    productId,
    canActorEditTaskProducts(taskId, actorUserId, task.status),
  );
  const storedCurrent = scanoTaskProductRepository.getStoredTaskProductById(taskId, productId);
  if (!current || !storedCurrent) {
    throw new ScanoTaskStoreError("Scano task product was not found.", 404, "SCANO_TASK_PRODUCT_NOT_FOUND");
  }

  const normalized = normalizeProductInput(input);
  const sourceMeta = {
    sourceType: current.sourceType,
    chain: current.chain,
    vendor: current.vendor,
    masterfile: current.masterfile,
    new: current.new,
  } satisfies ReturnType<typeof normalizeSourceMeta>;
  const keptImages = storedCurrent.images.filter((image) => normalized.existingImageIds.includes(image.id) && !!image.filePath);
  const removedImages = storedCurrent.images.filter((image) => !normalized.existingImageIds.includes(image.id) && !!image.filePath);
  const renamedKeptImages = renameStoredLocalImages(taskId, productId, normalized.sku, keptImages);
  const images = [
    ...renamedKeptImages,
    ...toStoredImages(taskId, productId, normalized.sku, uploadedFiles, renamedKeptImages.length),
  ];
  removeStoredLocalImages(removedImages);
  const nextPreviewImageUrl = normalized.imageUrls[0] ?? storedCurrent.previewImageUrl ?? null;
  ensureProductSourceRequirements({
    sourceType: sourceMeta.sourceType,
    price: normalized.price,
    hasImage: images.length > 0 || !!nextPreviewImageUrl,
  });
  for (const barcode of normalized.barcodes) {
    if (scanoTaskProductRepository.findDuplicateTaskProduct(taskId, barcode, {
      excludeProductId: productId,
      canEdit: false,
    })) {
      throw new ScanoTaskStoreError("This barcode already exists on another product in the task.", 409, "SCANO_TASK_PRODUCT_DUPLICATE_BARCODE");
    }
  }

  const updatedAt = nowIso();
  const updatedProduct: StoredTaskProduct = {
    ...storedCurrent,
    externalProductId: normalized.externalProductId,
    previewImageUrl: nextPreviewImageUrl,
    barcode: normalized.barcode,
    barcodes: normalized.barcodes,
    sku: normalized.sku,
    price: normalized.price,
    itemNameEn: normalized.itemNameEn,
    itemNameAr: normalized.itemNameAr,
    chain: sourceMeta.chain,
    vendor: sourceMeta.vendor,
    masterfile: sourceMeta.masterfile,
    new: sourceMeta.new,
    sourceType: sourceMeta.sourceType,
    images,
    updatedAt,
  };
  scanoTaskProductRepository.syncTaskProductProjection(taskId, updatedProduct, true);

  db.prepare(`
    INSERT INTO scano_task_product_edits (
      productId,
      editedByTeamMemberId,
      beforeJson,
      afterJson,
      editedAt
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    productId,
    teamMemberId,
    JSON.stringify(buildProductSnapshot(current)),
    JSON.stringify(buildProductSnapshot(updatedProduct)),
    updatedProduct.updatedAt,
  );

  const item = scanoTaskProductRepository.getTaskProductById(
    taskId,
    productId,
    canActorEditTaskProducts(taskId, actorUserId, task.status),
  );
  if (!item) {
    throw new ScanoTaskStoreError("Scano task product was not found.", 404, "SCANO_TASK_PRODUCT_NOT_FOUND");
  }

  return {
    item: { ...item, edits: getProductEditLogs(productId), edited: true },
    taskSummary: buildTaskSummaryPatch(
      getTaskItemsByIds([taskId], { actorUserId, canViewAllTasks: canReviewTasks, canManageTasks, canReviewTasks })[0]!,
    ),
  };
}

export function getScanoTaskProductDetail(
  taskId: ScanoTaskId,
  productId: string,
  actorUserId: number,
  canViewAllTasks: boolean,
  canManageTasks: boolean,
  canReviewTasks: boolean,
) {
  ensureTaskReadable(taskId, { actorUserId, canViewAllTasks, canManageTasks, canReviewTasks });
  const product = scanoTaskProductRepository.getTaskProductById(
    taskId,
    productId,
    canActorEditTaskProducts(taskId, actorUserId, getTaskByIdRow(taskId).status),
  );
  if (!product) {
    throw new ScanoTaskStoreError("Scano task product was not found.", 404, "SCANO_TASK_PRODUCT_NOT_FOUND");
  }
  return {
    ...product,
    edits: getProductEditLogs(productId),
    edited: getProductEditLogs(productId).length > 0,
  };
}

export function getScanoTaskProductImageDownload(
  taskId: ScanoTaskId,
  productId: string,
  imageId: string,
  actorUserId: number,
  canViewAllTasks: boolean,
  canManageTasks: boolean,
  canReviewTasks: boolean,
) {
  ensureTaskReadable(taskId, { actorUserId, canViewAllTasks, canManageTasks, canReviewTasks });
  const product = scanoTaskProductRepository.getStoredTaskProductById(taskId, productId);
  if (!product) {
    throw new ScanoTaskStoreError("Scano task product was not found.", 404, "SCANO_TASK_PRODUCT_NOT_FOUND");
  }
  const image = product.images.find((item) => item.id === imageId) ?? null;
  if (!image) {
    throw new ScanoTaskStoreError("Scano task product image was not found.", 404, "SCANO_TASK_PRODUCT_IMAGE_NOT_FOUND");
  }
  if (image.filePath && fs.existsSync(image.filePath)) {
    return {
      kind: "file" as const,
      filePath: image.filePath,
      fileName: image.fileName,
      mimeType: guessMimeTypeFromFileName(image.fileName),
    };
  }
  return {
    kind: "redirect" as const,
    url: image.url,
    fileName: image.fileName,
    mimeType: guessMimeTypeFromFileName(image.fileName),
  };
}

export async function createScanoTaskExport(taskId: ScanoTaskId, actorUserId: number, canReviewTasks: boolean, canManageTasks: boolean) {
  if (!canReviewTasks) {
    throw new ScanoTaskStoreError("Only Scano reviewers can export review packages.", 403, "SCANO_TASK_EXPORT_FORBIDDEN");
  }

  const task = getTaskByIdRow(taskId);
  if (task.status !== "awaiting_review" && task.status !== "completed") {
    throw new ScanoTaskStoreError("Review packages are available only during review or after completion.", 409, "SCANO_TASK_EXPORT_STATUS_INVALID");
  }

  ensureScanoStorageDir();
  const exportId = randomUUID();
  const exportDir = path.join(SCANO_STORAGE_DIR, "exports", taskId);
  fs.mkdirSync(exportDir, { recursive: true });
  const zipPath = path.join(exportDir, `${exportId}.zip`);
  const fileName = `scano-task-${taskId}.zip`;
  const products = scanoTaskProductRepository.getStoredTaskProductsForExport(taskId);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Scano Review");
  worksheet.columns = [
    { header: "ID", key: "id", width: 18 },
    { header: "SKU", key: "sku", width: 18 },
    { header: "Price", key: "price", width: 12 },
    { header: "Barcode", key: "barcode", width: 22 },
    { header: "All Barcodes", key: "allBarcodes", width: 34 },
    { header: "Item Name EN", key: "itemNameEn", width: 32 },
    { header: "Item Name AR", key: "itemNameAr", width: 28 },
    { header: "Source", key: "sourceType", width: 14 },
    { header: "Chain", key: "chain", width: 10 },
    { header: "Vendor", key: "vendor", width: 10 },
    { header: "Master File", key: "masterfile", width: 12 },
    { header: "New", key: "new", width: 10 },
    { header: "Image", key: "image", width: 24 },
  ];

  await Promise.all(products.map(async (product) => {
    const row = worksheet.addRow({
      id: product.externalProductId ?? product.id,
      sku: product.sku,
      price: product.price ?? "",
      barcode: product.barcode,
      allBarcodes: product.barcodes.join(", "),
      itemNameEn: product.itemNameEn,
      itemNameAr: product.itemNameAr ?? "",
      sourceType: product.sourceType,
      chain: product.chain,
      vendor: product.vendor,
      masterfile: product.masterfile,
      new: product.new,
      image: "",
    });
    row.height = 76;
    const firstImage = product.images[0];
    if (!firstImage) return;
    try {
      const imageAsset = await readStoredImageAsset(firstImage);
      const imageId = workbook.addImage({
        buffer: imageAsset.buffer,
        extension: imageAsset.extension,
      } as never);
      worksheet.addImage(imageId, {
        tl: { col: 12, row: row.number - 1 + 0.1 },
        ext: { width: 74, height: 74 },
      });
    } catch {}
  }));

  const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    archive.append(workbookBuffer, { name: `task-${taskId}.xlsx` });
    void (async () => {
      for (const product of products) {
        for (let index = 0; index < product.images.length; index += 1) {
          const image = product.images[index] as StoredTaskProductImage;
          try {
            const imageAsset = await readStoredImageAsset(image);
            archive.append(imageAsset.buffer, {
              name: path.posix.join("images", `${product.id}-${index + 1}.${imageAsset.extension}`),
            });
          } catch {}
        }
      }
      await archive.finalize();
    })().catch(reject);
  });

  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO scano_task_exports (
      id,
      taskId,
      fileName,
      filePath,
      createdAt,
      confirmedDownloadAt,
      imagesPurgedAt
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL)
  `).run(exportId, taskId, fileName, zipPath, createdAt);

  return {
    item: getLatestExport(taskId, canReviewTasks)!,
    task: getScanoTaskDetail(taskId, actorUserId, true, canManageTasks, canReviewTasks),
  };
}

export function getScanoTaskExportDownload(taskId: ScanoTaskId, exportId: string, canReviewTasks: boolean) {
  if (!canReviewTasks) {
    throw new ScanoTaskStoreError("Only Scano reviewers can download review packages.", 403, "SCANO_TASK_EXPORT_FORBIDDEN");
  }

  const row = db.prepare<[ScanoTaskId, string], StoredTaskExportState>(`
    SELECT
      id,
      fileName,
      filePath,
      createdAt,
      confirmedDownloadAt,
      imagesPurgedAt
    FROM scano_task_exports
    WHERE taskId = ? AND id = ?
    LIMIT 1
  `).get(taskId, exportId);
  if (!row || !fs.existsSync(row.filePath)) {
    throw new ScanoTaskStoreError("Scano task export was not found.", 404, "SCANO_TASK_EXPORT_NOT_FOUND");
  }

  return row;
}

export function confirmScanoTaskExportDownload(taskId: ScanoTaskId, exportId: string, actorUserId: number, canReviewTasks: boolean, canManageTasks: boolean) {
  if (!canReviewTasks) {
    throw new ScanoTaskStoreError("Only Scano reviewers can confirm export downloads.", 403, "SCANO_TASK_EXPORT_CONFIRM_FORBIDDEN");
  }

  const row = db.prepare<[ScanoTaskId, string], StoredTaskExportState>(`
    SELECT
      id,
      fileName,
      filePath,
      createdAt,
      confirmedDownloadAt,
      imagesPurgedAt
    FROM scano_task_exports
    WHERE taskId = ? AND id = ?
    LIMIT 1
  `).get(taskId, exportId);
  if (!row) {
    throw new ScanoTaskStoreError("Scano task export was not found.", 404, "SCANO_TASK_EXPORT_NOT_FOUND");
  }

  if (!row.confirmedDownloadAt) {
    const products = scanoTaskProductRepository.listStoredTaskProducts(taskId);
    for (const product of products) {
      for (const image of product.images) {
        if (image.filePath && fs.existsSync(image.filePath)) {
          fs.rmSync(image.filePath, { force: true });
        }
      }
    }
    const timestamp = nowIso();
    db.prepare(`
      UPDATE scano_task_exports
      SET
        confirmedDownloadAt = ?,
        imagesPurgedAt = ?
      WHERE id = ? AND taskId = ?
    `).run(timestamp, timestamp, exportId, taskId);
  }

  return {
    item: getLatestExport(taskId, canReviewTasks)!,
    task: getScanoTaskDetail(taskId, actorUserId, true, canManageTasks, canReviewTasks),
  };
}

export function deleteScanoTask(taskId: ScanoTaskId, actorUserId: number, canDeleteTasks: boolean) {
  if (!canDeleteTasks) {
    throw new ScanoTaskStoreError("Only Scano admins and team leads can delete tasks.", 403, "SCANO_TASK_DELETE_FORBIDDEN");
  }

  ensureTaskReadable(taskId, {
    actorUserId,
    canViewAllTasks: canDeleteTasks,
    canManageTasks: canDeleteTasks,
    canReviewTasks: canDeleteTasks,
  });

  const localImagePaths = getTaskLocalProductImagePaths(taskId);
  const exportFilePaths = getTaskExportFilePaths(taskId);
  const taskImagesDir = path.join(SCANO_PRODUCT_IMAGES_DIR, taskId);
  const taskExportsDir = path.join(SCANO_EXPORTS_DIR, taskId);

  const deleteTaskRow = db.transaction(() => {
    const result = db.prepare(`DELETE FROM scano_tasks WHERE id = ?`).run(taskId);
    if (result.changes < 1) {
      throw new ScanoTaskStoreError("Scano task was not found.", 404, "SCANO_TASK_NOT_FOUND");
    }
  });

  deleteTaskRow();
  scanoRunnerSessionStore.clearRunnerSessionsForTask(taskId);
  for (const filePath of [...localImagePaths, ...exportFilePaths]) {
    removeScanoFileIfExists(filePath);
  }
  removeScanoDirIfExists(taskImagesDir);
  removeScanoDirIfExists(taskExportsDir);

  return {
    id: taskId,
  };
}

export function purgeScanoTaskData() {
  const taskIds = db.prepare<[], { id: ScanoTaskId }>(`
    SELECT id
    FROM scano_tasks
  `).all().map((row) => row.id);

  const taskCount = taskIds.length;
  db.transaction(() => {
    db.prepare(`DELETE FROM scano_tasks`).run();
  })();

  scanoRunnerSessionStore.resetRunnerSessionStateForTests();
  removeScanoDirIfExists(SCANO_PRODUCT_IMAGES_DIR);
  removeScanoDirIfExists(SCANO_EXPORTS_DIR);
  ensureScanoStorageDir();

  return {
    purgedTaskCount: taskCount,
    purgedTaskIds: taskIds,
  };
}
