import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generate } from "../src/index";
import { parsePlan } from "../src/parse/index";
import { buildTaskLookup, isFinalEntry, matchEntryToTask } from "../src/parse/waves";
import type { Plan, Task } from "../src/model";
import { GOLDEN_CSS } from "../src/render/styles";

const FIXTURES = join(import.meta.dirname, "fixtures");
const GOLDEN_PLAN = join(FIXTURES, "golden-plan.md");
const GOLDEN_MASTER = join(FIXTURES, "golden-master.html");
const GOLDEN_CANVAS = join(FIXTURES, "golden-canvas.html");
const XSS_PLAN = join(FIXTURES, "xss-plan.md");
const DEGRADED_PLAN = join(FIXTURES, "degraded-plan.md");
const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const CWD = join(import.meta.dirname, "..");

const GOLDEN_SOURCE_LABEL = "test/fixtures/golden-plan.md";

function goldenSource(): string {
  return readFileSync(GOLDEN_PLAN, "utf-8");
}

function generateGolden(): string {
  return generate(goldenSource(), { sourceLabel: GOLDEN_SOURCE_LABEL }).html;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function countTcards(html: string): number {
  return (
    countOccurrences(html, `<details class="tcard`) +
    countOccurrences(html, `<div class="tcard`)
  );
}

interface Reconciled {
  waveEntries: number;
  unassigned: Task[];
  pairedTasks: Set<Task>;
}

function reconcilePlan(plan: Plan): Reconciled {
  const lookup = buildTaskLookup(plan.tasks);
  const finalIds = new Set(plan.finalTasks.map((f) => f.id));
  const pairedTasks = new Set<Task>();
  let waveEntries = 0;
  for (const wave of plan.waves) {
    for (const entry of wave.entries) {
      waveEntries++;
      const task = matchEntryToTask(entry, lookup, finalIds);
      if (task) pairedTasks.add(task);
    }
  }
  const unassigned = plan.tasks.filter((t) => !pairedTasks.has(t));
  return { waveEntries, unassigned, pairedTasks };
}

function extractStyle(html: string): string {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1]! : "";
}

describe("acceptance: golden-master characterization snapshot", () => {
  it("generate(goldenPlan) === committed golden-master file (byte compare)", () => {
    expect(existsSync(GOLDEN_MASTER)).toBe(true);
    const committed = readFileSync(GOLDEN_MASTER, "utf-8");
    const produced = generateGolden();
    expect(produced).toBe(committed);
  });
});

describe("acceptance: css invariant", () => {
  it("generated <style> STARTS WITH byte-exact GOLDEN_CSS (extension follows)", () => {
    const style = extractStyle(generateGolden());
    expect(style.startsWith(GOLDEN_CSS)).toBe(true);
    expect(style.length).toBeGreaterThanOrEqual(GOLDEN_CSS.length);
  });

  it("GOLDEN_CSS equals the golden-canvas fixture <style> (cross-check)", () => {
    const canvasStyle = extractStyle(readFileSync(GOLDEN_CANVAS, "utf-8"));
    expect(canvasStyle).toBe(GOLDEN_CSS);
  });
});

describe("acceptance: structural invariants", () => {
  it("output contains each of the 6 populated section ids", () => {
    const html = generateGolden();
    for (const id of ["crit", "waves", "guardrails", "verify", "decisions", "final"]) {
      expect(html.includes(`id="${id}"`)).toBe(true);
    }
  });

  it(".tcard count === rendered wave entries + unassigned tasks (normalized reconcile)", () => {
    const plan = parsePlan(goldenSource());
    const { waveEntries, unassigned } = reconcilePlan(plan);
    const expected = waveEntries + unassigned.length;

    const html = generateGolden();
    const tcards = countTcards(html);
    expect(tcards).toBe(expected);
  });

  it("golden: T1–T15 pair by normalized id so Unassigned is empty", () => {
    const plan = parsePlan(goldenSource());
    const { unassigned } = reconcilePlan(plan);
    expect(unassigned.length).toBe(0);
    const html = generateGolden();
    expect(html.includes("<span>Unassigned</span>")).toBe(false);
  });

  it(".dcard count === parsed decisions count", () => {
    const plan = parsePlan(goldenSource());
    const html = generateGolden();
    const dcards = countOccurrences(html, `<div class="dcard"`);
    expect(dcards).toBe(plan.decisions.length);
  });

  it(".fcard count === finalTasks count", () => {
    const plan = parsePlan(goldenSource());
    const html = generateGolden();
    const fcards = countOccurrences(html, `<div class="fcard"`);
    expect(fcards).toBe(plan.finalTasks.length);
  });

  it("every checked wave task card is shipped; every unchecked one is not", () => {
    const plan = parsePlan(goldenSource());
    const { unassigned } = reconcilePlan(plan);
    let checkedEntries = 0;
    let uncheckedEntries = 0;
    for (const wave of plan.waves) {
      for (const entry of wave.entries) {
        if (entry.checked) checkedEntries++;
        else uncheckedEntries++;
      }
    }
    for (const t of unassigned) {
      if (t.checked) checkedEntries++;
      else uncheckedEntries++;
    }

    const html = generateGolden();
    const shipped = countOccurrences(html, `class="tcard shipped"`);
    const plain = countOccurrences(html, `class="tcard">`);
    const inprogress = countOccurrences(html, `class="tcard inprogress"`);
    expect(shipped).toBe(checkedEntries);
    expect(plain + inprogress).toBe(uncheckedEntries);
    expect(shipped + plain + inprogress).toBe(countTcards(html));
  });

  it("marks exactly one .inprogress card (first unchecked, server-side)", () => {
    const plan = parsePlan(goldenSource());
    const hasUnchecked = plan.tasks.some((t) => !t.checked);
    const html = generateGolden();
    const inprogress = countOccurrences(html, `class="tcard inprogress"`);
    expect(inprogress).toBe(hasUnchecked ? 1 : 0);
  });

  it("injects a read-only controls bar and inline interactivity script", () => {
    const html = generateGolden();
    expect(html.includes(`data-controls`)).toBe(true);
    expect(html.includes(`data-expand-all`)).toBe(true);
    expect(html.includes(`data-filter-status`)).toBe(true);
    expect(countOccurrences(html, `<script>`)).toBe(1);
    expect(countOccurrences(html, `</script>`)).toBe(1);
  });

  it("includes the theme-toggle button in the controls bar", () => {
    const html = generateGolden();
    expect(html.includes(`data-theme-toggle`)).toBe(true);
    expect(html.includes(`data-theme-lbl`)).toBe(true);
  });

  it("default output is dark: no data-theme attribute on <html> (light is opt-in)", () => {
    const html = generateGolden();
    const htmlTag = html.match(/<html\b[^>]*>/);
    expect(htmlTag).not.toBeNull();
    expect(htmlTag![0].includes("data-theme")).toBe(false);
    const bodyTag = html.match(/<body\b[^>]*>/);
    expect(bodyTag).not.toBeNull();
    expect(bodyTag![0].includes("data-theme")).toBe(false);
  });
});

describe("acceptance: self-containment", () => {
  it("no external-ref attributes, no @import, no url(http", () => {
    const html = generateGolden();
    expect(/(src|href)="https?:/.test(html)).toBe(false);
    expect(html.includes("@import")).toBe(false);
    expect(html.includes("url(http")).toBe(false);
  });

  it("interactivity script is inline (no external <script src>)", () => {
    const html = generateGolden();
    expect(/<script\s+[^>]*src=/.test(html)).toBe(false);
    expect(html.includes("<script>")).toBe(true);
  });
});

describe("acceptance: xss escaping", () => {
  it("dangerous markup renders as escaped text, never as live nodes", () => {
    const src = readFileSync(XSS_PLAN, "utf-8");
    const { html } = generate(src);

    expect(html.includes("&lt;script&gt;")).toBe(true);
    expect(html.includes("<script>alert")).toBe(false);
    expect(/<[a-zA-Z]+[^>]*\sonerror=/.test(html)).toBe(false);
    expect(html.includes("<img onerror")).toBe(false);
    expect(html.includes("&lt;img onerror")).toBe(true);
  });
});

describe("acceptance: lenient degraded input (CLI spawn)", () => {
  it("exits 0, omits absent decisions, warns, emits valid HTML", async () => {
    const outputFile = join(tmpdir(), `opencode-acceptance-degraded-${Date.now()}.html`);
    try {
      const proc = Bun.spawn(["bun", "run", CLI, DEGRADED_PLAN, "-o", outputFile], {
        cwd: CWD,
        stdio: ["inherit", "pipe", "pipe"],
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(existsSync(outputFile)).toBe(true);

      const warnLines = stderr.split("\n").filter((l) => l.startsWith("warn:"));
      expect(warnLines.length).toBeGreaterThanOrEqual(1);

      const html = readFileSync(outputFile, "utf-8");
      expect(html.includes(`id="decisions"`)).toBe(false);
      expect(html.includes("<!doctype html")).toBe(true);
      expect(html.includes("</html>")).toBe(true);
    } finally {
      if (existsSync(outputFile)) rmSync(outputFile);
    }
  });
});

describe("acceptance: determinism", () => {
  it("two in-process generate(sameSource) calls are byte-equal", () => {
    const src = goldenSource();
    const first = generate(src, { sourceLabel: GOLDEN_SOURCE_LABEL }).html;
    const second = generate(src, { sourceLabel: GOLDEN_SOURCE_LABEL }).html;
    expect(first).toBe(second);
  });
});
