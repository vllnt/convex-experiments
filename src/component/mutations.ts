import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { pickVariant, type Variant } from "../shared";
import { assignResult, experimentStatus, exposureResult, variant } from "./validators";

/**
 * Reject a malformed variant set before any write: at least one variant, every
 * weight a positive finite number, and no duplicate variant keys. A zero/negative
 * weight would distort or zero out a bucket; a duplicate key would make
 * assignment ambiguous.
 *
 * @throws `ConvexError({ code: "INVALID_VARIANTS" })`
 */
function validateVariants(variants: readonly Variant[]): void {
  if (variants.length === 0) {
    throw new ConvexError({
      code: "INVALID_VARIANTS",
      message: "an experiment needs at least one variant",
    });
  }
  const seen = new Set<string>();
  for (const candidate of variants) {
    if (!(candidate.weight > 0 && isFinite(candidate.weight))) {
      throw new ConvexError({
        code: "INVALID_VARIANTS",
        message: `variant "${candidate.key}" weight must be a positive finite number`,
      });
    }
    if (seen.has(candidate.key)) {
      throw new ConvexError({
        code: "INVALID_VARIANTS",
        message: `duplicate variant key "${candidate.key}"`,
      });
    }
    seen.add(candidate.key);
  }
}

/**
 * Return the subject's sticky assignment, persisting a fresh deterministic pick on
 * first sight. Plain helper (not a Convex function) so `assign` and `logExposure`
 * share one enrollment path. Time is server-sourced by the caller.
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
  const variantKey = pickVariant(experiment.variants, experiment.salt, subjectRef);
  await ctx.db.insert("assignments", {
    scope: experiment.scope,
    experimentKey: experiment.key,
    subjectRef,
    variant: variantKey,
    assignedAt: now,
  });
  return { variant: variantKey, isNew: true };
}

/**
 * Create or update an experiment definition, keyed by `(scope, key)`. Returns
 * `{ created: true }` on insert, `{ created: false }` on update. Updating leaves
 * existing sticky assignments untouched — only the definition (variants, salt,
 * status) changes. Time is server-sourced.
 *
 * @throws `ConvexError({ code: "INVALID_VARIANTS" })` when the variant set is
 *   empty, has a non-positive/non-finite weight, or repeats a variant key.
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
 * (`isNew: true`); later calls replay it (`isNew: false`). Assignment is a pure
 * function of `(salt, subjectRef)` — see {@link pickVariant} — so it is sticky
 * even before persistence. Time is server-sourced.
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
 * Record that `subjectRef` was exposed to the experiment and return their variant.
 * Enrolls the subject if needed (same sticky path as `assign`), then upserts a
 * per-subject exposure row — first exposure inserts (`count` 1), later exposures
 * bump `count` and `lastExposedAt`. The deduped tally is what `results` reports as
 * unique subjects. `{ variant: null }` when not enrolled. Time is server-sourced.
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
    } else {
      await ctx.db.patch(existing._id, {
        lastExposedAt: now,
        count: existing.count + 1,
      });
    }
    return { variant: variantKey };
  },
});
