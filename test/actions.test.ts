import { afterEach, describe, expect, test } from "bun:test";
import {
  createReloadHub,
  injectSseClient,
  startServer,
  type ActionEntry,
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

const SAMPLE_HTML = [
  `<!doctype html>`,
  `<html><head><title>t</title></head>`,
  `<body>`,
  `<section id="waves"><div class="waves"><div class="wave w1">`,
  `<details class="tcard shipped"><summary><div class="trow">`,
  `<span class="tid">T1</span><span class="ttitle">First</span></div></summary></details>`,
  `<details class="tcard"><summary><div class="trow">`,
  `<span class="tid">T2</span><span class="ttitle">Second</span></div></summary></details>`,
  `</div></div></section>`,
  `<script>/* interactivity */</script>`,
  `</body></html>`,
].join("\n");

const ACTIONS: ActionEntry[] = [
  {
    taskId: "T1",
    prompt: "First\n\nDo the first thing",
    url: "https://github.com/owner/repo/pull/140",
  },
  {
    taskId: "T2",
    prompt: "Second\n\nDo the second thing",
  },
];

function silentLog(): { log: (m: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), lines };
}

describe("actions flag OFF (default)", () => {
  test("POST /action returns 404 when actions are not enabled", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: hub }),
    );

    const res = await fetch(`${server.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "open-ref", taskId: "T1" }),
    });
    expect(res.status).toBe(404);
    await res.text();
  });

  test("served / output has zero action-btn occurrences", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: hub }),
    );

    const body = await (await fetch(`${server.url}/`)).text();
    const count = (body.match(/action-btn/g) || []).length;
    expect(count).toBe(0);
    expect(body).not.toContain("plan-actions");
  });

  test("served / output is byte-identical to pre-STRETCH T19 served shape", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: hub }),
    );

    const served = await (await fetch(`${server.url}/`)).text();
    const baseline = injectSseClient(SAMPLE_HTML);
    expect(served).toBe(baseline);
  });

  test("served / output is byte-identical even when getActions is supplied but flag is off", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({
        port: pickPort(),
        getSnapshot: () => snapshot,
        events: hub,
        getActions: () => ACTIONS,
      }),
    );

    const served = await (await fetch(`${server.url}/`)).text();
    expect(served).toBe(injectSseClient(SAMPLE_HTML));
  });
});

describe("actions flag ON — served output", () => {
  test("served / output injects action buttons and data island", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({
        port: pickPort(),
        getSnapshot: () => snapshot,
        events: hub,
        enableActions: true,
        getActions: () => ACTIONS,
        openUrl: () => {},
      }),
    );

    const body = await (await fetch(`${server.url}/`)).text();
    expect(body).toContain("action-btn");
    expect(body).toContain('id="plan-actions"');
    expect(body).toContain('"taskId":"T1"');
    expect(body).toContain("https://github.com/owner/repo/pull/140");
  });
});

describe("actions flag ON — /action allowlist enforcement", () => {
  function makeServer(rec: { url?: string; calls: number }, logger: (m: string) => void) {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    return track(
      startServer({
        port: pickPort(),
        getSnapshot: () => snapshot,
        events: hub,
        enableActions: true,
        getActions: () => ACTIONS,
        openUrl: (u: string) => {
          rec.url = u;
          rec.calls += 1;
        },
        log: logger,
      }),
    );
  }

  test("unknown type (rm-rf) is rejected with 400 and no exec", async () => {
    const rec = { calls: 0 } as { url?: string; calls: number };
    const server = makeServer(rec, () => {});
    const res = await fetch(`${server.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "rm-rf", taskId: "T1" }),
    });
    expect(res.status).toBe(400);
    await res.text();
    expect(rec.calls).toBe(0);
  });

  test("unknown taskId returns 404 and no exec", async () => {
    const rec = { calls: 0 } as { url?: string; calls: number };
    const server = makeServer(rec, () => {});
    const res = await fetch(`${server.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "open-ref", taskId: "NOPE" }),
    });
    expect(res.status).toBe(404);
    await res.text();
    expect(rec.calls).toBe(0);
  });

  test("open-ref for a task with a full https URL invokes exec (mocked)", async () => {
    const rec = { calls: 0 } as { url?: string; calls: number };
    const server = makeServer(rec, () => {});
    const res = await fetch(`${server.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "open-ref", taskId: "T1" }),
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(rec.calls).toBe(1);
    expect(rec.url).toBe("https://github.com/owner/repo/pull/140");
  });

  test("open-ref for a task with only a bare ref (no full URL) is refused, no exec", async () => {
    const rec = { calls: 0 } as { url?: string; calls: number };
    const server = makeServer(rec, () => {});
    const res = await fetch(`${server.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "open-ref", taskId: "T2" }),
    });
    expect(res.status).toBe(400);
    await res.text();
    expect(rec.calls).toBe(0);
  });

  test("missing taskId returns 404 and no exec", async () => {
    const rec = { calls: 0 } as { url?: string; calls: number };
    const server = makeServer(rec, () => {});
    const res = await fetch(`${server.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "open-ref" }),
    });
    expect(res.status).toBe(404);
    await res.text();
    expect(rec.calls).toBe(0);
  });

  test("invalid JSON body returns 400 and no exec", async () => {
    const rec = { calls: 0 } as { url?: string; calls: number };
    const server = makeServer(rec, () => {});
    const res = await fetch(`${server.url}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    await res.text();
    expect(rec.calls).toBe(0);
  });

  test("every accepted action logs to the server log channel", async () => {
    const logger = silentLog();
    const rec = { calls: 0 } as { url?: string; calls: number };
    const server = makeServer(rec, logger.log);
    await (
      await fetch(`${server.url}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "open-ref", taskId: "T1" }),
      })
    ).text();
    expect(logger.lines.some((l) => l.includes("open-ref") && l.includes("T1"))).toBe(true);
  });

  test("GET /action is not a route (falls through to 404) even with actions on", async () => {
    const rec = { calls: 0 } as { url?: string; calls: number };
    const server = makeServer(rec, () => {});
    const res = await fetch(`${server.url}/action`, { method: "GET" });
    expect(res.status).toBe(404);
    await res.text();
  });
});

describe("actions data island — script-breakout escaping", () => {
  test("a </script> in a task title/prompt cannot break out of the data island", async () => {
    const { actionsDataIsland } = await import("../src/render/interactivity");
    const evil = "</script><script>alert(1)</script>";
    const island = actionsDataIsland([
      { taskId: "T1", prompt: `Title ${evil}`, url: undefined },
    ]);

    const dangerous = (island.match(/<\/script>/g) || []).length;
    expect(dangerous).toBe(1);
    expect(island).toContain("\\u003c/script\\u003e");
    expect(island).not.toContain("<script>alert(1)");

    const jsonText = island.slice(
      island.indexOf(">") + 1,
      island.lastIndexOf("</script>"),
    );
    const parsed = JSON.parse(jsonText) as Array<{ prompt: string }>;
    expect(parsed[0]!.prompt).toBe(`Title ${evil}`);
  });

  test("served flag-on HTML keeps the injected data island intact against </script>", async () => {
    const { injectActions } = await import("../src/render/interactivity");
    const evil = "</script><script>alert(1)</script>";
    const served = injectActions(SAMPLE_HTML, [
      { taskId: "T1", prompt: `First ${evil}`, url: undefined },
    ]);

    const islandOpen = served.indexOf('<script type="application/json" id="plan-actions">');
    expect(islandOpen).toBeGreaterThanOrEqual(0);
    const islandClose = served.indexOf("</script>", islandOpen);
    const islandBody = served.slice(
      islandOpen + '<script type="application/json" id="plan-actions">'.length,
      islandClose,
    );
    expect(islandBody).not.toContain("</script>");
    expect(islandBody).toContain("\\u003c/script\\u003e");
    const parsed = JSON.parse(islandBody) as Array<{ prompt: string }>;
    expect(parsed[0]!.prompt).toBe(`First ${evil}`);
  });
});

describe("resolveTaskActions (full-URL-only rule)", () => {
  test("extracts a full URL from a field and refuses bare refs", async () => {
    const { resolveTaskActions } = await import("../src/render/interactivity");
    const plan = {
      title: "p",
      tldr: [],
      objectives: { mustHave: [], mustNot: [], other: [] },
      waves: [],
      decisions: [],
      finalTasks: [],
      warnings: [],
      tasks: [
        {
          id: "A",
          checked: false,
          title: "Task A",
          state: { ref: "PR #140" },
          fields: [
            { label: "What to do", content: "See https://example.com/x for details", kind: "text" as const },
          ],
        },
        {
          id: "B",
          checked: false,
          title: "Task B",
          state: { ref: "f672a6a" },
          fields: [{ label: "What to do", content: "no urls here", kind: "text" as const }],
        },
      ],
    };
    const actions = resolveTaskActions(plan);
    expect(actions.length).toBe(2);
    expect(actions[0]!.url).toBe("https://example.com/x");
    expect(actions[0]!.prompt).toContain("Task A");
    expect(actions[0]!.prompt).toContain("See https://example.com/x");
    expect(actions[1]!.url).toBeUndefined();
  });

  test("does not construct URLs from bare PR numbers or SHAs", async () => {
    const { resolveTaskActions } = await import("../src/render/interactivity");
    const plan = {
      title: "p",
      tldr: [],
      objectives: { mustHave: [], mustNot: [], other: [] },
      waves: [],
      decisions: [],
      finalTasks: [],
      warnings: [],
      tasks: [
        {
          id: "C",
          checked: true,
          title: "Task C",
          stateComment: "commit f672a6a; PR #140",
          state: { ref: "PR #140" },
          fields: [],
        },
      ],
    };
    const actions = resolveTaskActions(plan);
    expect(actions[0]!.url).toBeUndefined();
  });
});
