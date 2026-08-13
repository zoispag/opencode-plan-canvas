import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSource, splitSections, scanLines } from "../src/parse/core";
import type { RawSection } from "../src/parse/core";
import { parseTasks } from "../src/parse/tasks";

const fixturePath = join(import.meta.dir, "fixtures", "golden-plan.md");
const fixtureText = readFileSync(fixturePath, "utf8");

function todosSection(): RawSection {
  const { sections } = splitSections(normalizeSource(fixtureText));
  const todos = sections.find((s) => s.normalized === "todos");
  if (!todos) throw new Error("TODOs section not found in fixture");
  return todos;
}

function makeSection(body: string): RawSection {
  const lines = normalizeSource(body).split("\n");
  return {
    heading: "## TODOs",
    normalized: "todos",
    level: 2,
    lines,
    startLine: 0,
  };
}

function independentTaskCount(section: RawSection): number {
  const scanned = scanLines(section.lines.join("\n"));
  let count = 0;
  const re = /^- \[[ xX]\] [A-Za-z0-9][A-Za-z0-9-]*\. /;
  for (const { line, inFence } of scanned) {
    if (inFence) continue;
    if (re.test(line)) count++;
  }
  return count;
}

describe("parseTasks — ID regex validation table", () => {
  const cases: Array<{ line: string; id: string | null; label: string }> = [
    { line: "- [ ] 1. Numeric id", id: "1", label: "plain numeric" },
    { line: "- [x] T8b. Suffixed id", id: "T8b", label: "T + digits + letter" },
    { line: "- [x] T-WIDGET-CORE. Dashed id", id: "T-WIDGET-CORE", label: "hyphenated caps" },
    { line: "- [x] F1. Final-style id", id: "F1", label: "F + digit" },
    { line: "- [x] NoDot title here", id: null, label: "no dot after id -> rejected" },
  ];

  for (const c of cases) {
    test(`id parse: ${c.label}`, () => {
      const { tasks } = parseTasks(makeSection(c.line));
      if (c.id === null) {
        expect(tasks.length).toBe(0);
      } else {
        expect(tasks.length).toBe(1);
        expect(tasks[0]!.id).toBe(c.id);
      }
    });
  }
});

describe("parseTasks — state comment -> badge mapping table", () => {
  const cases: Array<{ comment: string; badge: string; label: string }> = [
    { comment: "<!-- MERGED to master -->", badge: "merged", label: "MERGED keyword" },
    { comment: "<!-- DEFERRED to user -->", badge: "deferred", label: "DEFERRED keyword" },
    { comment: "<!-- VERIFICATION-ONLY, no code change -->", badge: "verified", label: "VERIFICATION-ONLY" },
    { comment: "<!-- verified via helm template -->", badge: "verified", label: "verified keyword" },
    { comment: "<!-- REVIEW_REQUIRED, PR open -->", badge: "review", label: "REVIEW_REQUIRED" },
    { comment: "<!-- DONE commit abc1234 -->", badge: "shipped", label: "DONE keyword" },
    { comment: "<!-- shipped as PR #140 -->", badge: "shipped", label: "shipped keyword" },
  ];

  for (const c of cases) {
    test(`badge: ${c.label}`, () => {
      const { tasks } = parseTasks(makeSection(`- [x] 1. Title  ${c.comment}`));
      expect(tasks.length).toBe(1);
      expect(tasks[0]!.state.badge).toBe(c.badge as never);
    });
  }

  test("checked task with NO keyword defaults to shipped", () => {
    const { tasks } = parseTasks(makeSection("- [x] 1. Title  <!-- nothing special here -->"));
    expect(tasks[0]!.state.badge).toBe("shipped");
  });

  test("checked task with NO comment at all defaults to shipped", () => {
    const { tasks } = parseTasks(makeSection("- [x] 1. Title with no comment"));
    expect(tasks[0]!.state.badge).toBe("shipped");
  });

  test("unchecked task has no default badge", () => {
    const { tasks } = parseTasks(makeSection("- [ ] 1. Not done yet"));
    expect(tasks[0]!.state.badge).toBeUndefined();
  });
});

describe("parseTasks — ref extraction (PR # preferred over SHA)", () => {
  test("PR number extracted as PR #<n>", () => {
    const { tasks } = parseTasks(makeSection("- [x] 1. Title  <!-- DONE PR #143 merged -->"));
    expect(tasks[0]!.state.ref).toBe("PR #143");
  });

  test("short SHA extracted when no PR", () => {
    const { tasks } = parseTasks(makeSection("- [x] 1. Title  <!-- DONE commit f672a6a on branch -->"));
    expect(tasks[0]!.state.ref).toBe("f672a6a");
  });

  test("PR preferred when both PR and SHA present", () => {
    const { tasks } = parseTasks(makeSection("- [x] 1. Title  <!-- commit 057508d PR #136 -->"));
    expect(tasks[0]!.state.ref).toBe("PR #136");
  });
});

describe("parseTasks — real golden TODOs section", () => {
  test("parsed task count equals independent in-test raw count", () => {
    const section = todosSection();
    const { tasks } = parseTasks(section);
    const independent = independentTaskCount(section);
    expect(tasks.length).toBe(independent);
    expect(tasks.length).toBe(19);
  });

  test("first task is id 1, checked, badge deferred (DEFERRED keyword wins over done per priority)", () => {
    const { tasks } = parseTasks(todosSection());
    const first = tasks[0]!;
    expect(first.id).toBe("1");
    expect(first.checked).toBe(true);
    expect(first.state.badge).toBe("deferred");
  });

  test("task 1 fields are the bold labels in source order", () => {
    const { tasks } = parseTasks(todosSection());
    const labels = tasks[0]!.fields.map((f) => f.label);
    expect(labels).toEqual([
      "What to do",
      "Must NOT do",
      "Recommended Agent Profile",
      "Parallelization",
      "References",
      "Acceptance Criteria",
      "QA Scenarios",
      "Evidence to Capture",
      "Commit",
    ]);
  });

  test("every checked task has a state badge set", () => {
    const { tasks } = parseTasks(todosSection());
    for (const t of tasks) {
      if (t.checked) {
        expect(t.state.badge).toBeDefined();
      }
    }
  });

  test("suffixed-id task T-WIDGET-CORE parses from golden", () => {
    const { tasks } = parseTasks(todosSection());
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain("T-WIDGET-CORE");
  });

  test("task 1 QA Scenarios field is fenced kind", () => {
    const { tasks } = parseTasks(todosSection());
    const qa = tasks[0]!.fields.find((f) => f.label === "QA Scenarios");
    expect(qa).toBeDefined();
    expect(qa!.kind).toBe("fenced");
  });

  test("task 1 Acceptance Criteria field is checklist kind", () => {
    const { tasks } = parseTasks(todosSection());
    const ac = tasks[0]!.fields.find((f) => f.label === "Acceptance Criteria");
    expect(ac).toBeDefined();
    expect(ac!.kind).toBe("checklist");
  });

  test("malformed no-dot lines (D-MULTI-REGION, T8b [folded]) are skipped with warnings", () => {
    const { tasks, warnings } = parseTasks(todosSection());
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain("D-MULTI-REGION");
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("parseTasks — synthetic edge cases", () => {
  test("suffixed-id task T-WIDGET-CORE parses standalone", () => {
    const body = [
      "- [x] T-WIDGET-CORE. Dockerfile.worker image  <!-- DONE commit d4a5e8c -->",
      "",
      "  **What to do**: build the image.",
      "",
      "  **Commit**: YES.",
    ].join("\n");
    const { tasks } = parseTasks(makeSection(body));
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.id).toBe("T-WIDGET-CORE");
    expect(tasks[0]!.fields.map((f) => f.label)).toEqual(["What to do", "Commit"]);
  });

  test("minimal task with title only -> empty fields, no crash", () => {
    const { tasks } = parseTasks(makeSection("- [ ] 42. Just a title, nothing else"));
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.id).toBe("42");
    expect(tasks[0]!.title).toBe("Just a title, nothing else");
    expect(tasks[0]!.fields).toEqual([]);
  });

  test("valid / malformed / valid -> 2 tasks + 1 warning with offending line", () => {
    const body = [
      "- [x] 1. First valid task  <!-- DONE -->",
      "- [x] NoDot title here",
      "- [ ] 2. Second valid task",
    ].join("\n");
    const { tasks, warnings } = parseTasks(makeSection(body));
    expect(tasks.length).toBe(2);
    expect(tasks.map((t) => t.id)).toEqual(["1", "2"]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.message).toContain("NoDot title here");
  });

  test("fenced QA block inside a field: field is fenced and inner - [ ] does NOT spawn a task", () => {
    const body = [
      "- [x] 1. Task with QA  <!-- DONE -->",
      "",
      "  **QA Scenarios**:",
      "  ```",
      "  Scenario: something",
      "  - [ ] this is inside a fence, not a task",
      "  ```",
      "",
      "  **Commit**: YES.",
    ].join("\n");
    const { tasks } = parseTasks(makeSection(body));
    expect(tasks.length).toBe(1);
    const qa = tasks[0]!.fields.find((f) => f.label === "QA Scenarios");
    expect(qa!.kind).toBe("fenced");
    const commit = tasks[0]!.fields.find((f) => f.label === "Commit");
    expect(commit).toBeDefined();
  });

  test("fenced field strips fence markers from content", () => {
    const body = [
      "- [x] 1. Task  <!-- DONE -->",
      "",
      "  **QA Scenarios**:",
      "  ```",
      "  inner line one",
      "  inner line two",
      "  ```",
    ].join("\n");
    const { tasks } = parseTasks(makeSection(body));
    const qa = tasks[0]!.fields.find((f) => f.label === "QA Scenarios")!;
    expect(qa.content).not.toContain("```");
    expect(qa.content).toContain("inner line one");
    expect(qa.content).toContain("inner line two");
  });

  test("inline text field classified as text", () => {
    const { tasks } = parseTasks(
      makeSection("- [ ] 1. Task\n\n  **Must NOT do**: change any logic.")
    );
    const f = tasks[0]!.fields[0]!;
    expect(f.label).toBe("Must NOT do");
    expect(f.kind).toBe("text");
    expect(f.content).toContain("change any logic");
  });

  test("any bold label is accepted (not just known set)", () => {
    const { tasks } = parseTasks(
      makeSection("- [ ] 1. Task\n\n  **Totally Custom Label**: some content here.")
    );
    expect(tasks[0]!.fields[0]!.label).toBe("Totally Custom Label");
  });

  test("stray trailing token after comment is tolerated (F1-style dangling backtick)", () => {
    const { tasks } = parseTasks(
      makeSection("- [x] F1. Plan Compliance Audit  <!-- APPROVE (user okay). -->`")
    );
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.id).toBe("F1");
    expect(tasks[0]!.title).toBe("Plan Compliance Audit");
    expect(tasks[0]!.state.badge).toBeDefined();
  });

  test("empty section -> no tasks, no crash", () => {
    const { tasks, warnings } = parseTasks(makeSection(""));
    expect(tasks).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
