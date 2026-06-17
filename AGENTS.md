<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-experiments

Deterministic A/B experimentation — sticky variant assignment and deduped exposure tracking, as a
Convex component. It follows the vllnt Component Standard (see the `convex-components` hub
`.claude/rules/component-standard.md`).

## Architecture

```
src/
├── shared.ts              # constants + pure deterministic assignment (fnv1a, pickVariant)
├── test.ts                # convex-test register() helper
├── client/
│   ├── index.ts           # Experiments class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
└── component/
    ├── schema.ts           # sandboxed tables: experiments, assignments, exposures
    ├── convex.config.ts    # defineComponent("experiments")
    ├── mutations.ts        # define, setStatus, assign, logExposure
    ├── queries.ts          # getExperiment, getAssignment, results
    └── validators.ts       # shared validators (variant, assignResult, variantResult, …)
```

Sandboxed tables, all keyed by `(scope, experimentKey, …)`, no host tables touched:

- `experiments` — the definition (`variants`, weights, `status`, `salt`), unique per `(scope, key)`.
- `assignments` — a subject's sticky variant, persisted on first `assign`.
- `exposures` — a deduped per-subject exposure tally (one row per subject; `count` bumps).

## Ownership boundary

**Component owns:**

- The three tables — definitions, sticky assignments, the deduped exposure ledger
- Deterministic weighted assignment — `pickVariant` is a pure function of `(salt, subjectRef)`
- Exposure dedup — one row per `(scope, experiment, subject)`; `results` reports distinct subjects
- Lifecycle: `draft → running → stopped` — only `running` enrolls
- Variant validation (`INVALID_VARIANTS`) and server-sourced time

**Host owns:**

- The experiment key, the variant keys and their weights (their meaning)
- `subjectRef` — an opaque identity string; the component never assumes its shape or source
- The **outcome metric** — conversions/revenue/retention live in the host's own tables, joined on
  the variant the component assigned (see `example/convex/example.ts`)
- Auth and authorization — who may define, start, stop, or enroll

**Auth:** the component is completely auth-agnostic. The host resolves identity, decides access, and
passes an opaque `subjectRef`. `scope` namespaces per tenant / surface; both are opaque strings.

## Key design decisions

- **Deterministic, sticky assignment (storage-free, then persisted):** `pickVariant(variants, salt,
  subjectRef)` hashes `(salt, subjectRef)` with FNV-1a and maps it onto the cumulative-weight line,
  so the same subject always lands in the same weighted bucket — sticky even before anything is
  written. `assign` persists that pick on first sight for a queryable, auditable record; later calls
  replay it (`isNew: false`).

- **Pure string hash, not `crypto.subtle`:** the component runs in a V8 isolate, so assignment uses a
  synchronous FNV-1a hash rather than the async Web Crypto API — keeping `pickVariant` a plain
  function callable inside a mutation.

- **Enrollment gated on `running`:** `assign`/`logExposure` return `{ variant: null }` when the
  experiment is absent, `draft`, or `stopped` — the host treats null as control. Stopping freezes new
  enrollment while leaving recorded assignments and exposures intact (an analysis of an experiment you
  stopped still reads correctly).

- **Deduped exposure tally:** `logExposure` upserts a single row per subject (`count` + timestamps),
  so `results` reports **distinct subjects** per variant (the funnel denominator) alongside total
  exposure events — without storing one row per event.

- **Assignment vs measurement split (compose, never merge):** this component **assigns** a variant
  and **counts exposure**; it deliberately does not own release control (kill-switches, % rollout —
  that pairs with a feature-flag component) nor the conversion metric (the host measures outcomes in
  its own tables and joins on the variant). Merging assignment with flagging is the classic
  experimentation anti-pattern.

- **`salt` re-randomizes without re-keying:** `salt` defaults to the experiment key; changing it
  reshuffles every subject's bucket for a clean re-run without touching subject ids.

- **Fully typed, zero `v.any()`:** variant keys, weights, statuses, and refs are all concrete types —
  there is no opaque host payload to store, so the component needs no `jsonValue` escape hatch.

- **Server-sourced time:** every handler reads `Date.now()` itself; no API accepts a caller-supplied
  timestamp.

- **Backend-only at 0.1.0 (no `./react` entry):** assignment + exposure are recorded server-side. A
  reactive `useExperiment` / `useAssignment` read surface is a real future addition (a subject seeing
  "their" variant client-side) — deferred until a first consumer asks for it, per the front-tooling
  analysis in the README.

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- Concrete typed args throughout — no `v.any()` dumps (none is needed here).
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds: statements, branches, functions, lines).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.

## Project rules

The universal vllnt engineering rules ship in `.claude/rules/` — **synced from the
`convex-components` hub** (single source; edit them there, not here):

| Rule | Covers |
|------|--------|
| [`code-style.md`](.claude/rules/code-style.md) | Match-surrounding-code, smallest change that works, typed public APIs |
| [`git-workflow.md`](.claude/rules/git-workflow.md) | Branch-first, signed no-reply commits, landing mode, strict checks |
| [`commit-privacy.md`](.claude/rules/commit-privacy.md) | No-reply commit identity; never leak a personal email |
| [`security.md`](.claude/rules/security.md) | Secrets, boundary validation, OWASP, dependency review |
| [`docs-sync.md`](.claude/rules/docs-sync.md) | **BLOCKING** docs stay current with every commit |

The full BLOCKING Component Standard (file/CI/docs/coverage contract) and fleet governance live in
the hub (`convex-components` `.claude/rules/component-standard.md`) — not duplicated into this repo.

## Docs sync

| Changed | Update in the same commit |
|---------|--------------------------|
| Public API (define/setStatus/assign/logExposure/getExperiment/getAssignment/results signatures) | README API Reference table, `docs/API.md`, `llms.txt` context, regenerate `llms-full.txt` |
| Config options / defaults (`defaultScope`, `defaultStatus`, `salt`) | README API Reference, `docs/API.md` constructor section |
| Schema / tables / indexes | this file (Architecture), README Architecture, `docs/API.md` |
| Error codes | `docs/API.md` → `## Error codes` table |
| `peerDependencies.convex` version | `llms.txt` context line (`convex@^X.Y.Z`), `docs/API.md` Compatibility line, README Installation peer note |
| Assignment / exposure semantics | `docs/API.md`, Key design decisions above |
| Any change | `pnpm generate:llms` to keep `llms-full.txt` current |

Grep old values before committing (e.g. `git grep "1.36.1"` → must be empty).
