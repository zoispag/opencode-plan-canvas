import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchPlan } from "../src/watch/watcher";
import type { WatchHandle, WatchUpdate } from "../src/watch/watcher";

const GOOD_PLAN = "# Watcher Plan\n\n## TODOs\n\n- [x] 1. First task\n";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "opc-watch-"));
}

const openHandles: WatchHandle[] = [];
const tempDirs: string[] = [];

function track(handle: WatchHandle): WatchHandle {
  openHandles.push(handle);
  return handle;
}

function tempRoot(): string {
  const dir = makeTempDir();
  tempDirs.push(dir);
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(stepMs);
  }
}

afterEach(() => {
  while (openHandles.length > 0) {
    const handle = openHandles.pop();
    try {
      handle?.close();
    } catch {}
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    try {
      if (dir) rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe("watchPlan initial render", () => {
  test("fires onUpdate once immediately with generation 1", async () => {
    const dir = tempRoot();
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, GOOD_PLAN);

    const updates: WatchUpdate[] = [];
    track(
      watchPlan(planPath, { debounceMs: 60, retryBackoffMs: 20 }, (u) => {
        updates.push(u);
      }),
    );

    await waitFor(() => updates.length >= 1);
    expect(updates.length).toBe(1);
    expect(updates[0]!.generation).toBe(1);
    expect(updates[0]!.html.length).toBeGreaterThan(0);
    expect(updates[0]!.html).toContain("Watcher Plan");
  });
});

describe("watchPlan debounce", () => {
  test("collapses a rapid burst of writes into a single update (generation 2)", async () => {
    const dir = tempRoot();
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, GOOD_PLAN);

    // 400ms debounce (vs default 150) keeps a ~20ms burst inside ONE window
    // even under parallel-suite CPU/event jitter; a tighter window let the
    // first fs.watch event's timer fire before the last write, splitting the
    // burst into two regens (generation 3) — the flaky failure guarded here.
    const debounceMs = 400;
    const burstWrites = 3;

    const updates: WatchUpdate[] = [];
    track(
      watchPlan(planPath, { debounceMs, retryBackoffMs: 20 }, (u) => {
        updates.push(u);
      }),
    );

    await waitFor(() => updates.length >= 1);
    expect(updates.length).toBe(1);
    expect(updates[0]!.generation).toBe(1);

    writeFileSync(planPath, "# Watcher Plan\n\n## TODOs\n\n- [x] 1. Edit A\n");
    await sleep(10);
    writeFileSync(planPath, "# Watcher Plan\n\n## TODOs\n\n- [x] 1. Edit B\n");
    await sleep(10);
    writeFileSync(planPath, "# Watcher Plan\n\n## TODOs\n\n- [x] 1. Edit C\n- [ ] 2. Second\n");

    await waitFor(() => updates.length >= 2, 3000);
    await sleep(debounceMs + 400);

    expect(updates.length).toBe(2);
    expect(updates[1]!.generation).toBe(2);
    expect(updates[1]!.html).toContain("Edit C");

    const totalWrites = 1 + burstWrites;
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.length).toBeLessThan(1 + totalWrites);
    const last = updates[updates.length - 1]!;
    expect(last.html).toContain("Edit C");
    expect(last.html).toContain("Second");
  });
});

describe("watchPlan last-good render", () => {
  test("keeps last-good html on garbage, then updates on valid content", async () => {
    const dir = tempRoot();
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, GOOD_PLAN);

    const updates: WatchUpdate[] = [];
    const errors: unknown[] = [];
    track(
      watchPlan(
        planPath,
        { debounceMs: 80, retries: 3, retryBackoffMs: 30, onError: (e) => errors.push(e) },
        (u) => {
          updates.push(u);
        },
      ),
    );

    await waitFor(() => updates.length >= 1);
    expect(updates.length).toBe(1);
    const goodHtml = updates[0]!.html;
    expect(goodHtml).toContain("First task");

    writeFileSync(planPath, "");
    await sleep(700);

    expect(updates.length).toBe(1);
    expect(errors.length).toBeGreaterThanOrEqual(1);

    writeFileSync(planPath, "# Recovered Plan\n\n## TODOs\n\n- [x] 1. Back online\n");
    await waitFor(() => updates.length >= 2);
    expect(updates.length).toBe(2);
    expect(updates[1]!.generation).toBe(2);
    expect(updates[1]!.html).toContain("Back online");
  });
});

describe("watchPlan boulder discovery", () => {
  test("boulder.json created after start is picked up on a later event", async () => {
    const dir = tempRoot();
    const sisyphus = join(dir, ".sisyphus");
    const plansDir = join(sisyphus, "plans");
    mkdirSync(plansDir, { recursive: true });
    const planPath = join(plansDir, "myplan.md");
    writeFileSync(planPath, GOOD_PLAN);

    const updates: WatchUpdate[] = [];
    track(
      watchPlan(planPath, { debounceMs: 80, retryBackoffMs: 20 }, (u) => {
        updates.push(u);
      }),
    );

    await waitFor(() => updates.length >= 1);
    expect(updates[0]!.boulder).toBeUndefined();

    const boulderPath = join(sisyphus, "boulder.json");
    writeFileSync(
      boulderPath,
      JSON.stringify({ active_plan: planPath, plan_name: "myplan" }),
    );
    await sleep(30);
    writeFileSync(planPath, "# Watcher Plan\n\n## TODOs\n\n- [x] 1. touched\n");

    await waitFor(() => updates.length >= 2);
    const last = updates[updates.length - 1]!;
    expect(last.boulder).toBeDefined();
    expect(last.boulder!.planName).toBe("myplan");
    expect(last.boulder!.activePlan).toBe(planPath);
  });

  test("malformed boulder.json is ignored gracefully (no crash, boulder undefined)", async () => {
    const dir = tempRoot();
    const sisyphus = join(dir, ".sisyphus");
    const plansDir = join(sisyphus, "plans");
    mkdirSync(plansDir, { recursive: true });
    const planPath = join(plansDir, "myplan.md");
    writeFileSync(planPath, GOOD_PLAN);
    writeFileSync(join(sisyphus, "boulder.json"), "{ this is : not json ,,,");

    const updates: WatchUpdate[] = [];
    track(
      watchPlan(planPath, { debounceMs: 60, retryBackoffMs: 20 }, (u) => {
        updates.push(u);
      }),
    );

    await waitFor(() => updates.length >= 1);
    expect(updates.length).toBe(1);
    expect(updates[0]!.boulder).toBeUndefined();
    expect(updates[0]!.html).toContain("Watcher Plan");
  });
});

describe("watchPlan close", () => {
  test("close() stops further updates", async () => {
    const dir = tempRoot();
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, GOOD_PLAN);

    const updates: WatchUpdate[] = [];
    const handle = watchPlan(planPath, { debounceMs: 60, retryBackoffMs: 20 }, (u) => {
      updates.push(u);
    });

    await waitFor(() => updates.length >= 1);
    handle.close();
    const countAfterClose = updates.length;

    writeFileSync(planPath, "# Watcher Plan\n\n## TODOs\n\n- [x] 1. after close\n");
    await sleep(500);

    expect(updates.length).toBe(countAfterClose);
  });
});
