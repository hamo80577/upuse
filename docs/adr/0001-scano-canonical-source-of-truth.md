# ADR 0001: Scano Task Product Canonical Source of Truth

- Status: accepted
- Date: 2026-04-09
- Phase: 0 baseline freeze

## Context

The Scano task domain is moving toward normalized task-product storage. The current model still contains `resolvedProductJson`, which mixes operational state with historical payload data.

Before the refactor starts, we need one written rule that future patches can follow and reviewers can enforce consistently.

## Decision

The canonical operational source of truth for confirmed Scano task products is:

- `scano_task_products`
- `scano_task_product_barcodes`
- `scano_task_product_images`

`resolvedProductJson` is retained only for:

- audit/history
- backward-compatible read paths during the transition
- forensic inspection when reviewing old scans

`resolvedProductJson` must not become the authoritative source for current confirmed task-product reads once normalized rows are available.

## Consequences

- Refactor work should preserve or migrate behavior toward the normalized tables above.
- Any read/write path that still depends on `resolvedProductJson` should be treated as transitional and called out explicitly in PR review.
- Behavior changes are out of scope for Phase 0; this ADR exists to freeze the target model before implementation begins.
