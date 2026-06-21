<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-experiments

Deterministic A/B experimentation — sticky variant assignment and deduped exposure tracking, as a
Convex component. It follows the vllnt Component Standard (see the `oss-packages` hub
`.claude/rules/component-standard.md`).

## Architecture

```
src/
├── shared.ts              # constants + pure deterministic assignment (fnv1a, pickVariant)
├── test.ts                # convex-test register() helper
├── react/
│   └── index.tsx          # optional ./react hooks (useVariant, useAssignment, useExperimentResults)
├── client/
│   ├── index.ts           # Experiments class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
└── component/
    ├── schema.ts           # sandboxed tables: experiments, assignments, exposures, variantTallies
    ├── convex.config.ts    # defineComponent("experiments")
    ├── mutations.ts        # define, setStatus, assign, logExposure, forgetSubject, deleteExperiment
    ├── queries.ts          # getExperiment, listExperiments, getAssignment, peek, results
    └── validators.ts       # shared validators (variant, assignResult, variantResult, …)
```

Sandboxed tables, all keyed by `(scope, experimentKey, …)`, no host tables touched:

- `experiments`    — the definition (`variants`, weights, `status`, `salt`), unique per `(scope, key)`.
- `assignments`    — a subject's sticky variant, persisted on first `assign`.
- `exposures`      — a deduped per-subject exposure row (one row per subject; `count` bumps).
- `variantTallies` — one row per `(scope, experiment, variant)` holding running `assigned` /
  `subjects` (distinct exposed) / `exposures` counts, maintained on write so `results` reads
  O(variants) rows instead of scanning the exposure table.

## Ownership boundary

**Component owns:**

- The four tables — definitions, sticky assignments, the deduped exposure ledger, the variant tallies
- Deterministic weighted assignment — `pickVariant` is a pure function of `(scope:salt, subjectRef)`
- Exposure dedup + the maintained tallies (`assigned`/`subjects`/`exposures` per variant)
- Lifecycle: `draft → running → stopped`; definition immutability once assigned; cascade delete + erasure
- Variant validation (`INVALID_VARIANTS`), the `EXPERIMENT_LOCKED` guard, and server-sourced time

**Host owns:**

- The experiment key, the variant keys and their weights (their meaning)
- `subjectRef` — an opaque identity string; the component never assumes its shape or source
- The **outcome metric** — conversions/revenue/retention live in the host's own tables, joined on
  the variant the component assigned (see `example/convex/example.ts`)
- **Statistical inference** — `results` returns `assigned`/`subjects`/`exposures`/`weight` per variant
  (enough to compute sample-ratio-mismatch); significance/CIs are the host's to compute
- Auth and authorization — who may define, start, stop, enroll, erase, or delete

**Auth:** the component is completely auth-agnostic. The host resolves identity, decides access, and
passes an opaque `subjectRef`. `scope` namespaces per tenant / surface; both are opaque strings.

## Key design decisions

- **Deterministic, sticky assignment (storage-free, then persisted):** `pickVariant` hashes
  `(scope:salt, subjectRef)` with FNV-1a and maps it onto the cumulative-weight line, so the same
  subject always lands in the same weighted bucket — sticky even before anything is written. `assign`
  persists that pick on first sight (and bumps the variant's `assigned` tally); later calls replay it.

- **`scope` is folded into the hash:** the bucket input is `${scope}:${salt}` so the same `subjectRef`
  buckets **independently per scope** — without this, a multi-tenant host running the "same" experiment
  per tenant would correlate every shared subject's assignment.

- **Definition is immutable once assigned (`EXPERIMENT_LOCKED`):** `define`-update may change `status`
  freely, but changing `variants` or `salt` after any subject is assigned throws — it would split the
  population across two randomizations (old subjects bucketed under the old definition, new under the
  new) and orphan tallies. To re-randomize or reweight, define a **new experiment key**. (Earlier docs
  wrongly promised "change salt to re-randomize"; that silently corrupts a live experiment, so it is
  now rejected.)

- **O(variants) `results` via maintained tallies:** `results` reads the `variantTallies` rows — one per
  defined variant — rather than scanning every exposure row, so it doesn't hit Convex read limits or
  trigger a full re-scan on each exposure. It returns `assigned`, distinct `subjects`, total
  `exposures`, and the configured `weight` so a host can run a sample-ratio-mismatch check.

- **`peek` — read-only deterministic assignment:** a query returns a subject's sticky variant
  **without persisting** (stored assignment if present, else the deterministic pick). This is the
  SSR / server-component path and the flicker-free first-paint source for a future React hook; the
  `logExposure` mutation then enrolls + tallies.

- **Lifecycle + erasure:** `deleteExperiment` cascade-deletes the definition + assignments + exposures
  + tallies (bounded, self-rescheduling). `forgetSubject` erases one subject's assignment + exposure
  (decrementing tallies) — the GDPR right-to-erasure primitive for a `subjectRef` that maps to a person.

- **Enrollment gated on `running`:** `assign`/`logExposure`/`peek` return `{ variant: null }` when the
  experiment is absent, `draft`, or `stopped`. Stopping freezes new enrollment while preserving data.

- **Deduped exposure tally:** `logExposure` upserts one row per subject (`count` + timestamps); the
  distinct-subject count is what `results` reports as `subjects`.

- **Assignment vs measurement split (compose, never merge):** this component **assigns** + **counts
  exposure**; it does not own release control (a feature-flag component) nor the conversion metric (the
  host measures in its own tables and joins on the variant).

- **Pure string hash, not `crypto.subtle`:** the component runs in a V8 isolate, so assignment uses a
  synchronous FNV-1a hash — keeping `pickVariant` callable inside a mutation.

- **Fully typed, zero `v.any()`:** variant keys, weights, statuses, and refs are concrete types.

- **Server-sourced time:** every handler reads `Date.now()` itself; no API accepts a caller timestamp.

- **Optional `./react` front-tooling:** thin hooks (`useVariant` on the deterministic `peek` for a
  flicker-free first paint, `useAssignment`, `useExperimentResults`) wrap `useQuery` over the host's
  **re-exported** query refs — the component never owns the host `api`. `react` is an optional peer
  dep (a backend-only consumer pulls none of it); the hooks are render-tested in jsdom at 100%. No
  secret/cross-subject data is exposed (no-leak rule).

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- Concrete typed args throughout — no `v.any()` dumps (none is needed here).
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds: statements, branches, functions, lines).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.

## Project rules

The universal vllnt engineering rules ship in `.claude/rules/` — **synced from the
`oss-packages` hub** (single source; edit them there, not here):

| Rule | Covers |
|------|--------|
| [`code-style.md`](.claude/rules/code-style.md) | Match-surrounding-code, smallest change that works, typed public APIs |
| [`git-workflow.md`](.claude/rules/git-workflow.md) | Branch-first, signed no-reply commits, landing mode, strict checks |
| [`commit-privacy.md`](.claude/rules/commit-privacy.md) | No-reply commit identity; never leak a personal email |
| [`security.md`](.claude/rules/security.md) | Secrets, boundary validation, OWASP, dependency review |
| [`docs-sync.md`](.claude/rules/docs-sync.md) | **BLOCKING** docs stay current with every commit |

The full BLOCKING Component Standard (file/CI/docs/coverage contract) and fleet governance live in
the hub (`oss-packages` `.claude/rules/component-standard.md`) — not duplicated into this repo.

## Docs sync

| Changed | Update in the same commit |
|---------|--------------------------|
| Public API (define/setStatus/assign/logExposure/forgetSubject/deleteExperiment/getExperiment/listExperiments/getAssignment/peek/results) | README API Reference table, `docs/API.md`, `llms.txt` context |
| Config options / defaults (`defaultScope`, `defaultStatus`, `salt`, delete batch) | README API Reference, `docs/API.md` constructor section |
| Schema / tables / indexes | this file (Architecture), README Architecture, `docs/API.md` |
| Error codes (`INVALID_VARIANTS`, `EXPERIMENT_LOCKED`) | `docs/API.md` → `## Error codes` table |
| `peerDependencies.convex` version | `llms.txt` context line (`convex@^X.Y.Z`), `docs/API.md` Compatibility line, README Installation peer note |
| Assignment / exposure / tally semantics | `docs/API.md`, Key design decisions above |

Grep old values before committing (e.g. `git grep "1.36.1"` → must be empty).
