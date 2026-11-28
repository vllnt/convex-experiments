/// <reference types="vite/client" />
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { register } from "./test.js";

/**
 * A host app's schema: its own tables, none of the component's. `register` must accept
 * the `convexTest` instance built from it; `pnpm typecheck:ci` fails if it does not.
 */
const hostSchema = defineSchema({
  notes: defineTable({ body: v.string() }),
});

const modules = import.meta.glob("./component/**/*.ts");

test("register accepts a host app's convexTest instance and keeps its data model", async () => {
  const t = convexTest(hostSchema, modules);
  register(t);
  register(t, "otherExperiments");

  const id = await t.run((ctx) => ctx.db.insert("notes", { body: "hello" }));
  const note = await t.run((ctx) => ctx.db.get(id));
  expect(note?.body).toBe("hello");
});
