# Scano Refactor Checklist

Phase 0 is a baseline freeze only.

- No runtime behavior change is intended in this phase.
- Every preserved behavior must stay covered by an existing or newly added test.
- Every intentional behavior change in later phases must be written here before merge.

## Baseline matrix

- `npm run test:ops`
- `npm --workspace apps/server run test:scano:baseline`
- `npm --workspace apps/web run test:scano:baseline`
- `npm run test:scano:baseline`

## Canonical-source guardrail

- `scano_task_products`, `scano_task_product_barcodes`, and `scano_task_product_images` are the operational source of truth.
- `resolvedProductJson` is audit/history only during the refactor.
- PRs must call out any remaining live dependency on `resolvedProductJson`.

## Behavior checklist

- Review export confirmation still gates task completion.
- Export confirmation metadata still unlocks task completion.
- Runner bootstrap remains stable for an active task session.
- Trusted-origin protections still deny untrusted browser writes.
- Login throttling still persists by normalized email plus client IP.

## Scaffolding tracked in this phase

- Immediate local task-image purge after export download confirmation
- Upload size limits for scanner image uploads
- Upload type restrictions for scanner image uploads

These two items are intentionally tracked as scaffolding in Phase 0. They should not be claimed as implemented behavior until enforcement lands in the runtime code and the tests move from `todo` to executable assertions.

## PR review checklist

- Confirm the ADR still matches the implementation direction.
- Confirm any behavior change is intentional and documented here first.
- Confirm no unrelated refactor slipped into the same PR.
- Confirm the narrow baseline matrix ran, or state exactly what was not run.
