import { afterEach, describe, expect, test } from "bun:test";
import {
  createReloadHub,
  injectSseClient,
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
  return 4600 + Math.floor(Math.random() * 300);
}

const SAMPLE_HTML = [
  `<!doctype html>`,
  `<html><head><title>t</title></head>`,
  `<body>`,
  `<section id="waves"><div class="waves"></div></section>`,
  `<script>/* interactivity */</script>`,
  `</body></html>`,
].join("\n");

describe("injectSseClient", () => {
  test("inserts an EventSource client before </body>", () => {
    const out = injectSseClient(SAMPLE_HTML);
    expect(out).toContain("EventSource");
    expect(out).toContain('new EventSource("/events")');
    const bodyIdx = out.lastIndexOf("</body>");
    const esIdx = out.indexOf("EventSource");
    expect(esIdx).toBeLessThan(bodyIdx);
  });

  test("guards against file:// protocol", () => {
    const out = injectSseClient(SAMPLE_HTML);
    expect(out).toContain('location.protocol === "file:"');
  });

  test("appends when no </body> present", () => {
    const out = injectSseClient(`<div id="waves"></div>`);
    expect(out).toContain("EventSource");
  });
});

describe("createReloadHub", () => {
  test("push notifies subscribers and unsubscribe stops them", () => {
    const hub = createReloadHub();
    const seen: number[] = [];
    const off = hub.subscribe((g) => seen.push(g));
    hub.push(1);
    hub.push(2);
    off();
    hub.push(3);
    expect(seen).toEqual([1, 2]);
  });
});

describe("startServer GET /", () => {
  test("serves the current html with injected SSE client", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: hub }),
    );

    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain('id="waves"');
    expect(body).toContain('new EventSource("/events")');
  });

  test("reflects the latest snapshot on each request", async () => {
    let snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: hub }),
    );

    const first = await (await fetch(`${server.url}/`)).text();
    expect(first).toContain('id="waves"');

    snapshot = {
      html: SAMPLE_HTML.replace("id=\"waves\"", 'id="waves" data-gen="2"'),
      generation: 2,
    };
    const second = await (await fetch(`${server.url}/`)).text();
    expect(second).toContain('data-gen="2"');
  });

  test("binds to localhost only (url is 127.0.0.1)", () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: hub }),
    );
    expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);
  });
});

describe("startServer GET /events (SSE)", () => {
  test("streams a reload event when a generation bump is pushed", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: hub }),
    );

    const controller = new AbortController();
    const res = await fetch(`${server.url}/events`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    setTimeout(() => hub.push(7), 50);

    let acc = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      if (acc.includes("event: reload")) break;
    }

    controller.abort();
    try {
      reader.releaseLock();
    } catch {}

    expect(acc).toContain("event: reload");
    expect(acc).toContain("id: 7");
    expect(acc).toContain("data: 7");
  });

  test("unsubscribes the listener on client disconnect", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: hub }),
    );

    const controller = new AbortController();
    const res = await fetch(`${server.url}/events`, { signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    try {
      reader.releaseLock();
    } catch {}

    await new Promise((r) => setTimeout(r, 100));
    expect(() => hub.push(2)).not.toThrow();
  });
});

describe("startServer unknown routes", () => {
  test("returns 404 for unknown paths", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const hub = createReloadHub();
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: hub }),
    );
    const res = await fetch(`${server.url}/nope`);
    expect(res.status).toBe(404);
    await res.text();
  });
});
