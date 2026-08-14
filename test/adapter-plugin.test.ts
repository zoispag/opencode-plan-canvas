import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REFRESH_PORT,
  createPlugin,
  extractChangedPath,
  handleEvent,
  isWatchedPath,
  orchestrateEvent,
  postRefresh,
  refreshUrl,
  type AdapterConfig,
  type OpencodeEvent,
  type PluginState,
  type SpawnedChild,
} from "../adapter/opencode-plugin/internal";
import {
  createReloadHub,
  startServer,
  type HtmlSnapshot,
  type RunningServer,
} from "../src/watch/server";

const running: RunningServer[] = [];

function track(server: RunningServer): RunningServer {
  running.push(server);
  return server;
}

afterEach(() => {
  while (running.length > 0) {
    const server = running.pop();
    try {
      server?.stop();
    } catch {}
  }
});

function pickPort(): number {
  return 4900 + Math.floor(Math.random() * 300);
}

function planEvent(path: string): OpencodeEvent {
  return { type: "file.watcher.updated", properties: { file: path } };
}

function fakePluginInput(): Parameters<ReturnType<typeof createPlugin>>[0] {
  return {} as Parameters<ReturnType<typeof createPlugin>>[0];
}

describe("isWatchedPath", () => {
  test("matches plan markdown under .sisyphus/plans", () => {
    expect(isWatchedPath(".sisyphus/plans/x.md")).toBe(true);
    expect(isWatchedPath("/repo/.sisyphus/plans/my-plan.md")).toBe(true);
    expect(isWatchedPath("/a/b/.sisyphus/plans/deep-name.md")).toBe(true);
  });

  test("matches the boulder.json", () => {
    expect(isWatchedPath(".sisyphus/boulder.json")).toBe(true);
    expect(isWatchedPath("/repo/.sisyphus/boulder.json")).toBe(true);
  });

  test("normalizes windows separators", () => {
    expect(isWatchedPath("C:\\repo\\.sisyphus\\plans\\x.md")).toBe(true);
  });

  test("rejects unrelated paths", () => {
    expect(isWatchedPath("src/foo.ts")).toBe(false);
    expect(isWatchedPath("/repo/src/watch/server.ts")).toBe(false);
    expect(isWatchedPath(".sisyphus/plans/notes.txt")).toBe(false);
    expect(isWatchedPath(".sisyphus/plans/sub/x.md")).toBe(false);
    expect(isWatchedPath(".sisyphus/boulder.jsonx")).toBe(false);
    expect(isWatchedPath("")).toBe(false);
  });
});

describe("extractChangedPath", () => {
  test("reads file/path/filename properties from the event", () => {
    expect(extractChangedPath(planEvent(".sisyphus/plans/x.md"))).toBe(
      ".sisyphus/plans/x.md",
    );
    expect(
      extractChangedPath({ type: "file.watcher.updated", properties: { path: "a.md" } }),
    ).toBe("a.md");
    expect(
      extractChangedPath({
        type: "file.watcher.updated",
        properties: { filename: "b.md" },
      }),
    ).toBe("b.md");
  });

  test("ignores non file.watcher.updated events", () => {
    expect(
      extractChangedPath({ type: "session.updated", properties: { file: "a.md" } }),
    ).toBeUndefined();
    expect(extractChangedPath({ type: "file.watcher.updated" })).toBeUndefined();
  });
});

describe("refreshUrl", () => {
  test("defaults to localhost:4499/refresh", () => {
    expect(refreshUrl()).toBe(`http://127.0.0.1:${DEFAULT_REFRESH_PORT}/refresh`);
    expect(DEFAULT_REFRESH_PORT).toBe(4499);
  });

  test("honors a custom port and host", () => {
    expect(refreshUrl({ port: 5000 })).toBe("http://127.0.0.1:5000/refresh");
    expect(refreshUrl({ host: "localhost", port: 5000 })).toBe(
      "http://localhost:5000/refresh",
    );
  });
});

describe("handleEvent with an injected fetch stub", () => {
  test("plan-path event triggers exactly one POST to /refresh", async () => {
    const hits: Array<{ url: string; method: string }> = [];
    const fetchStub = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      hits.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const acted = await handleEvent(planEvent("/repo/.sisyphus/plans/x.md"), {
      port: 4499,
      fetchImpl: fetchStub,
    });

    expect(acted).toBe(true);
    expect(hits.length).toBe(1);
    expect(hits[0]!.method).toBe("POST");
    expect(hits[0]!.url).toBe("http://127.0.0.1:4499/refresh");
  });

  test("boulder event triggers a POST", async () => {
    const hits: string[] = [];
    const fetchStub = (async (input: Parameters<typeof fetch>[0]) => {
      hits.push(String(input));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const acted = await handleEvent(planEvent("/repo/.sisyphus/boulder.json"), {
      fetchImpl: fetchStub,
    });

    expect(acted).toBe(true);
    expect(hits.length).toBe(1);
  });

  test("unrelated path (src/foo.ts) triggers NOTHING", async () => {
    const hits: string[] = [];
    const fetchStub = (async (input: Parameters<typeof fetch>[0]) => {
      hits.push(String(input));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const acted = await handleEvent(planEvent("/repo/src/foo.ts"), {
      fetchImpl: fetchStub,
    });

    expect(acted).toBe(false);
    expect(hits.length).toBe(0);
  });

  test("non file.watcher.updated event triggers NOTHING", async () => {
    const hits: string[] = [];
    const fetchStub = (async (input: Parameters<typeof fetch>[0]) => {
      hits.push(String(input));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const acted = await handleEvent(
      { type: "session.updated", properties: { file: ".sisyphus/plans/x.md" } },
      { fetchImpl: fetchStub },
    );

    expect(acted).toBe(false);
    expect(hits.length).toBe(0);
  });
});

describe("postRefresh against a mock Bun.serve that records hits", () => {
  test("records a single POST hit on /refresh for a plan event", async () => {
    const hits: Array<{ path: string; method: string }> = [];
    const port = pickPort();
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch(req: Request): Response {
        const u = new URL(req.url);
        hits.push({ path: u.pathname, method: req.method });
        return new Response(null, { status: 204 });
      },
    });
    try {
      const acted = await handleEvent(planEvent("/repo/.sisyphus/plans/x.md"), { port });
      expect(acted).toBe(true);
      expect(hits.length).toBe(1);
      expect(hits[0]!.path).toBe("/refresh");
      expect(hits[0]!.method).toBe("POST");
    } finally {
      server.stop(true);
    }
  });

  test("unrelated path produces zero hits on the mock server", async () => {
    const hits: string[] = [];
    const port = pickPort();
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch(req: Request): Response {
        hits.push(new URL(req.url).pathname);
        return new Response(null, { status: 204 });
      },
    });
    try {
      const acted = await handleEvent(planEvent("/repo/src/foo.ts"), { port });
      expect(acted).toBe(false);
      expect(hits.length).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test("postRefresh returns false when nothing is listening", async () => {
    const ok = await postRefresh({ port: 4 });
    expect(ok).toBe(false);
  });
});

describe("real watch server POST /refresh wiring", () => {
  test("POST /refresh invokes onRefresh and returns 204", async () => {
    const snapshot: HtmlSnapshot = { html: "<html></html>", generation: 1 };
    const hub = createReloadHub();
    let refreshed = 0;
    const server = track(
      startServer({
        port: pickPort(),
        getSnapshot: () => snapshot,
        events: hub,
        onRefresh: () => {
          refreshed += 1;
        },
      }),
    );

    const res = await fetch(`${server.url}/refresh`, { method: "POST" });
    expect(res.status).toBe(204);
    await res.text();
    expect(refreshed).toBe(1);
  });

  test("POST /refresh with no onRefresh wired is harmless (204)", async () => {
    const snapshot: HtmlSnapshot = { html: "<html></html>", generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: hub }),
    );
    const res = await fetch(`${server.url}/refresh`, { method: "POST" });
    expect(res.status).toBe(204);
    await res.text();
  });

  test("end-to-end: plugin event -> real server /refresh bumps onRefresh", async () => {
    const snapshot: HtmlSnapshot = { html: "<html></html>", generation: 1 };
    const hub = createReloadHub();
    let refreshed = 0;
    const server = track(
      startServer({
        port: pickPort(),
        getSnapshot: () => snapshot,
        events: hub,
        onRefresh: () => {
          refreshed += 1;
        },
      }),
    );

    const port = Number.parseInt(new URL(server.url).port, 10);
    const factory = createPlugin({ port });
    const hooks = await factory(fakePluginInput());
    type EventArg = Parameters<NonNullable<typeof hooks.event>>[0]["event"];
    await hooks.event!({ event: planEvent("/repo/.sisyphus/plans/x.md") as EventArg });
    await hooks.event!({ event: planEvent("/repo/src/unrelated.ts") as EventArg });

    expect(refreshed).toBe(1);
  });

  test("GET /refresh is not the POST route (falls through to 404)", async () => {
    const snapshot: HtmlSnapshot = { html: "<html></html>", generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({
        port: pickPort(),
        getSnapshot: () => snapshot,
        events: hub,
        onRefresh: () => {},
      }),
    );
    const res = await fetch(`${server.url}/refresh`, { method: "GET" });
    expect(res.status).toBe(404);
    await res.text();
  });
});

const NUDGE_FAIL: typeof fetch = (async () => {
  throw new Error("connection refused");
}) as unknown as typeof fetch;

const NUDGE_OK: typeof fetch = (async () =>
  new Response(null, { status: 204 })) as unknown as typeof fetch;

function recordingSpawner(calls: string[][]): {
  spawnImpl: (cmd: string[]) => SpawnedChild;
  kills: number[];
} {
  const kills: number[] = [];
  const spawnImpl = (cmd: string[]): SpawnedChild => {
    const index = calls.push([...cmd]) - 1;
    return { kill: () => kills.push(index) };
  };
  return { spawnImpl, kills };
}

function freshState(): PluginState {
  return { hasSpawned: false };
}

function inputFor(directory: string): { directory: string; worktree: string } {
  return { directory, worktree: directory };
}

describe("orchestrateEvent auto-spawn", () => {
  afterEach(() => {
    delete process.env.OPENCODE_PLAN_CANVAS_NO_SPAWN;
  });

  test("watched plan + nudge fails + autoSpawn -> spawns once with correct cmd", async () => {
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    const config: AdapterConfig = {
      port: 4499,
      autoSpawn: true,
      fetchImpl: NUDGE_FAIL,
      spawnImpl,
      spawnExtraArgs: ["--no-open"],
    };
    const state = freshState();
    const outcome = await orchestrateEvent(
      planEvent("/repo/.sisyphus/plans/x.md"),
      config,
      inputFor("/repo"),
      state,
    );
    expect(outcome).toBe("spawned");
    expect(calls.length).toBe(1);
    const cmd = calls[0]!;
    expect(cmd).toContain("watch");
    expect(cmd).toContain("/repo/.sisyphus/plans/x.md");
    const portIdx = cmd.indexOf("--port");
    expect(portIdx).toBeGreaterThan(-1);
    expect(cmd[portIdx + 1]).toBe("4499");
    expect(cmd).toContain("--no-open");
    expect(cmd).toContain("--enable-messaging");
    expect(state.hasSpawned).toBe(true);
    expect(state.child).toBeDefined();
  });

  test("spawn command enables messaging by default", async () => {
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    const config: AdapterConfig = { autoSpawn: true, fetchImpl: NUDGE_FAIL, spawnImpl };
    await orchestrateEvent(
      planEvent("/repo/.sisyphus/plans/x.md"),
      config,
      inputFor("/repo"),
      freshState(),
    );
    expect(calls[0]!).toContain("--enable-messaging");
  });

  test("enableMessaging=false omits the flag", async () => {
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    const config: AdapterConfig = {
      autoSpawn: true,
      fetchImpl: NUDGE_FAIL,
      spawnImpl,
      enableMessaging: false,
    };
    await orchestrateEvent(
      planEvent("/repo/.sisyphus/plans/x.md"),
      config,
      inputFor("/repo"),
      freshState(),
    );
    expect(calls[0]!).not.toContain("--enable-messaging");
  });

  test("OPENCODE_PLAN_CANVAS_NO_MESSAGING beats enableMessaging=true", async () => {
    process.env.OPENCODE_PLAN_CANVAS_NO_MESSAGING = "1";
    try {
      const calls: string[][] = [];
      const { spawnImpl } = recordingSpawner(calls);
      const config: AdapterConfig = {
        autoSpawn: true,
        fetchImpl: NUDGE_FAIL,
        spawnImpl,
        enableMessaging: true,
      };
      await orchestrateEvent(
        planEvent("/repo/.sisyphus/plans/x.md"),
        config,
        inputFor("/repo"),
        freshState(),
      );
      expect(calls[0]!).not.toContain("--enable-messaging");
    } finally {
      delete process.env.OPENCODE_PLAN_CANVAS_NO_MESSAGING;
    }
  });

  test("burst of 5 rapid events + nudge always fails -> spawns exactly once", async () => {
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    const config: AdapterConfig = {
      autoSpawn: true,
      fetchImpl: NUDGE_FAIL,
      spawnImpl,
    };
    const state = freshState();
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        orchestrateEvent(
          planEvent("/repo/.sisyphus/plans/x.md"),
          config,
          inputFor("/repo"),
          state,
        ),
      ),
    );
    expect(calls.length).toBe(1);
    expect(outcomes.filter((o) => o === "spawned").length).toBe(1);
    expect(outcomes.filter((o) => o === "skipped").length).toBe(4);
  });

  test("nudge succeeds -> does NOT spawn, returns nudged", async () => {
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    const config: AdapterConfig = {
      autoSpawn: true,
      fetchImpl: NUDGE_OK,
      spawnImpl,
    };
    const state = freshState();
    const outcome = await orchestrateEvent(
      planEvent("/repo/.sisyphus/plans/x.md"),
      config,
      inputFor("/repo"),
      state,
    );
    expect(outcome).toBe("nudged");
    expect(calls.length).toBe(0);
    expect(state.hasSpawned).toBe(false);
  });

  test("autoSpawn=false -> never spawns even when nudge fails (skipped)", async () => {
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    const config: AdapterConfig = {
      autoSpawn: false,
      fetchImpl: NUDGE_FAIL,
      spawnImpl,
    };
    const state = freshState();
    const outcome = await orchestrateEvent(
      planEvent("/repo/.sisyphus/plans/x.md"),
      config,
      inputFor("/repo"),
      state,
    );
    expect(outcome).toBe("skipped");
    expect(calls.length).toBe(0);
  });

  test("OPENCODE_PLAN_CANVAS_NO_SPAWN beats autoSpawn=true (skipped)", async () => {
    process.env.OPENCODE_PLAN_CANVAS_NO_SPAWN = "1";
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    const config: AdapterConfig = {
      autoSpawn: true,
      fetchImpl: NUDGE_FAIL,
      spawnImpl,
    };
    const state = freshState();
    const outcome = await orchestrateEvent(
      planEvent("/repo/.sisyphus/plans/x.md"),
      config,
      inputFor("/repo"),
      state,
    );
    expect(outcome).toBe("skipped");
    expect(calls.length).toBe(0);
  });

  test("non-watched path -> ignored, no nudge, no spawn", async () => {
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    let fetched = 0;
    const fetchImpl = (async () => {
      fetched += 1;
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    const config: AdapterConfig = { autoSpawn: true, fetchImpl, spawnImpl };
    const state = freshState();
    const outcome = await orchestrateEvent(
      planEvent("/repo/src/foo.ts"),
      config,
      inputFor("/repo"),
      state,
    );
    expect(outcome).toBe("ignored");
    expect(fetched).toBe(0);
    expect(calls.length).toBe(0);
  });

  test("relative plan path is absolutized against input.directory", async () => {
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    const config: AdapterConfig = {
      autoSpawn: true,
      fetchImpl: NUDGE_FAIL,
      spawnImpl,
    };
    const state = freshState();
    const outcome = await orchestrateEvent(
      planEvent(".sisyphus/plans/live.md"),
      config,
      inputFor("/abs/repo"),
      state,
    );
    expect(outcome).toBe("spawned");
    expect(calls[0]!).toContain("/abs/repo/.sisyphus/plans/live.md");
  });
});

describe("orchestrateEvent boulder.json resolution", () => {
  afterEach(() => {
    delete process.env.OPENCODE_PLAN_CANVAS_NO_SPAWN;
  });

  test("boulder-only event with no known plan -> skipped (never crashes)", async () => {
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    const config: AdapterConfig = {
      autoSpawn: true,
      fetchImpl: NUDGE_FAIL,
      spawnImpl,
    };
    const state = freshState();
    const outcome = await orchestrateEvent(
      planEvent("/nonexistent-xyz/.sisyphus/boulder.json"),
      config,
      inputFor("/nonexistent-xyz"),
      state,
    );
    expect(outcome).toBe("skipped");
    expect(calls.length).toBe(0);
  });

  test("boulder event reuses a previously seen plan path", async () => {
    const calls: string[][] = [];
    const { spawnImpl } = recordingSpawner(calls);
    const config: AdapterConfig = {
      autoSpawn: true,
      fetchImpl: NUDGE_OK,
      spawnImpl,
    };
    const state = freshState();
    // First, a plan event (nudge OK, no spawn) records lastPlanPath.
    await orchestrateEvent(
      planEvent("/repo/.sisyphus/plans/x.md"),
      config,
      inputFor("/repo"),
      state,
    );
    expect(state.lastPlanPath).toBe("/repo/.sisyphus/plans/x.md");
    // Then a boulder event while nudge fails should spawn using that plan.
    const failConfig: AdapterConfig = { ...config, fetchImpl: NUDGE_FAIL };
    const outcome = await orchestrateEvent(
      planEvent("/repo/.sisyphus/boulder.json"),
      failConfig,
      inputFor("/repo"),
      state,
    );
    expect(outcome).toBe("spawned");
    expect(calls[0]!).toContain("/repo/.sisyphus/plans/x.md");
  });

  test("boulder event resolves the sole *.md sibling under .sisyphus/plans", async () => {
    const dir = mkdtempSync(join(tmpdir(), "boulder-resolve-"));
    const plansDir = join(dir, ".sisyphus", "plans");
    mkdirSync(plansDir, { recursive: true });
    const planPath = join(plansDir, "only-plan.md");
    writeFileSync(planPath, "# plan");
    try {
      const calls: string[][] = [];
      const { spawnImpl } = recordingSpawner(calls);
      const config: AdapterConfig = {
        autoSpawn: true,
        fetchImpl: NUDGE_FAIL,
        spawnImpl,
      };
      const state = freshState();
      const outcome = await orchestrateEvent(
        planEvent(join(dir, ".sisyphus", "boulder.json")),
        config,
        inputFor(dir),
        state,
      );
      expect(outcome).toBe("spawned");
      expect(calls[0]!).toContain(planPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("createPlugin dispose kills the spawned child", () => {
  test("dispose() calls child.kill()", async () => {
    let killed = 0;
    const spawnImpl = (): SpawnedChild => ({ kill: () => (killed += 1) });
    const factory = createPlugin({
      autoSpawn: true,
      fetchImpl: NUDGE_FAIL,
      spawnImpl,
    });
    const hooks = await factory(inputFor("/repo") as never);
    type EventArg = Parameters<NonNullable<typeof hooks.event>>[0]["event"];
    await hooks.event!({
      event: planEvent("/repo/.sisyphus/plans/x.md") as EventArg,
    });
    expect(killed).toBe(0);
    await hooks.dispose!();
    expect(killed).toBe(1);
  });
});

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADAPTER_DIR = join(REPO_ROOT, "adapter", "opencode-plugin");
const BUILT_ENTRY = join(ADAPTER_DIR, "dist", "plugin.js");

describe("opencode loader contract on the BUILT package entry", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: ADAPTER_DIR, stdio: "ignore" });
  });

  test("default export is a plugin factory function", async () => {
    const mod = await import(BUILT_ENTRY);
    expect(typeof mod.default).toBe("function");
  });

  test("every named export opencode iterates is a plugin factory function", async () => {
    const mod = await import(BUILT_ENTRY);
    for (const [name, val] of Object.entries(mod)) {
      if (name === "default") continue;
      expect(typeof val, `export "${name}" must be a plugin factory function`).toBe(
        "function",
      );
    }
  });

  test("calling the default factory yields hooks with event and dispose", async () => {
    const mod = await import(BUILT_ENTRY);
    const hooks = await mod.default({ directory: "/tmp", worktree: "/tmp" });
    expect(typeof hooks.event).toBe("function");
    expect(typeof hooks.dispose).toBe("function");
  });
});
