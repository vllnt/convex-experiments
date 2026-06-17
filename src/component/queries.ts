import { v } from "convex/values";
import { query } from "./_generated/server";
import { pickVariant } from "../shared";
import {
  assignmentProjection,
  experimentDef,
  experimentStatus,
  exposureResult,
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

/** Every experiment in a scope, optionally filtered by `status`. */
export const listExperiments = query({
  args: { scope: v.string(), status: v.optional(experimentStatus) },
  returns: v.array(experimentDef),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("experiments")
      .withIndex("by_scope", (q) => q.eq("scope", args.scope))
      .collect();
    const filtered =
      args.status === undefined
        ? rows
        : rows.filter((row) => row.status === args.status);
    return filtered.map((row) => ({
      key: row.key,
      scope: row.scope,
      status: row.status,
      variants: row.variants,
      salt: row.salt,
      createdAt: row.createdAt,
    }));
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
 * Read-only deterministic variant for a subject — the sticky variant **without
 * persisting** anything. Returns the stored assignment if one exists, otherwise
 * the deterministic `pickVariant` result; `{ variant: null }` when the experiment
 * is absent or not `running`. Use this for SSR / server-component render and as a
 * flicker-free first paint; call the `logExposure` mutation to enroll + tally.
 */
export const peek = query({
  args: { scope: v.string(), key: v.string(), subjectRef: v.string() },
  returns: exposureResult,
  handler: async (ctx, args) => {
    const experiment = await ctx.db
      .query("experiments")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", args.scope).eq("key", args.key),
      )
      .unique();
    if (experiment === null || experiment.status !== "running") {
      return { variant: null };
    }
    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_scope_experiment_subject", (q) =>
        q
          .eq("scope", args.scope)
          .eq("experimentKey", args.key)
          .eq("subjectRef", args.subjectRef),
      )
      .unique();
    if (assignment !== null) {
      return { variant: assignment.variant };
    }
    return {
      variant: pickVariant(
        experiment.variants,
        `${experiment.scope}:${experiment.salt}`,
        args.subjectRef,
      ),
    };
  },
});

/**
 * Per-variant tallies for an experiment — `assigned`, distinct `subjects` exposed,
 * total `exposures`, and the configured `weight` (for sample-ratio-mismatch).
 * Reads the maintained `variantTallies` rows (O(variants)), never scanning the
 * exposure table. An experiment with no enrollment returns an empty array.
 */
export const results = query({
  args: { scope: v.string(), key: v.string() },
  returns: v.array(variantResult),
  handler: async (ctx, args) => {
    const experiment = await ctx.db
      .query("experiments")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", args.scope).eq("key", args.key),
      )
      .unique();
    if (experiment === null) {
      return [];
    }
    const tallies = await ctx.db
      .query("variantTallies")
      .withIndex("by_scope_experiment", (q) =>
        q.eq("scope", args.scope).eq("experimentKey", args.key),
      )
      .collect();
    const byVariant = new Map(tallies.map((tally) => [tally.variant, tally]));
    return experiment.variants.map((variant) => {
      const tally = byVariant.get(variant.key);
      return {
        variant: variant.key,
        assigned: tally?.assigned ?? 0,
        subjects: tally?.subjects ?? 0,
        exposures: tally?.exposures ?? 0,
        weight: variant.weight,
      };
    });
  },
});
