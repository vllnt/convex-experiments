import { describe, expect, test } from "vitest";
import { fnv1a, pickVariant, type Variant } from "./shared";

describe("fnv1a", () => {
  test("is deterministic for the same input", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
  });

  test("differs for different inputs and returns an unsigned 32-bit int", () => {
    const a = fnv1a("salt:user_1");
    const b = fnv1a("salt:user_2");
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(0x100000000);
    expect(Number.isInteger(a)).toBe(true);
  });
});

describe("pickVariant", () => {
  test("an empty variant set throws (guarded precondition)", () => {
    expect(() => pickVariant([], "s", "u")).toThrow(/at least one variant/);
  });

  test("a single variant always wins (final-bucket path, no loop)", () => {
    const variants: Variant[] = [{ key: "only", weight: 1 }];
    for (let i = 0; i < 20; i++) {
      expect(pickVariant(variants, "s", `u${i}`)).toBe("only");
    }
  });

  test("is sticky — same (salt, subject) always maps to the same variant", () => {
    const variants: Variant[] = [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
    ];
    const first = pickVariant(variants, "exp", "user_42");
    for (let i = 0; i < 10; i++) {
      expect(pickVariant(variants, "exp", "user_42")).toBe(first);
    }
  });

  test("changing the salt can re-randomize a subject's bucket", () => {
    const variants: Variant[] = [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
    ];
    // Across many subjects, the two salts disagree at least once.
    let differs = false;
    for (let i = 0; i < 50 && !differs; i++) {
      differs =
        pickVariant(variants, "salt_1", `u${i}`) !==
        pickVariant(variants, "salt_2", `u${i}`);
    }
    expect(differs).toBe(true);
  });

  test("covers both the early-return and final-bucket branches across subjects", () => {
    const variants: Variant[] = [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(pickVariant(variants, "spread", `subject_${i}`));
    }
    expect(seen).toEqual(new Set(["a", "b"]));
  });

  test("respects weights — a dominant variant wins the vast majority", () => {
    const variants: Variant[] = [
      { key: "rare", weight: 1 },
      { key: "common", weight: 99 },
    ];
    let common = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      if (pickVariant(variants, "w", `s_${i}`) === "common") {
        common++;
      }
    }
    // ~99% expected; assert a wide, deterministic-safe band.
    expect(common).toBeGreaterThan(n * 0.9);
  });
});
