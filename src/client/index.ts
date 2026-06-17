import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type {
  Assignment,
  AssignOutcome,
  DefineOptions,
  ExperimentDefinition,
  ExperimentsOptions,
  ExperimentStatus,
  ExposureOutcome,
  Variant,
  VariantResult,
} from "./types.js";
import { DEFAULT_DELETE_BATCH, DEFAULT_SCOPE, DEFAULT_STATUS } from "../shared.js";

/**
 * The experiments component's function references, as exposed on the host via
 * `components.experiments`. All values are concrete (no opaque host data), so the
 * client is fully typed end to end — there is no generic to narrow.
 */
export interface ExperimentsComponent {
  mutations: {
    define: FunctionReference<
      "mutation",
      "internal",
      {
        scope: string;
        key: string;
        variants: Variant[];
        salt: string;
        status: ExperimentStatus;
      },
      { created: boolean }
    >;
    setStatus: FunctionReference<
      "mutation",
      "internal",
      { scope: string; key: string; status: ExperimentStatus },
      boolean
    >;
    assign: FunctionReference<
      "mutation",
      "internal",
      { scope: string; key: string; subjectRef: string },
      AssignOutcome
    >;
    logExposure: FunctionReference<
      "mutation",
      "internal",
      { scope: string; key: string; subjectRef: string },
      ExposureOutcome
    >;
    forgetSubject: FunctionReference<
      "mutation",
      "internal",
      { scope: string; key: string; subjectRef: string },
      boolean
    >;
    deleteExperiment: FunctionReference<
      "mutation",
      "internal",
      { scope: string; key: string; batch: number },
      number
    >;
  };
  queries: {
    getExperiment: FunctionReference<
      "query",
      "internal",
      { scope: string; key: string },
      ExperimentDefinition | null
    >;
    listExperiments: FunctionReference<
      "query",
      "internal",
      { scope: string; status?: ExperimentStatus },
      ExperimentDefinition[]
    >;
    getAssignment: FunctionReference<
      "query",
      "internal",
      { scope: string; key: string; subjectRef: string },
      Assignment | null
    >;
    peek: FunctionReference<
      "query",
      "internal",
      { scope: string; key: string; subjectRef: string },
      ExposureOutcome
    >;
    results: FunctionReference<
      "query",
      "internal",
      { scope: string; key: string },
      VariantResult[]
    >;
  };
}

interface RunQueryCtx {
  runQuery<Q extends FunctionReference<"query", "internal">>(
    reference: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
}

interface RunMutationCtx {
  runMutation<M extends FunctionReference<"mutation", "internal">>(
    reference: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

/**
 * Consumer-facing client for deterministic A/B experimentation. The host owns
 * meaning and auth; it passes an opaque `subjectRef` and variant keys, and the
 * component answers a sticky, weight-respecting variant plus a deduped exposure
 * tally. Assignment is release-control-free — pair it with a feature-flag
 * component for kill-switches; this layer only assigns and measures.
 *
 * @example
 * ```ts
 * const experiments = new Experiments(components.experiments);
 * await experiments.define(ctx, "checkout_button", {
 *   variants: [
 *     { key: "control", weight: 1 },
 *     { key: "treatment", weight: 1 },
 *   ],
 * });
 * const { variant } = await experiments.logExposure(ctx, "checkout_button", userId);
 * if (variant === "treatment") renderNewButton();
 * // later: const tally = await experiments.results(ctx, "checkout_button");
 * ```
 */
export class Experiments {
  private readonly defaultScope: string;
  private readonly defaultStatus: ExperimentStatus;

  constructor(
    private readonly component: ExperimentsComponent,
    options: ExperimentsOptions = {},
  ) {
    this.defaultScope = options.defaultScope ?? DEFAULT_SCOPE;
    this.defaultStatus = options.defaultStatus ?? (DEFAULT_STATUS as "running");
  }

  private scopeOf(scope: string | undefined): string {
    return scope ?? this.defaultScope;
  }

  /**
   * Create or update an experiment. `variants` are weighted (equal weights split
   * evenly). `salt` defaults to `key`; `status` to the client default (`running`).
   * Returns `{ created }` — `false` when an existing definition was updated. Status
   * transitions are always allowed; `variants`/`salt` are immutable once a subject
   * is assigned (throws `EXPERIMENT_LOCKED`).
   */
  define(
    ctx: RunMutationCtx,
    key: string,
    opts: DefineOptions & { variants: Variant[] },
  ): Promise<{ created: boolean }> {
    return ctx.runMutation(this.component.mutations.define, {
      scope: this.scopeOf(opts.scope),
      key,
      variants: opts.variants,
      salt: opts.salt ?? key,
      status: opts.status ?? this.defaultStatus,
    });
  }

  /** Move an experiment to a new lifecycle status. Returns `false` if it is absent. */
  setStatus(
    ctx: RunMutationCtx,
    key: string,
    status: ExperimentStatus,
    scope?: string,
  ): Promise<boolean> {
    return ctx.runMutation(this.component.mutations.setStatus, {
      scope: this.scopeOf(scope),
      key,
      status,
    });
  }

  /**
   * Enroll a subject and return the sticky variant. `{ variant: null }` when the
   * experiment is absent or not running; otherwise `{ variant, isNew }`, `isNew`
   * true only on the first persisting call.
   */
  assign(
    ctx: RunMutationCtx,
    key: string,
    subjectRef: string,
    scope?: string,
  ): Promise<AssignOutcome> {
    return ctx.runMutation(this.component.mutations.assign, {
      scope: this.scopeOf(scope),
      key,
      subjectRef,
    });
  }

  /**
   * Record an exposure (enrolling the subject if needed) and return their variant,
   * or `null` if not enrolled. Repeated exposures for one subject are deduped into
   * a single tallied row.
   */
  logExposure(
    ctx: RunMutationCtx,
    key: string,
    subjectRef: string,
    scope?: string,
  ): Promise<ExposureOutcome> {
    return ctx.runMutation(this.component.mutations.logExposure, {
      scope: this.scopeOf(scope),
      key,
      subjectRef,
    });
  }

  /** The experiment definition, or `null` if none exists. */
  getExperiment(
    ctx: RunQueryCtx,
    key: string,
    scope?: string,
  ): Promise<ExperimentDefinition | null> {
    return ctx.runQuery(this.component.queries.getExperiment, {
      scope: this.scopeOf(scope),
      key,
    });
  }

  /** A subject's sticky assignment, or `null` if not enrolled. */
  getAssignment(
    ctx: RunQueryCtx,
    key: string,
    subjectRef: string,
    scope?: string,
  ): Promise<Assignment | null> {
    return ctx.runQuery(this.component.queries.getAssignment, {
      scope: this.scopeOf(scope),
      key,
      subjectRef,
    });
  }

  /**
   * Read-only deterministic variant for a subject — the sticky variant **without
   * persisting**. Returns the stored assignment if present, else the deterministic
   * pick; `null` when not enrolled. Use for SSR / a flicker-free first paint, then
   * call `logExposure` to enroll + tally.
   */
  peek(
    ctx: RunQueryCtx,
    key: string,
    subjectRef: string,
    scope?: string,
  ): Promise<ExposureOutcome> {
    return ctx.runQuery(this.component.queries.peek, {
      scope: this.scopeOf(scope),
      key,
      subjectRef,
    });
  }

  /** Every experiment in a scope, optionally filtered by `status`. */
  listExperiments(
    ctx: RunQueryCtx,
    opts: { scope?: string; status?: ExperimentStatus } = {},
  ): Promise<ExperimentDefinition[]> {
    return ctx.runQuery(this.component.queries.listExperiments, {
      scope: this.scopeOf(opts.scope),
      status: opts.status,
    });
  }

  /**
   * Per-variant tallies — `assigned`, distinct `subjects` exposed, total
   * `exposures`, and the configured `weight` (for sample-ratio-mismatch). Reads
   * O(variants), not the exposure table.
   */
  results(
    ctx: RunQueryCtx,
    key: string,
    scope?: string,
  ): Promise<VariantResult[]> {
    return ctx.runQuery(this.component.queries.results, {
      scope: this.scopeOf(scope),
      key,
    });
  }

  /**
   * Erase a subject's assignment + exposure in one experiment (GDPR right-to-
   * erasure), decrementing tallies. Returns `true` if anything was deleted. Loop
   * over `listExperiments` to erase a subject across a whole scope.
   */
  forgetSubject(
    ctx: RunMutationCtx,
    key: string,
    subjectRef: string,
    scope?: string,
  ): Promise<boolean> {
    return ctx.runMutation(this.component.mutations.forgetSubject, {
      scope: this.scopeOf(scope),
      key,
      subjectRef,
    });
  }

  /**
   * Delete an experiment and all of its data (definition, assignments, exposures,
   * tallies). Bounded + self-rescheduling; returns the rows removed this pass.
   * Idempotent and safe on an absent experiment.
   */
  deleteExperiment(
    ctx: RunMutationCtx,
    key: string,
    opts: { scope?: string; batch?: number } = {},
  ): Promise<number> {
    return ctx.runMutation(this.component.mutations.deleteExperiment, {
      scope: this.scopeOf(opts.scope),
      key,
      batch: opts.batch ?? DEFAULT_DELETE_BATCH,
    });
  }
}

export type {
  Assignment,
  AssignOutcome,
  DefineOptions,
  ExperimentDefinition,
  ExperimentsOptions,
  ExperimentStatus,
  ExposureOutcome,
  Variant,
  VariantResult,
};
