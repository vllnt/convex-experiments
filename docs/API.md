# API Reference — @vllnt/convex-experiments

**Compatibility:** `convex@^1.45.0`; React >=18 is optional. This reference is
bundled with the package and matches the installed version.

Construct the client with the mounted component and optional config:

```ts
import { Experiments } from "@vllnt/convex-experiments";

const experiments = new Experiments(components.experiments, {
  defaultScope: "global", // namespace applied when a call omits `scope`
  defaultStatus: "running", // status applied by `define` when a call omits `status`
});
```

All methods take the host `ctx` (a query or mutation context) as the first
argument. Variant keys, weights, statuses, and `subjectRef` are concrete typed
values — there is no opaque payload and no generic to narrow.

**Assignment is deterministic.** A subject's variant is a pure function of
`(scope, salt, subjectRef)`, mapped onto the cumulative-weight line of the
experiment's variants — so the same subject always lands in the same weighted
bucket, and the distribution matches the weights. `scope` is folded into the
hash so the same `subjectRef` buckets independently in each scope. `salt`
defaults to the experiment key and is **immutable once a subject is assigned**
(see `define`); to re-randomize, define a new experiment key.

**Time is server-sourced.** Assignment and exposure timestamps are read from the
server clock inside each handler; no method accepts a caller-supplied timestamp.

## Mutations

### `define(ctx, key, opts) → { created: boolean }`

`opts`:
`{ variants: { key: string; weight: number }[]; scope?: string; salt?: string; status?: "draft" | "running" | "stopped" }`.

Create or update an experiment, keyed by `(scope, key)`. `variants` are
weighted; equal weights split evenly. `salt` defaults to `key`; `status`
defaults to the client `defaultStatus` (`running`). Returns `{ created: true }`
on insert, `{ created: false }` on update.

**Immutability once assigned.** A `status` transition (start/stop) is always
allowed. Changing `variants` or `salt` after any subject is assigned throws
`EXPERIMENT_LOCKED` — it would split the population across two randomizations
and orphan the tallies. Re-randomize or reweight by defining a new experiment
key.

**Validation.** Throws `ConvexError({ code: "INVALID_VARIANTS", reason })` —
`reason` is `"empty"`, `"too_many"` (more than 100 variants), `"empty_key"`, `"key_too_long"` (over 512
characters), `"non_positive_weight"`, or
`"duplicate_key"` (with the offending `key` where applicable) — for a malformed
variant set. An empty `scope` or `key` throws `INVALID_ARGUMENT`; every mutation
rejects an empty `scope`, `key`, or (where taken) `subjectRef` the same way. Creating an
experiment or a new assignment rejects any of them (or `salt`) longer than 512 characters;
existing longer values remain usable by every mutation, including erasure. Re-defining an unchanged experiment writes nothing.

### `setStatus(ctx, key, status, scope?) → boolean`

Move an experiment to a new lifecycle `status` (`draft` | `running` |
`stopped`). Returns `false` when no experiment exists for `(scope, key)`, `true`
when it exists (a status that is already set writes nothing). Stopping freezes
new enrollment while leaving recorded assignments, exposures, and tallies intact.

### `assign(ctx, key, subjectRef, scope?) → AssignOutcome`

Enroll `subjectRef` and return the sticky variant:

- `{ variant: null }` — the experiment is absent or not `running`; the subject
  is not enrolled (treat as control).
- `{ variant; isNew }` — the enrolled variant key. `isNew` is `true` only on the
  call that first persisted the assignment; later calls replay it with
  `isNew: false`.

The pick is deterministic, so two concurrent first-`assign` calls for one
subject agree on the variant.

### `logExposure(ctx, key, subjectRef, scope?) → { variant: string | null }`

Record that `subjectRef` was exposed, enrolling them if needed, and return their
variant — or `{ variant: null }` when not enrolled. Repeated exposures for one
subject are deduped into a single row; the maintained per-variant tallies
(`subjects`, `exposures`) advance accordingly. Every call increments total
`exposures`; there is no event-idempotency key, so retrying a logical exposure
can count it again.

### `forgetSubject(ctx, key, subjectRef, scope?) → boolean`

Erase a subject's assignment + exposure in one experiment, decrementing the
variant tallies. The GDPR right-to-erasure primitive for a `subjectRef` that
maps to a person. Returns `true` if anything was deleted. Loop over
`listExperiments` to erase a subject across a whole scope.

### `deleteExperiment(ctx, key, opts?) → number`

`opts`: `{ scope?: string; batch?: number }` (`batch` default `200`, integer
1–500; otherwise `INVALID_BATCH`).

Delete an experiment and all of its data — the definition, every assignment,
exposure, and tally row. Bounded: removes up to `batch` rows per table per pass
and self-reschedules until the children are drained, then deletes the
definition (in the same pass, once every table returns fewer than `batch` rows).
Returns the rows removed in the first pass; the definition row is not counted.
Idempotent and safe on an absent experiment.

## Queries

### `getExperiment(ctx, key, scope?) → ExperimentDefinition | null`

The experiment definition (`key`, `scope`, `status`, `variants`, `salt`,
`createdAt`), or `null`.

### `listExperiments(ctx, opts?) → ExperimentDefinition[]`

`opts`: `{ scope?: string; status?: "draft" | "running" | "stopped" }`. Every
experiment in the scope, optionally filtered by `status` — the discovery /
management surface. Not paginated.

### `getAssignment(ctx, key, subjectRef, scope?) → { variant, assignedAt } | null`

A subject's sticky assignment, or `null` if not enrolled.

### `peek(ctx, key, subjectRef, scope?) → { variant: string | null }`

The subject's sticky variant **without persisting** — the stored assignment if
present, else the deterministic pick; `null` when absent or not `running`. Use
it for SSR / server-component render and a flicker-free first paint, then call
`logExposure` to enroll + tally.

### `results(ctx, key, scope?) → { variant, assigned, subjects, exposures, weight }[]`

One row per **defined** variant (O(variants) — reads the maintained tallies,
never scans the exposure table): `assigned` subjects, distinct `subjects`
exposed (the funnel denominator), total `exposures`, and the configured
`weight`. `assigned` + `weight` let a host check sample-ratio-mismatch (observed
vs expected split); significance is the host's to compute. An absent experiment
returns `[]`. Measure outcomes in your own tables, joined on the variant.

## Entry points and types

| Import                                           | Exports                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@vllnt/convex-experiments`                      | The `Experiments` class and the types `ExperimentsComponent`, `ExperimentsOptions`, `DefineOptions`, `ExperimentDefinition`, `ExperimentStatus`, `Variant`, `Assignment`, `AssignOutcome`, `ExposureOutcome`, `VariantResult`. |
| `@vllnt/convex-experiments/convex.config`        | The component definition (default export), passed to `app.use(...)`.                                                                                                                 |
| `@vllnt/convex-experiments/react`                | `useVariant`, `useAssignment`, `useExperimentResults` (below).                                                                                                                       |
| `@vllnt/convex-experiments/test`                 | `register(t, name = "experiments")`, to mount the component in a `convex-test` instance.                                                                                             |
| `@vllnt/convex-experiments/_generated/component` | The `ComponentApi` type (types only).                                                                                                                                                |

### React hooks

Each hook wraps `useQuery` over a public query reference **the host re-exports**
from its own `convex/` folder; the component never owns the host `api`. `scope`
is optional in the args type; whether it reaches the client call depends on the
host wrapper, and the client `defaultScope` applies when it is omitted. `react`
is an optional peer dependency.

| Hook                                     | Wraps           | Returns                                                                          |
| ---------------------------------------- | --------------- | -------------------------------------------------------------------------------- |
| `useVariant(peekRef, args)`              | `peek`          | `string \| null \| undefined` (variant, not enrolled, loading)                   |
| `useAssignment(getAssignmentRef, args)`  | `getAssignment` | `Assignment \| null \| undefined` (assignment, not enrolled, loading)             |
| `useExperimentResults(resultsRef, args)` | `results`       | `VariantResult[] \| undefined` (tallies, loading)                                |

`args` is `{ scope?: string; key: string; subjectRef: string }`, except for
`useExperimentResults`, which takes `{ scope?: string; key: string }`.

### Test helper

`register(t, name = "experiments")` calls `t.registerComponent` with the
component schema and modules. The consuming app needs `convex-test` and Vite's
`import.meta.glob` (for example through `vitest`).

## Error codes

| Code                | Thrown by          | When                                                                                                                                        |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`  | every mutation     | `scope`, `key`, or `subjectRef` (where taken) is an empty string, or new data has one (or `salt`) over 512 characters.                      |
| `INVALID_VARIANTS`  | `define`           | Empty or over-100 variant set, an empty or over-512-character variant key, a non-positive/non-finite weight, or a duplicate variant key (`reason` + `key` in the error data). |
| `INVALID_BATCH`     | `deleteExperiment` | Batch is not an integer in 1–500.                                                                                                           |
| `EXPERIMENT_LOCKED` | `define`           | `variants` or `salt` changed after a subject was assigned. Define a new experiment key to re-randomize.                                     |
