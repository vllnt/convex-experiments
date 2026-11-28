import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

// Checks what `npm pack` would publish, then installs the real tarball into a clean
// project outside the workspace, imports its runtime entry points with node, and
// type-checks a strict consumer of every `exports` entry. Run after `pnpm build`.
// Usage: node scripts/test-package.mjs [package-dir]

/** Files an installed package must contain: the docs agents read, and the entry points. */
const required = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/API.md",
  "dist/client/index.js",
  "dist/client/index.d.ts",
  "dist/react/index.js",
  "dist/component/convex.config.js",
  "src/test.ts",
];

/** Contributor and internal files that must never reach the tarball. */
const forbidden = [
  /^AGENTS\.md$/,
  /^ROADMAP\.md$/,
  /^CONTRIBUTING\.md$/,
  /^docs\/(?!API\.md$)/,
  /^example\//,
  /^scripts\//,
  /^\.github\//,
  /(^|\/)__tests__\//,
  /\.(test|spec)\.([cm]?[jt]sx?(\.map)?|d\.[cm]?ts)$/,
];

const repositoryBlob =
  /^https:\/\/github\.com\/vllnt\/convex-experiments\/blob\/[^/]+\/(.+)$/;

/** Installed next to the tarball, pinned to the versions this repo resolved. */
const peers = [
  "convex",
  "react",
  "@types/react",
  "typescript",
  "convex-test",
  "vite",
];

/**
 * A consumer file per `exports` entry (a `.js` twin reuses its extensionless
 * snippet). An export without a snippet fails the test, so none is skipped.
 * @type {Record<string, (specifier: string, name: string) => string>}
 */
const consumers = {
  ".": (
    s,
  ) => `import { Experiments, type ExperimentsComponent, type Variant, type VariantResult } from "${s}";
declare const component: ExperimentsComponent;
export const variants: Variant[] = [{ key: "control", weight: 1 }, { key: "treatment", weight: 1 }];
export const experiments = new Experiments(component, { defaultScope: "app" });
export type Row = VariantResult;
`,
  "./react": (s) => `import { makeFunctionReference } from "convex/server";
import { useAssignment, useExperimentResults, useVariant } from "${s}";
type Args = { scope?: string; key: string; subjectRef: string };
const peek = makeFunctionReference<"query", Args, { variant: string | null }>("example:peek");
export function Banner({ subjectRef }: { subjectRef: string }) {
  const variant = useVariant(peek, { key: "banner", subjectRef });
  return <p>{variant ?? "control"}</p>;
}
export const hooks = { useAssignment, useExperimentResults };
`,
  "./convex.config": (s) => `import { defineApp } from "convex/server";
import experiments from "${s}";
const app = defineApp();
app.use(experiments);
app.use(experiments, { name: "checkout" });
export default app;
`,
  "./_generated/component": (s, name) => `import { Experiments } from "${name}";
import type { ComponentApi } from "${s}";
declare const component: ComponentApi<"experiments">;
export const experiments = new Experiments(component);
`,
  "./test": (s) => `import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { register } from "${s}";
const t = convexTest(defineSchema({ notes: defineTable({ body: v.string() }) }), {});
register(t);
register(t, "checkout");
`,
};

const directory = resolve(process.argv[2] ?? process.cwd());
const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));

/** @type {{ files: { path: string }[] }[]} */
const [pack] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
const packed = new Set(pack.files.map((file) => file.path));
/** @type {string[]} */
const problems = [];

for (const path of required) {
  if (!packed.has(path)) problems.push(`missing from tarball: ${path}`);
}
for (const path of packed) {
  if (forbidden.some((pattern) => pattern.test(path)))
    problems.push(`must not ship: ${path}`);
}

// llms.txt is read from the installed package, so its links must stay inside it.
const index = readFileSync(join(directory, "llms.txt"), "utf8");
for (const [, target] of index.matchAll(/\]\(([^)\s]+)\)/g)) {
  const blob = repositoryBlob.exec(target)?.[1];
  if (blob !== undefined) {
    if (packed.has(blob))
      problems.push(
        `llms.txt links shipped file by URL, use ./${blob}: ${target}`,
      );
  } else if (!/^[a-z][a-z0-9+.-]*:|^#/i.test(target)) {
    const path = target.replace(/^\.\//, "").split("#")[0];
    if (!packed.has(path))
      problems.push(`llms.txt link not in tarball: ${target}`);
  }
}

/** Run a command quietly; on failure, report its output as one problem. */
function run(label, command, args, cwd) {
  try {
    execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
    return true;
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    problems.push(`${label} failed:\n${output || error.message}`);
    return false;
  }
}

/** Version spec that reproduces the repo's resolved copy, including npm: aliases. */
function pinned(peer) {
  const installed = JSON.parse(
    readFileSync(join(directory, "node_modules", peer, "package.json"), "utf8"),
  );
  return installed.name === peer
    ? installed.version
    : `npm:${installed.name}@${installed.version}`;
}

const entries = Object.entries(pkg.exports).filter(
  ([subpath]) => subpath !== "./package.json",
);
const tmp = mkdtempSync(join(tmpdir(), "convex-experiments-package-"));
try {
  const [{ filename }] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", tmp],
      {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    ),
  );
  const dependencies = { [pkg.name]: `file:${join(tmp, filename)}` };
  for (const peer of peers) dependencies[peer] = pinned(peer);
  const project = join(tmp, "consumer");
  mkdirSync(project);
  const write = (file, content) => writeFileSync(join(project, file), content);
  // The repo's pnpm settings carry the blocked build scripts (package.json) and the
  // release-age gate (pnpm-workspace.yaml). The copied workspace file makes the
  // consumer its own workspace root; `--ignore-workspace` would drop its settings.
  write(
    "package.json",
    JSON.stringify({
      private: true,
      type: "module",
      dependencies,
      pnpm: pkg.pnpm,
    }),
  );
  write(
    "pnpm-workspace.yaml",
    readFileSync(join(directory, "pnpm-workspace.yaml"), "utf8"),
  );

  const installed = run(
    "pnpm install of the packed tarball",
    "pnpm",
    ["install", "--no-frozen-lockfile", "--prefer-offline"],
    project,
  );
  if (installed) {
    const runtime = entries
      .filter(([, target]) =>
        typeof target === "string"
          ? /\.m?js$/.test(target)
          : "default" in target,
      )
      .map(([subpath]) => `${pkg.name}${subpath.slice(1)}`);
    write(
      "runtime.mjs",
      `for (const specifier of ${JSON.stringify(runtime)}) {
  const module = await import(specifier);
  if (Object.keys(module).length === 0) throw new Error(\`\${specifier} has no exports\`);
}
`,
    );
    const imported = run(
      "node import of runtime entries",
      "node",
      ["runtime.mjs"],
      project,
    );

    const files = [];
    entries.forEach(([subpath], i) => {
      const consumer = consumers[subpath.replace(/\.js$/, "")];
      if (consumer === undefined) {
        problems.push(`no type-check consumer for export "${subpath}"`);
        return;
      }
      files.push(`entry-${i}.tsx`);
      write(files.at(-1), consumer(`${pkg.name}${subpath.slice(1)}`, pkg.name));
    });
    write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "es2022",
          lib: ["es2022", "dom"],
          module: "nodenext",
          moduleResolution: "nodenext",
          jsx: "react-jsx",
          skipLibCheck: false,
          exactOptionalPropertyTypes: true,
          noEmit: true,
        },
        files,
      }),
    );
    const typescript = JSON.parse(
      readFileSync(
        join(project, "node_modules/typescript/package.json"),
        "utf8",
      ),
    );
    const bin =
      typeof typescript.bin === "string"
        ? typescript.bin
        : Object.entries(typescript.bin).find(([name]) =>
            name.startsWith("tsc"),
          )[1];
    const typed = run(
      "tsc --noEmit of the strict consumer",
      "node",
      [join(project, "node_modules/typescript", bin), "--project", project],
      project,
    );
    if (imported && typed && files.length === entries.length)
      console.log(
        `OK    packed install: node imports ${runtime.length} entries, tsc checks ${files.length} exports`,
      );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL  ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `OK    package contents: ${packed.size} files, llms.txt links resolve`,
  );
}
