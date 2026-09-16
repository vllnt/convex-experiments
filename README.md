<!-- Badges -->

[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-experiments.svg)](https://www.npmjs.com/package/@vllnt/convex-experiments)
[![CI](https://github.com/vllnt/convex-experiments/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-experiments/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-experiments.svg)](./LICENSE)

# @vllnt/convex-experiments

Deterministic A/B experimentation — sticky variant assignment and deduped
exposure tracking, as a Convex component.

```ts
const experiments = new Experiments(components.experiments);
await experiments.define(ctx, "checkout_button", {
  variants: [
    { key: "control", weight: 1 },
    { key: "treatment", weight: 1 },
  ],
});
const { variant } = await experiments.logExposure(
  ctx,
  "checkout_button",
  userId,
);
if (variant === "treatment") showNewButton();
```

Define an experiment with weighted variants; enroll subjects into a **sticky**
variant chosen deterministically from `(scope, salt, subjectRef)`; record
exposures and read per-variant tallies. Pair it with a feature-flag system for
kill-switches and measure conversions in your own tables — this component
handles assignment and exposure. Domain-neutral: any subject, any surface.

## Features

- **Deterministic + sticky** — the same subject always lands in the same
  weighted variant, even before anything is stored.
- **Weighted variants** — split traffic by relative weights (`1:1`, `90:10`,
  N-way); equal weights split evenly.
- **Enrollment lifecycle** — `draft → running → stopped`; only `running`
  enrolls, and stopping preserves recorded data.
- **Deduped exposures + O(variants) results** — one tallied row per subject;
  `results` reads maintained per-variant tallies
  (`assigned`/`subjects`/`exposures`/`weight`), never scanning the exposure
  table.
- **Sample-ratio-ready** — `assigned` + `weight` per variant let you check
  observed vs expected split (SRM).
- **`peek`** — a read-only deterministic query returns a subject's sticky
  variant without writing (SSR / flicker-free first paint).
- **Immutable once assigned** — `variants`/`salt` are fixed after enrollment
  (changing them throws); define a new key to re-randomize.
- **Lifecycle + GDPR** — `listExperiments` to discover, `forgetSubject` to erase
  one subject, `deleteExperiment` to cascade-delete.
- **Scopes** — global by default, or namespace per tenant / surface (folded into
  the hash for independent bucketing).
- **Fully typed** — variant keys, weights, and outcomes are concrete types end
  to end; no `any`.
- **Server-sourced time** — assignment timestamps come from the server, never
  the caller.

## Installation

```bash
pnpm add @vllnt/convex-experiments
```

Node.js >=18; required peer: `convex@^1.45.0`. React >=18 is optional. The
default npm channel is stable; use `@vllnt/convex-experiments@canary` for the
current prerelease surface documented here.

## Usage

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import experiments from "@vllnt/convex-experiments/convex.config";

const app = defineApp();
app.use(experiments);
export default app;
```

```ts
// convex/checkout.ts — host owns auth; pass an opaque subjectRef in.
import { components } from "./_generated/api";
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { Experiments } from "@vllnt/convex-experiments";

const experiments = new Experiments(components.experiments);

export const view = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const { variant } = await experiments.logExposure(
      ctx,
      "checkout_button",
      userId,
    );
    return { variant }; // "control" | "treatment" | null (not enrolled)
  },
});
```

Measure the outcome in your own table, joined on the assigned variant — then
read tallies with `results(ctx, "checkout_button")`. See
[`example/convex/example.ts`](example/convex/example.ts) for a host-side
conversion recorder.

The wrapper is illustrative, not an auth gate: resolve and authorize the subject
in the host before enrollment. After mounting, run `pnpm convex dev` to generate
component references.

## Configuration and limits

Client options are `defaultScope: "global"` and `defaultStatus: "running"`.
`define` therefore starts enrollment immediately unless you pass
`status: "draft"` or set a different client default. Omitted `salt` defaults to
the experiment key; the component hashes `${scope}:${salt}:${subjectRef}` with
FNV-1a. Assignment also depends on the ordered variants and weights. It is
deterministic bucketing, not a cryptographic randomness or access-control
mechanism.

`deleteExperiment` defaults to 200 rows per table per pass, accepts integer
batches 1–500, and returns only the first pass's deletion count. Discovery reads
are not paginated. Exposure rows are deduplicated per subject, but every
`logExposure` call increments total exposures: logical retries are not
deduplicated. The host owns conversion metrics, statistical inference and
release kill-switches.

## Multiple mounts

```ts
app.use(experiments, { name: "webExperiments" });
app.use(experiments, { name: "gameExperiments" });
// new Experiments(components.webExperiments), new Experiments(components.gameExperiments)
```

Mounts isolate tables and scheduled cleanup. Use `scope` for runtime namespaces,
not as a substitute for authorization.

## API Reference

| Method                                                   | Kind     | Result                                                     |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| `define(ctx, key, { variants, scope?, salt?, status? })` | mutation | `{ created: boolean }`                                     |
| `setStatus(ctx, key, status, scope?)`                    | mutation | `boolean`                                                  |
| `assign(ctx, key, subjectRef, scope?)`                   | mutation | `{ variant: null } \| { variant: string; isNew: boolean }` |
| `logExposure(ctx, key, subjectRef, scope?)`              | mutation | `{ variant: string \| null }`                              |
| `forgetSubject(ctx, key, subjectRef, scope?)`            | mutation | `boolean` (GDPR erasure)                                   |
| `deleteExperiment(ctx, key, { scope?, batch? })`         | mutation | `number` (cascade delete)                                  |
| `getExperiment(ctx, key, scope?)`                        | query    | `ExperimentDefinition \| null`                             |
| `listExperiments(ctx, { scope?, status? })`              | query    | `ExperimentDefinition[]`                                   |
| `getAssignment(ctx, key, subjectRef, scope?)`            | query    | `{ variant, assignedAt } \| null`                          |
| `peek(ctx, key, subjectRef, scope?)`                     | query    | `{ variant: string \| null }` (no write)                   |
| `results(ctx, key, scope?)`                              | query    | `{ variant, assigned, subjects, exposures, weight }[]`     |

Full reference: [docs/API.md](docs/API.md).

## React

Optional, tree-shakeable hooks via `@vllnt/convex-experiments/react` (`react` is
an optional peer dep — a backend-only consumer pulls none of it). Each hook
wraps `useQuery` over a query reference **you re-export** from your app, so the
component never owns your `api`.

```tsx
// convex/experiments.ts — re-export the host-side wrappers (auth gated)
// export const myVariant = query({ args: { key: v.string(), subjectRef: v.string() },
//   handler: (ctx, { key, subjectRef }) => experiments.peek(ctx, key, subjectRef) });
// Add host authorization before exposing this illustrative wrapper.

import { useVariant } from "@vllnt/convex-experiments/react";
import { api } from "@/convex/_generated/api";

function CheckoutButton({ userId }: { userId: string }) {
  // deterministic first paint via peek → no flash-of-control
  const variant = useVariant(api.experiments.myVariant, {
    key: "checkout_button",
    subjectRef: userId,
  });
  return variant === "treatment" ? <OneClick /> : <Classic />;
}
```

| Hook                                     | Wraps           | Returns                                                          |
| ---------------------------------------- | --------------- | ---------------------------------------------------------------- |
| `useVariant(peekRef, args)`              | `peek`          | `string \| null \| undefined` (variant / not-enrolled / loading) |
| `useAssignment(getAssignmentRef, args)`  | `getAssignment` | `Assignment \| null \| undefined`                                |
| `useExperimentResults(resultsRef, args)` | `results`       | `VariantResult[] \| undefined`                                   |

## Security

- Auth-agnostic — the host resolves identity and decides who may define, start,
  stop, or enroll.
- Tables sandboxed — reached only through the exported functions; `subjectRef`,
  variant keys, and `scope` stay opaque.
- Server-sourced timestamps — a caller cannot supply assignment time.

See [docs/API.md](docs/API.md).

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests use the simulated `convex-test` backend (`@edge-runtime/vm`), not a real
Convex deployment; they do not prove production concurrency or scheduler
delivery.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) ·
[bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet —
[vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
