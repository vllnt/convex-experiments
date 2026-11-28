import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";

import ts from "typescript";

// Agent-first docs check, run by `pnpm test:package` (CI Build job, after
// `pnpm build`). Fails when the README loses a required section or its order,
// the install command or first example moves below line 40, a code block has no
// language or a `...` gap, a relative link or anchor breaks, a public export
// lacks TSDoc or a README API row, an error code, reason or message is missing
// from "Errors and fixes", a README or docs/API.md TypeScript example stops
// type-checking against the built package (dist/), or the shared vllnt blocks
// (README Links and footer, llms.txt Ecosystem) drift. It also fails when a
// shipped or tracked file mentions the retired vllnt domain.

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");
const errors = [];
const fail = (message) => errors.push(message);

const pkg = JSON.parse(read("package.json"));
const NAME = pkg.name.replace(/^@[^/]+\//, "");
const REPO = String(pkg.repository?.url ?? "")
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");
const OSS = "https://oss.vllnt.com";
const DOCS = ["README.md", "docs/API.md", "llms.txt", "CHANGELOG.md"];
const README = read("README.md");
const API = read("docs/API.md");
const LLMS = read("llms.txt");
const readmeLines = README.split("\n");

if (!existsSync(join(ROOT, "dist/client/index.d.ts"))) {
  console.error("FAIL dist/ is missing: run `pnpm build` before this check");
  process.exit(1);
}

// ── Markdown helpers ─────────────────────────────────────────────────────────
function codeBlocks(markdown, file) {
  const blocks = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("```")) continue;
    const end = lines.findIndex((l, j) => j > i && l.startsWith("```"));
    if (end === -1) {
      fail(`${file}:${i + 1} code block is not closed`);
      break;
    }
    blocks.push({
      file,
      lang: lines[i].slice(3).trim(),
      line: i + 1,
      code: lines.slice(i + 1, end).join("\n"),
    });
    i = end;
  }
  return blocks;
}

function headings(markdown) {
  const out = [];
  let fenced = false;
  markdown.split("\n").forEach((line, index) => {
    if (line.startsWith("```")) fenced = !fenced;
    const match = !fenced && /^(#{1,6}) (.+)$/.exec(line);
    if (match)
      out.push({
        level: match[1].length,
        text: match[2].trim(),
        line: index + 1,
      });
  });
  return out;
}

const slug = (text) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");

function anchors(file) {
  const seen = new Map();
  return new Set(
    headings(read(file)).map(({ text }) => {
      const base = slug(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base}-${count}`;
    }),
  );
}

function section(markdown, name) {
  const lines = markdown.split("\n");
  const at = headings(markdown).find((h) => h.level === 2 && h.text === name);
  if (!at) return "";
  const next = headings(markdown).find((h) => h.level <= 2 && h.line > at.line);
  return lines.slice(at.line, next ? next.line - 1 : undefined).join("\n");
}

const tableRows = (text) => text.split("\n").filter((l) => l.startsWith("|"));

// ── README structure ─────────────────────────────────────────────────────────
const SECTIONS = [
  "For coding agents",
  "When to use",
  "Install",
  "Quick start",
  "API",
  "Common tasks",
  "Errors and fixes",
  "Limits and gotchas",
  "Compatibility",
  "Testing",
  "Security",
  "Related packages",
  "Contributing",
  "Links",
  "License",
];
const readmeHeadings = headings(README);
if (readmeLines[0] !== `# ${pkg.name}`)
  fail(`README line 1 must be "# ${pkg.name}"`);
const h2 = readmeHeadings.filter((h) => h.level === 2).map((h) => h.text);
if (JSON.stringify(h2) !== JSON.stringify(SECTIONS))
  fail(
    `README "##" sections must be exactly, in order: ${SECTIONS.join(" > ")}; found ${h2.join(" > ")}`,
  );
for (const name of SECTIONS) {
  if (h2.includes(name) && section(README, name).trim() === "")
    fail(`README "## ${name}" is empty; say in one line why it does not apply`);
}

const agentsNote = section(README, "For coding agents").trim().split("\n");
if (agentsNote.length > 3)
  fail(
    `README "For coding agents" must be 3 lines at most (has ${agentsNote.length})`,
  );

const whenToUse = section(README, "When to use");
const useBullets = (whenToUse.match(/^- Use it when /gm) ?? []).length;
const avoidBullets = (whenToUse.match(/^- Do not use it when /gm) ?? []).length;
if (useBullets < 2 || useBullets > 4)
  fail(
    `README "When to use" needs 2 to 4 "- Use it when" bullets (has ${useBullets})`,
  );
if (avoidBullets < 1 || avoidBullets > 3)
  fail(
    `README "When to use" needs 1 to 3 "- Do not use it when" bullets (has ${avoidBullets})`,
  );

const installLine =
  readmeLines.findIndex((l) =>
    new RegExp(
      `^(npm|pnpm|yarn|bun) (install|add) ${pkg.name.replace("/", "\\/")}`,
    ).test(l),
  ) + 1;
if (installLine === 0 || installLine > 40)
  fail(
    `README install command must be within lines 1-40 (line ${installLine || "none"})`,
  );
const quickStart = readmeHeadings.find((h) => h.text === "Quick start");
const firstExample = quickStart
  ? codeBlocks(README, "README.md").find((b) => b.line > quickStart.line)
  : undefined;
if (!firstExample || firstExample.line > 40)
  fail(
    `README first Quick start example must start within lines 1-40 (line ${firstExample?.line ?? "none"})`,
  );
readmeLines.forEach((l, i) => {
  if (
    /img\.shields\.io|badge\.svg/.test(l) &&
    (!quickStart || i + 1 < quickStart.line)
  )
    fail(`README:${i + 1} badges must sit below the Quick start`);
  if (/!\[\]\(/.test(l)) fail(`README:${i + 1} image has no alt text`);
});

// ── Identity: description, keywords, shared blocks ───────────────────────────
const description = String(pkg.description ?? "");
if (
  description.length === 0 ||
  description.length > 160 ||
  !description.endsWith(".") ||
  description.includes(". ")
)
  fail(
    "package.json description must be one sentence of at most 160 characters",
  );
if (
  !Array.isArray(pkg.keywords) ||
  new Set(pkg.keywords).size !== pkg.keywords.length ||
  pkg.keywords.length < 8 ||
  pkg.keywords.length > 12
)
  fail("package.json keywords must be 8 to 12 unique entries");
if (
  readmeLines[1] !== "" ||
  readmeLines[2] !== description ||
  readmeLines[3] !== ""
)
  fail("README line 3 (under the title) must be the package.json description");
const llmsLines = LLMS.split("\n");
if (llmsLines[0] !== `# ${pkg.name}` || llmsLines[2] !== `> ${description}`)
  fail(
    'llms.txt must start with "# <name>", then "> <package.json description>"',
  );

const LINKS = [
  "",
  `- Docs and changelog: [oss.vllnt.com/packages/${NAME}](${OSS}/packages/${NAME}) · [release feed](${OSS}/packages/${NAME}/rss.xml)`,
  `- All @vllnt packages: [oss.vllnt.com](${OSS}) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)`,
  `- Source and issues: [GitHub](${REPO}) · [issues](${REPO}/issues) · [npm](https://www.npmjs.com/package/${pkg.name})`,
  "- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)",
  "- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)",
  "- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)",
  "",
].join("\n");
if (section(README, "Links") !== LINKS)
  fail('README "## Links" must be exactly the shared vllnt Links list');
const FOOTER = `---\n\nPart of [vllnt open source](${OSS}) · [Package page](${OSS}/packages/${NAME}) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)\n`;
if (!README.endsWith(FOOTER))
  fail(
    'README must end with the vllnt footer ("---" then "Part of [vllnt open source]...")',
  );
const ECOSYSTEM = [
  "## Ecosystem",
  "",
  `- [Package page](${OSS}/packages/${NAME})`,
  `- [Release feed](${OSS}/packages/${NAME}/rss.xml)`,
  `- [All @vllnt packages](${OSS}/llms.txt)`,
  "- [Search vllnt packages and docs](https://index.vllnt.com)",
  "- [vllnt](https://vllnt.com/llms.txt)",
  "- [Author](https://bntvllnt.com)",
  "",
].join("\n");
if (!LLMS.endsWith(ECOSYSTEM))
  fail("llms.txt must end with the vllnt Ecosystem block");
for (const needle of [
  "\n## When to use\n",
  "](./docs/API.md)",
  "](./docs/API.md#error-codes)",
])
  if (!LLMS.includes(needle))
    fail(`llms.txt must contain ${JSON.stringify(needle)}`);

// Related packages: only @vllnt packages used in code (dependency or import).
const used = new Set(
  Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).filter((n) =>
    n.startsWith("@vllnt/"),
  ),
);
const tracked = execFileSync("git", ["ls-files"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
for (const file of tracked.filter((f) =>
  /^(src|example)\/.*\.[cm]?[jt]sx?$/.test(f),
)) {
  for (const [, name] of read(file).matchAll(
    /\bfrom\s+["'](@vllnt\/[a-z0-9-]+)/g,
  ))
    used.add(name);
}
used.delete(pkg.name);
const related = section(README, "Related packages").trim();
if (used.size === 0 && !/^None\.[^\n]*$/.test(related))
  fail(
    'README "## Related packages" must be one "None. ..." line: no @vllnt package is used in code',
  );
for (const name of used)
  if (!related.includes(`[\`${name}\`](${OSS}/packages/${name.slice(7)})`))
    fail(`README "## Related packages" must link ${name} to its package page`);

// ── Code blocks ──────────────────────────────────────────────────────────────
const allBlocks = DOCS.flatMap((file) => codeBlocks(read(file), file));
for (const block of allBlocks) {
  if (!block.lang)
    fail(`${block.file}:${block.line} code block has no language tag`);
}
const examples = allBlocks.filter(
  (b) =>
    (b.file === "README.md" || b.file === "docs/API.md") &&
    /^tsx?$/.test(b.lang),
);
for (const block of examples) {
  const where = `${block.file}:${block.line}`;
  if (
    /\.\.\.(?![\w$({[])/.test(block.code) ||
    /(\/\/|\/\*).*(\.\.\.|…)/.test(block.code)
  )
    fail(`${where} code block has a "..." gap`);
  block.path = /^\/\/ (\S+\.tsx?)$/m.exec(block.code.split("\n")[0])?.[1];
  if (!block.path) fail(`${where} must start with a "// <path>.ts" comment`);
}

// ── Relative links and anchors ───────────────────────────────────────────────
for (const file of DOCS) {
  const text = read(file).replace(/```[\s\S]*?```/g, "");
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [path, hash] = target.split("#");
    const dest = path ? join(dirname(file), path) : file;
    if (!existsSync(join(ROOT, dest)))
      fail(`${file}: link ${target} does not resolve`);
    else if (hash !== undefined && !anchors(dest).has(hash))
      fail(`${file}: link ${target} has no heading #${hash}`);
  }
}

// ── Exports: TSDoc, README API table, docs/API.md heading ────────────────────
const apiTable = tableRows(section(README, "API"));
const apiAnchors = anchors("docs/API.md");
const ENTRIES = Object.keys(pkg.exports).filter(
  (key) => key !== "./package.json" && !key.endsWith(".js"),
);
const COMPILER = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
  types: ["vite/client"],
  jsx: ts.JsxEmit.ReactJSX,
  isolatedModules: true,
};

/** A compiler host over real files plus `virtual` (absolute path → text). */
function programOf(virtual) {
  const host = ts.createCompilerHost(COMPILER);
  const { fileExists, readFile, getSourceFile, directoryExists } = host;
  const dirs = new Set(
    [...virtual.keys()].flatMap((f) => {
      const out = [];
      for (let d = dirname(f); d.startsWith(ROOT) && d !== ROOT; d = dirname(d))
        out.push(d);
      return out;
    }),
  );
  host.fileExists = (f) => virtual.has(f) || fileExists.call(host, f);
  host.readFile = (f) => virtual.get(f) ?? readFile.call(host, f);
  host.directoryExists = (d) => dirs.has(d) || directoryExists.call(host, d);
  host.getSourceFile = (f, lang, ...rest) =>
    virtual.has(f)
      ? ts.createSourceFile(f, virtual.get(f), lang)
      : getSourceFile.call(host, f, lang, ...rest);
  return ts.createProgram([...virtual.keys()], COMPILER, host);
}

// The probe sits inside the package, so `@vllnt/<name>` resolves through the
// package.json `exports` self-reference: dist/ types (and src/test.ts for ./test).
const VIRTUAL = join(ROOT, ".docs-check");
const probeFile = join(VIRTUAL, "probe.ts");
const probe = programOf(
  new Map([
    [
      probeFile,
      ENTRIES.map(
        (key, i) => `import * as e${i} from "${pkg.name}${key.slice(1)}";`,
      ).join("\n"),
    ],
  ]),
);
const checker = probe.getTypeChecker();
const hasDoc = (symbol) =>
  ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()
    .length > 0;
const rowLinks = (row) =>
  [...row.matchAll(/\]\(docs\/API\.md#([^)]+)\)/g)].map((m) => m[1]);
const imports = probe
  .getSourceFile(probeFile)
  .statements.filter(ts.isImportDeclaration);

imports.forEach((statement, i) => {
  const entry = `${pkg.name}${ENTRIES[i].slice(1)}`;
  const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
  if (!moduleSymbol) {
    fail(`cannot resolve ${entry} (is dist/ built?)`);
    return;
  }
  const file = moduleSymbol.valueDeclaration?.getSourceFile().fileName ?? "";
  const generated = /\/_generated\//.test(file);
  for (let symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.getName();
    const label =
      name === "default" ? `${entry} default export` : `${name} (${entry})`;
    if (symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    if (!generated && !hasDoc(symbol)) fail(`TSDoc summary missing: ${label}`);
    const row = apiTable.find((l) =>
      name === "default"
        ? l.includes("`default`") && l.includes(`\`${entry}\``)
        : l.includes(`[\`${name}\`]`) &&
          (i === 0 || l.includes(`\`${entry}\``)),
    );
    if (!row) fail(`README "## API" table has no row for ${label}`);
    else if (rowLinks(row).length === 0)
      fail(`README "## API" row for ${label} must link into docs/API.md`);
    if (!(symbol.flags & ts.SymbolFlags.Class)) continue;
    const ctor = symbol.members?.get("__constructor");
    if (!ctor || !hasDoc(ctor))
      fail(`TSDoc summary missing: ${name} constructor`);
    for (const member of checker.getPropertiesOfType(
      checker.getDeclaredTypeOfSymbol(symbol),
    )) {
      const decl = member.valueDeclaration;
      const hidden =
        decl &&
        ts.getCombinedModifierFlags(decl) &
          ts.ModifierFlags.NonPublicAccessibilityModifier;
      if (hidden || !(member.flags & ts.SymbolFlags.Method)) continue;
      const method = member.getName();
      if (!hasDoc(member)) fail(`TSDoc summary missing: ${name}.${method}`);
      const methodRow = apiTable.find((l) => l.includes(`[\`${method}(`));
      if (!methodRow)
        fail(`README "## API" table has no row for ${name}.${method}`);
      else if (!rowLinks(methodRow).includes(slug(method)))
        fail(
          `README "## API" row for ${name}.${method} must link docs/API.md#${slug(method)}`,
        );
    }
  }
});
for (const row of apiTable)
  for (const anchor of rowLinks(row))
    if (!apiAnchors.has(anchor))
      fail(`README "## API" links docs/API.md#${anchor}, which does not exist`);
if (!read("dist/client/index.d.ts").includes(`@see ${OSS}/packages/${NAME}`))
  fail(
    `dist/client/index.d.ts must carry "@see ${OSS}/packages/${NAME}" on the main export`,
  );

// ── Errors: every code, reason and literal message thrown in src/ ────────────
const errorsSection = section(README, "Errors and fixes");
const errorCells = tableRows(errorsSection).map((l) =>
  l.split(" | ").slice(0, 2).join(" | "),
);
const referenceErrors = section(API, "Error codes");
const sources = tracked.filter(
  (f) =>
    /^src\/.*\.tsx?$/.test(f) &&
    !/\.test\.tsx?$/.test(f) &&
    !/\/_generated\//.test(f),
);
let thrown = 0;
for (const file of sources) {
  const text = read(file);
  for (const [, code] of text.matchAll(/\bcode:\s*"([A-Z][A-Z0-9_]+)"/g)) {
    thrown++;
    if (!errorCells.some((c) => c.includes(`\`${code}\``)))
      fail(`README "## Errors and fixes" does not list ${code} (${file})`);
    if (!referenceErrors.includes(`\`${code}\``))
      fail(`docs/API.md "## Error codes" does not list ${code} (${file})`);
  }
  for (const [, reason] of text.matchAll(/\breason:\s*"([a-z_]+)"/g)) {
    thrown++;
    if (!errorCells.some((c) => c.includes(`reason: "${reason}"`)))
      fail(
        `README "## Errors and fixes" does not list reason: "${reason}" (${file})`,
      );
  }
  for (const [, message] of text.matchAll(
    /(?:\bmessage:\s*|new Error\()\s*"([^"]+)"/g,
  )) {
    thrown++;
    if (!errorCells.some((c) => c.includes(`\`${message}\``)))
      fail(
        `README "## Errors and fixes" does not list the message "${message}" (${file})`,
      );
  }
}
if (thrown === 0)
  fail("found no thrown error codes in src/; update the pattern");

// ── README and docs/API.md examples type-check against dist/ ─────────────────
// Examples are placed at their `// <path>` inside a virtual host app; `convex/_generated`
// is stubbed from the example modules and the mounts in the `convex.config.ts` examples.
const host = new Map();
const placed = [];
for (const block of examples.filter((b) => b.path)) {
  const copies = placed.filter((p) => p.path === block.path).length;
  const path =
    copies === 0 ? block.path : block.path.replace(/(\.tsx?)$/, `.${copies}$1`);
  placed.push({ ...block, path: block.path, at: path });
  host.set(join(VIRTUAL, path), `${block.code}\n`);
}
const component = /defineComponent\(\s*"([^"]+)"/.exec(
  read("src/component/convex.config.ts"),
)?.[1];
const mounts = new Set(
  placed
    .filter((b) => b.path.endsWith("convex.config.ts"))
    .flatMap((b) => [
      ...b.code.matchAll(
        /app\.use\(\s*\w+\s*(?:,\s*\{\s*name:\s*"([^"]+)"\s*\})?\s*\)/g,
      ),
    ])
    .map((m) => m[1] ?? component),
);
const modules = [...new Set(placed.map((b) => b.at))].filter(
  (p) =>
    /^convex\/[^/]+\.ts$/.test(p) && !/convex\.config|\.test\.|schema/.test(p),
);
const moduleName = (p) => p.slice("convex/".length, -".ts".length);
const stubs = {
  "convex/_generated/api.ts": [
    `import type { ComponentApi } from "${pkg.name}/_generated/component";`,
    'import { anyApi, componentsGeneric, type ApiFromModules, type FilterApi, type FunctionReference } from "convex/server";',
    ...modules.map(
      (p, i) => `import type * as m${i} from "../${moduleName(p)}.js";`,
    ),
    `type FullApi = ApiFromModules<{ ${modules.map((p, i) => `"${moduleName(p)}": typeof m${i};`).join(" ")} }>;`,
    'export const api = anyApi as unknown as FilterApi<FullApi, FunctionReference<"query" | "mutation" | "action", "public">>;',
    'export const internal = anyApi as unknown as FilterApi<FullApi, FunctionReference<"query" | "mutation" | "action", "internal">>;',
    `export const components = componentsGeneric() as unknown as { ${[...mounts].map((m) => `"${m}": ComponentApi;`).join(" ")} };`,
  ].join("\n"),
  "convex/_generated/server.ts": [
    'import { internalMutationGeneric, internalQueryGeneric, mutationGeneric, queryGeneric, type DataModelFromSchemaDefinition, type MutationBuilder, type QueryBuilder } from "convex/server";',
    'import type schema from "../schema.js";',
    "type DataModel = DataModelFromSchemaDefinition<typeof schema>;",
    'export const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;',
    'export const internalMutation = internalMutationGeneric as MutationBuilder<DataModel, "internal">;',
    'export const query = queryGeneric as QueryBuilder<DataModel, "public">;',
    'export const internalQuery = internalQueryGeneric as QueryBuilder<DataModel, "internal">;',
  ].join("\n"),
  "convex/schema.ts":
    'import { defineSchema } from "convex/server";\nexport default defineSchema({});\n',
};
for (const [path, code] of Object.entries(stubs)) {
  if (!host.has(join(VIRTUAL, path)))
    host.set(join(VIRTUAL, path), `${code}\n`);
}
const typed = programOf(host);
for (const diagnostic of ts.getPreEmitDiagnostics(typed)) {
  const file = diagnostic.file?.fileName ?? "";
  const block = placed.find((b) => join(VIRTUAL, b.at) === file);
  const at =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line
      : 0;
  const where = block
    ? `${block.file}:${block.line + 1 + at}`
    : relative(ROOT, file) || "tsc";
  fail(
    `${where}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
  );
}

// ── No retired domain in shipped or tracked files ────────────────────────────
const RETIRED = ["vllnt", "ai"].join(".");
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
)[0].files.map((f) => f.path);
const listFiles = (dir) =>
  readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(ROOT, join(e.parentPath, e.name)));
for (const file of new Set([...packed, ...tracked, ...listFiles("dist")])) {
  if (
    existsSync(join(ROOT, file)) &&
    read(file).toLowerCase().includes(RETIRED)
  )
    fail(`${file} mentions ${RETIRED}; use the vllnt.com URL`);
}

if (errors.length > 0) {
  for (const message of errors) console.error(`FAIL ${message}`);
  process.exit(1);
}
console.log(
  `OK    docs: ${SECTIONS.length} README sections in order, ${allBlocks.length} code blocks tagged, ${placed.length} examples type-check against dist/, ${thrown} error codes, reasons and messages documented`,
);
