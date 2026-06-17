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
      status: "running", // client default
      variants: TWO_EVEN,
      salt: "exp_1", // client salt default = key
      createdAt: 0,
    });
  });

  test("re-define updates (created:false), preserving sticky assignments", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_u", variants: TWO_EVEN });
    const before = await t.mutation(api.example.assign, {
      key: "exp_u",
      subjectRef: "u1",
    });
    // redefine with a new salt + explicit status/scope (full-options path)
    expect(
      await t.mutation(api.example.define, {
        key: "exp_u",
        variants: TWO_EVEN,
        salt: "new_salt",
        status: "running",
        scope: "global",
      }),
    ).toEqual({ created: false });
    const after = await t.query(api.example.getAssignment, {
      key: "exp_u",
      subjectRef: "u1",
    });
    // assignment is untouched by the redefine
    expect(after?.variant).toBe(
      before.variant === null ? undefined : before.variant,
    );
    const def = await t.query(api.example.getExperiment, { key: "exp_u" });
    expect(def?.salt).toBe("new_salt");
  });
});

describe("experiments — define validation (INVALID_VARIANTS)", () => {
  test("empty variant set is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.define, { key: "bad", variants: [] }),
    ).rejects.toThrow();
  });

  test("a zero weight is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.define, {
        key: "bad",
        variants: [{ key: "a", weight: 0 }],
      }),
    ).rejects.toThrow();
  });

  test("a non-finite (Infinity) weight is rejected", async () => {
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

  test("assign on a non-running experiment returns variant:null", async () => {
    const t = setup();
    await t.mutation(api.example.define, {
      key: "draft_exp",
      variants: TWO_EVEN,
      status: "draft",
    });
    expect(
      await t.mutation(api.example.assign, {
        key: "draft_exp",
        subjectRef: "u1",
      }),
    ).toEqual({ variant: null });
  });

  test("first assign enrolls (isNew:true) and persists; second replays (isNew:false)", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_a", variants: TWO_EVEN });
    const first = await t.mutation(api.example.assign, {
      key: "exp_a",
      subjectRef: "u1",
    });
    expect(first).toMatchObject({ isNew: true });
    expect(first.variant).not.toBeNull();
    const second = await t.mutation(api.example.assign, {
      key: "exp_a",
      subjectRef: "u1",
    });
    expect(second).toEqual({ variant: first.variant, isNew: false });

    const stored = await t.query(api.example.getAssignment, {
      key: "exp_a",
      subjectRef: "u1",
    });
    expect(stored).toEqual({ variant: first.variant, assignedAt: 0 });
  });

  test("a stopped experiment no longer enrolls new subjects", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_s", variants: TWO_EVEN });
    await t.mutation(api.example.assign, { key: "exp_s", subjectRef: "early" });
    expect(
      await t.mutation(api.example.setStatus, {
        key: "exp_s",
        status: "stopped",
      }),
    ).toBe(true);
    expect(
      await t.mutation(api.example.assign, { key: "exp_s", subjectRef: "late" }),
    ).toEqual({ variant: null });
    // the early subject's assignment survives the stop
    expect(
      await t.query(api.example.getAssignment, {
        key: "exp_s",
        subjectRef: "early",
      }),
    ).not.toBeNull();
  });
});

describe("experiments — setStatus", () => {
  test("setStatus on an absent experiment returns false", async () => {
    const t = setup();
    expect(
      await t.mutation(api.example.setStatus, {
        key: "nope",
        status: "running",
      }),
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
      await t.mutation(api.example.logExposure, {
        key: "exp_off",
        subjectRef: "u1",
      }),
    ).toEqual({ variant: null });
  });

  test("first exposure inserts a tally; repeats dedupe into one row", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_e", variants: TWO_EVEN });
    const e1 = await t.mutation(api.example.logExposure, {
      key: "exp_e",
      subjectRef: "u1",
    });
    expect(e1.variant).not.toBeNull();
    // re-exposing the same subject keeps a single tallied row (count bumps)
    await t.mutation(api.example.logExposure, { key: "exp_e", subjectRef: "u1" });
    await t.mutation(api.example.logExposure, { key: "exp_e", subjectRef: "u1" });

    const tally = await t.query(api.example.results, { key: "exp_e" });
    expect(tally).toHaveLength(1);
    expect(tally[0]).toEqual({
      variant: e1.variant,
      subjects: 1,
      exposures: 3,
    });
  });

  test("logExposure enrolls a subject that never called assign", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_lazy", variants: TWO_EVEN });
    const e = await t.mutation(api.example.logExposure, {
      key: "exp_lazy",
      subjectRef: "fresh",
    });
    expect(e.variant).not.toBeNull();
    const stored = await t.query(api.example.getAssignment, {
      key: "exp_lazy",
      subjectRef: "fresh",
    });
    expect(stored?.variant).toBe(e.variant);
  });
});

describe("experiments — results aggregation", () => {
  test("an experiment with no exposures returns an empty array", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_empty", variants: TWO_EVEN });
    expect(await t.query(api.example.results, { key: "exp_empty" })).toEqual([]);
  });

  test("tallies group distinct subjects and sum exposures per variant", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_g", variants: TWO_EVEN });
    // expose many subjects so both variants appear and at least one variant
    // collects multiple subjects (covers the new-agg + existing-agg branches)
    const byVariant = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const e = await t.mutation(api.example.logExposure, {
        key: "exp_g",
        subjectRef: `s_${i}`,
      });
      const variant = e.variant as string;
      byVariant.set(variant, (byVariant.get(variant) ?? 0) + 1);
    }
    const tally = await t.query(api.example.results, { key: "exp_g" });
    const total = tally.reduce((sum, r) => sum + r.subjects, 0);
    expect(total).toBe(30);
    for (const r of tally) {
      expect(r.subjects).toBe(byVariant.get(r.variant));
      expect(r.exposures).toBe(byVariant.get(r.variant));
    }
  });
});

describe("experiments — getExperiment / getAssignment projections", () => {
  test("getExperiment returns null for an absent experiment", async () => {
    const t = setup();
    expect(await t.query(api.example.getExperiment, { key: "absent" })).toBeNull();
  });

  test("getAssignment returns null before enrollment", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_p", variants: TWO_EVEN });
    expect(
      await t.query(api.example.getAssignment, {
        key: "exp_p",
        subjectRef: "nobody",
      }),
    ).toBeNull();
  });
});

describe("experiments — scopes (independent namespaces)", () => {
  test("the same key in different scopes is fully independent", async () => {
    const t = setup();
    await t.mutation(api.example.define, {
      key: "shared",
      variants: TWO_EVEN,
      scope: "a",
    });
    // scope "b" has no such experiment
    expect(
      await t.query(api.example.getExperiment, { key: "shared", scope: "b" }),
    ).toBeNull();
    expect(
      await t.mutation(api.example.assign, {
        key: "shared",
        subjectRef: "u1",
        scope: "b",
      }),
    ).toEqual({ variant: null });
    // scope "a" enrolls
    const r = await t.mutation(api.example.assign, {
      key: "shared",
      subjectRef: "u1",
      scope: "a",
    });
    expect(r.variant).not.toBeNull();
  });
});

describe("experiments — scoped client (defaultScope + defaultStatus)", () => {
  test("scoped client defines into its default scope as its default status", async () => {
    const t = setup();
    // scoped client: defaultScope "tenant", defaultStatus "draft"
    expect(
      await t.mutation(api.example.defineScoped, {
        key: "feat",
        variants: TWO_EVEN,
      }),
    ).toEqual({ created: true });
    // it landed in the "tenant" scope, not "global"
    expect(await t.query(api.example.getExperiment, { key: "feat" })).toBeNull();
    const def = await t.query(api.example.getExperimentScoped, { key: "feat" });
    expect(def?.scope).toBe("tenant");
    expect(def?.status).toBe("draft");

    // draft → assign returns null
    expect(
      await t.mutation(api.example.assignScoped, {
        key: "feat",
        subjectRef: "u1",
      }),
    ).toEqual({ variant: null });

    // start it, then the scoped client enrolls within the tenant scope
    expect(
      await t.mutation(api.example.setStatusScoped, {
        key: "feat",
        status: "running",
      }),
    ).toBe(true);
    const r = await t.mutation(api.example.assignScoped, {
      key: "feat",
      subjectRef: "u1",
    });
    expect(r.variant).not.toBeNull();
    expect(
      await t.query(api.example.getAssignmentScoped, {
        key: "feat",
        subjectRef: "u1",
      }),
    ).not.toBeNull();
    expect(await t.query(api.example.resultsScoped, { key: "feat" })).toEqual([]);
  });
});

describe("experiments — host-side conversion measurement (boundary)", () => {
  test("the host records conversions in its own table, joined on the assigned variant", async () => {
    const t = setup();
    await t.mutation(api.example.define, { key: "exp_c", variants: TWO_EVEN });
    const e = await t.mutation(api.example.logExposure, {
      key: "exp_c",
      subjectRef: "buyer",
    });
    const variant = await t.mutation(api.example.recordConversion, {
      key: "exp_c",
      subjectRef: "buyer",
    });
    expect(variant).toBe(e.variant);
    expect(
      await t.query(api.example.conversionCount, { variant: variant as string }),
    ).toBe(1);

    // a subject with no assignment cannot convert
    expect(
      await t.mutation(api.example.recordConversion, {
        key: "exp_c",
        subjectRef: "stranger_who_never_saw_it",
      }),
    ).toBeNull();
  });
});
