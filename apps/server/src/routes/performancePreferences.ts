import type { Request, Response } from "express";
import { z } from "zod";
import {
  createPerformanceSavedGroup,
  createPerformanceSavedView,
  deletePerformanceSavedGroup,
  deletePerformanceSavedView,
  getPerformancePreferences,
  savePerformanceCurrentState,
  updatePerformanceSavedGroup,
  updatePerformanceSavedView,
} from "../services/performancePreferencesStore.js";

const DeliveryTypeFilterSchema = z.enum(["logistics", "vendor_delivery"]);
const BranchFilterSchema = z.enum(["vendor", "transport", "late", "on_hold", "unassigned", "in_prep", "ready"]);
const NumericSortKeySchema = z.enum(["orders", "vfr", "lfr", "vlfr", "active", "late", "on_hold", "unassigned", "in_prep", "ready"]);

const PreferencesStateSchema = z.object({
  searchQuery: z.string().max(160).default(""),
  selectedVendorIds: z.array(z.coerce.number().int().positive()).max(5000).default([]),
  selectedDeliveryTypes: z.array(DeliveryTypeFilterSchema).max(DeliveryTypeFilterSchema.options.length).default([]),
  selectedBranchFilters: z.array(BranchFilterSchema).max(BranchFilterSchema.options.length).default([]),
  selectedSortKeys: z.array(NumericSortKeySchema).max(NumericSortKeySchema.options.length).default(["orders"]),
  nameSortEnabled: z.boolean().default(false),
  activeGroupId: z.coerce.number().int().positive().nullable().default(null),
  activeViewId: z.coerce.number().int().positive().nullable().default(null),
}).strict();

const PreferencesViewStateSchema = PreferencesStateSchema.omit({
  activeGroupId: true,
  activeViewId: true,
});

const NameSchema = z.string().trim().min(1).max(80);

const GroupCreateSchema = z.object({
  name: NameSchema,
  vendorIds: z.array(z.coerce.number().int().positive()).min(1).max(5000),
}).strict();

const GroupUpdateSchema = z.object({
  name: NameSchema.optional(),
  vendorIds: z.array(z.coerce.number().int().positive()).min(1).max(5000).optional(),
}).strict().refine((value) => typeof value.name === "string" || Array.isArray(value.vendorIds), {
  message: "At least one group field is required",
});

const ViewCreateSchema = z.object({
  name: NameSchema,
  state: PreferencesViewStateSchema,
}).strict();

const ViewUpdateSchema = z.object({
  name: NameSchema.optional(),
  state: PreferencesViewStateSchema.optional(),
}).strict().refine((value) => typeof value.name === "string" || typeof value.state === "object", {
  message: "At least one view field is required",
});

const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

function requireUserId(req: Request) {
  const userId = req.authUser?.id;
  if (!userId) {
    const error = new Error("Unauthorized") as Error & { status: number };
    error.status = 401;
    throw error;
  }
  return userId;
}

export function getPerformancePreferencesRoute(_req: Request, res: Response) {
  const userId = requireUserId(_req);
  res.json(getPerformancePreferences(userId));
}

export function putPerformanceCurrentPreferencesRoute(req: Request, res: Response) {
  const userId = requireUserId(req);
  const current = savePerformanceCurrentState(userId, PreferencesStateSchema.parse(req.body ?? {}));
  res.json({ ok: true, current });
}

export function createPerformanceGroupRoute(req: Request, res: Response) {
  const userId = requireUserId(req);
  const group = createPerformanceSavedGroup(userId, GroupCreateSchema.parse(req.body ?? {}));
  res.status(201).json({ ok: true, group });
}

export function updatePerformanceGroupRoute(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { id } = IdParamSchema.parse(req.params);
  const group = updatePerformanceSavedGroup(userId, id, GroupUpdateSchema.parse(req.body ?? {}));
  res.json({ ok: true, group });
}

export function deletePerformanceGroupRoute(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { id } = IdParamSchema.parse(req.params);
  deletePerformanceSavedGroup(userId, id);
  res.json({ ok: true });
}

export function createPerformanceViewRoute(req: Request, res: Response) {
  const userId = requireUserId(req);
  const view = createPerformanceSavedView(userId, ViewCreateSchema.parse(req.body ?? {}));
  res.status(201).json({ ok: true, view });
}

export function updatePerformanceViewRoute(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { id } = IdParamSchema.parse(req.params);
  const view = updatePerformanceSavedView(userId, id, ViewUpdateSchema.parse(req.body ?? {}));
  res.json({ ok: true, view });
}

export function deletePerformanceViewRoute(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { id } = IdParamSchema.parse(req.params);
  deletePerformanceSavedView(userId, id);
  res.json({ ok: true });
}
