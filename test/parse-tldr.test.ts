import { describe, test, expect } from "bun:test";
import { parseTldr } from "../src/parse/tldr";
import { normalizeSource, splitSections } from "../src/parse/core";
import type { RawSection } from "../src/parse/core";

function sectionFrom(source: string, normalizedKey: string): RawSection {
  const { sections } = splitSections(normalizeSource(source));
  const found = sections.find((s) => s.normalized === normalizedKey);
  if (!found) throw new Error(`section "${normalizedKey}" not found`);
  return found;
}

function goldenTldrSection(): RawSection {
  const source = Bun.file("test/fixtures/golden-plan.md").text();
  return source.then((text) => sectionFrom(text, "tl;dr")) as unknown as RawSection;
}

const GOLDEN = await Bun.file("test/fixtures/golden-plan.md").text();

describe("parseTldr — real golden TL;DR", () => {
  const section = sectionFrom(GOLDEN, "tl;dr");
  const { entries, warnings } = parseTldr(section);

  test("returns 7 entries in source order", () => {
    expect(entries.length).toBe(7);
  });

  test("labels VERBATIM in order", () => {
    const labels = entries.map((e) => e.label);
    expect(labels).toEqual([
      "Quick Summary",
      "Scope boundary (READ FIRST)",
      "Deliverables",
      "Estimated Effort",
      "Parallel Execution",
      "Critical Path",
      "Repos",
    ]);
  });

  test("no warnings for a well-formed blockquote", () => {
    expect(warnings.length).toBe(0);
  });

  test("Quick Summary value starts with the backtick repo name", () => {
    const qs = entries.find((e) => e.label === "Quick Summary");
    expect(qs).toBeDefined();
    expect(qs!.value.startsWith("`widget-service`")).toBe(true);
  });

  test("Estimated Effort value is a single trimmed line", () => {
    const ee = entries.find((e) => e.label === "Estimated Effort");
    expect(ee!.value).toBe(
      "XL (back-half adds a 3rd image + release orchestration + chart move + infra tests)",
    );
  });

  test("Deliverables value accumulates all its list lines", () => {
    const d = entries.find((e) => e.label === "Deliverables");
    expect(d).toBeDefined();
    const value = d!.value;
    expect(value).toContain("- [SHIPPED T1–T8] `widget-service`");
    expect(value).toContain("- **[NEW] `Dockerfile.worker` HERE**");
    expect(value).toContain("- **[NEW] Infra tests**: `tests/` harness");
    expect(value).toContain("- `legacy-widget-cli` archived/deprecated");
    expect(value).toContain(
      "- TDD (table-driven) + local-stack/kind integration QA",
    );
    const listLineCount = value
      .split("\n")
      .filter((l) => l.trimStart().startsWith("- ")).length;
    expect(listLineCount).toBe(10);
    expect(value.split("\n").length).toBeGreaterThanOrEqual(10);
  });

  test("Repos value is a single line split on the middle dot", () => {
    const r = entries.find((e) => e.label === "Repos");
    expect(r!.value).toContain("widget-service (was legacy-worker");
    expect(r!.value).toContain("legacy-widget-cli (archived)");
    expect(r!.value.includes("\n")).toBe(false);
  });
});

describe("parseTldr — synthetic minimal (2 entries)", () => {
  const source = [
    "# Title",
    "",
    "## TL;DR",
    "",
    "> **Alpha**: first value",
    "> **Beta**: second value",
    "",
    "## Next",
  ].join("\n");
  const section = sectionFrom(source, "tl;dr");
  const { entries, warnings } = parseTldr(section);

  test("parses both entries in order", () => {
    expect(entries).toEqual([
      { label: "Alpha", value: "first value" },
      { label: "Beta", value: "second value" },
    ]);
  });

  test("no warnings", () => {
    expect(warnings.length).toBe(0);
  });
});

describe("parseTldr — multi-line continuation accumulation", () => {
  const source = [
    "# Title",
    "",
    "## TL;DR",
    "",
    "> **List**:",
    "> - one",
    "> - two",
    ">",
    "> - three",
    "> **After**: done",
    "",
    "## Next",
  ].join("\n");
  const section = sectionFrom(source, "tl;dr");
  const { entries } = parseTldr(section);

  test("List entry accumulates list items and blank blockquote line, joined with newline", () => {
    const list = entries.find((e) => e.label === "List");
    expect(list!.value).toBe("- one\n- two\n\n- three");
  });

  test("After entry starts a fresh entry", () => {
    const after = entries.find((e) => e.label === "After");
    expect(after!.value).toBe("done");
  });

  test("exactly 2 entries", () => {
    expect(entries.length).toBe(2);
  });
});

describe("parseTldr — non-blockquote line ends accumulation", () => {
  const source = [
    "# Title",
    "",
    "## TL;DR",
    "",
    "> **One**: value one",
    "> continued",
    "",
    "plain prose not in blockquote",
    "> **Two**: value two",
    "",
    "## Next",
  ].join("\n");
  const section = sectionFrom(source, "tl;dr");
  const { entries } = parseTldr(section);

  test("One accumulates its continuation but stops at the non-blockquote line", () => {
    const one = entries.find((e) => e.label === "One");
    expect(one!.value).toBe("value one\ncontinued");
  });

  test("Two is parsed after prose resumes a blockquote", () => {
    const two = entries.find((e) => e.label === "Two");
    expect(two!.value).toBe("value two");
  });

  test("two entries total", () => {
    expect(entries.length).toBe(2);
  });
});

describe("parseTldr — pre-label blockquote lines warn and are skipped", () => {
  const source = [
    "# Title",
    "",
    "## TL;DR",
    "",
    "> orphan prose before any label",
    "> more orphan prose",
    "> **Real**: real value",
    "",
    "## Next",
  ].join("\n");
  const section = sectionFrom(source, "tl;dr");
  const { entries, warnings } = parseTldr(section);

  test("only the labelled entry is captured", () => {
    expect(entries).toEqual([{ label: "Real", value: "real value" }]);
  });

  test("at least one warning for orphan lines", () => {
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parseTldr — degrade paths", () => {
  test("empty section returns [] and no crash", () => {
    const section: RawSection = {
      heading: "## TL;DR",
      normalized: "tl;dr",
      level: 2,
      lines: [],
      startLine: 0,
    };
    const { entries, warnings } = parseTldr(section);
    expect(entries).toEqual([]);
    expect(Array.isArray(warnings)).toBe(true);
  });

  test("prose-only blockquote (no bold labels) returns [] and >=1 warning", () => {
    const source = [
      "# Title",
      "",
      "## TL;DR",
      "",
      "> just some prose",
      "> and a second line",
      "> and a third",
      "",
      "## Next",
    ].join("\n");
    const section = sectionFrom(source, "tl;dr");
    const { entries, warnings } = parseTldr(section);
    expect(entries).toEqual([]);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  test("outer whitespace of a value is trimmed, inner preserved", () => {
    const source = [
      "# Title",
      "",
      "## TL;DR",
      "",
      "> **Padded**:    spaced value   ",
      ">",
      "",
      "## Next",
    ].join("\n");
    const section = sectionFrom(source, "tl;dr");
    const { entries } = parseTldr(section);
    const padded = entries.find((e) => e.label === "Padded");
    expect(padded!.value).toBe("spaced value");
  });
});

void goldenTldrSection;
