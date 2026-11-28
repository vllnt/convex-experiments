/// <reference types="vite/client" />
import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register this component with a `convex-test` instance so consuming apps can test
 * integration: `import { register } from "@vllnt/convex-experiments/test"`.
 *
 * @param t - The host app's `convexTest(hostSchema, modules)` instance, for any host schema.
 * @param name - The component name the host mounts it under (`app.use(experiments, { name })`).
 * @example
 * const t = convexTest(schema, modules);
 * register(t);
 */
export function register<TSchema extends GenericSchema>(
  t: TestConvex<SchemaDefinition<TSchema, boolean>>,
  name = "experiments",
): void {
  t.registerComponent(name, schema, modules);
}
