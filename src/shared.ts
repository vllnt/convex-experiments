/** Shared constants + pure deterministic assignment used by both `client/` and `component/`. */

export const COMPONENT_NAME = "experiments";

/** Default namespace when the host does not scope an experiment. */
export const DEFAULT_SCOPE = "global";

/** Lifecycle status the client applies to `define` when the caller omits one. */
export const DEFAULT_STATUS = "running";

/** Default page size for a `deleteExperiment` cascade pass before it self-reschedules. */
export const DEFAULT_DELETE_BATCH = 200;

/** A weighted variant: an opaque variant key and its relative selection weight. */
export interface Variant {
  /** The host's opaque variant key (e.g. `"control"`, `"treatment"`). */
  key: string;
  /** Relative selection weight; the bucket width is `weight / sum(weights)`. */
  weight: number;
}

/**
 * FNV-1a 32-bit hash of `input`, returned as an unsigned integer. Deterministic,
 * synchronous, and dependency-free — the component runs in a V8 isolate, so a
 * pure string hash (rather than async `crypto.subtle`) is what keeps variant
 * assignment a plain function callable inside a mutation.
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministically pick a variant for `subjectRef` from `variants`, weighted by
 * each variant's `weight`. The same `(salt, subjectRef)` always maps to the same
 * variant — sticky assignment with no storage — and the distribution matches the
 * weights. The component folds `scope` into the salt so the same subject buckets
 * independently per scope. Assumes a non-empty `variants` with positive weights;
 * the caller validates that upstream.
 */
export function pickVariant(
  variants: readonly Variant[],
  salt: string,
  subjectRef: string,
): string {
  const lastVariant = variants[variants.length - 1];
  if (lastVariant === undefined) {
    throw new Error("pickVariant requires at least one variant");
  }
  let total = 0;
  for (const variant of variants) {
    total += variant.weight;
  }
  // Map the hash into [0, total): a point on the cumulative-weight line.
  let target = (fnv1a(`${salt}:${subjectRef}`) / 0x100000000) * total;
  // Walk every variant but the last, subtracting its bucket width.
  for (const variant of variants.slice(0, -1)) {
    target -= variant.weight;
    if (target < 0) {
      return variant.key;
    }
  }
  // The point fell in the final variant's bucket (also the single-variant case).
  return lastVariant.key;
}
