import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { Experiments } from "../../src/client";

/**
 * Host-app wrappers. The host owns auth: resolve identity here, then pass an
 * opaque `subjectRef` (and optional `scope`) into the experiments client. Time is
 * server-sourced inside the component — there is no `now` override to pass.
 */
const experiments = new Experiments(components.experiments);

/**
 * A second client with non-default options — exercises the client `defaultScope`
 * / `defaultStatus` branches (defines into a `"tenant"` scope as `"draft"`).
 */
const scoped = new Experiments(components.experiments, {
  defaultScope: "tenant",
  defaultStatus: "draft",
});

const variantArg = v.array(v.object({ key: v.string(), weight: v.number() }));
const statusArg = v.union(
  v.literal("draft"),
  v.literal("running"),
  v.literal("stopped"),
);
const assignResult = v.union(
  v.object({ variant: v.null() }),
  v.object({ variant: v.string(), isNew: v.boolean() }),
);
const exposureResult = v.union(
  v.object({ variant: v.null() }),
  v.object({ variant: v.string() }),
);
const experimentDef = v.union(
  v.null(),
  v.object({
    key: v.string(),
    scope: v.string(),
    status: statusArg,
    variants: variantArg,
    salt: v.string(),
    createdAt: v.number(),
  }),
);
const assignmentProjection = v.union(
  v.null(),
  v.object({ variant: v.string(), assignedAt: v.number() }),
);
const variantResults = v.array(
  v.object({
    variant: v.string(),
    subjects: v.number(),
    exposures: v.number(),
  }),
);

/** Full-options define — exercises explicit `scope`, `salt`, `status`. */
export const define = mutation({
  args: {
    key: v.string(),
    variants: variantArg,
    scope: v.optional(v.string()),
    salt: v.optional(v.string()),
    status: v.optional(statusArg),
  },
  returns: v.object({ created: v.boolean() }),
  handler: (ctx, a) =>
    experiments.define(ctx, a.key, {
      variants: a.variants,
      scope: a.scope,
      salt: a.salt,
      status: a.status,
    }),
});

/** Minimal define — omits salt/status/scope to exercise the client defaults. */
export const defineDefaults = mutation({
  args: { key: v.string(), variants: variantArg },
  returns: v.object({ created: v.boolean() }),
  handler: (ctx, a) => experiments.define(ctx, a.key, { variants: a.variants }),
});

export const setStatus = mutation({
  args: { key: v.string(), status: statusArg, scope: v.optional(v.string()) },
  returns: v.boolean(),
  handler: (ctx, a) => experiments.setStatus(ctx, a.key, a.status, a.scope),
});

export const assign = mutation({
  args: { key: v.string(), subjectRef: v.string(), scope: v.optional(v.string()) },
  returns: assignResult,
  handler: (ctx, a) => experiments.assign(ctx, a.key, a.subjectRef, a.scope),
});

export const logExposure = mutation({
  args: { key: v.string(), subjectRef: v.string(), scope: v.optional(v.string()) },
  returns: exposureResult,
  handler: (ctx, a) => experiments.logExposure(ctx, a.key, a.subjectRef, a.scope),
});

export const getExperiment = query({
  args: { key: v.string(), scope: v.optional(v.string()) },
  returns: experimentDef,
  handler: (ctx, a) => experiments.getExperiment(ctx, a.key, a.scope),
});

export const getAssignment = query({
  args: { key: v.string(), subjectRef: v.string(), scope: v.optional(v.string()) },
  returns: assignmentProjection,
  handler: (ctx, a) => experiments.getAssignment(ctx, a.key, a.subjectRef, a.scope),
});

export const results = query({
  args: { key: v.string(), scope: v.optional(v.string()) },
  returns: variantResults,
  handler: (ctx, a) => experiments.results(ctx, a.key, a.scope),
});

/**
 * Scoped-client variants — exercise the `defaultScope` / `defaultStatus` defaults
 * (define lands in `"tenant"` as `"draft"`; assign there reads the same scope).
 */
export const defineScoped = mutation({
  args: { key: v.string(), variants: variantArg },
  returns: v.object({ created: v.boolean() }),
  handler: (ctx, a) => scoped.define(ctx, a.key, { variants: a.variants }),
});

export const assignScoped = mutation({
  args: { key: v.string(), subjectRef: v.string() },
  returns: assignResult,
  handler: (ctx, a) => scoped.assign(ctx, a.key, a.subjectRef),
});

export const setStatusScoped = mutation({
  args: { key: v.string(), status: statusArg },
  returns: v.boolean(),
  handler: (ctx, a) => scoped.setStatus(ctx, a.key, a.status),
});

export const getExperimentScoped = query({
  args: { key: v.string() },
  returns: experimentDef,
  handler: (ctx, a) => scoped.getExperiment(ctx, a.key),
});

export const getAssignmentScoped = query({
  args: { key: v.string(), subjectRef: v.string() },
  returns: assignmentProjection,
  handler: (ctx, a) => scoped.getAssignment(ctx, a.key, a.subjectRef),
});

export const resultsScoped = query({
  args: { key: v.string() },
  returns: variantResults,
  handler: (ctx, a) => scoped.results(ctx, a.key),
});

/**
 * Host-side conversion recorder — writes to the host's own `conversions` table
 * (outside the component sandbox), keyed by the variant the component assigned.
 * Demonstrates the measurement boundary: the host owns the outcome metric.
 */
export const recordConversion = mutation({
  args: { key: v.string(), subjectRef: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, a) => {
    const assignment = await experiments.getAssignment(ctx, a.key, a.subjectRef);
    if (assignment === null) {
      return null;
    }
    await ctx.db.insert("conversions", {
      subjectRef: a.subjectRef,
      variant: assignment.variant,
    });
    return assignment.variant;
  },
});

export const conversionCount = query({
  args: { variant: v.string() },
  returns: v.number(),
  handler: async (ctx, a) => {
    const rows = await ctx.db
      .query("conversions")
      .withIndex("by_variant", (q) => q.eq("variant", a.variant))
      .collect();
    return rows.length;
  },
});
