# @vllnt/convex-experiments

Deterministic A/B testing for Convex: sticky weighted variant assignment, deduped exposure tracking and per-variant tallies, as a Convex component.

## For coding agents

Docs for the installed version are in `node_modules/@vllnt/convex-experiments/`:
`docs/API.md`, `llms.txt`, `CHANGELOG.md` and the TypeScript `src/`. Read them
before writing code against this package.

## When to use

- Use it when every subject (user, device, team) must get one variant of an
  experiment, and the same one on every later call.
- Use it when traffic is split by relative weights (`1:1`, `90:10`, N-way) and
  you need per-variant counts of assigned subjects, exposed subjects and exposures.
- Use it when a server render or first paint needs the subject's variant before
  anything is written (`peek`).
- Do not use it when you need release control, gradual rollouts, targeting rules
  or kill-switches: use a feature-flag system.
- Do not use it when you need to store outcomes (conversions, revenue,
  retention): use your own tables or an analytics event store, joined on the
  assigned variant.
- Do not use it when you need significance tests or confidence intervals: use a
  statistics tool on the counts that `results` returns.

## Install

```bash
pnpm add @vllnt/convex-experiments
```

## Quick start

```ts
// convex/convex.config.ts
import experiments from "@vllnt/convex-experiments/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(experiments);
export default app;
```

```ts
// convex/checkout.ts
import { Experiments } from "@vllnt/convex-experiments";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";

const experiments = new Experiments(components.experiments);

export const setup = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const { created } = await experiments.define(ctx, "checkout_button", {
      variants: [
        { key: "control", weight: 1 },
        { key: "one_click", weight: 1 },
      ],
    });
    return created;
  },
});

export const checkoutVariant = mutation({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    const { variant } = await experiments.logExposure(
      ctx,
      "checkout_button",
      user.tokenIdentifier,
    );
    return variant;
  },
});
```

Run `npx convex dev` once to generate `components.experiments`, then
`npx convex run checkout:setup`. `checkoutVariant` enrolls the caller on first
call and returns the same variant afterwards. It returns `null` when the
experiment is absent, `draft` or `stopped`: render your control. The component
never reads auth; the host derives `subjectRef` (here the user's
`tokenIdentifier`).

## API

Full reference: [docs/API.md](docs/API.md).

| Export                                                                     | Import from                                      | What it does                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [`Experiments`](docs/API.md#experiments)                                   | `@vllnt/convex-experiments`                      | Host client: `new Experiments(components.experiments, { defaultScope, defaultStatus })` |
| [`define(ctx, key, opts)`](docs/API.md#define)                             | `Experiments` method, mutation                   | Create or update an experiment; returns `{ created }`                                   |
| [`setStatus(ctx, key, status, scope?)`](docs/API.md#setstatus)             | `Experiments` method, mutation                   | Set `draft`, `running` or `stopped`; returns `false` when absent                        |
| [`assign(ctx, key, subjectRef, scope?)`](docs/API.md#assign)               | `Experiments` method, mutation                   | Enroll a subject; returns `{ variant: null }` or `{ variant, isNew }`                   |
| [`logExposure(ctx, key, subjectRef, scope?)`](docs/API.md#logexposure)     | `Experiments` method, mutation                   | Enroll if needed and count one exposure; returns `{ variant }`                          |
| [`forgetSubject(ctx, key, subjectRef, scope?)`](docs/API.md#forgetsubject) | `Experiments` method, mutation                   | Delete one subject's assignment and exposure rows; returns `boolean`                    |
| [`deleteExperiment(ctx, key, opts?)`](docs/API.md#deleteexperiment)        | `Experiments` method, mutation                   | Delete the experiment and all its rows in batches; returns the first pass's row count   |
| [`getExperiment(ctx, key, scope?)`](docs/API.md#getexperiment)             | `Experiments` method, query                      | The definition, or `null`                                                               |
| [`listExperiments(ctx, opts?)`](docs/API.md#listexperiments)               | `Experiments` method, query                      | Every experiment in one scope, optionally filtered by status                            |
| [`getAssignment(ctx, key, subjectRef, scope?)`](docs/API.md#getassignment) | `Experiments` method, query                      | The stored assignment `{ variant, assignedAt }`, or `null`                              |
| [`peek(ctx, key, subjectRef, scope?)`](docs/API.md#peek)                   | `Experiments` method, query                      | The subject's variant without writing; returns `{ variant }`                            |
| [`results(ctx, key, scope?)`](docs/API.md#results)                         | `Experiments` method, query                      | One `{ variant, assigned, subjects, exposures, weight }` row per defined variant        |
| [`ExperimentsComponent`](docs/API.md#experimentscomponent)                 | `@vllnt/convex-experiments` (type)               | Type of `components.experiments`                                                        |
| [`ExperimentsOptions`](docs/API.md#experimentsoptions)                     | `@vllnt/convex-experiments` (type)               | `{ defaultScope?, defaultStatus? }`                                                     |
| [`DefineOptions`](docs/API.md#defineoptions)                               | `@vllnt/convex-experiments` (type)               | `{ scope?, salt?, status? }` for `define`                                               |
| [`ExperimentDefinition`](docs/API.md#experimentdefinition)                 | `@vllnt/convex-experiments` (type)               | Result of `getExperiment` and `listExperiments`                                         |
| [`ExperimentStatus`](docs/API.md#experimentstatus)                         | `@vllnt/convex-experiments` (type)               | `"draft" \| "running" \| "stopped"`                                                     |
| [`Variant`](docs/API.md#variant)                                           | `@vllnt/convex-experiments` (type)               | `{ key, weight }`                                                                       |
| [`Assignment`](docs/API.md#assignment)                                     | `@vllnt/convex-experiments` (type)               | Result of `getAssignment`                                                               |
| [`AssignOutcome`](docs/API.md#assignoutcome)                               | `@vllnt/convex-experiments` (type)               | Result of `assign`                                                                      |
| [`ExposureOutcome`](docs/API.md#exposureoutcome)                           | `@vllnt/convex-experiments` (type)               | Result of `logExposure` and `peek`                                                      |
| [`VariantResult`](docs/API.md#variantresult)                               | `@vllnt/convex-experiments` (type)               | One row of `results`                                                                    |
| [`useVariant`](docs/API.md#usevariant)                                     | `@vllnt/convex-experiments/react`                | React hook over your `peek` wrapper; `string \| null \| undefined`                      |
| [`useAssignment`](docs/API.md#useassignment)                               | `@vllnt/convex-experiments/react`                | React hook over your `getAssignment` wrapper; `Assignment \| null \| undefined`         |
| [`useExperimentResults`](docs/API.md#useexperimentresults)                 | `@vllnt/convex-experiments/react`                | React hook over your `results` wrapper; `VariantResult[] \| undefined`                  |
| [`default` (component config)](docs/API.md#convexconfig)                   | `@vllnt/convex-experiments/convex.config`        | Pass to `app.use(...)`                                                                  |
| [`register`](docs/API.md#register)                                         | `@vllnt/convex-experiments/test`                 | Mount the component in a `convex-test` instance                                         |
| [`ComponentApi`](docs/API.md#componentapi)                                 | `@vllnt/convex-experiments/_generated/component` | Generated type of the mounted component                                                 |

## Common tasks

Stop an experiment and read its counts. `assigned` and `weight` per variant are
enough to check for a sample-ratio mismatch (observed vs expected split):

```ts
// convex/admin.ts
import { Experiments } from "@vllnt/convex-experiments";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";

const experiments = new Experiments(components.experiments);

export const stop = internalMutation({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: (ctx, { key }) => experiments.setStatus(ctx, key, "stopped"),
});

export const counts = internalQuery({
  args: { key: v.string() },
  returns: v.array(
    v.object({
      variant: v.string(),
      assigned: v.number(),
      subjects: v.number(),
      exposures: v.number(),
      weight: v.number(),
    }),
  ),
  handler: (ctx, { key }) => experiments.results(ctx, key),
});
```

Record an outcome in your own table, joined on the assigned variant:

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  conversions: defineTable({
    experimentKey: v.string(),
    variant: v.string(),
    subjectRef: v.string(),
  }).index("by_experiment_variant", ["experimentKey", "variant"]),
});
```

```ts
// convex/conversions.ts
import { Experiments } from "@vllnt/convex-experiments";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { mutation } from "./_generated/server";

const experiments = new Experiments(components.experiments);

export const recordPurchase = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    const assignment = await experiments.getAssignment(
      ctx,
      "checkout_button",
      user.tokenIdentifier,
    );
    if (assignment !== null) {
      await ctx.db.insert("conversions", {
        experimentKey: "checkout_button",
        variant: assignment.variant,
        subjectRef: user.tokenIdentifier,
      });
    }
    return null;
  },
});
```

Paint the right variant on first render in React. The hooks take a query
reference that you export from your own `convex/` folder:

```ts
// convex/experiments.ts
import { Experiments } from "@vllnt/convex-experiments";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { query } from "./_generated/server";

const experiments = new Experiments(components.experiments);

export const variant = query({
  args: { key: v.string(), subjectRef: v.string() },
  returns: v.object({ variant: v.union(v.string(), v.null()) }),
  handler: async (ctx, { key, subjectRef }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user?.tokenIdentifier !== subjectRef)
      throw new ConvexError("not allowed");
    return experiments.peek(ctx, key, subjectRef);
  },
});
```

```tsx
// src/CheckoutButton.tsx
import { useVariant } from "@vllnt/convex-experiments/react";

import { api } from "../convex/_generated/api";

export function CheckoutButton({ subjectRef }: { subjectRef: string }) {
  const variant = useVariant(api.experiments.variant, {
    key: "checkout_button",
    subjectRef,
  });
  if (variant === undefined) return null;
  return (
    <button type="button">
      {variant === "one_click" ? "Buy now" : "Checkout"}
    </button>
  );
}
```

`useVariant` reads `peek`, which writes nothing. Call a `logExposure` mutation
(such as `checkoutVariant` above) when the variant is shown, to enroll and count.

Erase one user from every experiment in a scope, and delete a finished
experiment. `forgetSubject` works on one experiment, so loop over
`listExperiments`. `deleteExperiment` schedules its own follow-up batches:

```ts
// convex/cleanup.ts
import { Experiments } from "@vllnt/convex-experiments";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const experiments = new Experiments(components.experiments);

export const eraseUser = internalMutation({
  args: { subjectRef: v.string() },
  returns: v.number(),
  handler: async (ctx, { subjectRef }) => {
    let erased = 0;
    for (const experiment of await experiments.listExperiments(ctx)) {
      if (await experiments.forgetSubject(ctx, experiment.key, subjectRef)) {
        erased++;
      }
    }
    return erased;
  },
});

export const deleteFinished = internalMutation({
  args: { key: v.string() },
  returns: v.number(),
  handler: async (ctx, { key }) => {
    await experiments.setStatus(ctx, key, "stopped");
    return experiments.deleteExperiment(ctx, key, { batch: 200 });
  },
});
```

Mount the component twice, or split one mount by scope. Named mounts share no
tables or scheduled work; scopes are namespaces inside one mount (folded into
the hash, so one subject buckets independently per scope), not access control:

```ts
// convex/convex.config.ts
import experiments from "@vllnt/convex-experiments/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(experiments, { name: "webExperiments" });
app.use(experiments, { name: "gameExperiments" });
export default app;
```

```ts
// convex/clients.ts
import { Experiments } from "@vllnt/convex-experiments";

import { components } from "./_generated/api";

export const web = new Experiments(components.webExperiments);
export const game = new Experiments(components.gameExperiments, {
  defaultScope: "season_1",
  defaultStatus: "draft",
});
```

## Errors and fixes

Invalid input throws a `ConvexError` whose `data` is `{ code, message }` (plus
`reason`, and `key` where it applies, for `INVALID_VARIANTS`). Catch it in the
host with `error instanceof ConvexError` and read `error.data.code`.

| Code                                                    | Message                                                                                                   | Cause                                                                                                           | Fix                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `INVALID_ARGUMENT`                                      | `scope must be non-empty` (or `key`, `subjectRef`)                                                        | A mutation got an empty `scope`, `key` or `subjectRef` string. Queries do not check this.                       | Pass non-empty strings; check the client `defaultScope` is not `""` |
| `INVALID_VARIANTS` with `reason: "empty"`               | `an experiment needs at least one variant`                                                                | `define` got `variants: []`                                                                                     | Pass at least one variant                                           |
| `INVALID_VARIANTS` with `reason: "empty_key"`           | `variant keys must be non-empty`                                                                          | A variant has `key: ""`                                                                                         | Give every variant a non-empty key                                  |
| `INVALID_VARIANTS` with `reason: "non_positive_weight"` | `variant "<key>" weight must be a positive finite number`                                                 | A weight is `0`, negative, `NaN` or `Infinity`                                                                  | Use positive finite weights (fractions are allowed)                 |
| `INVALID_VARIANTS` with `reason: "duplicate_key"`       | `duplicate variant key "<key>"`                                                                           | Two variants share a key                                                                                        | Make variant keys unique                                            |
| `INVALID_BATCH`                                         | `batch must be an integer between 1 and 500`                                                              | `deleteExperiment` got a `batch` that is not an integer in 1..500                                               | Omit `batch` (default 200) or pass an integer in 1..500             |
| `EXPERIMENT_LOCKED`                                     | `variants and salt are immutable once subjects are assigned; define a new experiment key to re-randomize` | `define` changed `variants` (keys, weights or order) or `salt` while the experiment has at least one assignment | Define a new experiment key; status-only changes are always allowed |
| `Error` (no code)                                       | `pickVariant requires at least one variant`                                                               | Internal guard. Not reachable through the public API: `define` rejects an empty variant set first               | None needed                                                         |

Arguments of the wrong type (for example a string `weight`) are rejected by
Convex argument validation before the component runs. The component throws no
other errors of its own: absent experiments and wrong scopes return `null`,
`false`, `0`, `{ variant: null }` or `[]` (see below).

## Limits and gotchas

- Only `running` experiments enroll. `assign`, `logExposure` and `peek` return
  `{ variant: null }` with no error when the experiment is absent, `draft` or
  `stopped`, and also for a misspelled key or a wrong scope.
- `define` starts the experiment as `running` unless you pass `status: "draft"`
  or construct the client with `defaultStatus: "draft"`.
- After `stopped`, `getAssignment` still returns stored assignments, while
  `assign`, `logExposure` and `peek` return `{ variant: null }`.
- `variants` (keys, weights and their order) and `salt` cannot change once any
  subject in that `(scope, key)` has an assignment (`EXPERIMENT_LOCKED`).
  Re-defining with identical input writes nothing and returns `{ created: false }`.
- The variant is computed from `scope`, `salt` (default: the experiment key),
  `subjectRef` and the ordered variants and weights, with the 32-bit FNV-1a
  hash. It is deterministic bucketing, not randomness or a secret: anyone who
  knows those inputs can compute a subject's variant.
- Every `logExposure` call adds 1 to `exposures`; there is no idempotency key, so
  a retried call counts again. `subjects` counts each subject once. `assign`
  alone adds to `assigned`, not to `subjects` or `exposures`.
- `forgetSubject` is not an opt-out: a later `assign` or `logExposure` enrolls
  the subject again, into the same variant while the definition is unchanged.
- `deleteExperiment` deletes up to `batch` rows per table per pass (default 200,
  integer 1..500) and reschedules itself until done. It returns only the first
  pass's count and does not count the definition row. The definition stays until
  the last pass, so a `running` experiment keeps enrolling meanwhile: stop it first.
- `listExperiments` and `results` are not paginated. `listExperiments` reads
  every experiment in the scope; calls that omit `scope` use the client
  `defaultScope` (`"global"`), never all scopes.
- `results` returns `[]` for an absent experiment and one zeroed row per defined
  variant before anyone enrolls.
- The component sets no maximum length for keys, scopes or `subjectRef`.
- Scopes are namespaces, not authorization. The component reads no auth.
- Timestamps (`createdAt`, `assignedAt`) are server time in ms; no method accepts
  a caller timestamp.
- Option types are `{ scope?: string }`, not `{ scope?: string | undefined }`.
  Under `exactOptionalPropertyTypes`, omit a key instead of passing `undefined`,
  for example `...(scope === undefined ? {} : { scope })`.

## Compatibility

- Peer dependency: `convex@^1.45.0`. This repository develops and tests against
  convex 1.51.
- `react >=18` is an optional peer dependency, needed only for
  `@vllnt/convex-experiments/react` (which also imports `convex/react`). A
  backend-only app needs no React.
- Node.js `>=18`. ES modules only.
- `@vllnt/convex-experiments/test` ships as TypeScript source (`src/test.ts`) and
  needs `convex-test` and Vite's `import.meta.glob`, for example through
  `vitest`, with `vite/client` types.

## Testing

Mount the component in your own `convex-test` suite with `register`. This
test uses the Quick start's `convex/checkout.ts` and runs in Vitest's
`edge-runtime` environment (`@edge-runtime/vm`):

```ts
// convex/checkout.test.ts
/// <reference types="vite/client" />
import { register } from "@vllnt/convex-experiments/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

test("a signed-in user keeps one variant", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  register(t);
  await t.mutation(internal.checkout.setup, {});
  const user = t.withIdentity({ tokenIdentifier: "user-1" });
  const first = await user.mutation(api.checkout.checkoutVariant, {});
  const again = await user.mutation(api.checkout.checkoutVariant, {});
  expect(first).not.toBeNull();
  expect(again).toBe(first);
});
```

`register(t, name)` takes the mount name when you used
`app.use(experiments, { name })`; the default is `"experiments"`.

This repository's own tests (`pnpm test`, `pnpm test:coverage` with 100%
coverage enforced) use the simulated `convex-test` backend, not a real Convex
deployment; they do not prove production concurrency or scheduler delivery.

## Security

- The component does not authenticate. The host must authorize every call and
  derive `subjectRef` and `scope` itself, or check a client-sent `subjectRef`
  against the caller's identity as in the React example above.
- Its tables are reachable only through the component's functions; `subjectRef`,
  variant keys and `scope` are opaque strings.
- A variant is not a secret or an entitlement: it can be computed from the
  experiment inputs (see Limits and gotchas).
- `forgetSubject` deletes a subject's assignment and exposure rows in one
  experiment and lowers the tallies, for right-to-erasure requests.

Report vulnerabilities as described in
[SECURITY.md](https://github.com/vllnt/convex-experiments/blob/main/SECURITY.md).

## Related packages

None. No other @vllnt package is used with this one in code (no dependency, shared test or example).

## Contributing

See
[CONTRIBUTING.md](https://github.com/vllnt/convex-experiments/blob/main/CONTRIBUTING.md).

## Links

- Docs and changelog: [oss.vllnt.com/packages/convex-experiments](https://oss.vllnt.com/packages/convex-experiments) · [release feed](https://oss.vllnt.com/packages/convex-experiments/rss.xml)
- All @vllnt packages: [oss.vllnt.com](https://oss.vllnt.com) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)
- Source and issues: [GitHub](https://github.com/vllnt/convex-experiments) · [issues](https://github.com/vllnt/convex-experiments/issues) · [npm](https://www.npmjs.com/package/@vllnt/convex-experiments)
- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)
- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)
- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)

## License

MIT. See [LICENSE](LICENSE).

[![npm version of @vllnt/convex-experiments](https://img.shields.io/npm/v/@vllnt/convex-experiments.svg)](https://www.npmjs.com/package/@vllnt/convex-experiments)
[![CI status](https://github.com/vllnt/convex-experiments/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-experiments/actions/workflows/ci.yml)

---

Part of [vllnt open source](https://oss.vllnt.com) · [Package page](https://oss.vllnt.com/packages/convex-experiments) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)
