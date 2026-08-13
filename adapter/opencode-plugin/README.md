# opencode-plan-canvas-plugin (optional adapter)

This is an **optional** [opencode](https://opencode.ai) plugin for
`opencode-plan-canvas`. It is **not required** for anything to work.

## Why it exists

`opencode-plan-canvas watch <plan.md>` already watches the plan (and the
`.sisyphus/boulder.json` file) on disk with a native `fs.watch`-based watcher.
That watcher regenerates the canvas and pushes a live-reload event over SSE all
on its own — with **zero** dependency on opencode.

Inside an opencode session, though, file changes are sometimes buffered or
written in ways that a bare `fs.watch` notices a beat later. This plugin simply
makes updates **snappier** while you are working inside opencode: it listens for
opencode's `file.watcher.updated` event and, when the changed file is a plan or
boulder file, sends a tiny `POST /refresh` nudge to the running watch server so
it re-reads and regenerates immediately (bypassing the debounce).

If you never install this plugin, the watch server behaves exactly the same —
just with normal `fs.watch` latency. **The core tool does not know this plugin
exists.**

## What it does

- Subscribes to opencode's `file.watcher.updated` event.
- When the changed path matches `**/.sisyphus/plans/*.md` or
  `**/.sisyphus/boulder.json`, it POSTs to
  `http://127.0.0.1:<port>/refresh` (default port `4499`).
- Any other path (e.g. `src/foo.ts`) is ignored — no request is sent.

The `/refresh` endpoint is a no-auth, localhost-only development nudge. It only
triggers an immediate re-read/regen of the plan the watch server is already
watching; it carries no payload and cannot write back to any file.

## Plugin contract

This module is a real opencode plugin, aligned to the official
[`@opencode-ai/plugin`](https://www.npmjs.com/package/@opencode-ai/plugin)
`Plugin` type. A plugin is a module that exports a factory function
`async ({ project, client, $, directory, worktree }) => Hooks`; opencode calls
it at startup and awaits the returned hooks object. This adapter returns a
single `event` hook.

Exports:

- `PlanCanvasPlugin: Plugin` — the named export (port `4499`).
- `default` — the same factory as `PlanCanvasPlugin`.
- `createPlugin(config?: { port?, host?, fetchImpl? }): Plugin` — a
  port-configurable factory.
- Pure helpers, also exported for reuse/testing: `handleEvent`,
  `isWatchedPath`, `extractChangedPath`, `refreshUrl`, `postRefresh`,
  `AdapterConfig`, `DEFAULT_REFRESH_PORT` (`4499`).

`@opencode-ai/plugin` is a **type-only devDependency** of this adapter's own
`package.json`; it is imported with `import type` and adds **no runtime
dependency**. The root `opencode-plan-canvas` package stays zero-runtime-dep.

## Install / use

There are two ways to load an opencode plugin. Load order and de-duplication
follow opencode's rules: local plugins under `.opencode/plugins/` and
`~/.config/opencode/plugins/` are auto-loaded at startup, and if the same npm
plugin is listed more than once it is loaded a single time.

### 1. Via `opencode.json` (npm)

Once this package is **published to npm** as `opencode-plan-canvas-plugin`, add
it to your opencode config's `plugin` array (npm package names only):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plan-canvas-plugin"]
}
```

opencode auto-installs npm plugins via Bun at startup (cached under
`~/.cache/opencode/node_modules/`). Alternatively, add it as a dependency in a
project-local `.opencode/package.json` and reference it the same way.

> This adapter is **publish-ready** but has **not** been published here. Publish
> it (`npm publish` from `adapter/opencode-plugin/`) before using the npm route.
> A non-default port cannot be passed through the `plugin` array — use the local
> wrapper form below for that.

### 2. Via the local plugin directory (no publish)

Drop (or symlink) a plugin file into `.opencode/plugins/` (project) or
`~/.config/opencode/plugins/` (global). opencode auto-loads it at startup — no
npm publish needed. A tiny wrapper file is all you need:

```ts
// .opencode/plugins/plan-canvas.ts

// If the package is linked/installed:
export { PlanCanvasPlugin } from "opencode-plan-canvas-plugin";

// OR, from a local checkout of this repo (absolute path):
export { createPlugin } from "/abs/path/adapter/opencode-plugin/plugin.ts";
```

To run against a non-default watch-server port, use the port-configurable
factory as the default export:

```ts
// .opencode/plugins/plan-canvas.ts
import { createPlugin } from "opencode-plan-canvas-plugin";

export default createPlugin({ port: 4500 });
```

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

The adapter MAY import **types** from the core (`src/model.ts`). The core
(`src/`) never imports anything from `adapter/`. This one-way dependency keeps
the core buildable and publishable without the adapter, and keeps opencode's
runtime out of the root package entirely (`@opencode-ai/plugin` lives only in
the adapter's own `package.json`, and only as a type-only devDependency).
