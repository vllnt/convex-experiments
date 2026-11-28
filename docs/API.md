# API Reference — @vllnt/convex-experiments

**Compatibility:** `convex@^1.45.0`; React >=18 is optional. This reference is
bundled with the package and matches the installed version.

## Entry points

| Import                                           | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vllnt/convex-experiments`                      | The [`Experiments`](#experiments) class and the types [`ExperimentsComponent`](#experimentscomponent), [`ExperimentsOptions`](#experimentsoptions), [`DefineOptions`](#defineoptions), [`ExperimentDefinition`](#experimentdefinition), [`ExperimentStatus`](#experimentstatus), [`Variant`](#variant), [`Assignment`](#assignment), [`AssignOutcome`](#assignoutcome), [`ExposureOutcome`](#exposureoutcome), [`VariantResult`](#variantresult). |
| `@vllnt/convex-experiments/convex.config`        | The component definition ([default export](#convexconfig)), passed to `app.use(...)`.                                                                                                                                                                                                                                                                                                                                                             |
| `@vllnt/convex-experiments/react`                | [`useVariant`](#usevariant), [`useAssignment`](#useassignment), [`useExperimentResults`](#useexperimentresults).                                                                                                                                                                                                                                                                                                                                  |
| `@vllnt/convex-experiments/test`                 | [`register`](#register), to mount the component in a `convex-test` instance.                                                                                                                                                                                                                                                                                                                                                                      |
| `@vllnt/convex-experiments/_generated/component` | The [`ComponentApi`](#componentapi) type (types only).                                                                                                                                                                                                                                                                                                                                                                                            |

## Client

### `Experiments`

`new Experiments(component, options?)`

- `component`: the mount's function references, `components.experiments` (or
  `components.<name>` for `app.use(experiments, { name })`).
- `options`: [`ExperimentsOptions`](#experimentsoptions):
  `defaultScope` (default `"global"`) is the scope used when a call omits
  `scope`; `defaultStatus` (default `"running"`) is the status `define` uses
  when a call omits `status`.

```ts
// convex/experiments.ts
import { Experiments } from "@vllnt/convex-experiments";

import { components } from "./_generated/api";

export const experiments = new Experiments(components.experiments, {
  defaultScope: "global",
  defaultStatus: "running",
});
```

All methods take the host `ctx` (a query or mutation context; mutations need a
mutation context) as the first argument and return a `Promise`. Variant keys,
weights, statuses and `subjectRef` are concrete typed values; there is no
generic to narrow.

**Assignment is deterministic.** A subject's variant is
`pickVariant(variants, "<scope>:<salt>", subjectRef)` (an internal function in
`src/shared.ts`, not exported by any entry point): a 32-bit FNV-1a hash of
`"<scope>:<salt>:<subjectRef>"`, computed over its UTF-16 code units
(`charCodeAt`) rather than UTF-8 bytes, mapped onto the cumulative-weight line of
the experiment's variants, in their defined order. The same subject always lands in
the same weighted bucket, and `scope` is part of the input, so one `subjectRef`
buckets independently in each scope. `salt` defaults to the experiment key and
is fixed once a subject is assigned (see [`define`](#define)).

**Time is server-sourced.** `createdAt`, `assignedAt` and exposure timestamps
are read from the server clock inside each handler; no method accepts a
caller-supplied timestamp.

**Empty identifiers.** Every mutation throws `INVALID_ARGUMENT` for an empty
`scope`, `key` or (where taken) `subjectRef`. Queries do not validate empty
identifiers. An empty `scope` or `key` finds no experiment, because mutations
never store one, so the query returns `null`, `{ variant: null }` or `[]`. An
empty `subjectRef` is different: `peek(ctx, key, "")` on a `running` experiment
returns a real variant (the deterministic pick for the empty string).

### `define`

`define(ctx, key, opts) → Promise<{ created: boolean }>` (mutation)

`opts`: [`DefineOptions`](#defineoptions) `& { variants: Variant[] }`, that is
`{ variants: { key: string; weight: number }[]; scope?: string; salt?: string; status?: "draft" | "running" | "stopped" }`.

Create or update an experiment, keyed by `(scope, key)`. Each variant's share is
`weight / sum(weights)`; equal weights split evenly. `salt` defaults to `key`;
`status` defaults to the client `defaultStatus` (`"running"`, so enrollment
starts at once). Returns `{ created: true }` on insert and `{ created: false }`
on update. Re-defining with unchanged `variants`, `salt` and `status` writes
nothing.

**Re-running `define` resets `status`.** The client always sends
`status: opts.status ?? defaultStatus`, and the update path writes that status.
So calling `define` again without `status` on a `stopped` (or `draft`)
experiment sets it back to the client `defaultStatus` (`"running"` by default)
and restarts enrollment. Pass `status` explicitly when re-running `define`, or
use [`setStatus`](#setstatus) for lifecycle changes.

**Immutable once assigned.** A `status` change is always allowed. Changing
`variants` (keys, weights or order) or `salt` while the experiment has at least
one assignment throws `EXPERIMENT_LOCKED`: it would split the population across
two randomizations. To re-randomize or reweight, define a new experiment key.

**Validation.** Throws `ConvexError({ code: "INVALID_VARIANTS", reason })` for a
malformed variant set: `reason` is `"empty"`, `"empty_key"`,
`"non_positive_weight"` (with the variant `key`; weights must be positive and
finite) or `"duplicate_key"` (with the `key`). An empty `scope` or `key` throws
`INVALID_ARGUMENT`.

### `setStatus`

`setStatus(ctx, key, status, scope?) → Promise<boolean>` (mutation)

Move an experiment to `"draft"`, `"running"` or `"stopped"`. Returns `false`
when no experiment exists for `(scope, key)` and `true` when it exists (setting
the current status writes nothing). Stopping freezes new enrollment and leaves
assignments, exposures and tallies intact.

### `assign`

`assign(ctx, key, subjectRef, scope?) → Promise<AssignOutcome>` (mutation)

Enroll `subjectRef` and return the sticky variant:

- `{ variant: null }`: the experiment is absent or not `running`; nothing is
  written (treat as control).
- `{ variant, isNew }`: the enrolled variant key. `isNew` is `true` only on the
  call that first stored the assignment (and added 1 to the variant's
  `assigned` tally); later calls return the stored variant with `isNew: false`.

### `logExposure`

`logExposure(ctx, key, subjectRef, scope?) → Promise<ExposureOutcome>` (mutation)

Record that `subjectRef` was exposed, enrolling them first if needed, and return
`{ variant }`, or `{ variant: null }` when the experiment is absent or not
`running` (nothing is written). One exposure row is kept per subject (its
`count` grows). The first exposure adds 1 to the variant's `subjects` and
`exposures`; later ones add 1 to `exposures` only. There is no idempotency key,
so a retried call counts again.

### `forgetSubject`

`forgetSubject(ctx, key, subjectRef, scope?) → Promise<boolean>` (mutation)

Delete the subject's assignment and exposure rows in one experiment and lower
the variant tallies (`assigned`, `subjects`, `exposures`) to match. Returns
`true` if any row was deleted. Works whatever the experiment's status. Loop over
[`listExperiments`](#listexperiments) to erase a subject across a scope. A later
`assign` or `logExposure` enrolls the subject again.

### `deleteExperiment`

`deleteExperiment(ctx, key, opts?) → Promise<number>` (mutation)

`opts`: `{ scope?: string; batch?: number }`. `batch` defaults to `200` and must
be an integer in 1..500, otherwise `INVALID_BATCH`.

Delete an experiment and all of its data: the definition and every assignment,
exposure and tally row. Each pass deletes up to `batch` rows from each of the
three child tables. When any of them returned a full `batch`, the pass schedules
another pass; otherwise it also deletes the definition. Returns the child rows
removed by the first pass (the definition row is not counted). Safe on an absent
experiment (returns `0`). The definition exists until the last pass, so a
`running` experiment keeps enrolling during a multi-pass delete; stop it first.

### `getExperiment`

`getExperiment(ctx, key, scope?) → Promise<ExperimentDefinition | null>` (query)

The [`ExperimentDefinition`](#experimentdefinition), or `null`.

### `listExperiments`

`listExperiments(ctx, opts?) → Promise<ExperimentDefinition[]>` (query)

`opts`: `{ scope?: string; status?: "draft" | "running" | "stopped" }`. Every
experiment in one scope (the client `defaultScope` when omitted), optionally
filtered by `status`. Not paginated: it reads every experiment in the scope.

### `getAssignment`

`getAssignment(ctx, key, subjectRef, scope?) → Promise<Assignment | null>` (query)

The stored [`Assignment`](#assignment) `{ variant, assignedAt }`, or `null` if
the subject has none. Returns stored assignments whatever the experiment's
status.

### `peek`

`peek(ctx, key, subjectRef, scope?) → Promise<ExposureOutcome>` (query)

The subject's variant **without writing**: the stored assignment if present,
else the deterministic pick that `assign` would store. `{ variant: null }` when
the experiment is absent or not `running`. Use it for server rendering and a
first paint without a flash of the control, then call `logExposure` to enroll
and count.

### `results`

`results(ctx, key, scope?) → Promise<VariantResult[]>` (query)

One [`VariantResult`](#variantresult) row per **defined** variant, in definition
order, read from the maintained tallies (O(variants); the exposure table is never
scanned): `assigned` subjects, distinct exposed `subjects`, total `exposures`
and the configured `weight`. Rows are zeroed before anyone enrolls. An absent
experiment returns `[]`. `assigned` and `weight` let a host check for a
sample-ratio mismatch; significance is the host's to compute. Measure outcomes
in your own tables, joined on the variant.

## Types

### `ExperimentsComponent`

The type of `components.experiments`: the component's mutation (`define`,
`setStatus`, `assign`, `logExposure`, `forgetSubject`, `deleteExperiment`) and
query (`getExperiment`, `listExperiments`, `getAssignment`, `peek`, `results`)
function references.

### `ExperimentsOptions`

`{ defaultScope?: string; defaultStatus?: ExperimentStatus }`. Defaults:
`"global"` and `"running"`.

### `DefineOptions`

`{ scope?: string; salt?: string; status?: ExperimentStatus }`: per-call
overrides for `define`. `salt` defaults to the experiment key.

### `ExperimentDefinition`

`{ key: string; scope: string; status: ExperimentStatus; variants: Variant[]; salt: string; createdAt: number }`.
`createdAt` is the server time in ms of the first `define`.

### `ExperimentStatus`

`"draft" | "running" | "stopped"`. Only `running` enrolls subjects.

### `Variant`

`{ key: string; weight: number }`. `weight` is relative: the bucket width is
`weight / sum(weights)`.

### `Assignment`

`{ variant: string; assignedAt: number }`. `assignedAt` is the server time in ms
the assignment was first stored.

### `AssignOutcome`

`{ variant: null } | { variant: string; isNew: boolean }`.

### `ExposureOutcome`

`{ variant: string | null }`, returned by `logExposure` and `peek`.

### `VariantResult`

`{ variant: string; assigned: number; subjects: number; exposures: number; weight: number }`.

## React hooks

Each hook wraps `useQuery` from `convex/react` over a public query reference
**the host exports** from its own `convex/` folder; the component never owns the
host `api`. `scope` is optional in the args type; whether it reaches the client
call depends on the host wrapper. `react` is an optional peer dependency.

### `useVariant`

`useVariant(peekRef, args) → string | null | undefined`

Wraps a host query that calls `peek`. Returns the variant, `null` when the
experiment is absent or not `running`, or `undefined` while loading.
`args`: `{ scope?: string; key: string; subjectRef: string }`.

### `useAssignment`

`useAssignment(getAssignmentRef, args) → Assignment | null | undefined`

Wraps a host query that calls `getAssignment`. `args`:
`{ scope?: string; key: string; subjectRef: string }`.

### `useExperimentResults`

`useExperimentResults(resultsRef, args) → VariantResult[] | undefined`

Wraps a host query that calls `results`. `args`: `{ scope?: string; key: string }`.

## Other entry points

### `convex.config`

The default export of `@vllnt/convex-experiments/convex.config` is the
component definition (`defineComponent("experiments")`). Pass it to
`app.use(experiments)`, or `app.use(experiments, { name })` for a named mount.

### `register`

`register(t, name = "experiments") → void`, from `@vllnt/convex-experiments/test`.
Calls `t.registerComponent(name, schema, modules)` with the component's schema
and modules. `t` is the host app's own `convexTest(hostSchema, modules)`
instance, whatever its tables. The entry ships as TypeScript source and needs
`convex-test` and Vite's `import.meta.glob` (for example through `vitest`).

### `ComponentApi`

The generated type of the mounted component, from
`@vllnt/convex-experiments/_generated/component` (types only).

## Error codes

Thrown as `ConvexError` with `data` `{ code, message }` (plus `reason` and, where
it applies, `key` for `INVALID_VARIANTS`).

| Code                | Thrown by          | When                                                                                                                                                                                   |
| ------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`  | every mutation     | `scope`, `key`, or `subjectRef` (where taken) is an empty string.                                                                                                                      |
| `INVALID_VARIANTS`  | `define`           | `reason`: `"empty"` (no variants), `"empty_key"` (a variant key is `""`), `"non_positive_weight"` (a weight is not positive and finite), `"duplicate_key"` (two variants share a key). |
| `INVALID_BATCH`     | `deleteExperiment` | `batch` is not an integer in 1..500.                                                                                                                                                   |
| `EXPERIMENT_LOCKED` | `define`           | `variants` or `salt` changed while the experiment has at least one assignment. Define a new experiment key to re-randomize.                                                            |
