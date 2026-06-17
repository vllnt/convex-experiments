import { v } from "convex/values";

/** A weighted variant — an opaque variant key and its relative selection weight. */
export const variant = v.object({ key: v.string(), weight: v.number() });

/** Experiment lifecycle status. `running` is the only status that enrolls subjects. */
export const experimentStatus = v.union(
  v.literal("draft"),
  v.literal("running"),
  v.literal("stopped"),
);

/**
 * Result of `assign`. `{ variant: null }` — the experiment is absent or not
 * `running`, so the subject is not enrolled (the host treats this as control).
 * `{ variant, isNew }` — the enrolled variant key, with `isNew` true only on the
 * call that first persisted the assignment.
 */
export const assignResult = v.union(
  v.object({ variant: v.null() }),
  v.object({ variant: v.string(), isNew: v.boolean() }),
);

/** Result of `logExposure`: the enrolled variant, or `null` when not enrolled. */
export const exposureResult = v.union(
  v.object({ variant: v.null() }),
  v.object({ variant: v.string() }),
);

/** Projection of an experiment definition returned by `getExperiment`. */
export const experimentDef = v.object({
  key: v.string(),
  scope: v.string(),
  status: experimentStatus,
  variants: v.array(variant),
  salt: v.string(),
  createdAt: v.number(),
});

/** Projection of a subject's sticky assignment returned by `getAssignment`. */
export const assignmentProjection = v.object({
  variant: v.string(),
  assignedAt: v.number(),
});

/** Per-variant exposure tally returned by `results`. */
export const variantResult = v.object({
  /** The variant key. */
  variant: v.string(),
  /** Distinct subjects exposed to this variant (the funnel denominator). */
  subjects: v.number(),
  /** Total exposure events recorded for this variant. */
  exposures: v.number(),
});
