import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");

// tsc with `moduleResolution: bundler` emits extensionless relative specifiers
// (e.g. `./parse/index`). Node's ESM loader requires explicit `.js` extensions,
// so rewrite relative import/export specifiers in emitted output to add `.js`.
// Source stays extensionless so the Bun path and the test suite are untouched.
const REL_SPEC = /(\bfrom\s*["'])(\.\.?\/[^"']+?)(["'])/g;

function addJsExt(spec) {
  if (/\.(js|json|mjs|cjs)$/.test(spec)) return spec;
  return `${spec}.js`;
}

function rewriteFile(file) {
  const src = readFileSync(file, "utf-8");
  const out = src.replace(REL_SPEC, (_m, pre, spec, post) => `${pre}${addJsExt(spec)}${post}`);
  if (out !== src) writeFileSync(file, out, "utf-8");
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith(".js") || full.endsWith(".d.ts")) {
      rewriteFile(full);
    }
  }
}

walk(distDir);

const cli = join(distDir, "cli.js");
const NODE_SHEBANG = "#!/usr/bin/env node";
const lines = readFileSync(cli, "utf-8").split("\n");
if (lines[0].startsWith("#!")) {
  lines[0] = NODE_SHEBANG;
} else {
  lines.unshift(NODE_SHEBANG);
}
writeFileSync(cli, lines.join("\n"), "utf-8");
chmodSync(cli, 0o755);

console.log(`post-build: relative specifiers -> *.js; dist/cli.js shebang -> ${NODE_SHEBANG}`);
