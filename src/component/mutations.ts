import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { pickVariant, type Variant } from "../shared";
import { assignResult, experimentStatus, exposureResult, variant } from "./validators";

/**
 * Reject a malformed variant set before any write: at least one variant, every
 * weight a positive finite number, and no duplicate variant keys. The thrown
 * `ConvexError` carries a `reason` so the host can branch on the specific failure.
 *
 * @throws `ConvexError({ code: "INVALID_VARIANTS", reason })`
 */
function validateVariants(variants: readonly Variant[]): void {
  if (variants.length === 0) {
    throw new ConvexError({
      code: "INVALID_VARIANTS",
      reason: "empty",
      message: "an experiment needs at least one variant",
    });
  }
  const seen = new Set<string>();
  for (const candidate of variants) {
    if (!(candidate.weight > 0 && isFinite(candidate.weight))) {
      throw new ConvexError({
        code: "INVALID_VARIANTS",
        reason: "non_positive_weight",
        key: candidate.key,
        message: `variant "${candidate.key}" weight must be a positive finite number`,
      });
    }
    if (seen.has(candidate.key)) {
      throw new ConvexError({
        code: "INVALID_VARIANTS",
        reason: "duplicate_key",
        key: candidate.key,
        message: `duplicate variant key "${candidate.key}"`,
      });
    }
    seen.add(candidate.key);
  }
}

/**
 * The hash salt for an experiment folds in `scope` so the same `subjectRef` lands
 * in an independent bucket per scope (a tenant-correlation bug otherwise) and the
 * host's `salt` re-keys within the scope.
 */
function hashSalt(experiment: Doc<"experiments">): string {
  return `${experiment.scope}:${experiment.salt}`;
}

/** Incrementally maintain the per-`(scope, experiment, variant)` tally row. */
async function bumpTally(
  ctx: MutationCtx,
  scope: string,
  experimentKey: string,
  variantKey: string,
  delta: { assigned?: number; subjects?: number; exposures?: number },
): Promise<void> {
  const assigned = delta.assigned ?? 0;
  const subjects = delta.subjects ?? 0;
  const exposures = delta.exposures ?? 0;
  const row = await ctx.db
    .query("variantTallies")
    .withIndex("by_scope_experiment_variant", (q) =>
      q.eq("scope", scope).eq("experimentKey", experimentKey).eq("variant", variantKey),
    )
    .unique();
  if (row === null) {
    await ctx.db.insert("variantTallies", {
      scope,
      experimentKey,
      variant: variantKey,
      assigned,
      subjects,
      exposures,
    });
  } else {
    await ctx.db.patch(row._id, {
      assigned: row.assigned + assigned,
      subjects: row.subjects + subjects,
      exposures: row.exposures + exposures,
    });
  }
}

/**
 * Return the subject's sticky assignment, persisting a fresh deterministic pick on
 * first sight (and bumping the variant's `assigned` tally). Plain helper (not a
 * Convex function) so `assign` and `logExposure` share one enrollment path. Time is
 * server-sourced by the caller.
 */
async function ensureAssignment(
  ctx: MutationCtx,
  experiment: Doc<"experiments">,
  subjectRef: string,
  now: number,
): Promise<{ variant: string; isNew: boolean }> {
  const existing = await ctx.db
    .query("assignments")
    .withIndex("by_scope_experiment_subject", (q) =>
      q
        .eq("scope", experiment.scope)
        .eq("experimentKey", experiment.key)
        .eq("subjectRef", subjectRef),
    )
    .unique();
  if (existing !== null) {
    return { variant: existing.variant, isNew: false };
  }
  const variantKey = pickVariant(experiment.variants, hashSalt(experiment), subjectRef);
  await ctx.db.insert("assignments", {
    scope: experiment.scope,
    experimentKey: experiment.key,
    subjectRef,
    variant: variantKey,
    assignedAt: now,
  });
  await bumpTally(ctx, experiment.scope, experiment.key, variantKey, { assigned: 1 });
  return { variant: variantKey, isNew: true };
}

/** True when two variant sets differ in key, weight, or order. */
function variantsChanged(a: readonly Variant[], b: readonly Variant[]): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Create or update an experiment definition, keyed by `(scope, key)`. Returns
 * `{ created: true }` on insert, `{ created: false }` on update. Time is
 * server-sourced.
 *
 * **Immutability once assigned:** `variants` and `salt` are fixed once any subject
 * is assigned — changing them would split the population across two randomizations
 * (some subjects bucketed under the old definition, some the new) and orphan
 * tallies. Status transitions (start/stop) are always allowed. To re-randomize or
 * reweight after enrollment, define a new experiment key.
 *
 * @throws `ConvexError({ code: "INVALID_VARIANTS", reason })` for a bad variant set.
 * @throws `ConvexError({ code: "EXPERIMENT_LOCKED" })` when `variants`/`salt` change
 *   after a subject has been assigned.
 */
export const define = mutation({
  args: {
    scope: v.string(),
    key: v.string(),
    variants: v.array(variant),
    salt: v.string(),
    status: experimentStatus,
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    validateVariants(args.variants);
    const existing = await ctx.db
      .query("experiments")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", args.scope).eq("key", args.key),
      )
      .unique();
    if (existing === null) {
      await ctx.db.insert("experiments", {
        key: args.key,
        scope: args.scope,
        status: args.status,
        variants: args.variants,
        salt: args.salt,
        createdAt: Date.now(),
      });
      return { created: true };
    }
    if (variantsChanged(existing.variants, args.variants) || existing.salt !== args.salt) {
      const firstAssignment = await ctx.db
        .query("assignments")
        .withIndex("by_scope_experiment_subject", (q) =>
          q.eq("scope", args.scope).eq("experimentKey", args.key),
        )
        .first();
      if (firstAssignment !== null) {
        throw new ConvexError({
          code: "EXPERIMENT_LOCKED",
          message:
            "variants and salt are immutable once subjects are assigned; define a new experiment key to re-randomize",
        });
      }
    }
    await ctx.db.patch(existing._id, {
      status: args.status,
      variants: args.variants,
      salt: args.salt,
    });
    return { created: false };
  },
});

/**
 * Move an experiment to a new lifecycle `status`. Returns `false` when no
 * experiment exists for `(scope, key)`, `true` once patched. Stopping an
 * experiment freezes enrollment (`assign` returns `{ variant: null }`) while
 * leaving recorded assignments and exposures intact.
 */
export const setStatus = mutation({
  args: { scope: v.string(), key: v.string(), status: experimentStatus },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("experiments")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", args.scope).eq("key", args.key),
      )
      .unique();
    if (existing === null) {
      return false;
    }
    await ctx.db.patch(existing._id, { status: args.status });
    return true;
  },
});

/**
 * Enroll `subjectRef` and return the sticky variant. `{ variant: null }` when the
 * experiment is absent or not `running` (the host treats it as control). When
 * `running`, the first call deterministically picks and persists a variant
 * (`isNew: true`); later calls replay it (`isNew: false`). Time is server-sourced.
 */
export const assign = mutation({
  args: { scope: v.string(), key: v.string(), subjectRef: v.string() },
  returns: assignResult,
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
    return ensureAssignment(ctx, experiment, args.subjectRef, Date.now());
  },
});

/**
 * Record that `subjectRef` was exposed and return their variant, enrolling if
 * needed. First exposure inserts a tally row and bumps `subjects` + `exposures`;
 * later exposures bump `exposures` only (deduped per subject). `{ variant: null }`
 * when not enrolled. Time is server-sourced.
 */
export const logExposure = mutation({
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
    const now = Date.now();
    const { variant: variantKey } = await ensureAssignment(
      ctx,
      experiment,
      args.subjectRef,
      now,
    );
    const existing = await ctx.db
      .query("exposures")
      .withIndex("by_scope_experiment_subject", (q) =>
        q
          .eq("scope", args.scope)
          .eq("experimentKey", args.key)
          .eq("subjectRef", args.subjectRef),
      )
      .unique();
    if (existing === null) {
      await ctx.db.insert("exposures", {
        scope: args.scope,
        experimentKey: args.key,
        subjectRef: args.subjectRef,
        variant: variantKey,
        firstExposedAt: now,
        lastExposedAt: now,
        count: 1,
      });
      await bumpTally(ctx, args.scope, args.key, variantKey, {
        subjects: 1,
        exposures: 1,
      });
    } else {
      await ctx.db.patch(existing._id, {
        lastExposedAt: now,
        count: existing.count + 1,
      });
      await bumpTally(ctx, args.scope, args.key, variantKey, { exposures: 1 });
    }
    return { variant: variantKey };
  },
});

/**
 * Erase a subject's footprint in one experiment — their assignment and exposure
 * rows — decrementing the variant tallies accordingly. The GDPR right-to-erasure
 * primitive for a `subjectRef` that maps to a person. Returns `true` if anything
 * was deleted. Loop over `listExperiments` to erase a subject across a scope.
 */
export const forgetSubject = mutation({
  args: { scope: v.string(), key: v.string(), subjectRef: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    let deleted = false;
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
      await bumpTally(ctx, args.scope, args.key, assignment.variant, {
        assigned: -1,
      });
      await ctx.db.delete(assignment._id);
      deleted = true;
    }
    const exposure = await ctx.db
      .query("exposures")
      .withIndex("by_scope_experiment_subject", (q) =>
        q
          .eq("scope", args.scope)
          .eq("experimentKey", args.key)
          .eq("subjectRef", args.subjectRef),
      )
      .unique();
    if (exposure !== null) {
      await bumpTally(ctx, args.scope, args.key, exposure.variant, {
        subjects: -1,
        exposures: -exposure.count,
      });
      await ctx.db.delete(exposure._id);
      deleted = true;
    }
    return deleted;
  },
});

/**
 * Delete an experiment and all of its data — the definition, every assignment,
 * exposure, and tally row. Bounded: removes up to `batch` rows per table per pass
 * and self-reschedules until the children are drained, then deletes the definition.
 * Idempotent and safe to call on an absent experiment. Returns the rows removed
 * this pass.
 */
export const deleteExperiment = mutation({
  args: { scope: v.string(), key: v.string(), batch: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let removed = 0;
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_scope_experiment_subject", (q) =>
        q.eq("scope", args.scope).eq("experimentKey", args.key),
      )
      .take(args.batch);
    for (const row of assignments) {
      await ctx.db.delete(row._id);
      removed++;
    }
    const exposures = await ctx.db
      .query("exposures")
      .withIndex("by_scope_experiment", (q) =>
        q.eq("scope", args.scope).eq("experimentKey", args.key),
      )
      .take(args.batch);
    for (const row of exposures) {
      await ctx.db.delete(row._id);
      removed++;
    }
    const tallies = await ctx.db
      .query("variantTallies")
      .withIndex("by_scope_experiment", (q) =>
        q.eq("scope", args.scope).eq("experimentKey", args.key),
      )
      .take(args.batch);
    for (const row of tallies) {
      await ctx.db.delete(row._id);
      removed++;
    }
    if (removed > 0) {
      await ctx.scheduler.runAfter(0, api.mutations.deleteExperiment, {
        scope: args.scope,
        key: args.key,
        batch: args.batch,
      });
      return removed;
    }
    const def = await ctx.db
      .query("experiments")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", args.scope).eq("key", args.key),
      )
      .unique();
    if (def !== null) {
      await ctx.db.delete(def._id);
    }
    return removed;
  },
});
