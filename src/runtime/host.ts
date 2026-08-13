import { spawn as nodeSpawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

interface BunLike {
  spawn(
    cmd: string[],
    opts?: { stdout?: string; stderr?: string; stdin?: string },
  ): unknown;
  serve(opts: {
    port?: number;
    hostname?: string;
    fetch: (req: Request) => Response | Promise<Response>;
  }): { port?: number; stop(closeActiveConnections?: boolean): void };
}

function bun(): BunLike {
  return (globalThis as unknown as { Bun: BunLike }).Bun;
}

export function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url];

    if (isBun) {
      bun().spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
      return;
    }

    const child = nodeSpawn(cmd[0]!, cmd.slice(1), { stdio: "ignore", detached: true });
    child.unref();
    child.on("error", () => {});
  } catch {
  }
}

export interface ServeOptions {
  port?: number;
  hostname?: string;
  fetch: (req: Request) => Response | Promise<Response>;
  onListenError?: (err: Error) => void;
}

export interface ServeHandle {
  port: number;
  stop(): void;
}

export function serve(options: ServeOptions): ServeHandle {
  const port = options.port ?? 0;
  const hostname = options.hostname ?? "127.0.0.1";

  if (isBun) {
    const server = bun().serve({ port, hostname, fetch: options.fetch });
    const boundPort = server.port ?? port;
    return {
      port: boundPort,
      stop(): void {
        try {
          server.stop(true);
        } catch {
        }
      },
    };
  }

  return serveNode(options.fetch, port, hostname, options.onListenError);
}

function serveNode(
  handler: (req: Request) => Response | Promise<Response>,
  port: number,
  hostname: string,
  onListenError?: (err: Error) => void,
): ServeHandle {
  const server = createServer((req, res) => {
    void handleNodeRequest(req, res, handler);
  });

  // Track live sockets so stop() can destroy them synchronously; server.close()
  // alone waits for in-flight (and never-ending SSE) connections to drain.
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const portBox = { value: port };

  // A bind failure (EADDRINUSE) surfaces asynchronously on Node. Route it
  // through the optional callback so the CLI can print a clean message; else
  // exit non-zero rather than crash with an unhandled 'error' event.
  server.on("error", (err: Error) => {
    if (onListenError) {
      onListenError(err);
    } else {
      console.error(`error: server: ${err.message}`);
      process.exit(1);
    }
  });

  server.listen(port, hostname, () => {
    const addr = server.address();
    if (addr && typeof addr === "object") {
      portBox.value = addr.port;
    }
  });

  return {
    get port(): number {
      return portBox.value;
    },
    stop(): void {
      try {
        server.close();
      } catch {
      }
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {
        }
      }
      sockets.clear();
    },
  } as ServeHandle;
}

async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (req: Request) => Response | Promise<Response>,
): Promise<void> {
  let response: Response;
  try {
    response = await handler(toWebRequest(req));
  } catch {
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("internal error");
    return;
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);

  const body = response.body;
  if (body === null) {
    const text = await response.text().catch(() => "");
    res.end(text);
    return;
  }

  await pipeStreamToResponse(body, req, res);
}

// Streams a web ReadableStream to the Node response incrementally so SSE
// (`/events`) flushes each frame as it arrives instead of buffering forever.
async function pipeStreamToResponse(
  body: ReadableStream<Uint8Array>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const reader = body.getReader();
  let cancelled = false;

  const onClose = (): void => {
    if (cancelled) return;
    cancelled = true;
    // Cancels the ReadableStream, running its `cancel()` hook upstream which
    // unsubscribes the SSE listener and clears the heartbeat interval.
    reader.cancel().catch(() => {});
  };
  res.on("close", onClose);
  req.on("aborted", onClose);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || cancelled || res.writableEnded) break;
      if (value && value.byteLength > 0) {
        res.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        (res as ServerResponse & { flush?: () => void }).flush?.();
      }
    }
  } catch {
  } finally {
    if (!res.writableEnded) {
      try {
        res.end();
      } catch {
      }
    }
  }
}

// Adapts a node:http request to a web Request, wiring an AbortSignal to the
// socket lifecycle so the SSE handler's `req.signal` fires on disconnect.
function toWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? "127.0.0.1";
  const url = `http://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  req.on("aborted", abort);
  req.on("close", abort);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const init: RequestInit = { method, headers, signal: controller.signal };

  if (method !== "GET" && method !== "HEAD") {
    const stream = new ReadableStream<Uint8Array>({
      start(controllerInner) {
        req.on("data", (chunk: Buffer) => controllerInner.enqueue(new Uint8Array(chunk)));
        req.on("end", () => controllerInner.close());
        req.on("error", () => {
          try {
            controllerInner.close();
          } catch {
          }
        });
      },
    });
    (init as RequestInit & { duplex?: string }).duplex = "half";
    init.body = stream;
  }

  return new Request(url, init);
}
