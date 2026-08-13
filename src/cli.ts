#!/usr/bin/env bun

import { readFileSync } from "fs";
import { existsSync, renameSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { openBrowser } from "./runtime/host";
import { generate } from "./index";
import { parsePlan } from "./parse/index";
import { resolveTaskActions, type TaskAction } from "./render/interactivity";
import { watchPlan } from "./watch/watcher";
import type { WatchUpdate } from "./watch/watcher";
import {
  DEFAULT_PORT,
  createReloadHub,
  startServer,
  type HtmlSnapshot,
} from "./watch/server";

const HELP_TEXT = `usage: opencode-plan-canvas <plan.md> [--output <file>] [--help] [--version]
       opencode-plan-canvas watch <plan.md> [--port <n>] [--no-open] [--out <file>]

  <plan.md>              Input plan markdown file (required for default command)
  -o, --output <file>    Output file path (default: <plan-basename>.canvas.html next to input)
  --help, -h             Print this help message and exit
  --version, -v          Print version and exit

  watch <plan.md>        Start a localhost live-reload server (SSE) that re-renders on change
    --port <n>           Port to bind on 127.0.0.1 (default: ${DEFAULT_PORT})
    --no-open            Do not open the browser automatically
    --out <file>         Also write the static (server-free) HTML on each regen
    --enable-actions     STRETCH: enable served-only two-way controls (default OFF)
`;

function printWarnings(warnings: WatchUpdate["warnings"]): void {
  for (const warning of warnings) {
    if (warning.line !== undefined) {
      console.error(`warn: ${warning.line}: ${warning.message}`);
    } else {
      console.error(`warn: ${warning.message}`);
    }
  }
}

function atomicWrite(outputFile: string, html: string): void {
  const tempFile = join(tmpdir(), `.opencode-plan-canvas-${randomBytes(8).toString("hex")}.tmp`);
  writeFileSync(tempFile, html, "utf-8");
  renameSync(tempFile, outputFile);
}

function readVersion(): string {
  // `import.meta.dirname` resolves on Node >=20.11 and Bun; fall back to the
  // module URL so a built `dist/cli.js` still finds the sibling package.json
  // one directory up (both `src/` and `dist/` sit one level under the root).
  const here = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf-8"));
  return pkg.version;
}

async function runWatch(rest: string[]): Promise<void> {
  let planFile: string | undefined;
  let port = DEFAULT_PORT;
  let noOpen = false;
  let outFile: string | undefined;
  let enableActions = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--port") {
      const value = rest[++i];
      const parsed = value !== undefined ? Number.parseInt(value, 10) : NaN;
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        console.error(`error: invalid --port value: ${value ?? "(missing)"}`);
        process.exit(1);
      }
      port = parsed;
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--out") {
      outFile = rest[++i];
    } else if (arg === "--enable-actions") {
      enableActions = true;
    } else if (!arg.startsWith("-")) {
      planFile = arg;
    }
  }

  if (!planFile) {
    console.error("error: watch requires a <plan.md> argument");
    process.exit(1);
  }
  if (!existsSync(planFile)) {
    console.error(`error: ${planFile}: no such file or directory`);
    process.exit(1);
  }

  const hub = createReloadHub();
  let snapshot: HtmlSnapshot = { html: pendingHtml(planFile), generation: 0 };
  let lastGeneration = 0;
  let currentActions: TaskAction[] = [];

  const refreshActions = (source: string): void => {
    if (!enableActions) return;
    try {
      currentActions = resolveTaskActions(parsePlan(source));
    } catch {
      currentActions = [];
    }
  };

  if (enableActions) {
    try {
      refreshActions(readFileSync(planFile, "utf-8"));
    } catch {}
  }

  const handle = watchPlan(
    planFile,
    { onError: (e) => console.error(`warn: ${errorMessage(e)}`) },
    (update: WatchUpdate) => {
      lastGeneration = Math.max(lastGeneration, update.generation);
      snapshot = { html: update.html, generation: update.generation };
      if (enableActions) {
        try {
          refreshActions(readFileSync(planFile!, "utf-8"));
        } catch {}
      }
      printWarnings(update.warnings);
      if (outFile) {
        try {
          atomicWrite(outFile, update.html);
        } catch (e) {
          console.error(`warn: failed to write ${outFile}: ${errorMessage(e)}`);
        }
      }
      hub.push(update.generation);
    },
  );

  const forceRefresh = (): void => {
    let source: string;
    try {
      source = readFileSync(planFile!, "utf-8");
    } catch (e) {
      console.error(`warn: refresh failed to read ${planFile}: ${errorMessage(e)}`);
      return;
    }
    let result: { html: string; warnings: WatchUpdate["warnings"] };
    try {
      result = generate(source, { sourceLabel: planFile });
    } catch (e) {
      console.error(`warn: refresh failed to render ${planFile}: ${errorMessage(e)}`);
      return;
    }
    lastGeneration += 1;
    snapshot = { html: result.html, generation: lastGeneration };
    refreshActions(source);
    printWarnings(result.warnings);
    if (outFile) {
      try {
        atomicWrite(outFile, result.html);
      } catch (e) {
        console.error(`warn: failed to write ${outFile}: ${errorMessage(e)}`);
      }
    }
    hub.push(lastGeneration);
  };

  let server;
  try {
    server = startServer({
      port,
      getSnapshot: () => snapshot,
      events: hub,
      onRefresh: forceRefresh,
      enableActions,
      getActions: () => currentActions,
    });
  } catch (e) {
    handle.close();
    console.error(`error: failed to start server on port ${port}: ${errorMessage(e)}`);
    process.exit(1);
  }

  console.log(server.url);

  if (!noOpen) openBrowser(server.url);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      handle.close();
    } catch {}
    try {
      server.stop();
    } catch {}
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>(() => {});
}

function pendingHtml(planFile: string): string {
  const label = escapeForHtml(planFile);
  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8">`,
    `<title>opencode-plan-canvas — starting…</title></head>`,
    `<body><main style="font-family:system-ui;padding:2rem;color:#c9d1d9;background:#0d1117">`,
    `<h1>Rendering…</h1>`,
    `<p>Waiting for the first render of <code>${label}</code>. This page will reload automatically.</p>`,
    `<section id="waves"></section>`,
    `</main></body></html>`,
  ].join("\n");
}

function escapeForHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log(readVersion());
    process.exit(0);
  }

  if (args[0] === "watch") {
    await runWatch(args.slice(1));
    return;
  }

  let inputFile: string | undefined;
  let outputFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-o" || arg === "--output") {
      outputFile = args[++i];
    } else if (!arg.startsWith("-")) {
      inputFile = arg;
    }
  }

  if (!inputFile) {
    console.error("error: missing input file");
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`error: ${inputFile}: no such file or directory`);
    process.exit(1);
  }

  const source = readFileSync(inputFile, "utf-8");
  const { html, warnings } = generate(source, { sourceLabel: inputFile });

  printWarnings(warnings);

  if (!outputFile) {
    const dir = dirname(inputFile);
    const base = basename(inputFile, ".md");
    outputFile = join(dir, `${base}.canvas.html`);
  }

  atomicWrite(outputFile, html);

  process.exit(0);
}

main().catch((err) => {
  console.error("fatal:", err.message);
  process.exit(1);
});
