import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSource, splitSections } from "../src/parse/core";
import type { RawSection } from "../src/parse/core";
import { normalizeEntryId, parseEntry, parseWaves, reconcile } from "../src/parse/waves";
import type { FinalTask, Task, Wave } from "../src/model";

const fixturePath = join(import.meta.dir, "fixtures", "golden-plan.md");
const fixtureText = readFileSync(fixturePath, "utf8");

function wavesSection(): RawSection {
  const { sections } = splitSections(normalizeSource(fixtureText));
  const found =
    sections.find((s) => s.normalized === "parallel execution waves") ??
    sections.find((s) => s.normalized === "execution strategy");
  if (!found) throw new Error("Execution Strategy / Parallel Execution Waves section not found");
  return found;
}

function makeSection(body: string, normalized = "execution strategy"): RawSection {
  const lines = normalizeSource(body).split("\n");
  return {
    heading: `## ${normalized}`,
    normalized,
    level: 2,
    lines,
    startLine: 0,
  };
}

function task(id: string): Task {
  return { id, checked: false, title: `task ${id}`, state: {}, fields: [] };
}

function finalTask(id: string): FinalTask {
  return { id, checked: false, title: `final ${id}`, description: "" };
}

const GOLDEN_FINAL: FinalTask[] = [
  finalTask("F1"),
  finalTask("F2"),
  finalTask("F3"),
  finalTask("F4"),
];

describe("parseWaves — real golden fence", () => {
  const result = parseWaves(wavesSection());

  test("parses exactly 5 waves in source order", () => {
    expect(result.waves.length).toBe(5);
  });

  test("wave names captured verbatim (with em-dash / parentheticals tolerated)", () => {
    const names = result.waves.map((w) => w.name);
    expect(names[0]).toBe("Wave 1–2");
    expect(names[1]).toBe("Wave A");
    expect(names[2]).toBe("Wave B");
    expect(names[3]).toBe("Wave C");
    expect(names[4]).toBe("Wave FINAL");
  });

  test("ordered entry counts match reality (7,3,4,5,4)", () => {
    const shape = result.waves.map((w) => `${w.name}:${w.entries.length}`).join("|");
    expect(shape).toBe("Wave 1–2:7|Wave A:3|Wave B:4|Wave C:5|Wave FINAL:4");
  });

  test("no crash, no criticalPath inside this fence", () => {
    expect(result.criticalPath).toBeUndefined();
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  test("glyph-less T8 continuation line is captured as an entry", () => {
    const wave1 = result.waves[0]!;
    const ids = wave1.entries.map((e) => e.id);
    expect(ids).toEqual(["T1", "T2", "T5", "T3", "T4", "T7", "T8"]);
    const t8 = wave1.entries.find((e) => e.id === "T8")!;
    expect(t8).toBeDefined();
    expect(t8.checked).toBe(true);
    expect(t8.title.startsWith("release tool 2nd (cli) image")).toBe(true);
  });

  test("Wave 1–2 entries carry checkbox state and notes", () => {
    const wave1 = result.waves[0]!;
    const t1 = wave1.entries.find((e) => e.id === "T1")!;
    expect(t1.checked).toBe(true);
    expect(t1.title).toBe("Repo/module rename → widget-service");
    expect(t1.note).toBe("PR #12");
  });

  test("Wave A entries have no checkbox (checked=false) and keep bracket category in title", () => {
    const waveA = result.waves[1]!;
    const ids = waveA.entries.map((e) => e.id);
    expect(ids).toEqual(["T-WIDGET-CORE", "T-RELEASE", "T6"]);
    expect(waveA.entries.every((e) => e.checked === false)).toBe(true);
  });

  test("Wave C keeps [CROSS-REPO chart] bracket prefix in title (not a checkbox)", () => {
    const waveC = result.waves[3]!;
    const t10 = waveC.entries.find((e) => e.id === "T10")!;
    expect(t10.checked).toBe(false);
    expect(t10.title.includes("[CROSS-REPO chart]")).toBe(true);
  });

  test("Wave FINAL parsed; trailer arrow line is NOT an entry", () => {
    const final = result.waves[4]!;
    expect(/final/i.test(final.name)).toBe(true);
    const ids = final.entries.map((e) => e.id);
    expect(ids).toEqual(["F1", "F2", "F3", "F4"]);
    for (const e of final.entries) {
      expect(e.id.startsWith("→")).toBe(false);
      expect(e.title.startsWith("Present results")).toBe(false);
    }
  });
});

describe("parseWaves — synthetic edge cases", () => {
  test("fence with NO tree glyphs still parses entries via <ID>: lines", () => {
    const body = [
      "### Parallel Execution Waves",
      "",
      "```",
      "Wave One (synthetic):",
      "A1: [ ] first entry (note-a)",
      "A2: [x] second entry",
      "",
      "Wave Two:",
      "B1: third entry",
      "```",
      "",
    ].join("\n");
    const { waves, warnings } = parseWaves(makeSection(body, "parallel execution waves"));
    expect(waves.length).toBe(2);
    expect(waves[0]!.name).toBe("Wave One");
    expect(waves[0]!.description).toBe("synthetic");
    expect(waves[0]!.entries.map((e) => e.id)).toEqual(["A1", "A2"]);
    expect(waves[0]!.entries[0]!.checked).toBe(false);
    expect(waves[0]!.entries[0]!.note).toBe("note-a");
    expect(waves[0]!.entries[1]!.checked).toBe(true);
    expect(waves[1]!.entries.map((e) => e.id)).toEqual(["B1"]);
    expect(warnings.length).toBe(0);
  });

  test("Critical Path: line inside the fence is returned as criticalPath", () => {
    const body = [
      "```",
      "Critical Path: T1 → T2 → T3",
      "Wave One:",
      "├── T1: [x] do a thing",
      "```",
    ].join("\n");
    const { criticalPath, waves } = parseWaves(makeSection(body));
    expect(criticalPath).toBe("T1 → T2 → T3");
    expect(waves.length).toBe(1);
    expect(waves[0]!.entries.map((e) => e.id)).toEqual(["T1"]);
  });

  test("missing fence -> waves: [] + one warning, no crash", () => {
    const body = [
      "### Parallel Execution Waves",
      "",
      "Some prose describing waves but no fenced block at all.",
      "Another line.",
      "",
    ].join("\n");
    const { waves, warnings } = parseWaves(makeSection(body, "parallel execution waves"));
    expect(waves).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.message.length).toBeGreaterThan(0);
  });

  test("does not treat # or - [ inside fence as headings/tasks", () => {
    const body = [
      "```",
      "Wave One:",
      "# not a heading",
      "- [ ] not a task line",
      "├── T1: [x] real entry",
      "```",
    ].join("\n");
    const { waves } = parseWaves(makeSection(body));
    expect(waves.length).toBe(1);
    expect(waves[0]!.entries.map((e) => e.id)).toEqual(["T1"]);
  });
});

describe("normalizeEntryId — T/F prefix stripping", () => {
  test("strips T prefix off numeric ids", () => {
    expect(normalizeEntryId("T1")).toBe("1");
    expect(normalizeEntryId("T15")).toBe("15");
  });

  test("keeps a trailing lowercase suffix (T8b -> 8b)", () => {
    expect(normalizeEntryId("T8b")).toBe("8b");
  });

  test("strips F prefix the same way (F1 -> 1)", () => {
    expect(normalizeEntryId("F1")).toBe("1");
    expect(normalizeEntryId("F4")).toBe("4");
  });

  test("bare numeric id is unchanged", () => {
    expect(normalizeEntryId("1")).toBe("1");
    expect(normalizeEntryId("8b")).toBe("8b");
  });

  test("hyphenated id does NOT match the T\\d pattern -> unchanged", () => {
    expect(normalizeEntryId("T-WIDGET-CORE")).toBe("T-WIDGET-CORE");
    expect(normalizeEntryId("T-RELEASE")).toBe("T-RELEASE");
  });

  test("a bare prefix with no digits is unchanged", () => {
    expect(normalizeEntryId("T")).toBe("T");
    expect(normalizeEntryId("F")).toBe("F");
  });

  test("uppercase trailing letter or multi-letter suffix does NOT strip", () => {
    expect(normalizeEntryId("T8B")).toBe("T8B");
    expect(normalizeEntryId("T8bc")).toBe("T8bc");
  });

  test("verbose 'Task N' ids normalize to the bare number", () => {
    expect(normalizeEntryId("Task 1")).toBe("1");
    expect(normalizeEntryId("Task 8b")).toBe("8b");
    expect(normalizeEntryId("task 3")).toBe("3");
    expect(normalizeEntryId("Task 12")).toBe("12");
  });

  test("bare 'Task' with no number is unchanged", () => {
    expect(normalizeEntryId("Task")).toBe("Task");
  });
});

describe("parseEntry — 'Task N' wave-entry convention (the reported bug)", () => {
  test("'├── Task 1: Branch [quick]' is NOT dropped; id captured as 'Task 1'", () => {
    const entry = parseEntry("├── Task 1: Branch [quick]");
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("Task 1");
    expect(entry!.title.length).toBeGreaterThan(0);
    expect(entry!.checked).toBe(false);
  });

  test("'└── Task 2:  IncompleteSnapshotException [quick]' parses (extra spaces tolerated)", () => {
    const entry = parseEntry("└── Task 2:  IncompleteSnapshotException [quick]");
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("Task 2");
    expect(entry!.title.length).toBeGreaterThan(0);
  });

  test("'Task 12b' suffix id is captured", () => {
    const entry = parseEntry("├── Task 12b: x");
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("Task 12b");
  });

  test("existing conventions unchanged: T1 / bare number / hyphenated id", () => {
    expect(parseEntry("├── T1: something")!.id).toBe("T1");
    expect(parseEntry("1: bare")!.id).toBe("1");
    expect(parseEntry("T-WIDGET-CORE: x")!.id).toBe("T-WIDGET-CORE");
  });
});

describe("reconcile — normalized pairing of wave entries and tasks", () => {
  function buildWaves(): Wave[] {
    return parseWaves(wavesSection()).waves;
  }

  test("exact id still wins (T1 entry pairs task T1 when present verbatim)", () => {
    const waves = buildWaves();
    const tasks = [task("T1"), task("T-WIDGET-CORE")];
    const { pairs } = reconcile(waves, tasks, GOLDEN_FINAL);
    expect(pairs.get("T1")).toBe(tasks[0]!);
    expect(pairs.get("T-WIDGET-CORE")).toBe(tasks[1]!);
  });

  test("T1 wave entry pairs numbered task 1 via normalized id (the reported bug)", () => {
    const waves = buildWaves();
    const tasks = [task("1")];
    const { pairs, tasksWithoutEntries } = reconcile(waves, tasks, GOLDEN_FINAL);
    expect(pairs.get("T1")).toBe(tasks[0]!);
    expect(tasksWithoutEntries.length).toBe(0);
  });

  test("T8b entry would pair task 8b via normalized id", () => {
    const waves: Wave[] = [
      { name: "W", entries: [{ id: "T8b", checked: false, title: "python tag rename" }] },
    ];
    const tasks = [task("8b")];
    const { pairs, entriesWithoutTasks } = reconcile(waves, tasks);
    expect(pairs.get("T8b")).toBe(tasks[0]!);
    expect(entriesWithoutTasks.length).toBe(0);
  });

  test("F-wave entries do NOT warn and do NOT steal numbered tasks", () => {
    const waves = buildWaves();
    const tasks = [task("1")];
    const { pairs, entriesWithoutTasks } = reconcile(waves, tasks, GOLDEN_FINAL);
    const messages = entriesWithoutTasks.map((w) => w.message).join("\n");
    expect(messages.includes("F1")).toBe(false);
    expect(messages.includes("F4")).toBe(false);
    expect(pairs.get("F1")).toBeUndefined();
    expect(pairs.get("F4")).toBeUndefined();
  });

  test("non-F wave entries with no matching task still warn", () => {
    const waves = buildWaves();
    const tasks = [task("1")];
    const { entriesWithoutTasks } = reconcile(waves, tasks, GOLDEN_FINAL);
    const messages = entriesWithoutTasks.map((w) => w.message).join("\n");
    expect(entriesWithoutTasks.length).toBeGreaterThan(0);
    expect(messages.includes("T2")).toBe(true);
    expect(messages.includes("F4")).toBe(false);
  });

  test("task not in any wave -> tasksWithoutEntries (the Unassigned ones)", () => {
    const waves = buildWaves();
    const tasks = [task("1"), task("ORPHAN-X")];
    const { tasksWithoutEntries } = reconcile(waves, tasks, GOLDEN_FINAL);
    const ids = tasksWithoutEntries.map((w) => w.message);
    expect(tasksWithoutEntries.length).toBe(1);
    expect(ids[0]!.includes("ORPHAN-X")).toBe(true);
  });

  test("reconcile is pure: does not mutate inputs; lowercase t not normalized", () => {
    const waves: Wave[] = [
      { name: "W", entries: [{ id: "T1", checked: false, title: "x" }] },
    ];
    const tasks = [task("t1")];
    const before = JSON.stringify({ waves, tasks });
    const { pairs, entriesWithoutTasks, tasksWithoutEntries } = reconcile(waves, tasks);
    expect(pairs.get("T1")).toBeUndefined();
    expect(entriesWithoutTasks.length).toBe(1);
    expect(tasksWithoutEntries.length).toBe(1);
    expect(JSON.stringify({ waves, tasks })).toBe(before);
  });

  test("golden waves + numbered golden tasks pair completely; Unassigned is empty", () => {
    const waves = buildWaves();
    const ids = [
      "1", "2", "5", "3", "4", "7", "8",
      "T-WIDGET-CORE", "T-RELEASE", "6",
      "T-DOCS", "T-INFRATEST", "9", "12",
      "10", "11", "13", "14", "15",
    ];
    const tasks = ids.map(task);
    const { pairs, entriesWithoutTasks, tasksWithoutEntries } = reconcile(
      waves,
      tasks,
      GOLDEN_FINAL,
    );
    expect(pairs.size).toBe(ids.length);
    expect(tasksWithoutEntries.length).toBe(0);
    expect(entriesWithoutTasks.length).toBe(0);
  });

  test("'Task N' wave entries pair numbered TODOs with zero Unassigned warnings", () => {
    const waves: Wave[] = [
      {
        name: "Wave 1",
        entries: [
          { id: "Task 1", checked: true, title: "Branch + config file" },
          { id: "Task 2", checked: true, title: "IncompleteSnapshotException" },
        ],
      },
    ];
    const tasks = [task("1"), task("2")];
    const { pairs, entriesWithoutTasks, tasksWithoutEntries } = reconcile(waves, tasks);
    expect(pairs.get("Task 1")).toBe(tasks[0]!);
    expect(pairs.get("Task 2")).toBe(tasks[1]!);
    expect(entriesWithoutTasks.length).toBe(0);
    expect(tasksWithoutEntries.length).toBe(0);
  });

  test("first-wins determinism: two tasks normalizing to same key -> first registered pairs", () => {
    const waves: Wave[] = [
      { name: "W", entries: [{ id: "T1", checked: false, title: "x" }] },
    ];
    const a = task("1");
    const b = task("T1");
    const { pairs } = reconcile(waves, [a, b]);
    expect(pairs.get("T1")).toBe(b);
  });
});
