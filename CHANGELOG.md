# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
