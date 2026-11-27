import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Kept for existing automation; llms.txt is curated, not generated from source.
// Links to shipped files are checked against the packed tarball by scripts/test-package.mjs.
const index = readFileSync("llms.txt", "utf8");
assert.ok(index.startsWith("# @vllnt/convex-experiments\n"));
assert.ok(index.includes("[README](./README.md)"));
assert.ok(index.includes("[API Reference](./docs/API.md)"));
assert.ok(index.includes("[Changelog](./CHANGELOG.md)"));
assert.ok(index.includes("## For coding agents"));
assert.ok(index.includes("node_modules/@vllnt/convex-experiments/docs/"));
assert.ok(index.includes("## Ecosystem"));
assert.ok(index.includes("(https://oss.vllnt.com/llms.txt)"));
