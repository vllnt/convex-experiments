/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";
import { MAX_ID_LENGTH, MAX_VARIANTS } from "./shared.js";

const modules = import.meta.glob("./component/**/*.ts");

const writes = vi.hoisted((): string[] => []);

vi.mock("./component/_generated/server.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./component/_generated/server.js")>();
  const WRITE_METHODS = new Set(["insert", "patch", "replace", "delete"]);
  function countingDb<T extends object>(db: T): T {
    return new Proxy(db, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") {
          return value;
        }
        return (...callArgs: unknown[]) => {
          if (typeof prop === "string" && WRITE_METHODS.has(prop)) {
            writes.push(`${prop}:${String(callArgs[0])}`);
          }
          return Reflect.apply(value, target, callArgs);
        };
      },
    });
  }
  const mutation: typeof original.mutation = (definition) => {
    if (typeof definition === "function") {
      return original.mutation((ctx, args) => definition({ ...ctx, db: countingDb(ctx.db) }, args));
    }
    return original.mutation({
      ...definition,
      handler: (ctx, args) => definition.handler({ ...ctx, db: countingDb(ctx.db) }, args),
    });
  };
  return { ...original, mutation };
});

function writesDuring<T>(run: () => Promise<T>): Promise<string[]> {
  writes.length = 0;
  return run().then(() => [...writes]);
}

const TWO_EVEN = [
  { key: "control", weight: 1 },
  { key: "treatment", weight: 1 },
];

function setup() {
  return convexTest(schema, modules);
}

async function define(t: ReturnType<typeof setup>, key: string, status: "draft" | "running" | "stopped" = "running") {
  return t.mutation(api.mutations.define, {
    scope: "s",
    key,
    variants: TWO_EVEN,
    salt: key,
    status,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("experiments component — write and call efficiency", () => {
  test("deleteExperiment drains a small experiment in one pass with no scheduled continuation", async () => {
    const t = setup();
    await define(t, "exp");
    for (let i = 0; i < 3; i++) {
      await t.mutation(api.mutations.logExposure, { scope: "s", key: "exp", subjectRef: `u${i}` });
    }
    const tallyRows = await t.run(async (ctx) => (await ctx.db.query("variantTallies").collect()).length);
    const removed = await t.mutation(api.mutations.deleteExperiment, { scope: "s", key: "exp", batch: 10 });
    expect(removed).toBe(3 + 3 + tallyRows);
    const state = await t.run(async (ctx) => ({
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      experiments: await ctx.db.query("experiments").collect(),
    }));
    expect(state.scheduled).toHaveLength(0);
    expect(state.experiments).toHaveLength(0);
  });

  test("deleteExperiment schedules a continuation only while a table still fills the batch", async () => {
    const t = setup();
    await define(t, "exp");
    for (let i = 0; i < 4; i++) {
      await t.mutation(api.mutations.assign, { scope: "s", key: "exp", subjectRef: `u${i}` });
    }
    await t.mutation(api.mutations.deleteExperiment, { scope: "s", key: "exp", batch: 2 });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await t.run(async (ctx) => ({
      experiments: await ctx.db.query("experiments").collect(),
      assignments: await ctx.db.query("assignments").collect(),
      tallies: await ctx.db.query("variantTallies").collect(),
    }));
    expect(left).toEqual({ experiments: [], assignments: [], tallies: [] });
  });

  test("first exposure writes one tally row per variant with assigned, subjects and exposures together", async () => {
    const t = setup();
    await define(t, "exp");
    const { variant } = await t.mutation(api.mutations.logExposure, { scope: "s", key: "exp", subjectRef: "u" });
    const tallies = await t.run((ctx) => ctx.db.query("variantTallies").collect());
    expect(tallies).toHaveLength(1);
    expect(tallies[0]).toMatchObject({ variant, assigned: 1, subjects: 1, exposures: 1 });
    await t.mutation(api.mutations.logExposure, { scope: "s", key: "exp", subjectRef: "u" });
    const again = await t.run((ctx) => ctx.db.query("variantTallies").collect());
    expect(again[0]).toMatchObject({ assigned: 1, subjects: 1, exposures: 2 });
  });

  test("exposure after a prior assign does not double count assigned", async () => {
    const t = setup();
    await define(t, "exp");
    await t.mutation(api.mutations.assign, { scope: "s", key: "exp", subjectRef: "u" });
    await t.mutation(api.mutations.logExposure, { scope: "s", key: "exp", subjectRef: "u" });
    const tallies = await t.run((ctx) => ctx.db.query("variantTallies").collect());
    expect(tallies[0]).toMatchObject({ assigned: 1, subjects: 1, exposures: 1 });
  });

  test("an orphaned exposure row still counts a fresh assignment once", async () => {
    const t = setup();
    await define(t, "exp");
    await t.run(async (ctx) => {
      await ctx.db.insert("exposures", {
        scope: "s",
        experimentKey: "exp",
        subjectRef: "u",
        variant: "control",
        firstExposedAt: 0,
        lastExposedAt: 0,
        count: 1,
      });
    });
    const { variant } = await t.mutation(api.mutations.logExposure, { scope: "s", key: "exp", subjectRef: "u" });
    const tally = await t.run((ctx) => ctx.db.query("variantTallies").unique());
    expect(tally).toMatchObject({ variant, assigned: 1, subjects: 0, exposures: 1 });
  });

  test("no-op define and setStatus perform zero writes; a status change patches once", async () => {
    const t = setup();
    await define(t, "exp");
    expect(await writesDuring(() => define(t, "exp"))).toEqual([]);
    expect(
      await writesDuring(() => t.mutation(api.mutations.setStatus, { scope: "s", key: "exp", status: "running" })),
    ).toEqual([]);
    expect(await writesDuring(() => define(t, "exp", "stopped"))).toEqual(["patch:experiments"]);
    expect(
      await writesDuring(() => t.mutation(api.mutations.setStatus, { scope: "s", key: "exp", status: "running" })),
    ).toEqual(["patch:experiments"]);
  });

  test("first exposure writes the tally row exactly once", async () => {
    const t = setup();
    await define(t, "exp");
    const first = await writesDuring(() =>
      t.mutation(api.mutations.logExposure, { scope: "s", key: "exp", subjectRef: "u" }),
    );
    expect(first.sort()).toEqual(["insert:assignments", "insert:exposures", "insert:variantTallies"]);
    const repeat = await writesDuring(() =>
      t.mutation(api.mutations.logExposure, { scope: "s", key: "exp", subjectRef: "u" }),
    );
    expect(repeat.sort()).toEqual(["patch:exposures", "patch:variantTallies"]);
  });

  test("re-defining an unchanged experiment and setting the same status keep the definition intact", async () => {
    const t = setup();
    await define(t, "exp");
    const before = await t.run((ctx) => ctx.db.query("experiments").unique());
    expect(await define(t, "exp")).toEqual({ created: false });
    expect(await t.mutation(api.mutations.setStatus, { scope: "s", key: "exp", status: "running" })).toBe(true);
    const after = await t.run((ctx) => ctx.db.query("experiments").unique());
    expect(after).toEqual(before);
    expect(await define(t, "exp", "stopped")).toEqual({ created: false });
    const stopped = await t.run((ctx) => ctx.db.query("experiments").unique());
    expect(stopped).toMatchObject({ status: "stopped", variants: TWO_EVEN, salt: "exp" });
  });
});

describe("experiments component — input size limits", () => {
  const long = "x".repeat(MAX_ID_LENGTH + 1);
  const ok = "x".repeat(MAX_ID_LENGTH);

  test.each(["scope", "key"] as const)("define rejects a new experiment with an over-long %s", async (field) => {
    const t = setup();
    await expect(
      t.mutation(api.mutations.define, {
        scope: "s",
        key: "exp",
        salt: "exp",
        variants: TWO_EVEN,
        status: "running",
        [field]: long,
      }),
    ).rejects.toThrow(/INVALID_ARGUMENT|at most/);
  });

  test("assign and logExposure reject a new subject with an over-long subjectRef", async () => {
    const t = setup();
    await define(t, "exp");
    await expect(
      t.mutation(api.mutations.assign, { scope: "s", key: "exp", subjectRef: long }),
    ).rejects.toThrow(/INVALID_ARGUMENT|at most/);
    await expect(
      t.mutation(api.mutations.logExposure, { scope: "s", key: "exp", subjectRef: long }),
    ).rejects.toThrow(/INVALID_ARGUMENT|at most/);
  });

  test("define accepts identifiers at the limit", async () => {
    const t = setup();
    await expect(
      t.mutation(api.mutations.define, {
        scope: ok,
        key: ok,
        salt: ok,
        variants: [{ key: ok, weight: 1 }],
        status: "running",
      }),
    ).resolves.toEqual({ created: true });
  });

  test("define rejects an over-long salt", async () => {
    const t = setup();
    await expect(
      t.mutation(api.mutations.define, { scope: "s", key: "exp", salt: long, variants: TWO_EVEN, status: "running" }),
    ).rejects.toThrow(/salt must be at most/);
  });

  test("define rejects an over-long variant key", async () => {
    const t = setup();
    await expect(
      t.mutation(api.mutations.define, {
        scope: "s",
        key: "exp",
        salt: "exp",
        variants: [{ key: long, weight: 1 }],
        status: "running",
      }),
    ).rejects.toThrow(/key_too_long|at most/);
  });

  test("define rejects more than the maximum number of variants", async () => {
    const t = setup();
    const variants = Array.from({ length: MAX_VARIANTS + 1 }, (_, i) => ({ key: `v${i}`, weight: 1 }));
    await expect(
      t.mutation(api.mutations.define, { scope: "s", key: "exp", salt: "exp", variants, status: "running" }),
    ).rejects.toThrow(/too_many|at most/);
  });
});

describe("experiments component — existing over-long data stays usable", () => {
  const long = "y".repeat(MAX_ID_LENGTH + 1);
  const manyVariants = Array.from({ length: MAX_VARIANTS + 1 }, (_, i) => ({ key: `v${i}`, weight: 1 }));

  async function seedLegacy(t: ReturnType<typeof setup>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("experiments", {
        scope: long,
        key: long,
        status: "running",
        variants: manyVariants,
        salt: long,
        createdAt: 0,
      });
      await ctx.db.insert("assignments", {
        scope: long,
        experimentKey: long,
        subjectRef: long,
        variant: "v0",
        assignedAt: 0,
      });
      await ctx.db.insert("exposures", {
        scope: long,
        experimentKey: long,
        subjectRef: long,
        variant: "v0",
        firstExposedAt: 0,
        lastExposedAt: 0,
        count: 1,
      });
      await ctx.db.insert("variantTallies", {
        scope: long,
        experimentKey: long,
        variant: "v0",
        assigned: 1,
        subjects: 1,
        exposures: 1,
      });
    });
  }

  test("re-define, status changes, exposure and erasure work on legacy values", async () => {
    const t = setup();
    await seedLegacy(t);
    const ref = { scope: long, key: long };
    await expect(
      t.mutation(api.mutations.define, { ...ref, variants: manyVariants, salt: long, status: "stopped" }),
    ).resolves.toEqual({ created: false });
    expect(await t.mutation(api.mutations.setStatus, { ...ref, status: "running" })).toBe(true);
    await expect(t.mutation(api.mutations.logExposure, { ...ref, subjectRef: long })).resolves.toEqual({
      variant: "v0",
    });
    expect(await t.mutation(api.mutations.forgetSubject, { ...ref, subjectRef: long })).toBe(true);
    await t.mutation(api.mutations.deleteExperiment, { ...ref, batch: 10 });
    const left = await t.run(async (ctx) => ({
      experiments: await ctx.db.query("experiments").collect(),
      tallies: await ctx.db.query("variantTallies").collect(),
    }));
    expect(left).toEqual({ experiments: [], tallies: [] });
  });

  test("new assignments on a legacy experiment still enforce the subjectRef limit", async () => {
    const t = setup();
    await seedLegacy(t);
    await expect(
      t.mutation(api.mutations.assign, { scope: long, key: long, subjectRef: `${long}z` }),
    ).rejects.toThrow(/at most/);
    await expect(
      t.mutation(api.mutations.assign, { scope: long, key: long, subjectRef: "short" }),
    ).resolves.toMatchObject({ isNew: true });
  });

  test("changing a legacy definition must satisfy the new limits", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("experiments", {
        scope: "s",
        key: "legacy",
        status: "draft",
        variants: TWO_EVEN,
        salt: "legacy",
        createdAt: 0,
      });
    });
    await expect(
      t.mutation(api.mutations.define, { scope: "s", key: "legacy", variants: manyVariants, salt: "legacy", status: "draft" }),
    ).rejects.toThrow(/too_many|at most/);
  });
});
