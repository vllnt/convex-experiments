/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    mutations: {
      assign: FunctionReference<
        "mutation",
        "internal",
        { key: string; scope: string; subjectRef: string },
        { variant: null } | { isNew: boolean; variant: string },
        Name
      >;
      define: FunctionReference<
        "mutation",
        "internal",
        {
          key: string;
          salt: string;
          scope: string;
          status: "draft" | "running" | "stopped";
          variants: Array<{ key: string; weight: number }>;
        },
        { created: boolean },
        Name
      >;
      logExposure: FunctionReference<
        "mutation",
        "internal",
        { key: string; scope: string; subjectRef: string },
        { variant: null } | { variant: string },
        Name
      >;
      setStatus: FunctionReference<
        "mutation",
        "internal",
        { key: string; scope: string; status: "draft" | "running" | "stopped" },
        boolean,
        Name
      >;
    };
    queries: {
      getAssignment: FunctionReference<
        "query",
        "internal",
        { key: string; scope: string; subjectRef: string },
        null | { assignedAt: number; variant: string },
        Name
      >;
      getExperiment: FunctionReference<
        "query",
        "internal",
        { key: string; scope: string },
        null | {
          createdAt: number;
          key: string;
          salt: string;
          scope: string;
          status: "draft" | "running" | "stopped";
          variants: Array<{ key: string; weight: number }>;
        },
        Name
      >;
      results: FunctionReference<
        "query",
        "internal",
        { key: string; scope: string },
        Array<{ exposures: number; subjects: number; variant: string }>,
        Name
      >;
    };
  };
