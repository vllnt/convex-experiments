import { defineComponent } from "convex/server";

/**
 * The experiments component definition. Mount it in the host's
 * `convex/convex.config.ts` with `app.use(experiments)`, or
 * `app.use(experiments, { name })` for a named mount.
 */
const component = defineComponent("experiments");

// Nest official child components here, e.g.:
// import aggregate from "@convex-dev/aggregate/convex.config";
// component.use(aggregate);

export default component;
