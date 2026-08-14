# opencode-plan-canvas-plugin (optional adapter)

This is an **optional** [opencode](https://opencode.ai) plugin for
`opencode-plan-canvas`. It is **not required** for anything to work.

## Why it exists

`opencode-plan-canvas watch <plan.md>` watches the plan (and the
`.sisyphus/boulder.json` file) on disk with a native `fs.watch`-based watcher.
That watcher regenerates the canvas and pushes a live-reload event over SSE all
on its own — with **zero** dependency on opencode.

This plugin does three things while you work inside opencode:

1. **Auto-spawns the watch server for you (default ON).** When a plan or boulder
   file changes and no server is already listening, the plugin launches
   `opencode-plan-canvas watch <plan> --port <port>` itself and lets the CLI open
   your browser. You no longer have to run `npx opencode-plan-canvas watch <plan>`
   by hand — just edit a plan and the canvas appears.
2. **Nudges an already-running server to be snappier.** Inside an opencode
   session, file changes are sometimes buffered or written in ways that a bare
   `fs.watch` notices a beat later. When a server is already up, the plugin sends
   a tiny `POST /refresh` so it re-reads and regenerates immediately (bypassing
   the debounce).
3. **Relays canvas messages to the agent (when the server runs with
   `--enable-messaging`).** The canvas can queue user prompts as files under
   `.sisyphus/outbox/`; the plugin delivers each one into your active opencode
   session. This only works with the plugin loaded — the watch server alone has
   no way to reach the agent. See [Message relay](#message-relay) below.

When opencode shuts down, the plugin kills the server it spawned (via the
`dispose` hook and process-exit handlers), so it never leaves a zombie holding
port `4499`.

If you never install this plugin, the watch server still behaves exactly the
same when you start it yourself — just with normal `fs.watch` latency and no
auto-spawn. **The core tool does not know this plugin exists.**

## What it does

- Subscribes to opencode's `file.watcher.updated` event.
- When the changed path matches `**/.sisyphus/plans/*.md` or
  `**/.sisyphus/boulder.json`, it first probes the watch server with a
  `POST /refresh` to `http://127.0.0.1:<port>/refresh` (default port `4499`):
  - **If a server answers**, that nudge forces an immediate re-read/regen and the
    plugin is done (no spawn).
  - **If nothing answers** and auto-spawn is enabled (the default), the plugin
    spawns the `watch` server for the resolved plan. The spawned CLI opens the
    browser itself.
- Any other path (e.g. `src/foo.ts`) is ignored — no request and no spawn.

Spawning is **deduplicated**: a burst of rapid events produces at most one
server. The child is spawned detached with its stdio ignored and `unref`'d, so
it never holds opencode open, and it is killed on opencode exit.

The `/refresh` endpoint is a no-auth, localhost-only development nudge. It only
triggers an immediate re-read/regen of the plan the watch server is already
watching; it carries no payload and cannot write back to any file.

### Message relay

When the watch server runs with `--enable-messaging`, the canvas shows a prompt
box (and a per-task "send message" button). Each message is written by the
server as one JSON file under `<root>/.sisyphus/outbox/`. This plugin is what
turns those files into agent prompts:

- On the first watched plan/boulder event, the plugin starts an outbox watcher
  on the resolved `.sisyphus/outbox` directory (`fs.watch` plus a slow poll
  fallback, mirroring the plan watcher).
- For each queued message it picks the **most recently active** opencode session
  (via `client.session.list()`, ordered by last-updated time) and forwards the
  text as a user prompt with `client.session.promptAsync`. Task-scoped messages
  are prefixed with the task id for context.
- A message file is deleted **only after a successful send**, so delivery is
  at-least-once. If no session is available yet, or the send fails, the message
  stays queued and is retried on the next change/poll. Malformed files are
  dropped.

The outbox watcher is closed on opencode shutdown (`dispose` + process-exit
handlers), alongside any spawned server. If the server is not run with
`--enable-messaging`, no files are ever written and this relay does nothing.

### Boulder-file resolution

A plan event (`.sisyphus/plans/*.md`) spawns `watch` for that exact plan and is
remembered as the "last seen" plan. A `.sisyphus/boulder.json` event has no plan
path of its own, so the plugin resolves a sibling plan: if `.sisyphus/plans/`
holds exactly one `*.md` it uses that; otherwise it reuses the last-seen plan; if
neither is available it simply skips spawning (it never crashes). A plan event
always nudges an already-running server regardless.

## Configuration

`createPlugin(config?)` accepts (all optional, backward-compatible):

- `port?: number` — watch-server port to nudge/spawn on. Default `4499`.
- `host?: string` — host for the `/refresh` nudge. Default `127.0.0.1`.
- `autoSpawn?: boolean` — auto-spawn the server when none is running. Default
  **true**.
- `spawnCommand?: string[]` — base command used to launch the server. Default
  `["npx", "-y", "opencode-plan-canvas@latest"]`. The plugin appends
  `watch <planPath> --port <port>` (and any `spawnExtraArgs`) to it.
- `spawnExtraArgs?: string[]` — extra flags appended after the plan path (e.g.
  `["--no-open"]`).
- `spawnImpl?: (cmd: string[]) => { kill: () => void }` — injectable spawner
  (mainly for tests). The default uses `child_process.spawn` detached with
  `stdio: "ignore"` + `unref()`, and its `kill()` terminates the process group.
- `fetchImpl?: typeof fetch` — injectable fetch (mainly for tests).

### Opt out of auto-spawn

Set the environment variable `OPENCODE_PLAN_CANVAS_NO_SPAWN` to a truthy value to
force auto-spawn **off** for the whole session (env beats config). The plugin
then only nudges an already-running server, exactly like v0.1.x:

```sh
OPENCODE_PLAN_CANVAS_NO_SPAWN=1 opencode
```

Or set `autoSpawn: false` in `createPlugin({ autoSpawn: false })`.

## Plugin contract

This module is a real opencode plugin, aligned to the official
[`@opencode-ai/plugin`](https://www.npmjs.com/package/@opencode-ai/plugin)
`Plugin` type. A plugin is a module that exports a factory function
`async ({ project, client, $, directory, worktree }) => Hooks`; opencode calls
it at startup and awaits the returned hooks object. This adapter returns an
`event` hook (which nudges/auto-spawns) and a `dispose` hook (which kills any
spawned server on shutdown).

The package **entry** (`opencode-plan-canvas-plugin`) exports **only** the
default Plugin factory — nothing else. opencode iterates a plugin module's
exports and calls each as a factory, so the entry must expose only callable
plugin factories; leaking a helper or a constant there makes opencode throw
`Plugin export is not a function`.

Entry export:

- `default` — the ready-to-use Plugin factory (port `4499`).

The configurable factory and the pure helpers live in a separate internal module
reachable via the `./internal` subpath (`opencode-plan-canvas-plugin/internal`):

- `createPlugin(config?: AdapterConfig): Plugin` — a configurable factory (see
  [Configuration](#configuration)).
- Pure helpers, also exported for reuse/testing: `handleEvent` (unchanged
  nudge-only), `orchestrateEvent` (the nudge-then-spawn orchestrator),
  `isWatchedPath`, `extractChangedPath`, `refreshUrl`, `postRefresh`,
  `AdapterConfig`, `PluginState`, `SpawnedChild`, `DEFAULT_REFRESH_PORT` (`4499`).

`@opencode-ai/plugin` is a **type-only devDependency** of this adapter's own
`package.json`; it is imported with `import type` and adds **no runtime
dependency**. The root `opencode-plan-canvas` package stays zero-runtime-dep.

## Install / use

There are two ways to load an opencode plugin. Load order and de-duplication
follow opencode's rules: local plugins under `.opencode/plugins/` and
`~/.config/opencode/plugins/` are auto-loaded at startup, and if the same npm
plugin is listed more than once it is loaded a single time.

This package ships **compiled JS + `.d.ts`** (built from `plugin.ts` with
`tsc`), not raw TypeScript. The published tarball contains only `dist/` and this
README — consumers get plain ESM with types and zero runtime dependencies.

### Quick start (global config)

The recommended path: add the plugin to your **global** opencode config at
`~/.config/opencode/opencode.jsonc`, using an `@latest` pin:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-plan-canvas-plugin@latest"
  ]
}
```

**Restart opencode** — plugins are loaded at startup, so a newly added (or newly
published) plugin only takes effect after a restart.

Once loaded, editing any `.sisyphus/plans/*.md` file auto-spawns the canvas and
opens your browser (see [Why it exists](#why-it-exists)) — no manual `npx`.

> **Upgrade / cache gotcha.** opencode caches the *resolved* `@latest` version
> under `~/.cache/opencode/packages/opencode-plan-canvas-plugin@latest/` and does
> **not** re-resolve `@latest` on every restart. So after a new version is
> published, a plain restart may keep loading the old one. To force the upgrade,
> remove that cache directory and restart:
>
> ```sh
> rm -rf ~/.cache/opencode/packages/opencode-plan-canvas-plugin@latest
> # then restart opencode
> ```

### 1. Via `opencode.json` (npm)

Add it to your opencode config's `plugin` array (npm package names only):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plan-canvas-plugin"]
}
```

opencode auto-installs npm plugins via Bun at startup (cached under
`~/.cache/opencode/packages/`). Alternatively, add it as a dependency in a
project-local `.opencode/package.json` and reference it the same way.

> A non-default port cannot be passed through the `plugin` array — use the local
> wrapper form below for that.

### 2. Via the local plugin directory (no publish)

Drop (or symlink) a plugin file into `.opencode/plugins/` (project) or
`~/.config/opencode/plugins/` (global). opencode auto-loads it at startup — no
npm publish needed. A tiny wrapper file is all you need:

```ts
// .opencode/plugins/plan-canvas.ts

// If the package is linked/installed, re-export the ready-to-use default factory:
export { default } from "opencode-plan-canvas-plugin";

// OR, from a local checkout of this repo (absolute path), use the internal module:
export { createPlugin } from "/abs/path/adapter/opencode-plugin/internal.ts";
```

To run against a non-default watch-server port, or to turn auto-spawn off, use
the configurable factory as the default export:

```ts
// .opencode/plugins/plan-canvas.ts
import { createPlugin } from "opencode-plan-canvas-plugin/internal";

export default createPlugin({ port: 4500 });

// Nudge-only (no auto-spawn), matching v0.1.x behavior:
// export default createPlugin({ autoSpawn: false });
```

## Build

`plugin.ts` (the thin entry) and `internal.ts` (helpers, constants, types, and
orchestration) are the source of truth. The published package is built from
both:

```sh
cd adapter/opencode-plugin
npm install        # installs the type-only devDep @opencode-ai/plugin
npm run build      # tsc -p tsconfig.build.json → dist/{plugin,internal}.{js,d.ts}
```

`dist/` is gitignored (CI builds it fresh) and is produced automatically before
publish via the `prepublishOnly` script. Both type-only imports
(`@opencode-ai/plugin` and the inlined `ParseWarning`) are fully erased from the
emitted JS, so `dist/plugin.js` and `dist/internal.js` are dependency-free ESM.

## Typechecking

The adapter has its own `tsconfig.json` that extends the root config. Install
its devDependency (`@opencode-ai/plugin`) so the type import resolves, then
either of the following passes cleanly:

```sh
bun install                                          # in adapter/opencode-plugin/
bunx tsc --noEmit                                    # root (covers adapter too)
bunx tsc --noEmit -p adapter/opencode-plugin/tsconfig.json
```

## Dependency direction (one-way)

The adapter imports **no runtime code** from the core. It does not even import
types from `src/` anymore: the one tiny shared type (`ParseWarning`) is inlined
in `internal.ts`, so the published package has **zero** dependency on `../../src`
and `dist/` never references it. The core (`src/`) likewise never imports
anything from `adapter/`. This keeps the core buildable and publishable without
the adapter, and keeps opencode's runtime out of the root package entirely
(`@opencode-ai/plugin` lives only in the adapter's own `package.json`, and only
as a type-only devDependency).

## Releasing

Publishing is automated via GitHub Actions with **npm Trusted Publishing**
(OIDC) — provenance attestations are generated and no npm token is stored. The
workflow is `.github/workflows/publish-plugin.yml`, triggered by pushing a
`plugin-v*` tag.

One-time prerequisites (maintainer, before the first release):

1. Make the GitHub repo **public** (provenance requires a public repo + package).
2. On npmjs.com, open the `opencode-plan-canvas-plugin` package →
   **Settings → Trusted Publishing → GitHub Actions**, and register repo
   `zoispag/opencode-plan-canvas` with workflow file `publish-plugin.yml`.

Per-release procedure:

1. Bump the `version` in `adapter/opencode-plugin/package.json`.
2. Commit the bump.
3. Create an **annotated** (immutable) git tag and push it:

   ```sh
   git tag -a plugin-v0.1.0 -m "opencode-plan-canvas-plugin v0.1.0"
   git push origin plugin-v0.1.0
   ```

4. GitHub Actions builds `dist/` fresh, runs the suite, and publishes to npm
   with provenance via OIDC. (npm versions are immutable once published.)
5. Recommended: create a **GitHub Release** from the same tag for a human-facing,
   immutable release artifact.
