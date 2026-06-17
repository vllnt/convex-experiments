/** Public TypeScript surface for the experiments client. */

/** A weighted variant — an opaque variant key and its relative selection weight. */
export interface Variant {
  /** The host's opaque variant key (e.g. `"control"`, `"treatment"`). */
  key: string;
  /** Relative selection weight; the bucket width is `weight / sum(weights)`. */
  weight: number;
}

/** Experiment lifecycle status. `running` is the only status that enrolls subjects. */
export type ExperimentStatus = "draft" | "running" | "stopped";

/** Construction options for the {@link Experiments} client. */
export interface ExperimentsOptions {
  /** Namespace applied when a call omits `scope`. Default `"global"`. */
  defaultScope?: string;
  /** Status applied by `define` when a call omits `status`. Default `"running"`. */
  defaultStatus?: ExperimentStatus;
}

/** Per-call overrides for {@link Experiments.define}. */
export interface DefineOptions {
  /** Namespace for this experiment. Defaults to the client `defaultScope`. */
  scope?: string;
  /**
   * Hash salt for deterministic assignment. Defaults to the experiment `key`.
   * Fixed once any subject is assigned (changing it after enrollment throws
   * `EXPERIMENT_LOCKED`); to re-randomize, define a new experiment key.
   */
  salt?: string;
  /** Initial lifecycle status. Defaults to the client `defaultStatus`. */
  status?: ExperimentStatus;
}

/** An experiment definition, as returned by {@link Experiments.getExperiment}. */
export interface ExperimentDefinition {
  key: string;
  scope: string;
  status: ExperimentStatus;
  variants: Variant[];
  salt: string;
  /** Absolute ms timestamp the experiment was first defined. */
  createdAt: number;
}

/** A subject's sticky assignment, as returned by {@link Experiments.getAssignment}. */
export interface Assignment {
  variant: string;
  /** Absolute ms timestamp the assignment was first persisted. */
  assignedAt: number;
}

/**
 * Outcome of {@link Experiments.assign}. `{ variant: null }` — not enrolled
 * (experiment absent or not running). `{ variant, isNew }` — the enrolled variant,
 * with `isNew` true only on the call that first persisted the assignment.
 */
export type AssignOutcome =
  | { variant: null }
  | { variant: string; isNew: boolean };

/** Outcome of {@link Experiments.logExposure}: the variant, or `null` if not enrolled. */
export type ExposureOutcome = { variant: string | null };

/** A per-variant tally, as returned by {@link Experiments.results}. */
export interface VariantResult {
  /** The variant key. */
  variant: string;
  /** Subjects assigned to this variant (the realized split, for SRM). */
  assigned: number;
  /** Distinct subjects exposed to this variant (the funnel denominator). */
  subjects: number;
  /** Total exposure events recorded for this variant. */
  exposures: number;
  /** The configured weight from the current definition (0 if the variant is gone). */
  weight: number;
}
