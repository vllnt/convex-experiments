# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

### Added

- Ship `docs/API.md`, `CHANGELOG.md` and `llms.txt` in the npm package, so coding agents can read
  docs that match the installed version from `node_modules/@vllnt/convex-experiments/`. `llms.txt`
  links shipped files relatively and has a "For coding agents" note and an Ecosystem line; the README
  gains a "For coding agents" note and a "Related packages" section.
- `pnpm test:package` (run in CI) fails when a required file is missing from the tarball, when a
  contributor or internal file would ship, or when an `llms.txt` link does not resolve inside it.
- `docs/API.md` documents the `./react`, `./test` and `./convex.config` entry points and the exported types.

### Fixed

- Correct shipped doc comments: `results` returns a zeroed row per defined variant (not `[]`) for an
  experiment with no enrollment, `weight` is never `0`, and `setStatus` returns `true` whenever the
  experiment exists.
- **Breaking:** Reject empty `scope`, `key`, and `subjectRef` identifiers in `define`, `setStatus`,
  `assign`, `logExposure`, `forgetSubject`, and `deleteExperiment` with
  `ConvexError({ code: "INVALID_ARGUMENT" })`, and an empty variant key in `define` with
  `INVALID_VARIANTS` (`reason: "empty_key"`). Callers passing an empty `scope`, `key`, `subjectRef`
  or variant key now get a `ConvexError` instead of success.
- Make the `/test` entry type-check for consumers using `moduleResolution: nodenext`: relative imports
  in `src/` use explicit `.js` extensions and `src/test.ts` references `vite/client` types.
- `register()` from `/test` accepts a host app's `convexTest(hostSchema, modules)` instance. It was
  typed against the component's own schema, so any host schema with other tables failed with TS2345.

### Changed

- Rework the README for coding agents (fixed section order, type-checked examples, an errors table
  and a limits list), rewrite `docs/API.md` with one heading per export, refresh `llms.txt`, add
  TSDoc to every public export, and set the `description` and `keywords` to match the code.
  `pnpm test:package` now also runs `scripts/check-docs.mjs`, which enforces these docs.
  `pnpm typecheck:ci` now also type-checks `example/` and the tests.
- `deleteExperiment` deletes the definition in the same pass once every child table returns fewer rows
  than `batch`, which can save the final scheduled mutation of a delete.
- `define` and `setStatus` skip the write when nothing changed, so idempotent re-defines no longer
  invalidate `peek`/`getExperiment`/`results` subscriptions.
- The first `logExposure` for a subject updates its variant tally once instead of twice.
- Clarify installation and usage documentation; retain `llms.txt` as the single
  maintained LLM index and remove the generated `llms-full.txt` bundle.
- Adopt pnpm 10 with a seven-day release-age gate and blocked dependency install scripts; drop
  dependency overrides that no longer change the lockfile.
- Develop and test against `convex` 1.51 and `convex-test` 0.0.73, and move the development
  toolchain to ESLint 10, jsdom 31, `@vllnt/typescript` 3 and Vitest 5.1.1. The `convex` peer range
  (`^1.45.0`) is unchanged.
- Publish `@latest` only from a `vX.Y.Z` tag on `main` (npm trusted publishing with provenance); pin all
  workflow actions and scope their permissions. No local publish scripts remain.
- Exclude test files from the published package.
- Publish a canary on every push to `main` that touches the package or its shipped docs, and remove the
  repository-variable gate. The canary job still publishes under the `canary` dist-tag
  only and never moves `latest`; the `homepage` now points at `https://oss.vllnt.com/packages/convex-experiments`.

## [0.1.0] - 2026-09-01

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
- `salt` defaults to the experiment key and seeds the assignment hash.
- Scopes namespace experiments per tenant / surface; server-sourced timestamps throughout.
- Fully typed end to end — variant keys, weights, statuses, and refs are concrete types; no `v.any()`.
- `define` rejects an empty variant set, a non-positive/non-finite weight, or a duplicate variant key
  with `ConvexError({ code: "INVALID_VARIANTS" })`.
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

- Treat Convex `_generated` output as CLI-owned, exclude it from formatting, and expose a
  dedicated codegen script.
- Refresh all direct dependencies to their latest compatible releases for canary validation.
- Require `convex@^1.45.0` and update `convex-test` to `^0.0.56`.
- **`scope` is folded into the assignment hash** (`${scope}:${salt}`) so the same `subjectRef` buckets
  independently per scope — fixes cross-tenant assignment correlation.

### Fixed

- Reject zero, fractional, non-finite, negative, and oversized experiment-deletion batches to
  prevent infinite self-scheduling and oversized transactions.
- **Definition immutability (`EXPERIMENT_LOCKED`).** Changing `variants` or `salt` after a subject is
  assigned now throws instead of silently splitting the population across two randomizations. The
  earlier "change salt to re-randomize" claim was incorrect for enrolled subjects and is removed from
  the docs; re-randomize by defining a new experiment key.
