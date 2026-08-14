import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createReloadHub,
  startServer,
  type HtmlSnapshot,
  type RunningServer,
} from "../src/watch/server";
import { injectMessaging } from "../src/render/interactivity";
import { isOutboxMessageFile } from "../src/watch/outbox";

const running: RunningServer[] = [];
const dirs: string[] = [];

function track(server: RunningServer): RunningServer {
  running.push(server);
  return server;
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "msg-srv-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (running.length > 0) {
    try {
      running.pop()?.stop();
    } catch {}
  }
  while (dirs.length > 0) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {}
  }
});

function pickPort(): number {
  return 4750 + Math.floor(Math.random() * 200);
}

const SAMPLE_HTML = [
  `<!doctype html>`,
  `<html><head><title>t</title></head>`,
  `<body>`,
  `<div class="wrap"><section id="waves"><div class="waves"></div></section></div>`,
  `</body></html>`,
].join("\n");

describe("injectMessaging", () => {
  test("inserts the prompt bar and /prompt POST before </body>", () => {
    const out = injectMessaging(SAMPLE_HTML);
    expect(out).toContain("data-msg-bar");
    expect(out).toContain('"/prompt"');
    const bodyIdx = out.lastIndexOf("</body>");
    const barIdx = out.indexOf("data-msg-bar");
    expect(barIdx).toBeLessThan(bodyIdx);
  });

  test("appends when no </body> present", () => {
    const out = injectMessaging(`<div class="wrap"></div>`);
    expect(out).toContain("data-msg-bar");
  });
});

describe("startServer messaging gating", () => {
  test("GET / omits messaging UI when disabled", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: createReloadHub() }),
    );
    const body = await (await fetch(`${server.url}/`)).text();
    expect(body).not.toContain("data-msg-bar");
  });

  test("POST /prompt is 404 when disabled", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const server = track(
      startServer({ port: pickPort(), getSnapshot: () => snapshot, events: createReloadHub() }),
    );
    const res = await fetch(`${server.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.status).toBe(404);
    await res.text();
  });

  test("messaging stays disabled if enableMessaging is set without an outboxDir", async () => {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    const server = track(
      startServer({
        port: pickPort(),
        getSnapshot: () => snapshot,
        events: createReloadHub(),
        enableMessaging: true,
      }),
    );
    const body = await (await fetch(`${server.url}/`)).text();
    expect(body).not.toContain("data-msg-bar");
    const res = await fetch(`${server.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.status).toBe(404);
    await res.text();
  });
});

describe("startServer POST /prompt when enabled", () => {
  function enabledServer(outboxDir: string): RunningServer {
    const snapshot: HtmlSnapshot = { html: SAMPLE_HTML, generation: 1 };
    return track(
      startServer({
        port: pickPort(),
        getSnapshot: () => snapshot,
        events: createReloadHub(),
        enableMessaging: true,
        outboxDir,
        log: () => {},
      }),
    );
  }

  test("GET / injects the messaging UI", async () => {
    const server = enabledServer(join(scratch(), "outbox"));
    const body = await (await fetch(`${server.url}/`)).text();
    expect(body).toContain("data-msg-bar");
    expect(body).toContain("msg-send");
  });

  test("valid generic message returns 202 and writes an outbox file", async () => {
    const dir = join(scratch(), "outbox");
    const server = enabledServer(dir);
    const res = await fetch(`${server.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "add a task to do xyz" }),
    });
    expect(res.status).toBe(202);
    await res.text();
    const files = readdirSync(dir).filter(isOutboxMessageFile);
    expect(files.length).toBe(1);
  });

  test("valid task-scoped message persists the taskId", async () => {
    const dir = join(scratch(), "outbox");
    const server = enabledServer(dir);
    const res = await fetch(`${server.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "clarify", taskId: "3" }),
    });
    expect(res.status).toBe(202);
    await res.text();
    const files = readdirSync(dir).filter(isOutboxMessageFile);
    const parsed = JSON.parse(await Bun.file(join(dir, files[0]!)).text());
    expect(parsed.taskId).toBe("3");
  });

  test("empty text returns 400", async () => {
    const server = enabledServer(join(scratch(), "outbox"));
    const res = await fetch(`${server.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    expect(res.status).toBe(400);
    await res.text();
  });

  test("invalid JSON returns 400", async () => {
    const server = enabledServer(join(scratch(), "outbox"));
    const res = await fetch(`${server.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "nope",
    });
    expect(res.status).toBe(400);
    await res.text();
  });

  test("GET /prompt falls through to 404", async () => {
    const server = enabledServer(join(scratch(), "outbox"));
    const res = await fetch(`${server.url}/prompt`, { method: "GET" });
    expect(res.status).toBe(404);
    await res.text();
  });
});
