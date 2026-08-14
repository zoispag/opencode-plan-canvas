/// <reference types="node" />
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";

// Mirrors the core `ParseWarning` (src/model.ts). Inlined so the published
// package has zero dependency on `../../src` and dist never references it.
export interface ParseWarning {
  line?: number;
  message: string;
}

export const DEFAULT_REFRESH_PORT = 4499;

// Default base command used to launch the watch server when none is running.
// Overridable via `AdapterConfig.spawnCommand` (e.g. tests point it at a local
// `dist/cli.js`).
const DEFAULT_SPAWN_COMMAND = ["npx", "-y", "opencode-plan-canvas@latest"];

// Minimal handle returned by a spawner. `kill` must terminate the server (and,
// for the default detached impl, its whole process group) best-effort.
export interface SpawnedChild {
  kill: () => void;
}

export interface AdapterConfig {
  port?: number;
  host?: string;
  fetchImpl?: typeof fetch;
  /** Auto-spawn the watch server when a plan changes and none is running. Default: true. */
  autoSpawn?: boolean;
  /** Base command to launch the server. Default: ["npx","-y","opencode-plan-canvas@latest"]. */
  spawnCommand?: string[];
  /** Extra flags appended after the plan path (e.g. ["--no-open"] in tests). */
  spawnExtraArgs?: string[];
  /** Injectable spawner for tests. Default uses detached child_process.spawn + unref. */
  spawnImpl?: (cmd: string[]) => SpawnedChild;
}

// Loose, testable stand-in for opencode's fully-typed `Event` union. Kept local
// so the pure helpers unit-test without constructing an SDK `Event`; the real
// `file.watcher.updated` carries `properties.file`, but we read file/path/filename
// defensively in case the event shape shifts across opencode versions.
export type OpencodeEvent = {
  type: string;
  properties?: Record<string, unknown>;
};

// Per-plugin-instance mutable state threaded through `orchestrateEvent`. Tracks
// whether we already spawned a server (dedupe), the child handle (for cleanup),
// and the last-seen plan path (used to resolve boulder-only events).
export interface PluginState {
  hasSpawned: boolean;
  child?: SpawnedChild;
  lastPlanPath?: string;
  exitHandlersRegistered?: boolean;
}

export type OrchestrationOutcome = "ignored" | "nudged" | "spawned" | "skipped";

const PLAN_PATH_RE = /(^|\/)\.sisyphus\/plans\/[^/]+\.md$/;
const BOULDER_PATH_RE = /(^|\/)\.sisyphus\/boulder\.json$/;

export function isWatchedPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  const normalized = path.replace(/\\/g, "/");
  return PLAN_PATH_RE.test(normalized) || BOULDER_PATH_RE.test(normalized);
}

export function extractChangedPath(event: OpencodeEvent): string | undefined {
  if (!event || event.type !== "file.watcher.updated") return undefined;
  const props = event.properties;
  if (!props || typeof props !== "object") return undefined;
  const candidates = ["file", "path", "filename"] as const;
  for (const key of candidates) {
    const value = props[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function refreshUrl(config?: AdapterConfig): string {
  const host = config?.host ?? "127.0.0.1";
  const port = config?.port ?? DEFAULT_REFRESH_PORT;
  return `http://${host}:${port}/refresh`;
}

export async function postRefresh(config?: AdapterConfig): Promise<boolean> {
  const doFetch = config?.fetchImpl ?? fetch;
  try {
    const res = await doFetch(refreshUrl(config), { method: "POST" });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

// Pure nudge-only handler. Unchanged signature/behavior — kept for backward
// compatibility and existing tests. Does NOT spawn.
export async function handleEvent(
  event: OpencodeEvent,
  config?: AdapterConfig,
): Promise<boolean> {
  const path = extractChangedPath(event);
  if (path === undefined) return false;
  if (!isWatchedPath(path)) return false;
  await postRefresh(config);
  return true;
}

// Default detached spawner: launches the process in its own group, ignores its
// stdio, and unrefs it so opencode isn't held open by the child. `kill` targets
// the negative PID (the process group) so `npx` wrappers die with the server.
function defaultSpawnImpl(cmd: string[]): SpawnedChild {
  const child = spawn(cmd[0]!, cmd.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return {
    kill: () => {
      try {
        if (typeof child.pid === "number") {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
        } else {
          child.kill("SIGTERM");
        }
      } catch {}
    },
  };
}

// Resolve the absolute base directory from the plugin input (directory wins,
// then worktree, then cwd). Used to absolutize relative event paths.
function baseDir(input?: Partial<PluginInput>): string {
  if (input && typeof input.directory === "string" && input.directory.length > 0) {
    return input.directory;
  }
  if (input && typeof input.worktree === "string" && input.worktree.length > 0) {
    return input.worktree;
  }
  return process.cwd();
}

function absolutize(path: string, input?: Partial<PluginInput>): string {
  const normalized = path.replace(/\\/g, "/");
  if (isAbsolute(normalized)) return normalized;
  return join(baseDir(input), normalized);
}

// Resolve which plan path to hand the spawned `watch` command for a given
// watched event. Plan events resolve to themselves. Boulder events resolve to a
// sibling plan: the sole `*.md` under `.sisyphus/plans/`, else a previously
// seen plan, else undefined (skip spawning — never crash).
function resolvePlanPath(
  eventPath: string,
  input: Partial<PluginInput> | undefined,
  state: PluginState,
): string | undefined {
  const abs = absolutize(eventPath, input);
  const normalized = abs.replace(/\\/g, "/");

  if (PLAN_PATH_RE.test(normalized)) {
    state.lastPlanPath = abs;
    return abs;
  }

  if (BOULDER_PATH_RE.test(normalized)) {
    // boulder.json lives in .sisyphus/; its sibling plans dir is .sisyphus/plans.
    const sisyphusDir = dirname(abs);
    const plansDir = join(sisyphusDir, "plans");
    try {
      if (existsSync(plansDir)) {
        const mdFiles = readdirSync(plansDir).filter((f) => f.endsWith(".md"));
        if (mdFiles.length === 1) {
          const resolved = join(plansDir, mdFiles[0]!);
          state.lastPlanPath = resolved;
          return resolved;
        }
      }
    } catch {}
    // Fall back to a previously seen plan path if we have one.
    return state.lastPlanPath;
  }

  return undefined;
}

function registerExitHandlers(state: PluginState): void {
  if (state.exitHandlersRegistered) return;
  state.exitHandlersRegistered = true;
  const killChild = () => {
    try {
      state.child?.kill();
    } catch {}
  };
  process.once("exit", killChild);
  process.once("SIGINT", killChild);
  process.once("SIGTERM", killChild);
}

// Orchestrates a single event: nudge an existing server, else auto-spawn one.
// Best-effort — never throws into opencode's event loop.
//
// Outcomes:
//   "ignored" — not a watched path (or not a file.watcher.updated event)
//   "nudged"  — a server was already up; POST /refresh succeeded, no spawn
//   "spawned" — no server up; we launched one
//   "skipped" — watched, nudge failed, but spawning was disabled/deduped/unresolvable
export async function orchestrateEvent(
  event: OpencodeEvent,
  config: AdapterConfig | undefined,
  input: Partial<PluginInput> | undefined,
  state: PluginState,
): Promise<OrchestrationOutcome> {
  try {
    const path = extractChangedPath(event);
    if (path === undefined || !isWatchedPath(path)) return "ignored";

    // Resolve the plan path early so boulder events update lastPlanPath and we
    // know whether we have something spawnable.
    const planPath = resolvePlanPath(path, input, state);

    // The nudge doubles as our "is a server already running?" probe.
    const ok = await postRefresh(config);
    if (ok) return "nudged";

    // Env opt-out beats config.
    const envNoSpawn = isTruthy(process.env.OPENCODE_PLAN_CANVAS_NO_SPAWN);
    const autoSpawn = envNoSpawn ? false : config?.autoSpawn ?? true;

    if (!autoSpawn || state.hasSpawned || planPath === undefined) {
      return "skipped";
    }

    // Dedupe: set the flag synchronously BEFORE any await so a burst of events
    // yields at most one spawn.
    state.hasSpawned = true;

    const port = config?.port ?? DEFAULT_REFRESH_PORT;
    const base = config?.spawnCommand ?? DEFAULT_SPAWN_COMMAND;
    const extra = config?.spawnExtraArgs ?? [];
    const cmd = [...base, "watch", planPath, "--port", String(port), ...extra];

    const spawner = config?.spawnImpl ?? defaultSpawnImpl;
    state.child = spawner(cmd);
    registerExitHandlers(state);
    return "spawned";
  } catch {
    return "skipped";
  }
}

function isTruthy(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v.length > 0 && v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

export function createPlugin(config?: AdapterConfig): Plugin {
  return async (input) => {
    const state: PluginState = { hasSpawned: false };
    return {
      event: async ({ event }) => {
        await orchestrateEvent(event as OpencodeEvent, config, input, state);
      },
      dispose: async () => {
        try {
          state.child?.kill();
        } catch {}
      },
    };
  };
}
