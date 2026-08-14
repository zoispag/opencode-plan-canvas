import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPlugin,
  outboxDirFor,
  startOutboxWatcher,
} from "../adapter/opencode-plugin/internal";

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "adapter-outbox-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {}
  }
});

interface PromptCall {
  id: string;
  text: string;
}

function fakeClient(options?: {
  sessions?: Array<{
    id: string;
    parentID?: string;
    time?: { created?: number; updated?: number };
  }>;
  onPrompt?: () => void | Promise<void>;
  failPrompt?: boolean;
}) {
  const calls: PromptCall[] = [];
  const sessions = options?.sessions ?? [{ id: "ses_new", time: { updated: 100 } }];
  const client = {
    session: {
      list: async () => ({ data: sessions }),
      promptAsync: async (opts: {
        path: { id: string };
        body: { parts: Array<{ type: "text"; text: string }> };
      }) => {
        if (options?.onPrompt) await options.onPrompt();
        if (options?.failPrompt) throw new Error("prompt boom");
        calls.push({ id: opts.path.id, text: opts.body.parts[0]!.text });
        return {};
      },
    },
  };
  return { client, calls };
}

function writeMsg(
  dir: string,
  fileTs: number,
  body: { text: string; taskId?: string; ts?: number },
): void {
  const message = { v: 1, ts: body.ts ?? Date.now(), text: body.text, taskId: body.taskId };
  writeFileSync(join(dir, `${fileTs}-0123456789ab.json`), JSON.stringify(message));
}

async function settle(ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("outboxDirFor", () => {
  test("resolves the outbox from an absolute plan event path", () => {
    expect(outboxDirFor("/repo/.sisyphus/plans/live.md", { directory: "/repo" })).toBe(
      "/repo/.sisyphus/outbox",
    );
  });

  test("resolves the outbox from a boulder event path", () => {
    expect(outboxDirFor("/repo/.sisyphus/boulder.json", { directory: "/repo" })).toBe(
      "/repo/.sisyphus/outbox",
    );
  });

  test("absolutizes a relative plan path against input.directory", () => {
    expect(outboxDirFor(".sisyphus/plans/x.md", { directory: "/abs/repo" })).toBe(
      "/abs/repo/.sisyphus/outbox",
    );
  });

  test("returns undefined for unrelated paths", () => {
    expect(outboxDirFor("/repo/src/foo.ts", { directory: "/repo" })).toBeUndefined();
  });
});

describe("startOutboxWatcher delivery", () => {
  test("delivers a queued message to the most recent session and deletes the file", async () => {
    const dir = join(scratch(), "outbox");
    const { client, calls } = fakeClient({
      sessions: [
        { id: "ses_old", time: { updated: 100 } },
        { id: "ses_new", time: { updated: 500 } },
      ],
    });
    const watcher = startOutboxWatcher(dir, client, () => {});
    try {
      writeMsg(dir, 1700000000000, { text: "do the thing" });
      await settle();
      expect(calls.length).toBe(1);
      expect(calls[0]!.id).toBe("ses_new");
      expect(calls[0]!.text).toContain("do the thing");
      expect(readdirSync(dir).filter((n) => n.endsWith(".json")).length).toBe(0);
    } finally {
      watcher.close();
    }
  });

  test("includes the task id in the composed prompt for task-scoped messages", async () => {
    const dir = join(scratch(), "outbox");
    const { client, calls } = fakeClient();
    const watcher = startOutboxWatcher(dir, client, () => {});
    try {
      writeMsg(dir, 1700000000001, { text: "clarify", taskId: "T7" });
      await settle();
      expect(calls.length).toBe(1);
      expect(calls[0]!.text).toContain("T7");
      expect(calls[0]!.text).toContain("clarify");
    } finally {
      watcher.close();
    }
  });

  test("drops a malformed file without calling promptAsync", async () => {
    const dir = join(scratch(), "outbox");
    const { client, calls } = fakeClient();
    const watcher = startOutboxWatcher(dir, client, () => {});
    try {
      writeFileSync(join(dir, "1700000000002-0123456789ab.json"), "{ not json");
      await settle();
      expect(calls.length).toBe(0);
      expect(readdirSync(dir).filter((n) => n.endsWith(".json")).length).toBe(0);
    } finally {
      watcher.close();
    }
  });

  test("keeps the message queued when no session is available", async () => {
    const dir = join(scratch(), "outbox");
    const { client, calls } = fakeClient({ sessions: [] });
    const watcher = startOutboxWatcher(dir, client, () => {});
    try {
      writeMsg(dir, 1700000000003, { text: "later" });
      await settle();
      expect(calls.length).toBe(0);
      expect(readdirSync(dir).filter((n) => n.endsWith(".json")).length).toBe(1);
    } finally {
      watcher.close();
    }
  });

  test("keeps the message queued when promptAsync fails", async () => {
    const dir = join(scratch(), "outbox");
    const { client, calls } = fakeClient({ failPrompt: true });
    const watcher = startOutboxWatcher(dir, client, () => {});
    try {
      writeMsg(dir, 1700000000004, { text: "retry me" });
      await settle();
      expect(calls.length).toBe(0);
      expect(readdirSync(dir).filter((n) => n.endsWith(".json")).length).toBe(1);
    } finally {
      watcher.close();
    }
  });

  test("prefers a top-level session over a newer child (subagent) session", async () => {
    const dir = join(scratch(), "outbox");
    const { client, calls } = fakeClient({
      sessions: [
        { id: "ses_parent", time: { updated: 200 } },
        { id: "ses_child", parentID: "ses_parent", time: { updated: 900 } },
      ],
    });
    const watcher = startOutboxWatcher(dir, client, () => {});
    try {
      writeMsg(dir, 1700000000006, { text: "for the user" });
      await settle();
      expect(calls.length).toBe(1);
      expect(calls[0]!.id).toBe("ses_parent");
    } finally {
      watcher.close();
    }
  });

  test("falls back to newest overall when every session is a child", async () => {
    const dir = join(scratch(), "outbox");
    const { client, calls } = fakeClient({
      sessions: [
        { id: "ses_a", parentID: "ses_root", time: { updated: 100 } },
        { id: "ses_b", parentID: "ses_root", time: { updated: 800 } },
      ],
    });
    const watcher = startOutboxWatcher(dir, client, () => {});
    try {
      writeMsg(dir, 1700000000007, { text: "orphaned" });
      await settle();
      expect(calls.length).toBe(1);
      expect(calls[0]!.id).toBe("ses_b");
    } finally {
      watcher.close();
    }
  });

  test("drops a stale message without delivering it", async () => {
    const dir = join(scratch(), "outbox");
    const { client, calls } = fakeClient();
    const watcher = startOutboxWatcher(dir, client, () => {});
    try {
      const stale = Date.now() - 20 * 60 * 1000;
      writeMsg(dir, 1700000000008, { text: "yesterday's message", ts: stale });
      await settle();
      expect(calls.length).toBe(0);
      expect(readdirSync(dir).filter((n) => n.endsWith(".json")).length).toBe(0);
    } finally {
      watcher.close();
    }
  });

  test("delivers a recent message even with a ts present", async () => {
    const dir = join(scratch(), "outbox");
    const { client, calls } = fakeClient();
    const watcher = startOutboxWatcher(dir, client, () => {});
    try {
      writeMsg(dir, 1700000000009, { text: "fresh" });
      await settle();
      expect(calls.length).toBe(1);
      expect(calls[0]!.text).toContain("fresh");
    } finally {
      watcher.close();
    }
  });
});

describe("createPlugin wires the outbox watcher", () => {
  test("a plan event starts delivery for messages dropped in the outbox", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adapter-plugin-outbox-"));
    dirs.push(dir);
    const planPath = join(dir, ".sisyphus", "plans", "live.md");
    const { client, calls } = fakeClient();

    const factory = createPlugin({
      autoSpawn: false,
      fetchImpl: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    });
    const hooks = await factory({ client, directory: dir, worktree: dir } as never);
    type EventArg = Parameters<NonNullable<typeof hooks.event>>[0]["event"];
    await hooks.event!({
      event: {
        type: "file.watcher.updated",
        properties: { file: planPath },
      } as EventArg,
    });

    const outbox = join(dir, ".sisyphus", "outbox");
    writeMsg(outbox, 1700000000005, { text: "from the canvas" });
    await settle(120);

    expect(calls.length).toBe(1);
    expect(calls[0]!.text).toContain("from the canvas");

    await hooks.dispose!();
  });
});
