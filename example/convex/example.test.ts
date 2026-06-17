import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { register } from "../../src/test";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  register(t);
  return t;
}

const TWO_EVEN = [
  { key: "control", weight: 1 },
  { key: "treatment", weight: 1 },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("experiments — define", () => {
  test("first define inserts (created:true) with server-stamped createdAt", async () => {
    const t = setup();
    expect(
      await t.mutation(api.example.define, { key: "exp_1", variants: TWO_EVEN }),
    ).toEqual({ created: true });
    const def = await t.query(api.example.getExperiment, { key: "exp_1" });
    expect(def).toEqual({
      key: "exp_1",
      scope: "global",
      status: "running",
      variants: TWO_EVEN,
      salt: "exp_1",
      createdAt: 0,
    });
  });

  test("status-only re-define updates (created:false), no guard", async () => {
    const t = setup();
    await t.mutation(api.example.defineDefaults, { key: "exp_s", variants: TWO_EVEN });
    expect(
      await t.mutation(api.example.define, {
        key: "exp_s",
        variants: TWO_EVEN,
        status: "stopped",
      }),
    ).toEqual({ created: false });
    expect(
      (await t.query(api.example.getExperiment, { key: "exp_s" }))?.status,
    ).toBe("stopped");
  });

  test("salt change before enrollment is allowed", async () => {
    const t = setup();
    await t.mutation(api.example.define, {
      key: "exp_salt",
      variants: TWO_EVEN,
      salt: "s1",
    });
    expect(
      await t.mutation(api.example.define, {
        key: "exp_salt",
        variants: TWO_EVEN,
        salt: "s2",
      }),
    ).toEqual({ created: false });
    expect((await t.query(api.example.getExperiment, { key: "exp_salt" }))?.salt).toBe("s2");
  });

  test("variants change before enrollment is allowed", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_v", variants: TWO_EVEN });
    expect(
      await t.mutation(api.example.define, {
        key: "exp_v",
        variants: [
          { key: "control", weight: 1 },
          { key: "variant_c", weight: 1 },
        ],
      }),
    ).toEqual({ created: false });
  });

  test("variants/salt change AFTER a subject is assigned throws EXPERIMENT_LOCKED", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_lock", variants: TWO_EVEN });
    await t.mutation(api.example.assign, { key: "exp_lock", subjectRef: "u1" });
    await expect(
      t.mutation(api.example.define, {
        key: "exp_lock",
        variants: TWO_EVEN,
        salt: "different",
      }),
    ).rejects.toThrow(/EXPERIMENT_LOCKED|immutable/);
    // a status-only redefine is still allowed after enrollment
    expect(
      await t.mutation(api.example.define, {
        key: "exp_lock",
        variants: TWO_EVEN,
        status: "stopped",
      }),
    ).toEqual({ created: false });
  });
});

describe("experiments — define validation (INVALID_VARIANTS reasons)", () => {
  test("empty variant set is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.define, { key: "bad", variants: [] }),
    ).rejects.toThrow();
  });
  test("a zero weight is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.define, { key: "bad", variants: [{ key: "a", weight: 0 }] }),
    ).rejects.toThrow();
  });
  test("a non-finite weight is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.define, {
        key: "bad",
        variants: [{ key: "a", weight: Infinity }],
      }),
    ).rejects.toThrow();
  });
  test("a duplicate variant key is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.define, {
        key: "bad",
        variants: [
          { key: "a", weight: 1 },
          { key: "a", weight: 1 },
        ],
      }),
    ).rejects.toThrow();
  });
});

describe("experiments — assign (sticky, enrollment-gated)", () => {
  test("assign on an absent experiment returns variant:null", async () => {
    const t = setup();
    expect(
      await t.mutation(api.example.assign, { key: "ghost", subjectRef: "u1" }),
    ).toEqual({ variant: null });
  });

  test("assign on draft / stopped returns variant:null", async () => {
    const t = setup();
    await t.mutation(api.example.define, {
      key: "exp_draft",
      variants: TWO_EVEN,
      status: "draft",
    });
    expect(
      await t.mutation(api.example.assign, { key: "exp_draft", subjectRef: "u1" }),
    ).toEqual({ variant: null });
    await t.mutation(api.example.define, { key: "exp_stop", variants: TWO_EVEN });
    await t.mutation(api.example.setStatus, { key: "exp_stop", status: "stopped" });
    expect(
      await t.mutation(api.example.assign, { key: "exp_stop", subjectRef: "u1" }),
    ).toEqual({ variant: null });
  });

  test("first assign enrolls (isNew:true), replays (isNew:false), bumps assigned tally", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_a", variants: TWO_EVEN });
    const first = await t.mutation(api.example.assign, { key: "exp_a", subjectRef: "u1" });
    expect(first).toMatchObject({ isNew: true });
    expect(first.variant).not.toBeNull();
    const second = await t.mutation(api.example.assign, { key: "exp_a", subjectRef: "u1" });
    expect(second).toEqual({ variant: first.variant, isNew: false });
    expect(
      await t.query(api.example.getAssignment, { key: "exp_a", subjectRef: "u1" }),
    ).toEqual({ variant: first.variant, assignedAt: 0 });
    const res = await t.query(api.example.results, { key: "exp_a" });
    const assignedRow = res.find((r) => r.variant === first.variant);
    expect(assignedRow).toMatchObject({ assigned: 1, subjects: 0, exposures: 0, weight: 1 });
  });
});

describe("experiments — setStatus", () => {
  test("setStatus on an absent experiment returns false", async () => {
    const t = setup();
    expect(
      await t.mutation(api.example.setStatus, { key: "nope", status: "running" }),
    ).toBe(false);
  });
});

describe("experiments — logExposure (deduped tally)", () => {
  test("logExposure on a non-running experiment returns variant:null", async () => {
    const t = setup();
    await t.mutation(api.example.define, {
      key: "exp_off",
      variants: TWO_EVEN,
      status: "draft",
    });
    expect(
      await t.mutation(api.example.logExposure, { key: "exp_off", subjectRef: "u1" }),
    ).toEqual({ variant: null });
  });

  test("first exposure tallies subjects+exposures; repeats bump exposures only", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_e", variants: TWO_EVEN });
    const e1 = await t.mutation(api.example.logExposure, { key: "exp_e", subjectRef: "u1" });
    expect(e1.variant).not.toBeNull();
    await t.mutation(api.example.logExposure, { key: "exp_e", subjectRef: "u1" });
    await t.mutation(api.example.logExposure, { key: "exp_e", subjectRef: "u1" });
    const res = await t.query(api.example.results, { key: "exp_e" });
    const row = res.find((r) => r.variant === e1.variant);
    expect(row).toMatchObject({ assigned: 1, subjects: 1, exposures: 3, weight: 1 });
  });
});

describe("experiments — results (O(variants), SRM-ready)", () => {
  test("results on an absent experiment returns []", async () => {
    const t = setup();
    expect(await t.query(api.example.results, { key: "absent" })).toEqual([]);
  });

  test("a defined experiment with no enrollment returns a zero row per variant", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_z", variants: TWO_EVEN });
    expect(await t.query(api.example.results, { key: "exp_z" })).toEqual([
      { variant: "control", assigned: 0, subjects: 0, exposures: 0, weight: 1 },
      { variant: "treatment", assigned: 0, subjects: 0, exposures: 0, weight: 1 },
    ]);
  });

  test("tallies + weights enable a sample-ratio check", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_g", variants: TWO_EVEN });
    for (let i = 0; i < 30; i++) {
      await t.mutation(api.example.logExposure, { key: "exp_g", subjectRef: `s_${i}` });
    }
    const res = await t.query(api.example.results, { key: "exp_g" });
    expect(res.reduce((sum, r) => sum + r.assigned, 0)).toBe(30);
    expect(res.reduce((sum, r) => sum + r.subjects, 0)).toBe(30);
    for (const r of res) {
      expect(r.weight).toBe(1);
      expect(r.assigned).toBe(r.subjects);
    }
  });
});

describe("experiments — getExperiment / getAssignment / listExperiments", () => {
  test("getExperiment + getAssignment return null when absent", async () => {
    const t = setup();
    expect(await t.query(api.example.getExperiment, { key: "absent" })).toBeNull();
    await t.mutation(api.example.define, { key: "exp_p", variants: TWO_EVEN });
    expect(
      await t.query(api.example.getAssignment, { key: "exp_p", subjectRef: "nobody" }),
    ).toBeNull();
  });

  test("listExperiments returns all, then filtered by status", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "a", variants: TWO_EVEN });
    await t.mutation(api.example.define, { key: "b", variants: TWO_EVEN, status: "draft" });
    const all = await t.query(api.example.listExperimentsDefaults, {});
    expect(all.map((e) => e.key).sort()).toEqual(["a", "b"]);
    const running = await t.query(api.example.listExperiments, { status: "running" });
    expect(running.map((e) => e.key)).toEqual(["a"]);
  });
});

describe("experiments — peek (deterministic read-only)", () => {
  test("peek returns null when absent / not running", async () => {
    const t = setup();
    expect(
      await t.query(api.example.peek, { key: "ghost", subjectRef: "u1" }),
    ).toEqual({ variant: null });
    await t.mutation(api.example.define, {
      key: "exp_d",
      variants: TWO_EVEN,
      status: "draft",
    });
    expect(
      await t.query(api.example.peek, { key: "exp_d", subjectRef: "u1" }),
    ).toEqual({ variant: null });
  });

  test("peek is deterministic, matches a subsequent assign, and never writes", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_pk", variants: TWO_EVEN });
    const peeked = await t.query(api.example.peek, { key: "exp_pk", subjectRef: "u1" });
    expect(peeked.variant).not.toBeNull();
    expect(
      await t.query(api.example.getAssignment, { key: "exp_pk", subjectRef: "u1" }),
    ).toBeNull();
    const assigned = await t.mutation(api.example.assign, { key: "exp_pk", subjectRef: "u1" });
    expect(assigned).toMatchObject({ variant: peeked.variant });
    expect(
      await t.query(api.example.peek, { key: "exp_pk", subjectRef: "u1" }),
    ).toEqual({ variant: peeked.variant });
  });
});

describe("experiments — scopes are independent", () => {
  test("the same key in different scopes is fully independent", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "shared", variants: TWO_EVEN, scope: "a" });
    expect(
      await t.query(api.example.getExperiment, { key: "shared", scope: "b" }),
    ).toBeNull();
    expect(
      await t.mutation(api.example.assign, { key: "shared", subjectRef: "u1", scope: "b" }),
    ).toEqual({ variant: null });
    const r = await t.mutation(api.example.assign, {
      key: "shared",
      subjectRef: "u1",
      scope: "a",
    });
    expect(r.variant).not.toBeNull();
  });
});

describe("experiments — scoped client (defaultScope + defaultStatus)", () => {
  test("scoped client defines into its default scope as draft, then enrolls", async () => {
    const t = setup();
    expect(
      await t.mutation(api.example.defineScoped, { key: "feat", variants: TWO_EVEN }),
    ).toEqual({ created: true });
    expect(await t.query(api.example.getExperiment, { key: "feat" })).toBeNull();
    const def = await t.query(api.example.getExperimentScoped, { key: "feat" });
    expect(def?.scope).toBe("tenant");
    expect(def?.status).toBe("draft");
    expect(
      await t.mutation(api.example.assignScoped, { key: "feat", subjectRef: "u1" }),
    ).toEqual({ variant: null });
    expect(
      await t.mutation(api.example.setStatusScoped, { key: "feat", status: "running" }),
    ).toBe(true);
    const r = await t.mutation(api.example.assignScoped, { key: "feat", subjectRef: "u1" });
    expect(r.variant).not.toBeNull();
    expect(
      await t.query(api.example.getAssignmentScoped, { key: "feat", subjectRef: "u1" }),
    ).not.toBeNull();
    expect(await t.query(api.example.resultsScoped, { key: "feat" })).toHaveLength(2);
  });
});

describe("experiments — forgetSubject (GDPR erasure)", () => {
  test("forgets an assigned + exposed subject and decrements tallies", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_f", variants: TWO_EVEN });
    const e = await t.mutation(api.example.logExposure, { key: "exp_f", subjectRef: "u1" });
    await t.mutation(api.example.logExposure, { key: "exp_f", subjectRef: "u1" });
    expect(
      await t.mutation(api.example.forgetSubject, { key: "exp_f", subjectRef: "u1" }),
    ).toBe(true);
    expect(
      await t.query(api.example.getAssignment, { key: "exp_f", subjectRef: "u1" }),
    ).toBeNull();
    const res = await t.query(api.example.results, { key: "exp_f" });
    const row = res.find((r) => r.variant === e.variant);
    expect(row).toMatchObject({ assigned: 0, subjects: 0, exposures: 0 });
  });

  test("forgets an assigned-but-never-exposed subject", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_fa", variants: TWO_EVEN });
    await t.mutation(api.example.assign, { key: "exp_fa", subjectRef: "u1" });
    expect(
      await t.mutation(api.example.forgetSubject, { key: "exp_fa", subjectRef: "u1" }),
    ).toBe(true);
    expect(
      await t.query(api.example.getAssignment, { key: "exp_fa", subjectRef: "u1" }),
    ).toBeNull();
  });

  test("forgetting an unknown subject returns false", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_fn", variants: TWO_EVEN });
    expect(
      await t.mutation(api.example.forgetSubject, { key: "exp_fn", subjectRef: "nobody" }),
    ).toBe(false);
  });
});

describe("experiments — deleteExperiment (cascade)", () => {
  test("deletes definition + assignments + exposures + tallies, batched", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_del", variants: TWO_EVEN });
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.example.logExposure, { key: "exp_del", subjectRef: `s_${i}` });
    }
    const firstPass = await t.mutation(api.example.deleteExperiment, {
      key: "exp_del",
      batch: 2,
    });
    expect(firstPass).toBeGreaterThan(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(api.example.getExperiment, { key: "exp_del" })).toBeNull();
    expect(await t.query(api.example.results, { key: "exp_del" })).toEqual([]);
    expect(
      await t.query(api.example.getAssignment, { key: "exp_del", subjectRef: "s_0" }),
    ).toBeNull();
  });

  test("deleting an experiment with no children removes the definition in one pass", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_empty", variants: TWO_EVEN });
    expect(
      await t.mutation(api.example.deleteExperimentDefaults, { key: "exp_empty" }),
    ).toBe(0);
    expect(await t.query(api.example.getExperiment, { key: "exp_empty" })).toBeNull();
  });

  test("deleting an absent experiment is a no-op (returns 0)", async () => {
    const t = setup();
    expect(
      await t.mutation(api.example.deleteExperiment, { key: "never", batch: 200 }),
    ).toBe(0);
  });
});

describe("experiments — host-side conversion measurement (boundary)", () => {
  test("the host records conversions in its own table, joined on the assigned variant", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_c", variants: TWO_EVEN });
    const e = await t.mutation(api.example.logExposure, { key: "exp_c", subjectRef: "buyer" });
    const variant = await t.mutation(api.example.recordConversion, {
      key: "exp_c",
      subjectRef: "buyer",
    });
    expect(variant).toBe(e.variant);
    expect(
      await t.query(api.example.conversionCount, { variant: variant as string }),
    ).toBe(1);
    expect(
      await t.mutation(api.example.recordConversion, {
        key: "exp_c",
        subjectRef: "stranger",
      }),
    ).toBeNull();
  });
});
