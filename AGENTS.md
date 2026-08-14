# AGENTS.md

## What this is

`opencode-plan-canvas` is a Bun/TypeScript CLI that turns a Prometheus-style work plan (Markdown) into a single self-contained, offline HTML "canvas" (GitHub-dark themed). It's deterministic: the same plan produces byte-identical HTML. The repo ships two npm packages: the CLI (`opencode-plan-canvas`, root package, runs on Node ≥20.11 and Bun with zero runtime dependencies) and an optional opencode adapter (`opencode-plan-canvas-plugin`, in `adapter/opencode-plugin/`) that auto-spawns the canvas watch server when a plan changes inside opencode. For depth, read `README.md` and `docs/architecture.md`.

## Project layout

- `src/` — CLI/library source (TypeScript, runs directly under Bun; compiled to `dist/` for Node/npm)
  - `src/cli.ts` — entry/bin
  - `src/index.ts` — library API, exports `generate()`
  - `src/model.ts` — types
  - `src/text.ts` — HTML escaping / inline-markdown allowlist
  - `src/parse/` — Markdown plan parser: `core.ts`, `tldr.ts`, `objectives.ts`, `waves.ts`, `tasks.ts`, `decisions.ts`, `final.ts`, `index.ts`
  - `src/render/` — HTML rendering: `shell.ts`, `hero.ts`, `sections.ts`, `waves.ts`, `interactivity.ts`, `styles.ts`, `index.ts`
  - `src/watch/` — live-reload watch server: `server.ts` (SSE HTTP server), `watcher.ts` (fs.watch + poll)
  - `src/runtime/host.ts` — Bun↔Node runtime shim (`openBrowser` + `serve`); detects `typeof Bun` and uses `Bun.serve`/`Bun.spawn` under Bun, else `node:http` + `node:child_process`. This is what makes the CLI run on both runtimes.
- `adapter/opencode-plugin/` — the opencode plugin (separate package)
  - `plugin.ts` — thin entry, default export only
  - `internal.ts` — helpers / orchestration / config (reachable via the `./internal` subpath)
  - builds via its own `tsconfig.build.json` to `dist/`
- `test/` — 21 test files (382 passing), run with `bun test`. Fixtures in `test/fixtures/`, including `golden-plan.md` + `golden-master.html` (golden-master acceptance test).
- `scripts/postbuild.mjs` — rewrites extensionless relative imports to `*.js` and forces the `#!/usr/bin/env node` shebang on `dist/cli.js` (Node ESM needs extensions; source stays extensionless for Bun).
- `docs/architecture.md` — architecture notes.
- `.github/workflows/` — `ci.yml`, `publish-cli.yml`, `publish-plugin.yml`.

## Commands

```bash
bun test                       # full suite (382 tests). Primary dev loop.
bunx tsc --noEmit              # typecheck root (script: typecheck)
bun run src/cli.ts <plan.md>   # run CLI from source under Bun, no build (script: generate)
npm run build                  # tsc -p tsconfig.build.json && node scripts/postbuild.mjs -> dist/ (ESM, node shebang)
npm run clean                  # rm -rf dist
node dist/cli.js <plan.md>     # Node smoke test on the compiled CLI (after build)
```

Adapter build:

```bash
cd adapter/opencode-plugin && npm run build   # its own tsconfig.build.json
```

You only need `npm run build` for the Node/npm artifact. Day-to-day work runs directly under Bun.

## Critical invariants (DO NOT break)

These are the highest-value rules. Violating any of them breaks published behavior or CI.

1. **`GOLDEN_CSS` in `src/render/styles.ts` is IMMUTABLE.** It's a byte-for-byte copy of a reference stylesheet (~9.6KB). Do NOT edit it — the golden-master acceptance test asserts byte-identical output. Any CSS additions go in the SEPARATE `EXTENSION_CSS` block in the same file, never inside `GOLDEN_CSS`.

2. **Determinism.** `generate()` must stay deterministic: the same plan produces identical HTML. Never introduce timestamps, randomness, or ordering nondeterminism into rendering.

3. **The plugin entry must export ONLY the default Plugin factory.** `adapter/opencode-plugin/plugin.ts` → `dist/plugin.js`. opencode iterates a plugin module's exports and calls EACH as a factory, so leaking a helper or a constant (e.g. a number) there makes opencode throw `Plugin export is not a function`. Helpers live in `internal.ts` (reachable via the `./internal` subpath). Emitted relative imports MUST carry the `.js` extension (Node ESM); the build/scripts handle this, so don't hand-write extensionless imports that ship to `dist`.

4. **Zero runtime dependencies** in the root package — Node built-ins only (`node:fs`, `node:path`, `node:http`, `node:child_process`, `crypto`). `@types/node`, `typescript`, and `bun-types` are devDeps. Do NOT add runtime deps. The adapter's `@opencode-ai/plugin` is a TYPE-ONLY devDependency.

5. **Dual-runtime.** Any new use of a Bun-only API (`Bun.serve`, `Bun.spawn`, etc.) must go through `src/runtime/host.ts` so the Node build still works. Test both: `bun test` AND `node dist/cli.js ...` after build.

6. **OSS hygiene.** This is a public repo. NO proprietary tokens or company names in code, tests, or fixtures. Use SYNTHETIC fixtures. `.sisyphus/` is gitignored (plans/scratch live there and must not be committed).

## Plan-format conventions

The parser reconciles several ways of writing the same task, so know these before editing `src/parse/`.

- Wave-tree entries may be written as `T1:`, bare `1:`, or `Task 1:` (verbose form). All reconcile to the numbered TODO id (`- [x] 1. Title`).
- `normalizeEntryId` in `src/parse/waves.ts` maps `T1`/`Task 1` → `1`, `F1` → `1`, `T8b`/`Task 8b` → `8b`.
- Final-verification entries are `F1`, `F2`, … and belong to a separate list.
- Escaping: everything plan-derived is HTML-escaped. Only a tiny inline-markdown allowlist is honored (`code`, **bold**, links to http/https/#). Never introduce a raw-HTML injection path.

## Release flow

Automated and immutable. Trusted publishing via GitHub Actions OIDC (no npm tokens), with provenance attestations, immutable git tags, and GitHub Releases.

- CLI: bump ROOT `package.json` version, commit, push tag `v<x.y.z>` → `publish-cli.yml` publishes.
- Plugin: bump `adapter/opencode-plugin/package.json` version, commit, push tag `plugin-v<x.y.z>` → `publish-plugin.yml` publishes.
- npm versions are IMMUTABLE. Always bump before tagging; never reuse a version.
- opencode caches `@latest` plugins under `~/.cache/opencode/packages/<name>@latest/`. A new version needs a cache clear plus an opencode restart to load.

Current versions: CLI `v0.1.2`, plugin `v0.2.2` (both published with provenance).

## Testing

- `bun test` is the primary loop (382 passing across 21 files).
- The golden-master acceptance test compares generated output against `test/fixtures/golden-master.html`. If it fails after a rendering change, confirm you didn't touch `GOLDEN_CSS` or add nondeterminism before regenerating any fixture.
- After a Node-targeted change, run the full dual-runtime check: `bun test`, `npm run build`, then `node dist/cli.js <plan.md>`.
