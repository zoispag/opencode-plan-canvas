import {
  injectActions,
  injectMessaging,
  type TaskAction,
} from "../render/interactivity";
import { openBrowser, serve } from "../runtime/host";
import { writeOutboxMessage } from "./outbox";

export interface HtmlSnapshot {
  html: string;
  generation: number;
}

export type ReloadListener = (generation: number) => void;

export interface SubscribeApi {
  subscribe(listener: ReloadListener): () => void;
}

export interface ActionEntry {
  taskId: string;
  prompt: string;
  url?: string;
}

export interface StartServerOptions {
  port?: number;
  getSnapshot: () => HtmlSnapshot;
  events: SubscribeApi;
  onRefresh?: () => void;
  enableActions?: boolean;
  getActions?: () => ActionEntry[];
  openUrl?: (url: string) => void;
  log?: (message: string) => void;
  enableMessaging?: boolean;
  outboxDir?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  stop(): void;
}

export const DEFAULT_PORT = 4499;
const HEARTBEAT_MS = 25000;

export function createReloadHub(): SubscribeApi & { push(generation: number): void } {
  const listeners = new Set<ReloadListener>();
  return {
    subscribe(listener: ReloadListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push(generation: number): void {
      for (const listener of [...listeners]) {
        try {
          listener(generation);
        } catch {}
      }
    },
  };
}

const SSE_CLIENT_SCRIPT = [
  `<script>`,
  `(function () {`,
  `  "use strict";`,
  `  try {`,
  `    if (typeof location !== "undefined" && location.protocol === "file:") return;`,
  `    if (typeof EventSource === "undefined") return;`,
  `    var es = new EventSource("/events");`,
  `    es.addEventListener("reload", function () {`,
  `      try { location.reload(); } catch (e) {}`,
  `    });`,
  `  } catch (e) {`,
  `    try { console.warn("plan-canvas live-reload disabled:", e); } catch (_) {}`,
  `  }`,
  `})();`,
  `</script>`,
].join("\n");

export function injectSseClient(html: string): string {
  const marker = "</body>";
  const idx = html.lastIndexOf(marker);
  if (idx === -1) {
    return `${html}\n${SSE_CLIENT_SCRIPT}\n`;
  }
  return `${html.slice(0, idx)}${SSE_CLIENT_SCRIPT}\n${html.slice(idx)}`;
}

function sseReloadFrame(generation: number): string {
  return `event: reload\nid: ${generation}\ndata: ${generation}\n\n`;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function defaultOpenUrl(url: string): void {
  openBrowser(url);
}

export function startServer(options: StartServerOptions): RunningServer {
  const port = options.port ?? DEFAULT_PORT;
  const { getSnapshot, events, onRefresh } = options;
  const enableActions = options.enableActions === true;
  const getActions = options.getActions;
  const openUrl = options.openUrl ?? defaultOpenUrl;
  const log = options.log ?? ((m: string) => console.log(m));
  const enableMessaging = options.enableMessaging === true && !!options.outboxDir;
  const outboxDir = options.outboxDir;

  const server = serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/" && req.method === "GET") {
        const snapshot = getSnapshot();
        let body = injectSseClient(snapshot.html);
        if (enableActions && getActions) {
          const actions: TaskAction[] = getActions();
          body = injectActions(body, actions);
        }
        if (enableMessaging) {
          body = injectMessaging(body);
        }
        return new Response(body, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (path === "/events" && req.method === "GET") {
        return sseResponse(req, events);
      }

      if (path === "/refresh" && req.method === "POST") {
        if (onRefresh) {
          try {
            onRefresh();
          } catch {}
        }
        return new Response(null, {
          status: 204,
          headers: { "cache-control": "no-store" },
        });
      }

      if (enableActions && path === "/action" && req.method === "POST") {
        return handleAction(req, getActions, openUrl, log);
      }

      if (enableMessaging && path === "/prompt" && req.method === "POST") {
        return handlePrompt(req, outboxDir, log);
      }

      return new Response("not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    },
  });

  const boundPort = server.port ?? port;
  return {
    url: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    stop(): void {
      try {
        server.stop();
      } catch {}
    },
  };
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handleAction(
  req: Request,
  getActions: (() => ActionEntry[]) | undefined,
  openUrl: (url: string) => void,
  log: (message: string) => void,
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    log(`action: rejected (invalid JSON body)`);
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  if (typeof payload !== "object" || payload === null) {
    log(`action: rejected (body is not an object)`);
    return jsonResponse(400, { error: "body must be an object" });
  }

  const type = (payload as Record<string, unknown>).type;
  if (type !== "open-ref") {
    log(`action: rejected (unknown type: ${String(type)})`);
    return jsonResponse(400, { error: "unknown action type" });
  }

  const taskId = (payload as Record<string, unknown>).taskId;
  if (typeof taskId !== "string" || taskId.length === 0) {
    log(`action: rejected (missing taskId)`);
    return jsonResponse(404, { error: "unknown task" });
  }

  const actions = getActions ? getActions() : [];
  const entry = actions.find((a) => a.taskId === taskId);
  if (!entry) {
    log(`action: rejected (unknown task: ${taskId})`);
    return jsonResponse(404, { error: "unknown task" });
  }

  const target = entry.url;
  if (typeof target !== "string" || !isHttpUrl(target)) {
    log(`action: refused open-ref for ${taskId} (no full http(s) URL)`);
    return jsonResponse(400, { error: "task has no full http(s) reference URL" });
  }

  log(`action: open-ref ${taskId} -> ${target}`);
  try {
    openUrl(target);
  } catch (e) {
    log(`action: open-ref ${taskId} exec failed: ${String(e)}`);
    return jsonResponse(500, { error: "failed to open url" });
  }
  return jsonResponse(200, { ok: true, opened: target });
}

async function handlePrompt(
  req: Request,
  outboxDir: string | undefined,
  log: (message: string) => void,
): Promise<Response> {
  if (!outboxDir) {
    return jsonResponse(500, { error: "messaging not configured" });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    log(`prompt: rejected (invalid JSON body)`);
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  if (typeof payload !== "object" || payload === null) {
    log(`prompt: rejected (body is not an object)`);
    return jsonResponse(400, { error: "body must be an object" });
  }

  const record = payload as Record<string, unknown>;
  const result = writeOutboxMessage(outboxDir, {
    text: record.text,
    taskId: record.taskId,
  });

  if (!result.ok) {
    log(`prompt: rejected (${result.error ?? "unknown"})`);
    return jsonResponse(400, { error: result.error ?? "invalid message" });
  }

  const scope = typeof record.taskId === "string" ? ` [task ${record.taskId}]` : "";
  log(`prompt: queued${scope} -> ${result.path}`);
  return jsonResponse(202, { ok: true });
}

function sseResponse(req: Request, events: SubscribeApi): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (text: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };

      enqueue(`: connected\n\n`);

      unsubscribe = events.subscribe((generation) => {
        enqueue(sseReloadFrame(generation));
      });

      heartbeat = setInterval(() => {
        enqueue(`: keepalive\n\n`);
      }, HEARTBEAT_MS);
      if (typeof (heartbeat as { unref?: () => void }).unref === "function") {
        (heartbeat as { unref?: () => void }).unref?.();
      }

      const signal = req.signal;
      if (signal) {
        if (signal.aborted) {
          cleanup();
          try {
            controller.close();
          } catch {}
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            cleanup();
            try {
              controller.close();
            } catch {}
          },
          { once: true },
        );
      }

      function cleanup(): void {
        if (closed) return;
        closed = true;
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {}
          unsubscribe = undefined;
        }
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
      }
    },
    cancel() {
      closed = true;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {}
        unsubscribe = undefined;
      }
      if (heartbeat !== undefined) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}
