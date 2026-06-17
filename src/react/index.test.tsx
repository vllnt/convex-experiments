// @vitest-environment jsdom

/**
 * Tests for the optional `./react` front-tooling layer. Runs under jsdom (per-file
 * pragma; the global vitest env is edge-runtime). `convex/react` is mocked so the
 * hooks are exercised as thin pass-throughs to `useQuery`.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import { useAssignment, useExperimentResults, useVariant } from "./index.js";
import type { Assignment, VariantResult } from "../client/types.js";

vi.mock("convex/react", () => ({ useQuery: vi.fn() }));
const useQueryMock = vi.mocked(useQuery);

const peekRef = "experiments.peek" as unknown as FunctionReference<
  "query",
  "public",
  { scope?: string; key: string; subjectRef: string },
  { variant: string | null }
>;
const assignmentRef = "experiments.getAssignment" as unknown as FunctionReference<
  "query",
  "public",
  { scope?: string; key: string; subjectRef: string },
  Assignment | null
>;
const resultsRef = "experiments.results" as unknown as FunctionReference<
  "query",
  "public",
  { scope?: string; key: string },
  VariantResult[]
>;

describe("useVariant", () => {
  test("returns undefined while loading", () => {
    useQueryMock.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useVariant(peekRef, { key: "exp", subjectRef: "u1" }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(peekRef, { key: "exp", subjectRef: "u1" });
    expect(result.current).toBeUndefined();
  });

  test("returns the variant key when enrolled", () => {
    useQueryMock.mockReturnValue({ variant: "treatment" });
    const { result } = renderHook(() =>
      useVariant(peekRef, { key: "exp", subjectRef: "u1" }),
    );
    expect(result.current).toBe("treatment");
  });

  test("returns null when not enrolled", () => {
    useQueryMock.mockReturnValue({ variant: null });
    const { result } = renderHook(() =>
      useVariant(peekRef, { key: "exp", subjectRef: "u1" }),
    );
    expect(result.current).toBeNull();
  });
});

describe("useAssignment", () => {
  test("forwards to useQuery and returns its data", () => {
    const data: Assignment = { variant: "control", assignedAt: 1 };
    useQueryMock.mockReturnValue(data);
    const { result } = renderHook(() =>
      useAssignment(assignmentRef, { key: "exp", subjectRef: "u1" }),
    );
    expect(result.current).toBe(data);
  });
});

describe("useExperimentResults", () => {
  test("forwards to useQuery and returns its data", () => {
    const data: VariantResult[] = [
      { variant: "control", assigned: 1, subjects: 1, exposures: 2, weight: 1 },
    ];
    useQueryMock.mockReturnValue(data);
    const { result } = renderHook(() => useExperimentResults(resultsRef, { key: "exp" }));
    expect(result.current).toBe(data);
  });
});
