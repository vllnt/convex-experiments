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
import { DEFAULT_SCOPE, DEFAULT_STATUS } from "../shared.js";

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
  };
  queries: {
    getExperiment: FunctionReference<
      "query",
      "internal",
      { scope: string; key: string },
      ExperimentDefinition | null
    >;
    getAssignment: FunctionReference<
      "query",
      "internal",
      { scope: string; key: string; subjectRef: string },
      Assignment | null
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
   * Returns `{ created }` — `false` when an existing definition was updated.
   * Updating never disturbs existing sticky assignments.
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

  /** Per-variant exposure tallies (distinct subjects + total exposures). */
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
