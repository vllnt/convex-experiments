import { v } from "convex/values";
import { query } from "./_generated/server";
import {
  assignmentProjection,
  experimentDef,
  variantResult,
} from "./validators";

/** The experiment definition for `(scope, key)`, or `null` if none exists. */
export const getExperiment = query({
  args: { scope: v.string(), key: v.string() },
  returns: v.union(v.null(), experimentDef),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("experiments")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", args.scope).eq("key", args.key),
      )
      .unique();
    if (row === null) {
      return null;
    }
    return {
      key: row.key,
      scope: row.scope,
      status: row.status,
      variants: row.variants,
      salt: row.salt,
      createdAt: row.createdAt,
    };
  },
});

/** A subject's sticky assignment for an experiment, or `null` if not enrolled. */
export const getAssignment = query({
  args: { scope: v.string(), key: v.string(), subjectRef: v.string() },
  returns: v.union(v.null(), assignmentProjection),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("assignments")
      .withIndex("by_scope_experiment_subject", (q) =>
        q
          .eq("scope", args.scope)
          .eq("experimentKey", args.key)
          .eq("subjectRef", args.subjectRef),
      )
      .unique();
    if (row === null) {
      return null;
    }
    return { variant: row.variant, assignedAt: row.assignedAt };
  },
});

/**
 * Per-variant exposure tallies for an experiment: distinct `subjects` exposed and
 * total `exposures`. Reads the deduped exposure rows via the `by_scope_experiment`
 * index and groups them in memory (one indexed scan, no per-row queries). An
 * experiment with no exposures returns an empty array.
 */
export const results = query({
  args: { scope: v.string(), key: v.string() },
  returns: v.array(variantResult),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("exposures")
      .withIndex("by_scope_experiment", (q) =>
        q.eq("scope", args.scope).eq("experimentKey", args.key),
      )
      .collect();
    const byVariant = new Map<string, { subjects: number; exposures: number }>();
    for (const row of rows) {
      const agg = byVariant.get(row.variant) ?? { subjects: 0, exposures: 0 };
      agg.subjects += 1;
      agg.exposures += row.count;
      byVariant.set(row.variant, agg);
    }
    return Array.from(byVariant, ([variantKey, agg]) => ({
      variant: variantKey,
      subjects: agg.subjects,
      exposures: agg.exposures,
    }));
  },
});
