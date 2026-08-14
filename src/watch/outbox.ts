import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

// A directory of small JSON files (one per prompt), not a single append log,
// so delivery is idempotent: the plugin claims a message by removing its file.
export const OUTBOX_MESSAGE_VERSION = 1 as const;

// Hard cap so a runaway paste cannot write an unbounded file (mirrors the
// server-side and browser-side limits).
export const MAX_MESSAGE_TEXT_LEN = 8000;

export interface OutboxMessage {
  v: number;
  ts: number;
  taskId?: string;
  text: string;
}

export function resolveOutboxDir(planPath: string): string {
  const planDir = dirname(planPath);
  if (basename(planDir) === "plans" && basename(dirname(planDir)) === ".sisyphus") {
    return join(dirname(planDir), "outbox");
  }
  return join(planDir, "outbox");
}

export function ensureOutboxDir(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return existsSync(dir);
  } catch {
    return false;
  }
}

function messageFilename(ts: number): string {
  return `${ts}-${randomBytes(6).toString("hex")}.json`;
}

export function isOutboxMessageFile(name: string): boolean {
  // `<epochMs>-<12 hex>.json` — timestamp prefix orders files; hex suffix avoids
  // same-millisecond collisions. Readers use this to skip temp/other files.
  return /^\d+-[0-9a-f]{12}\.json$/.test(name);
}

export interface WriteOutboxResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export function writeOutboxMessage(
  dir: string,
  input: { text: unknown; taskId?: unknown },
  now: number = Date.now(),
): WriteOutboxResult {
  if (typeof input.text !== "string") {
    return { ok: false, error: "text must be a string" };
  }
  const text = input.text.trim();
  if (text.length === 0) {
    return { ok: false, error: "text must not be empty" };
  }
  if (text.length > MAX_MESSAGE_TEXT_LEN) {
    return { ok: false, error: "text too long" };
  }

  let taskId: string | undefined;
  if (input.taskId !== undefined) {
    if (typeof input.taskId !== "string" || input.taskId.length === 0) {
      return { ok: false, error: "taskId must be a non-empty string" };
    }
    taskId = input.taskId;
  }

  if (!ensureOutboxDir(dir)) {
    return { ok: false, error: "failed to create outbox directory" };
  }

  const message: OutboxMessage = {
    v: OUTBOX_MESSAGE_VERSION,
    ts: now,
    text,
    ...(taskId !== undefined ? { taskId } : {}),
  };

  const finalPath = join(dir, messageFilename(now));
  const tempPath = join(dir, `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    // temp-file + rename so a reader never observes a partial JSON write.
    writeFileSync(tempPath, JSON.stringify(message), "utf8");
    renameSync(tempPath, finalPath);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, path: finalPath };
}
