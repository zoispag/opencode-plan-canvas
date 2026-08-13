# opencode-plan-canvas-plugin (optional adapter)

This is an **optional** opencode plugin adapter for `opencode-plan-canvas`. It is
**not required** for anything to work.

## Why it exists

`opencode-plan-canvas watch <plan.md>` already watches the plan (and the
`.sisyphus/boulder.json` file) on disk with a native `fs.watch`-based watcher.
That watcher regenerates the canvas and pushes a live-reload event over SSE all
on its own — with **zero** dependency on opencode.

Inside an opencode session, though, file changes are sometimes buffered or
written in ways that a bare `fs.watch` notices a beat later. This adapter simply
makes updates **snappier** while you are working inside opencode: it listens for
opencode's `file.watcher.updated` event and, when the changed file is a plan or
boulder file, sends a tiny `POST /refresh` nudge to the running watch server so
it re-reads and regenerates immediately (bypassing the debounce).

If you never install this adapter, the watch server behaves exactly the same —
just with normal `fs.watch` latency. **The core tool does not know this adapter
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

## Install / use

This module is self-contained under `adapter/opencode-plugin/`. It declares **no
runtime dependency** on opencode (it uses a small local structural interface for
the plugin shape) and adds **nothing** to the root package's dependencies.

Point opencode at the plugin's default export (an opencode plugin factory). If
your watch server runs on a non-default port, construct the plugin with a port:

```ts
import { createPlugin } from "opencode-plan-canvas-plugin";

export default createPlugin({ port: 4499 });
```

Or use the ready-made default export (port `4499`):

```ts
export { default } from "opencode-plan-canvas-plugin";
```

## Typechecking

The adapter has its own `tsconfig.json` that extends the root config. It is also
covered by the root `tsconfig.json` `include` glob. Either of the following
passes cleanly:

```sh
bunx tsc --noEmit                                    # root (covers adapter too)
bunx tsc --noEmit -p adapter/opencode-plugin/tsconfig.json
```

## Dependency direction (one-way)

The adapter MAY import **types** from the core (`src/model.ts`). The core
(`src/`) never imports anything from `adapter/`. This one-way dependency keeps
the core buildable and publishable without the adapter, and keeps opencode out
of the root package entirely.
