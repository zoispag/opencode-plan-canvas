import { describe, test, expect } from "bun:test";
import { parseObjectives } from "../src/parse/objectives";
import { normalizeSource, splitSections } from "../src/parse/core";
import type { RawSection } from "../src/parse/core";

const GOLDEN = await Bun.file("test/fixtures/golden-plan.md").text();

function workObjectivesSection(source: string): RawSection {
  const { sections } = splitSections(normalizeSource(source));
  const idx = sections.findIndex((s) => s.normalized === "work objectives");
  if (idx < 0) throw new Error("Work Objectives section not found");
  const h2 = sections[idx]!;
  const body: string[] = [...h2.lines];
  for (let i = idx + 1; i < sections.length; i++) {
    const s = sections[i]!;
    if (s.level === 2) break;
    body.push(s.heading, ...s.lines);
  }
  return { ...h2, lines: body };
}

function synthetic(lines: string[]): RawSection {
  return {
    heading: "## Work Objectives",
    normalized: "work objectives",
    level: 2,
    lines,
    startLine: 0,
  };
}

describe("parseObjectives — real golden Work Objectives", () => {
  const section = workObjectivesSection(GOLDEN);
  const { objectives, warnings } = parseObjectives(section);

  test("mustHave has 5 items (REAL fixture count)", () => {
    expect(objectives.mustHave.length).toBe(5);
  });

  test("mustNot has 11 items (REAL fixture count)", () => {
    expect(objectives.mustNot.length).toBe(11);
  });

  test("mustHave items are verbatim list content (no leading dash)", () => {
    expect(objectives.mustHave[0]).toContain("THREE images from ONE git tag");
    expect(objectives.mustHave[0]!.startsWith("-")).toBe(false);
    expect(objectives.mustHave[4]).toContain("Executable resolution");
  });

  test("mustNot items are verbatim guardrails", () => {
    expect(objectives.mustNot[0]).toContain("scheduler image (OUT OF SCOPE)");
    expect(objectives.mustNot[10]).toContain("new sidecar mode");
  });

  test("other includes Core Objective and Definition of Done", () => {
    const headings = objectives.other.map((o) => o.heading);
    expect(headings).toContain("Core Objective");
    expect(headings).toContain("Definition of Done");
    expect(headings).toContain("Concrete Deliverables");
  });

  test("other sections carry their content lines", () => {
    const core = objectives.other.find((o) => o.heading === "Core Objective");
    expect(core).toBeDefined();
    expect(core!.lines.join("\n")).toContain("widget-service");
  });

  test("Must Have / Must NOT Have are NOT in other", () => {
    const headings = objectives.other.map((o) => o.heading);
    expect(headings).not.toContain("Must Have");
    expect(headings.some((h) => /must not/i.test(h))).toBe(false);
  });

  test("no warnings for well-formed golden objectives", () => {
    expect(warnings.length).toBe(0);
  });
});

describe("parseObjectives — normalization + degrade", () => {
  test("normalizes 'Must NOT Have (Guardrails)' via trailing-paren strip", () => {
    const { objectives } = parseObjectives(
      synthetic([
        "### Must NOT Have (Guardrails)",
        "- guard one",
        "- guard two",
      ]),
    );
    expect(objectives.mustNot).toEqual(["guard one", "guard two"]);
  });

  test("case-insensitive Must Have heading", () => {
    const { objectives } = parseObjectives(
      synthetic(["### must have", "- item a"]),
    );
    expect(objectives.mustHave).toEqual(["item a"]);
  });

  test("empty section returns empty objectives, no crash", () => {
    const { objectives, warnings } = parseObjectives(synthetic([]));
    expect(objectives.mustHave).toEqual([]);
    expect(objectives.mustNot).toEqual([]);
    expect(objectives.other).toEqual([]);
    expect(Array.isArray(warnings)).toBe(true);
  });

  test("unknown H3 preserved in other with lines", () => {
    const { objectives } = parseObjectives(
      synthetic(["### Random Section", "prose one", "prose two"]),
    );
    const rs = objectives.other.find((o) => o.heading === "Random Section");
    expect(rs).toBeDefined();
    expect(rs!.lines).toEqual(["prose one", "prose two"]);
  });

  test("list items only counted under must have/not H3s", () => {
    const { objectives } = parseObjectives(
      synthetic([
        "### Must Have",
        "- mh1",
        "### Definition of Done",
        "- [ ] dod checkbox",
      ]),
    );
    expect(objectives.mustHave).toEqual(["mh1"]);
    const dod = objectives.other.find((o) => o.heading === "Definition of Done");
    expect(dod).toBeDefined();
    expect(dod!.lines).toContain("- [ ] dod checkbox");
  });
});
