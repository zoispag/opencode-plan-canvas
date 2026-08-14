import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_MESSAGE_TEXT_LEN,
  OUTBOX_MESSAGE_VERSION,
  isOutboxMessageFile,
  resolveOutboxDir,
  writeOutboxMessage,
} from "../src/watch/outbox";

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "outbox-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    try {
      rmSync(dir!, { recursive: true, force: true });
    } catch {}
  }
});

describe("resolveOutboxDir", () => {
  test("maps a standard plan path to the sibling .sisyphus/outbox", () => {
    expect(resolveOutboxDir("/repo/.sisyphus/plans/live.md")).toBe(
      "/repo/.sisyphus/outbox",
    );
  });

  test("falls back to an outbox dir next to non-standard plans", () => {
    expect(resolveOutboxDir("/tmp/plan.md")).toBe("/tmp/outbox");
  });
});

describe("isOutboxMessageFile", () => {
  test("accepts the generated filename shape", () => {
    expect(isOutboxMessageFile("1700000000000-0123456789ab.json")).toBe(true);
  });

  test("rejects temp files and foreign names", () => {
    expect(isOutboxMessageFile(".abc123.tmp")).toBe(false);
    expect(isOutboxMessageFile("notes.json")).toBe(false);
    expect(isOutboxMessageFile("1700000000000-xyz.json")).toBe(false);
  });
});

describe("writeOutboxMessage", () => {
  test("writes a valid generic message and creates the dir", () => {
    const dir = join(scratch(), "outbox");
    const res = writeOutboxMessage(dir, { text: "  hello world  " }, 1234);
    expect(res.ok).toBe(true);
    const files = readdirSync(dir).filter(isOutboxMessageFile);
    expect(files.length).toBe(1);
    const parsed = JSON.parse(readFileSync(join(dir, files[0]!), "utf8"));
    expect(parsed).toEqual({ v: OUTBOX_MESSAGE_VERSION, ts: 1234, text: "hello world" });
  });

  test("includes taskId when provided", () => {
    const dir = join(scratch(), "outbox");
    const res = writeOutboxMessage(dir, { text: "scoped", taskId: "T5" }, 99);
    expect(res.ok).toBe(true);
    const parsed = JSON.parse(readFileSync(res.path!, "utf8"));
    expect(parsed.taskId).toBe("T5");
    expect(parsed.text).toBe("scoped");
  });

  test("rejects empty, whitespace-only, and non-string text", () => {
    const dir = join(scratch(), "outbox");
    expect(writeOutboxMessage(dir, { text: "" }).ok).toBe(false);
    expect(writeOutboxMessage(dir, { text: "   " }).ok).toBe(false);
    expect(writeOutboxMessage(dir, { text: 42 as unknown as string }).ok).toBe(false);
  });

  test("rejects over-long text", () => {
    const dir = join(scratch(), "outbox");
    const res = writeOutboxMessage(dir, { text: "x".repeat(MAX_MESSAGE_TEXT_LEN + 1) });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("text too long");
  });

  test("rejects a non-string taskId", () => {
    const dir = join(scratch(), "outbox");
    const res = writeOutboxMessage(dir, { text: "ok", taskId: 7 as unknown as string });
    expect(res.ok).toBe(false);
  });

  test("does not leave a temp file behind on success", () => {
    const dir = join(scratch(), "outbox");
    writeOutboxMessage(dir, { text: "clean" });
    const temps = readdirSync(dir).filter((n) => n.endsWith(".tmp"));
    expect(temps.length).toBe(0);
  });
});
