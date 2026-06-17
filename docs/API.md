# API Reference — @vllnt/convex-experiments

**Compatibility:** `convex@^1.41.0`

Construct the client with the mounted component and optional config:

```ts
import { Experiments } from "@vllnt/convex-experiments";

const experiments = new Experiments(components.experiments, {
  defaultScope: "global", // namespace applied when a call omits `scope`
  defaultStatus: "running", // status applied by `define` when a call omits `status`
});
```

All methods take the host `ctx` (a query or mutation context) as the first argument. Variant keys,
weights, statuses, and `subjectRef` are concrete typed values — there is no opaque payload and no
generic to narrow.

**Assignment is deterministic.** A subject's variant is a pure function of `(salt, subjectRef)`,
mapped onto the cumulative-weight line of the experiment's variants — so the same subject always
lands in the same weighted bucket, and the distribution matches the weights. `salt` defaults to the
experiment key; change it to reshuffle every subject's bucket for a clean re-run.

**Time is server-sourced.** Assignment and exposure timestamps are read from the server clock inside
each handler; no method accepts a caller-supplied timestamp.

## Mutations

### `define(ctx, key, opts) → { created: boolean }`

`opts`: `{ variants: { key: string; weight: number }[]; scope?: string; salt?: string; status?: "draft" | "running" | "stopped" }`.

Create or update an experiment, keyed by `(scope, key)`. `variants` are weighted; equal weights split
evenly. `salt` defaults to `key`; `status` defaults to the client `defaultStatus` (`running`).
Returns `{ created: true }` on insert, `{ created: false }` when an existing definition was updated.
Updating changes only the definition — existing sticky assignments are left untouched.

**Validation** — throws `ConvexError({ code: "INVALID_VARIANTS" })` when the variant set is empty, a
weight is not a positive finite number, or a variant key is repeated.

### `setStatus(ctx, key, status, scope?) → boolean`

Move an experiment to a new lifecycle `status` (`draft` | `running` | `stopped`). Returns `false`
when no experiment exists for `(scope, key)`, `true` once patched. Stopping freezes new enrollment
(`assign` returns `{ variant: null }`) while leaving recorded assignments and exposures intact.

### `assign(ctx, key, subjectRef, scope?) → AssignOutcome`

Enroll `subjectRef` and return the sticky variant:

- `{ variant: null }` — the experiment is absent or not `running`; the subject is not enrolled (treat
  as control).
- `{ variant; isNew }` — the enrolled variant key. `isNew` is `true` only on the call that first
  persisted the assignment; later calls replay it with `isNew: false`.

The pick is deterministic, so two concurrent first-`assign` calls for one subject agree on the
variant.

### `logExposure(ctx, key, subjectRef, scope?) → { variant: string | null }`

Record that `subjectRef` was exposed, enrolling them if needed (same sticky path as `assign`), and
return their variant — or `{ variant: null }` when not enrolled. Repeated exposures for one subject
are deduped into a single tallied row (`count` and `lastExposedAt` advance); the distinct-subject
count is what `results` reports.

## Queries

### `getExperiment(ctx, key, scope?) → ExperimentDefinition | null`

The experiment definition (`key`, `scope`, `status`, `variants`, `salt`, `createdAt`) for
`(scope, key)`, or `null` if none exists.

### `getAssignment(ctx, key, subjectRef, scope?) → { variant, assignedAt } | null`

A subject's sticky assignment, or `null` if they are not enrolled. `assignedAt` is the absolute ms
timestamp the assignment was first persisted.

### `results(ctx, key, scope?) → { variant, subjects, exposures }[]`

Per-variant exposure tallies: `subjects` is the distinct subjects exposed to that variant (the funnel
denominator), `exposures` the total exposure events. An experiment with no exposures returns `[]`.
Measure outcomes (conversion, revenue, retention) in your own tables, joined on the variant.

## Error codes

| Code | Thrown by | When |
|------|-----------|------|
| `INVALID_VARIANTS` | `define` | Empty variant set, a non-positive/non-finite weight, or a duplicate variant key. |
