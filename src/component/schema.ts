import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { variant } from "./validators";

/**
 * Sandboxed tables — the experimentation ledger's own concern. No host tables are
 * touched. An experiment is unique within a `scope`; `subjectRef`, variant keys,
 * and the scope are all opaque host-owned strings.
 *
 * - `experiments`    — the experiment definition (variants, weights, lifecycle, salt).
 * - `assignments`    — a subject's sticky variant choice, persisted on first `assign`.
 * - `exposures`      — a deduped per-subject exposure tally (the measurable surface).
 * - `variantTallies` — one row per `(scope, experiment, variant)` holding running
 *   `assigned` / `subjects` (distinct exposed) / `exposures` counts, maintained on
 *   write so `results` reads O(variants) rows instead of scanning every exposure.
 */
export default defineSchema({
  experiments: defineTable({
    key: v.string(),
    scope: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("running"),
      v.literal("stopped"),
    ),
    variants: v.array(variant),
    salt: v.string(),
    createdAt: v.number(),
  })
    .index("by_scope_key", ["scope", "key"])
    .index("by_scope", ["scope"]),

  assignments: defineTable({
    scope: v.string(),
    experimentKey: v.string(),
    subjectRef: v.string(),
    variant: v.string(),
    assignedAt: v.number(),
  }).index("by_scope_experiment_subject", [
    "scope",
    "experimentKey",
    "subjectRef",
  ]),

  exposures: defineTable({
    scope: v.string(),
    experimentKey: v.string(),
    subjectRef: v.string(),
    variant: v.string(),
    firstExposedAt: v.number(),
    lastExposedAt: v.number(),
    count: v.number(),
  })
    .index("by_scope_experiment_subject", [
      "scope",
      "experimentKey",
      "subjectRef",
    ])
    .index("by_scope_experiment", ["scope", "experimentKey"]),

  variantTallies: defineTable({
    scope: v.string(),
    experimentKey: v.string(),
    variant: v.string(),
    assigned: v.number(),
    subjects: v.number(),
    exposures: v.number(),
  })
    .index("by_scope_experiment_variant", ["scope", "experimentKey", "variant"])
    .index("by_scope_experiment", ["scope", "experimentKey"]),
});
