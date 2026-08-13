import { existsSync, readFileSync, statSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";
import { generate } from "../index";
import { parsePlan } from "../parse/index";
import type { ParseWarning } from "../model";

export interface BoulderInfo {
  planName?: string;
  activePlan?: string;
  raw?: unknown;
}

export interface WatchUpdate {
  html: string;
  warnings: ParseWarning[];
  generation: number;
  boulder?: BoulderInfo;
}

export interface WatchOptions {
  debounceMs?: number;
  retries?: number;
  retryBackoffMs?: number;
  pollMs?: number;
  onError?: (error: unknown) => void;
}

export interface WatchHandle {
  close(): void;
}

const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_BACKOFF_MS = 100;
const DEFAULT_POLL_MS = 2000;

function planHasContent(source: string): boolean {
  const plan = parsePlan(source);
  if (plan.title.trim().length > 0) return true;
  if (plan.tasks.length > 0) return true;
  if (plan.waves.length > 0) return true;
  if (plan.tldr.length > 0) return true;
  if (plan.decisions.length > 0) return true;
  if (plan.finalTasks.length > 0) return true;
  return false;
}

function discoverBoulderPath(planPath: string): string | undefined {
  const planDir = dirname(planPath);
  if (basename(planDir) === "plans" && basename(dirname(planDir)) === ".sisyphus") {
    return join(dirname(planDir), "boulder.json");
  }
  let current = planDir;
  for (let i = 0; i < 40; i += 1) {
    const candidate = join(current, ".sisyphus", "boulder.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const sibling = join(planDir, ".sisyphus", "boulder.json");
  return sibling;
}

function readBoulder(boulderPath: string | undefined): BoulderInfo | undefined {
  if (!boulderPath) return undefined;
  if (!existsSync(boulderPath)) return undefined;
  let text: string;
  try {
    text = readFileSync(boulderPath, "utf8");
  } catch {
    return undefined;
  }
  if (text.trim().length === 0) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const info: BoulderInfo = { raw };
  const planName = record["plan_name"];
  if (typeof planName === "string") info.planName = planName;
  const activePlan = record["active_plan"];
  if (typeof activePlan === "string") info.activePlan = activePlan;
  return info;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function watchPlan(
  planPath: string,
  opts: WatchOptions,
  onUpdate: (update: WatchUpdate) => void,
): WatchHandle {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const retryBackoffMs = opts.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const onError = opts.onError;

  const boulderPath = discoverBoulderPath(planPath);

  let generation = 0;
  let lastGoodHtml: string | undefined;
  let closed = false;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let regenSeq = 0;

  let planWatcher: FSWatcher | undefined;
  let boulderWatcher: FSWatcher | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  function emitError(error: unknown): void {
    if (onError) {
      try {
        onError(error);
      } catch {}
    }
  }

  async function tryReadPlan(): Promise<{ source: string } | undefined> {
    const attempts = Math.max(1, retries);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let source: string | undefined;
      try {
        source = readFileSync(planPath, "utf8");
      } catch (error) {
        if (attempt === attempts - 1) {
          emitError(error);
          return undefined;
        }
        await sleep(retryBackoffMs);
        continue;
      }
      if (planHasContent(source)) {
        return { source };
      }
      if (attempt === attempts - 1) {
        emitError(
          new Error(
            `plan at ${planPath} yielded zero sections after ${attempts} attempt(s); keeping last-good render`,
          ),
        );
        return undefined;
      }
      await sleep(retryBackoffMs);
    }
    return undefined;
  }

  async function regenerate(): Promise<void> {
    if (closed) return;
    const seq = (regenSeq += 1);
    const read = await tryReadPlan();
    if (closed) return;
    if (seq !== regenSeq) return;
    if (!read) return;

    let result: { html: string; warnings: ParseWarning[] };
    try {
      result = generate(read.source, { sourceLabel: planPath });
    } catch (error) {
      emitError(error);
      return;
    }
    if (closed) return;

    lastGoodHtml = result.html;
    generation += 1;
    const boulder = readBoulder(boulderPath);
    onUpdate({
      html: result.html,
      warnings: result.warnings,
      generation,
      boulder,
    });
  }

  function scheduleRegen(): void {
    if (closed) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void regenerate();
    }, debounceMs);
  }

  function armPlanWatcher(): void {
    if (closed) return;
    try {
      planWatcher = watch(planPath, (eventType) => {
        if (closed) return;
        scheduleRegen();
        if (eventType === "rename") {
          rearmPlanWatcher();
        }
      });
      planWatcher.on("error", () => {
        rearmPlanWatcher();
      });
    } catch {
      planWatcher = undefined;
    }
  }

  function rearmPlanWatcher(): void {
    if (closed) return;
    try {
      planWatcher?.close();
    } catch {}
    planWatcher = undefined;
    setTimeout(() => {
      if (closed) return;
      if (existsSync(planPath)) armPlanWatcher();
    }, Math.min(retryBackoffMs, 50));
  }

  function armBoulderWatcher(): void {
    if (closed || !boulderPath) return;
    const boulderDir = dirname(boulderPath);
    if (!existsSync(boulderDir)) return;
    try {
      boulderWatcher = watch(boulderDir, (_eventType, filename) => {
        if (closed) return;
        if (filename === null || basename(boulderPath) === String(filename)) {
          scheduleRegen();
        }
      });
      boulderWatcher.on("error", () => {});
    } catch {
      boulderWatcher = undefined;
    }
  }

  function startPollFallback(): void {
    if (closed) return;
    let lastSig = "";
    pollTimer = setInterval(() => {
      if (closed) return;
      let sig = "";
      try {
        const st = statSync(planPath);
        sig = `${st.mtimeMs}:${st.size}`;
      } catch {
        sig = "missing";
      }
      if (boulderPath && existsSync(boulderPath)) {
        try {
          const bst = statSync(boulderPath);
          sig += `|${bst.mtimeMs}:${bst.size}`;
        } catch {}
      }
      if (lastSig === "") {
        lastSig = sig;
        return;
      }
      if (sig !== lastSig) {
        lastSig = sig;
        scheduleRegen();
      }
    }, pollMs);
    if (typeof (pollTimer as { unref?: () => void }).unref === "function") {
      (pollTimer as { unref?: () => void }).unref?.();
    }
  }

  armPlanWatcher();
  armBoulderWatcher();
  startPollFallback();

  void regenerate();

  return {
    close(): void {
      if (closed) return;
      closed = true;
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      try {
        planWatcher?.close();
      } catch {}
      try {
        boulderWatcher?.close();
      } catch {}
      planWatcher = undefined;
      boulderWatcher = undefined;
    },
  };
}
