import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

// Checks what `npm pack` would publish, without installing anything. Run after `pnpm build`.
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

const directory = resolve(process.argv[2] ?? process.cwd());

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

if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL  ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `OK    package contents: ${packed.size} files, llms.txt links resolve`,
  );
}
