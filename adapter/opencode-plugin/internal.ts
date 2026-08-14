/// <reference types="node" />
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  watch,
} from "node:fs";
import type { FSWatcher } from "node:fs";
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
  /** Spawn the server with --enable-messaging so the canvas can prompt the agent. Default: true. */
  enableMessaging?: boolean;
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
  outboxWatcher?: OutboxWatcher;
  outboxDir?: string;
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
      state.outboxWatcher?.close();
    } catch {}
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
    // Env opt-out beats config, mirroring OPENCODE_PLAN_CANVAS_NO_SPAWN.
    const envNoMessaging = isTruthy(process.env.OPENCODE_PLAN_CANVAS_NO_MESSAGING);
    const enableMessaging = envNoMessaging ? false : config?.enableMessaging ?? true;
    const messagingFlag = enableMessaging ? ["--enable-messaging"] : [];
    const cmd = [
      ...base,
      "watch",
      planPath,
      "--port",
      String(port),
      ...messagingFlag,
      ...extra,
    ];

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

// Structural subset of the opencode SDK client we rely on. Kept minimal and
// local so the adapter neither imports the SDK at runtime nor couples to its
// full generated type surface (which shifts across versions).
interface SessionSummary {
  id: string;
  parentID?: string;
  time?: { created?: number; updated?: number };
}

interface SessionClient {
  session: {
    list: () => Promise<{ data?: SessionSummary[] | null }>;
    promptAsync: (options: {
      path: { id: string };
      body: { parts: Array<{ type: "text"; text: string }> };
    }) => Promise<unknown>;
  };
}

interface OutboxMessage {
  text: string;
  taskId?: string;
  ts?: number;
}

const OUTBOX_FILE_RE = /^\d+-[0-9a-f]{12}\.json$/;

// Messages older than this on the plugin's first sight are almost certainly
// left over from an earlier, unrelated session; delivering them into today's
// session would be confusing, so they are dropped instead of relayed.
const STALE_MESSAGE_MS = 10 * 60 * 1000;

export function outboxDirFor(
  eventPath: string,
  input: Partial<PluginInput> | undefined,
): string | undefined {
  const abs = absolutize(eventPath, input);
  const normalized = abs.replace(/\\/g, "/");
  const m = normalized.match(/^(.*)\/\.sisyphus\/(?:plans\/[^/]+\.md|boulder\.json)$/);
  if (!m) return undefined;
  return join(m[1]!, ".sisyphus", "outbox");
}

function parseOutboxMessage(raw: string): OutboxMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.text !== "string" || rec.text.trim().length === 0) return undefined;
  const msg: OutboxMessage = { text: rec.text };
  if (typeof rec.taskId === "string" && rec.taskId.length > 0) msg.taskId = rec.taskId;
  if (typeof rec.ts === "number" && Number.isFinite(rec.ts)) msg.ts = rec.ts;
  return msg;
}

function composePrompt(message: OutboxMessage): string {
  if (message.taskId) {
    return `[plan-canvas] Message about task ${message.taskId}:\n\n${message.text}`;
  }
  return `[plan-canvas] Message from the plan canvas:\n\n${message.text}`;
}

async function mostRecentSessionId(
  client: SessionClient,
): Promise<string | undefined> {
  let sessions: SessionSummary[] | null | undefined;
  try {
    const res = await client.session.list();
    sessions = res.data;
  } catch {
    return undefined;
  }
  if (!Array.isArray(sessions) || sessions.length === 0) return undefined;
  const sessionKey = (s: SessionSummary): number =>
    s.time?.updated ?? s.time?.created ?? 0;
  const pickNewest = (pool: SessionSummary[]): string | undefined => {
    let best: SessionSummary | undefined;
    let bestKey = -1;
    for (const s of pool) {
      if (!s || typeof s.id !== "string") continue;
      const key = sessionKey(s);
      if (key > bestKey) {
        bestKey = key;
        best = s;
      }
    }
    return best?.id;
  };
  // A user watching the canvas is in a top-level session; background subagent
  // sessions (which carry a parentID) are often newer but are the wrong target.
  const topLevel = sessions.filter((s) => s && !s.parentID);
  return pickNewest(topLevel.length > 0 ? topLevel : sessions);
}

async function deliverOutboxFile(
  filePath: string,
  client: SessionClient,
  log: (message: string) => void,
  now: number = Date.now(),
): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  const message = parseOutboxMessage(raw);
  if (!message) {
    // Drop malformed files so they don't wedge the queue on every scan.
    try {
      unlinkSync(filePath);
    } catch {}
    return;
  }

  if (message.ts !== undefined && now - message.ts > STALE_MESSAGE_MS) {
    try {
      unlinkSync(filePath);
    } catch {}
    log(`outbox: dropped stale message ${filePath}`);
    return;
  }

  const sessionId = await mostRecentSessionId(client);
  if (!sessionId) {
    log(`outbox: no active session; leaving ${filePath} queued`);
    return;
  }

  try {
    await client.session.promptAsync({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: composePrompt(message) }] },
    });
  } catch (e) {
    log(`outbox: promptAsync failed for ${filePath}: ${String(e)}`);
    return;
  }

  // The file's presence is the "not yet delivered" flag; removal happens only
  // on a successful send, giving at-least-once delivery.
  try {
    unlinkSync(filePath);
  } catch {}
  const scope = message.taskId ? ` [task ${message.taskId}]` : "";
  log(`outbox: delivered${scope} -> session ${sessionId}`);
}

async function drainOutbox(
  dir: string,
  client: SessionClient,
  log: (message: string) => void,
): Promise<void> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const epochOf = (name: string): number => Number.parseInt(name.split("-")[0]!, 10);
  const files = names
    .filter((n) => OUTBOX_FILE_RE.test(n))
    .sort((a, b) => epochOf(a) - epochOf(b));
  const now = Date.now();
  for (const name of files) {
    await deliverOutboxFile(join(dir, name), client, log, now);
  }
}

export interface OutboxWatcher {
  close: () => void;
}

export function startOutboxWatcher(
  dir: string,
  client: SessionClient,
  log: (message: string) => void,
): OutboxWatcher {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch {}

  let closed = false;
  let draining = false;
  let pending = false;

  const runDrain = (): void => {
    if (closed) return;
    if (draining) {
      pending = true;
      return;
    }
    draining = true;
    void drainOutbox(dir, client, log).finally(() => {
      draining = false;
      if (pending && !closed) {
        pending = false;
        runDrain();
      }
    });
  };

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(dir, () => runDrain());
    watcher.on("error", () => {});
  } catch {
    watcher = undefined;
  }

  // fs.watch can miss events on some platforms; a slow poll is the safety net.
  const poll: ReturnType<typeof setInterval> = setInterval(runDrain, 2000);
  if (typeof (poll as { unref?: () => void }).unref === "function") {
    (poll as { unref?: () => void }).unref?.();
  }

  runDrain();

  return {
    close(): void {
      closed = true;
      try {
        watcher?.close();
      } catch {}
      clearInterval(poll);
    },
  };
}

function asSessionClient(input: unknown): SessionClient | undefined {
  if (!input || typeof input !== "object") return undefined;
  const client = (input as { client?: unknown }).client;
  if (!client || typeof client !== "object") return undefined;
  const session = (client as { session?: unknown }).session;
  if (!session || typeof session !== "object") return undefined;
  const s = session as Record<string, unknown>;
  if (typeof s.list !== "function" || typeof s.promptAsync !== "function") {
    return undefined;
  }
  return client as SessionClient;
}

function maybeStartOutbox(
  event: OpencodeEvent,
  input: Partial<PluginInput> | undefined,
  state: PluginState,
  log: (message: string) => void,
): void {
  if (state.outboxWatcher) return;
  const client = asSessionClient(input);
  if (!client) return;
  const path = extractChangedPath(event);
  if (path === undefined || !isWatchedPath(path)) return;
  const dir = outboxDirFor(path, input);
  if (!dir) return;
  state.outboxDir = dir;
  state.outboxWatcher = startOutboxWatcher(dir, client, log);
}

export function createPlugin(config?: AdapterConfig): Plugin {
  return async (input) => {
    const state: PluginState = { hasSpawned: false };
    const log = (m: string): void => {
      try {
        console.log(`[plan-canvas] ${m}`);
      } catch {}
    };
    return {
      event: async ({ event }) => {
        maybeStartOutbox(event as OpencodeEvent, input, state, log);
        await orchestrateEvent(event as OpencodeEvent, config, input, state);
      },
      dispose: async () => {
        try {
          state.outboxWatcher?.close();
        } catch {}
        try {
          state.child?.kill();
        } catch {}
      },
    };
  };
}
