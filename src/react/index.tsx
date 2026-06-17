/**
 * Optional, tree-shakeable React front-tooling for `@vllnt/convex-experiments`.
 *
 * Thin reactive hooks over `useQuery` from `convex/react`. Each takes the HOST's
 * re-exported query reference plus its args — the component never imports the host
 * `api`. `react` and `convex/react` are optional peer deps: a backend-only consumer
 * pulls none of this code.
 *
 * NO-LEAK CONTRACT: these hooks expose only non-secret experiment data — the
 * subject's own variant key, their assignment, and aggregate per-variant tallies.
 * There is no secret or cross-subject payload. `useVariant` reads the deterministic
 * `peek` query, so it paints the correct variant on first render (no flash of
 * control); call the `logExposure` mutation to enroll + tally.
 */

import type { FunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import type { Assignment, VariantResult } from "../client/types.js";

/**
 * Reactive, flicker-free variant for a subject — wraps the host's re-exported
 * `peek` query (deterministic, read-only). Returns the variant key, `null` when not
 * enrolled, or `undefined` while the query loads.
 */
export function useVariant(
  peekRef: FunctionReference<
    "query",
    "public",
    { scope?: string; key: string; subjectRef: string },
    { variant: string | null }
  >,
  args: { scope?: string; key: string; subjectRef: string },
): string | null | undefined {
  const result = useQuery(peekRef, args);
  return result === undefined ? undefined : result.variant;
}

/**
 * Reactive sticky assignment — wraps the host's re-exported `getAssignment` query.
 * `null` when not enrolled, `undefined` while loading.
 */
export function useAssignment(
  getAssignmentRef: FunctionReference<
    "query",
    "public",
    { scope?: string; key: string; subjectRef: string },
    Assignment | null
  >,
  args: { scope?: string; key: string; subjectRef: string },
): Assignment | null | undefined {
  return useQuery(getAssignmentRef, args);
}

/**
 * Reactive per-variant tallies (`assigned`/`subjects`/`exposures`/`weight`) for a
 * live results dashboard — wraps the host's re-exported `results` query.
 */
export function useExperimentResults(
  resultsRef: FunctionReference<
    "query",
    "public",
    { scope?: string; key: string },
    VariantResult[]
  >,
  args: { scope?: string; key: string },
): VariantResult[] | undefined {
  return useQuery(resultsRef, args);
}
