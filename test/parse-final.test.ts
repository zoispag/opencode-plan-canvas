import { describe, test, expect } from "bun:test";
import { parseFinal } from "../src/parse/final";
import { normalizeSource, splitSections } from "../src/parse/core";
import type { RawSection } from "../src/parse/core";

const GOLDEN = await Bun.file("test/fixtures/golden-plan.md").text();

function sectionFrom(source: string, key: string): RawSection {
  const { sections } = splitSections(normalizeSource(source));
  const found = sections.find((s) => s.normalized === key);
  if (!found) throw new Error(`section "${key}" not found`);
  return found;
}

function synthetic(lines: string[]): RawSection {
  return {
    heading: "## Final Verification Wave",
    normalized: "final verification wave",
    level: 2,
    lines,
    startLine: 0,
  };
}

describe("parseFinal — real golden Final Verification Wave", () => {
  const section = sectionFrom(GOLDEN, "final verification wave");
  const { finalTasks } = parseFinal(section);

  test("finds exactly F1-F4", () => {
    expect(finalTasks.length).toBe(4);
    expect(finalTasks.map((f) => f.id)).toEqual(["F1", "F2", "F3", "F4"]);
  });

  test("categories match fixture: oracle, unspecified-high, unspecified-high, deep", () => {
    expect(finalTasks.map((f) => f.category)).toEqual([
      "oracle",
      "unspecified-high",
      "unspecified-high",
      "deep",
    ]);
  });

  test("titles captured", () => {
    expect(finalTasks[0]!.title).toBe("Plan Compliance Audit");
    expect(finalTasks[1]!.title).toBe("Code Quality Review");
    expect(finalTasks[3]!.title).toContain("Scope Fidelity");
  });

  test("checked reflects fixture (all F1-F4 are [x])", () => {
    expect(finalTasks.map((f) => f.checked)).toEqual([true, true, true, true]);
  });

  test("description captured from following prose", () => {
    expect(finalTasks[0]!.description).toContain("Verify each Must-Have");
    expect(finalTasks[1]!.description).toContain("golangci-lint");
  });

  test("Output line parsed and backticks stripped", () => {
    expect(finalTasks[0]!.output).toBeDefined();
    expect(finalTasks[0]!.output).toBe("Must Have [N/N] | Must NOT [N/N] | Tasks [N/N] | VERDICT");
    expect(finalTasks[0]!.output!.startsWith("`")).toBe(false);
  });

  test("stateComment captured despite trailing stray backtick", () => {
    expect(finalTasks[0]!.stateComment).toContain("APPROVE");
    expect(finalTasks[0]!.stateComment).not.toContain("`");
  });

  test("no crash on the stray trailing backtick (all 4 parse)", () => {
    expect(finalTasks.every((f) => f.id.length > 0)).toBe(true);
  });
});

describe("parseFinal — F-grammar edge cases", () => {
  test("unchecked F-line parses with checked=false", () => {
    const { finalTasks } = parseFinal(
      synthetic(["- [ ] F1. **Title Here** — `oracle`"]),
    );
    expect(finalTasks[0]!.checked).toBe(false);
    expect(finalTasks[0]!.category).toBe("oracle");
  });

  test("synthetic F-line with trailing stray backtick after comment parses", () => {
    const { finalTasks } = parseFinal(
      synthetic([
        "- [x] F9. **Stray Backtick** — `deep`  <!-- APPROVE (ok) -->`",
        "  body prose",
        "  Output: `X | Y | VERDICT`",
      ]),
    );
    expect(finalTasks.length).toBe(1);
    expect(finalTasks[0]!.id).toBe("F9");
    expect(finalTasks[0]!.category).toBe("deep");
    expect(finalTasks[0]!.checked).toBe(true);
    expect(finalTasks[0]!.stateComment).toBe("APPROVE (ok)");
    expect(finalTasks[0]!.description).toContain("body prose");
    expect(finalTasks[0]!.output).toBe("X | Y | VERDICT");
  });

  test("missing category tolerated (undefined)", () => {
    const { finalTasks } = parseFinal(
      synthetic(["- [ ] F1. **No Category Task**", "  some description"]),
    );
    expect(finalTasks[0]!.category).toBeUndefined();
    expect(finalTasks[0]!.title).toBe("No Category Task");
  });

  test("missing Output tolerated (undefined)", () => {
    const { finalTasks } = parseFinal(
      synthetic(["- [x] F2. **No Output** — `quick`", "  just prose"]),
    );
    expect(finalTasks[0]!.output).toBeUndefined();
    expect(finalTasks[0]!.description).toContain("just prose");
  });

  test("multiple F-lines split correctly", () => {
    const { finalTasks } = parseFinal(
      synthetic([
        "- [x] F1. **First** — `oracle`",
        "  desc1",
        "- [ ] F2. **Second** — `deep`",
        "  desc2",
      ]),
    );
    expect(finalTasks.length).toBe(2);
    expect(finalTasks[0]!.description).toContain("desc1");
    expect(finalTasks[0]!.description).not.toContain("desc2");
    expect(finalTasks[1]!.description).toContain("desc2");
  });

  test("description does NOT include the Output line", () => {
    const { finalTasks } = parseFinal(
      synthetic([
        "- [x] F1. **T** — `oracle`",
        "  real prose",
        "  Output: `A | VERDICT`",
      ]),
    );
    expect(finalTasks[0]!.description).toContain("real prose");
    expect(finalTasks[0]!.description).not.toContain("Output:");
  });

  test("empty section → no final tasks, no crash", () => {
    const { finalTasks, warnings } = parseFinal(synthetic([]));
    expect(finalTasks).toEqual([]);
    expect(Array.isArray(warnings)).toBe(true);
  });
});
