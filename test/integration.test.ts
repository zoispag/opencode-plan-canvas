import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generate } from "../src/index";
import { parsePlan } from "../src/parse/index";
import { buildTaskLookup, matchEntryToTask } from "../src/parse/waves";

const GOLDEN = join(import.meta.dirname, "fixtures", "golden-plan.md");
const TASK_N = join(import.meta.dirname, "fixtures", "task-n-waves-plan.md");

function goldenSource(): string {
  return readFileSync(GOLDEN, "utf-8");
}

function taskNSource(): string {
  return readFileSync(TASK_N, "utf-8");
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

describe("integration: parse -> model -> render pipeline", () => {
  it("emits every populated section id from the golden plan", () => {
    const { html } = generate(goldenSource());
    for (const id of ["crit", "waves", "guardrails", "verify", "decisions", "final"]) {
      expect(html.includes(`id="${id}"`)).toBe(true);
    }
  });

  it("renders one .tcard per reconciled wave entry plus unassigned tasks", () => {
    const source = goldenSource();
    const plan = parsePlan(source);

    const lookup = buildTaskLookup(plan.tasks);
    const finalIds = new Set(plan.finalTasks.map((f) => f.id));
    const paired = new Set<(typeof plan.tasks)[number]>();
    let waveEntries = 0;
    for (const wave of plan.waves) {
      for (const entry of wave.entries) {
        waveEntries++;
        const t = matchEntryToTask(entry, lookup, finalIds);
        if (t) paired.add(t);
      }
    }
    const unassigned = plan.tasks.filter((t) => !paired.has(t)).length;
    const expected = waveEntries + unassigned;

    const { html } = generate(source);
    const tcardCount =
      countOccurrences(html, `<details class="tcard`) +
      countOccurrences(html, `<div class="tcard`);
    expect(tcardCount).toBe(expected);
  });

  it("produces byte-identical output on repeated runs (determinism)", () => {
    const source = goldenSource();
    const first = generate(source, { sourceLabel: "golden-plan.md" });
    const second = generate(source, { sourceLabel: "golden-plan.md" });
    expect(first.html).toBe(second.html);
    expect(first.html).toBe(first.html);
  });

  it("ends output with a trailing newline", () => {
    const { html } = generate(goldenSource());
    expect(html.endsWith("\n")).toBe(true);
  });

  it("returns warnings in the result rather than throwing", () => {
    const result = generate(goldenSource());
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const w of result.warnings) {
      expect(typeof w.message).toBe("string");
    }
  });

  it("is self-contained (no external ref attributes)", () => {
    const { html } = generate(goldenSource());
    expect(/(src|href)="https?:/.test(html)).toBe(false);
  });

  it("degrades leniently: missing sections stay empty, absent sections omitted", () => {
    const tiny = "# Tiny\n\n## TODOs\n\n- [ ] 1. Only task\n";
    const { html, warnings } = generate(tiny);
    expect(html.includes(`id="waves"`)).toBe(true);
    expect(html.includes(`id="decisions"`)).toBe(false);
    expect(html.includes(`id="crit"`)).toBe(false);
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("'Task N' wave entries reconcile with numbered TODOs: zero Unassigned", () => {
    const source = taskNSource();
    const { html, warnings } = generate(source);
    const unassignedWarnings = warnings.filter((w) =>
      w.message.includes("not present in any wave"),
    );
    expect(unassignedWarnings.length).toBe(0);
    expect(html.includes(">Unassigned<")).toBe(false);
    expect(html.includes(`id="waves"`)).toBe(true);

    const plan = parsePlan(source);
    const lookup = buildTaskLookup(plan.tasks);
    const finalIds = new Set(plan.finalTasks.map((f) => f.id));
    const paired = new Set<(typeof plan.tasks)[number]>();
    for (const wave of plan.waves) {
      for (const entry of wave.entries) {
        const t = matchEntryToTask(entry, lookup, finalIds);
        if (t) paired.add(t);
      }
    }
    expect(plan.tasks.filter((t) => !paired.has(t)).length).toBe(0);
  });

  it("CLI prints warn: to STDERR and keeps STDOUT clean during file output", async () => {
    const outputFile = join(tmpdir(), `opencode-integration-${Date.now()}.html`);
    try {
      const proc = Bun.spawn(
        ["bun", "run", "src/cli.ts", GOLDEN, "-o", outputFile],
        { cwd: import.meta.dirname + "/..", stdio: ["inherit", "pipe", "pipe"] },
      );
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toContain("warn:");
      expect(existsSync(outputFile)).toBe(true);

      const written = readFileSync(outputFile, "utf-8");
      expect(written.endsWith("\n")).toBe(true);
      expect(written).toContain("<!doctype html");
    } finally {
      if (existsSync(outputFile)) rmSync(outputFile);
    }
  });
});
