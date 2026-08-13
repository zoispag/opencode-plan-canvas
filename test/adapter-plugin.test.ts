import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_REFRESH_PORT,
  createPlugin,
  extractChangedPath,
  handleEvent,
  isWatchedPath,
  postRefresh,
  refreshUrl,
  type OpencodeEvent,
} from "../adapter/opencode-plugin/plugin";
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
    const hooks = await factory({});
    await hooks.event!({ event: planEvent("/repo/.sisyphus/plans/x.md") });
    await hooks.event!({ event: planEvent("/repo/src/unrelated.ts") });

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
