<!-- Badges -->
[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-experiments.svg)](https://www.npmjs.com/package/@vllnt/convex-experiments)
[![CI](https://github.com/vllnt/convex-experiments/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-experiments/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-experiments.svg)](./LICENSE)

# @vllnt/convex-experiments

Deterministic A/B experimentation — sticky variant assignment and deduped exposure tracking, as a
Convex component.

```ts
const experiments = new Experiments(components.experiments);
await experiments.define(ctx, "checkout_button", {
  variants: [
    { key: "control", weight: 1 },
    { key: "treatment", weight: 1 },
  ],
});
const { variant } = await experiments.logExposure(ctx, "checkout_button", userId);
if (variant === "treatment") showNewButton();
```

Define an experiment with weighted variants; enroll subjects into a **sticky** variant chosen
deterministically from `(salt, subjectRef)`; record exposures and read per-variant tallies. Pair it
with a feature-flag system for kill-switches and measure conversions in your own tables — this
component handles assignment and exposure. Domain-neutral: any subject, any surface.

## Features

- **Deterministic + sticky** — the same subject always lands in the same weighted variant, even before anything is stored.
- **Weighted variants** — split traffic by relative weights (`1:1`, `90:10`, N-way); equal weights split evenly.
- **Enrollment lifecycle** — `draft → running → stopped`; only `running` enrolls, and stopping preserves recorded data.
- **Deduped exposures** — one tallied row per subject; `results` reports distinct subjects and total exposures per variant.
- **Salted re-runs** — change `salt` to reshuffle buckets without changing subject ids.
- **Scopes** — global by default, or namespace per tenant / surface.
- **Fully typed** — variant keys, weights, and outcomes are concrete types end to end; no `any`.
- **Server-sourced time** — assignment timestamps come from the server, never the caller.

## Installation

```bash
pnpm add @vllnt/convex-experiments
```

Peer dependency: `convex@^1.41.0`.

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
    const { variant } = await experiments.logExposure(ctx, "checkout_button", userId);
    return { variant }; // "control" | "treatment" | null (not enrolled)
  },
});
```

Measure the outcome in your own table, joined on the assigned variant — then read tallies with
`results(ctx, "checkout_button")`. See [`example/convex/example.ts`](example/convex/example.ts) for a
host-side conversion recorder.

## API Reference

| Method | Kind | Result |
|--------|------|--------|
| `define(ctx, key, { variants, scope?, salt?, status? })` | mutation | `{ created: boolean }` |
| `setStatus(ctx, key, status, scope?)` | mutation | `boolean` |
| `assign(ctx, key, subjectRef, scope?)` | mutation | `{ variant: null } \| { variant: string; isNew: boolean }` |
| `logExposure(ctx, key, subjectRef, scope?)` | mutation | `{ variant: string \| null }` |
| `getExperiment(ctx, key, scope?)` | query | `ExperimentDefinition \| null` |
| `getAssignment(ctx, key, subjectRef, scope?)` | query | `{ variant, assignedAt } \| null` |
| `results(ctx, key, scope?)` | query | `{ variant, subjects, exposures }[]` |

Full reference: [docs/API.md](docs/API.md).

## React

Backend-only at this version — no `./react` entry. Assignment and exposure are recorded server-side;
a reactive read hook may ship in a later version.

## Security

- Auth-agnostic — the host resolves identity and decides who may define, start, stop, or enroll.
- Tables sandboxed — reached only through the exported functions; `subjectRef`, variant keys, and `scope` stay opaque.
- Server-sourced timestamps — a caller cannot supply assignment time.

See [docs/API.md](docs/API.md).

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test` (`@edge-runtime/vm`), not mocks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
