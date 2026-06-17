# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional `@vllnt/convex-experiments/react` entry — `useVariant` (flicker-free, on `peek`),
  `useAssignment`, `useExperimentResults`. Thin `useQuery` wrappers over the host's re-exported refs;
  `react` is an optional peer dep; render-tested in jsdom at 100%.
- `peek` — a read-only, deterministic query that returns a subject's sticky variant **without
  persisting** (the SSR / flicker-free first-paint path).
- `listExperiments(scope, status?)` — discovery / management surface.
- `forgetSubject` — erase one subject's assignment + exposure (GDPR right-to-erasure), decrementing
  tallies; `deleteExperiment` — bounded, self-rescheduling cascade delete of an experiment + all data.
- `results` now returns `assigned` and `weight` per variant (alongside `subjects`/`exposures`) so a
  host can check sample-ratio-mismatch, and reads maintained `variantTallies` in **O(variants)**
  instead of scanning every exposure row.
- `INVALID_VARIANTS` errors now carry a `reason` (`empty` / `non_positive_weight` / `duplicate_key`).

### Changed

- **`scope` is folded into the assignment hash** (`${scope}:${salt}`) so the same `subjectRef` buckets
  independently per scope — fixes cross-tenant assignment correlation.

### Fixed

- **Definition immutability (`EXPERIMENT_LOCKED`).** Changing `variants` or `salt` after a subject is
  assigned now throws instead of silently splitting the population across two randomizations. The
  earlier "change salt to re-randomize" claim was incorrect for enrolled subjects and is removed from
  the docs; re-randomize by defining a new experiment key.

## [0.1.0] - 2026-06-17

### Added

- First release of `@vllnt/convex-experiments`.
- Deterministic, sticky variant assignment: `pickVariant` hashes `(salt, subjectRef)` with FNV-1a
  onto the cumulative-weight line, so the same subject always lands in the same weighted bucket —
  sticky before persistence, weight-respecting, and stable across concurrent first-`assign` calls.
- `define` / `setStatus` lifecycle (`draft → running → stopped`); only `running` enrolls, and
  stopping freezes new enrollment while preserving recorded assignments and exposures.
- `assign` returns `{ variant: null }` (not enrolled) or `{ variant, isNew }`, persisting the pick on
  first sight and replaying it afterwards.
- `logExposure` dedups exposures into one tallied row per subject; `results` reports distinct
  subjects and total exposures per variant.
- `salt` (defaulting to the experiment key) re-randomizes buckets for a clean re-run without changing
  subject ids.
- Scopes namespace experiments per tenant / surface; server-sourced timestamps throughout.
- Fully typed end to end — variant keys, weights, statuses, and refs are concrete types; no `v.any()`.
- `define` rejects an empty variant set, a non-positive/non-finite weight, or a duplicate variant key
  with `ConvexError({ code: "INVALID_VARIANTS" })`.
