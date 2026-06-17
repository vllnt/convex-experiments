# Roadmap — @vllnt/convex-experiments

This component's own roadmap. Phases are immutable kebab-case **outcome slugs**; tasks have stable
`slug.N` IDs. History is never deleted — completed and dropped work stays for the record.

**Status vocabulary:** `planned` · `in-progress` · `done` · `blocked` · `dropped`

> Hub-level milestones (creation, fleet programs, the canary→stable hold) live in the
> `vllnt/convex-components` hub `ROADMAP.md`. This file tracks only this package's own work.

---

## ship-core-assignment — `done`

Deterministic sticky assignment + deduped exposure, shipped at 0.1.0 (canary).

- `ship-core-assignment.1` — `done` — `define` / `setStatus` lifecycle (`draft → running → stopped`), `INVALID_VARIANTS` validation.
- `ship-core-assignment.2` — `done` — deterministic weighted assignment (`fnv1a` + `pickVariant`), sticky pre-persistence, persisted on first `assign`.
- `ship-core-assignment.3` — `done` — `logExposure` deduped per-subject tally; `results` distinct-subjects + total-exposures aggregation.
- `ship-core-assignment.4` — `done` — `getExperiment` / `getAssignment` projections; scope namespacing; server-sourced time.
- `ship-core-assignment.5` — `done` — 100% E2E coverage via the `example/` host harness (happy + adversarial), lint/typecheck/build green.
- `ship-core-assignment.6` — `done` — standard repo: CI, canary `publish.yml`, docs set, `.claude/rules`, repo hardening.

## harden-correctness — `done`

Implemented from the 2026-06-17 multi-perspective review (5 reviewers). Shipped at 0.1.0 (canary),
100% coverage maintained.

- `harden-correctness.1` — `done` — **`EXPERIMENT_LOCKED` guard**: `variants`/`salt` immutable once a subject is assigned (removed the false "change salt to re-randomize" claim that silently split the population).
- `harden-correctness.2` — `done` — **`scope` folded into the assignment hash** (`${scope}:${salt}`) — fixes cross-tenant assignment correlation.
- `harden-correctness.3` — `done` — **`results` is O(variants)** via a maintained `variantTallies` table (no exposure-table scan / read-limit failure) and returns `assigned` + `weight` for sample-ratio-mismatch.
- `harden-correctness.4` — `done` — **lifecycle + GDPR**: `deleteExperiment` (cascade, self-rescheduling), `forgetSubject` (erasure), `listExperiments` (discovery).
- `harden-correctness.5` — `done` — **`peek`** (read-only deterministic assignment for SSR / flicker-free paint); `INVALID_VARIANTS` carries a `reason`.

> Deferred to later phases (design-sized, not half-built): layers/universes + holdouts
> (`assignment-strategies`), full significance/SRM stats + sequential testing
> (`results-and-significance`), the `./react` hooks built on `peek` (`reactive-read-surface`),
> typed-variant generics, segmentation dimensions, and sharded-counter write-sharding for the tallies.

## reactive-read-surface — `planned`

Optional `./react` tooling, decided by the front-tooling analysis once a real consumer needs a
client-side variant read.

- `reactive-read-surface.1` — `planned` — re-run the front-tooling usage analysis when the first consumer lands (server-only vs reactive display).
- `reactive-read-surface.2` — `planned` — `useExperiment` / `useAssignment` hooks over re-exported host refs; render-tested + coverage-included; tree-shakeable optional peer deps.

## results-and-significance — `planned`

Richer measurement helpers, without owning the host's outcome metric.

- `results-and-significance.1` — `planned` — optional conversion-binding helper (host records the outcome; component joins exposure ↔ outcome on the variant).
- `results-and-significance.2` — `planned` — confidence / significance summary over `results` (evaluate composing `@convex-dev/aggregate` for large exposure sets vs in-query grouping).
- `results-and-significance.3` — `done` — guard against unbounded `results` scans (now O(variants) via `variantTallies`; see `harden-correctness.3`). Sharded-counter write-sharding remains a follow-up.

## assignment-strategies — `planned`

Beyond a single weighted split.

- `assignment-strategies.1` — `planned` — mutually-exclusive experiment groups / holdouts (a subject in at most one of a set).
- `assignment-strategies.2` — `planned` — targeting predicates evaluated host-side before enrollment (keep auth/domain in the host).
- `assignment-strategies.3` — `planned` — investigate multi-armed / adaptive allocation (likely a separate opt-in mode, not the default).

## first-stable-release — `blocked`

Promote 0.1.0 (canary) to the first stable release.

- `first-stable-release.1` — `blocked` — needs a real 2nd consumer to satisfy the hub Rule of Three (0.1.0 shipped as an owner-sanctioned override of the graduation hold).
- `first-stable-release.2` — `blocked` — depends on `reactive-read-surface` + `results-and-significance` settling the public API before a 1.0.0 commitment.
