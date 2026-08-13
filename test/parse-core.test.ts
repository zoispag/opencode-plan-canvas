import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  normalizeSource,
  scanLines,
  normalizeHeading,
  matchSection,
  splitSections,
  type RawSection,
  type ScannedLine,
} from "../src/parse/core";

describe("normalizeSource", () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    { name: "CRLF -> LF", input: "a\r\nb\r\nc", expected: "a\nb\nc" },
    { name: "lone CR -> LF", input: "a\rb\rc", expected: "a\nb\nc" },
    { name: "mixed CRLF + CR + LF", input: "a\r\nb\rc\nd", expected: "a\nb\nc\nd" },
    { name: "strip leading BOM", input: "\uFEFF# Title", expected: "# Title" },
    { name: "BOM only stripped at start", input: "x\uFEFFy", expected: "x\uFEFFy" },
    {
      name: "does not trim trailing whitespace",
      input: "code   \r\n  more  ",
      expected: "code   \n  more  ",
    },
    { name: "already-LF unchanged", input: "a\nb\n", expected: "a\nb\n" },
    { name: "empty string", input: "", expected: "" },
  ];
  for (const c of cases) {
    test(c.name, () => {
      expect(normalizeSource(c.input)).toBe(c.expected);
    });
  }
});

describe("scanLines fence awareness", () => {
  test("marks backtick fence body and delimiters as inFence", () => {
    const src = "# T\n\n## A\n```\n## NOT-A-HEADING\n```\n## B\n";
    const scanned: ScannedLine[] = scanLines(src);
    expect(scanned.map((l) => l.inFence)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(scanned[4]?.line).toBe("## NOT-A-HEADING");
    expect(scanned[4]?.index).toBe(4);
  });

  test("backtick fence not closed by tilde fence", () => {
    const src = "```\ninside\n~~~\nstill inside\n```\nout\n";
    const scanned = scanLines(src);
    expect(scanned.map((l) => l.inFence)).toEqual([true, true, true, true, true, false, false]);
  });

  test("tilde fence not closed by backtick fence", () => {
    const src = "~~~\ninside\n```\nstill inside\n~~~\nout\n";
    const scanned = scanLines(src);
    expect(scanned.map((l) => l.inFence)).toEqual([true, true, true, true, true, false, false]);
  });

  test("fenced bash comments that look like H1 are inFence", () => {
    const src = "## Success\n```bash\n# widget-service\ngo build\n```\n";
    const scanned = scanLines(src);
    expect(scanned[0]?.inFence).toBe(false);
    expect(scanned[1]?.inFence).toBe(true);
    expect(scanned[2]?.inFence).toBe(true);
    expect(scanned[3]?.inFence).toBe(true);
    expect(scanned[4]?.inFence).toBe(true);
  });

  test("4+ backticks and 3+ tildes count as fences", () => {
    const src = "````\n## x\n````\n~~~~\n## y\n~~~~\n";
    const scanned = scanLines(src);
    expect(scanned.map((l) => l.inFence)).toEqual([true, true, true, true, true, true, false]);
  });
});

describe("normalizeHeading", () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    { name: "strip # and lowercase", input: "## Context", expected: "context" },
    { name: "H3 markers", input: "### Original Request", expected: "original request" },
    {
      name: "trailing parenthetical stripped",
      input: "Verification Strategy (MANDATORY)",
      expected: "verification strategy",
    },
    {
      name: "long trailing parenthetical with em-dash",
      input: "Final Verification Wave (MANDATORY — after ALL implementation tasks)",
      expected: "final verification wave",
    },
    {
      name: "heading marker plus parenthetical",
      input: "## Verification Strategy (MANDATORY)",
      expected: "verification strategy",
    },
    { name: "TL;DR keeps semicolon", input: "## TL;DR", expected: "tl;dr" },
    {
      name: "slash preserved",
      input: "## Decisions Needed / Defaults Applied",
      expected: "decisions needed / defaults applied",
    },
    { name: "extra spaces trimmed", input: "##   Spaced   ", expected: "spaced" },
    {
      name: "only trailing parenthetical stripped, not inner",
      input: "Foo (bar) Baz",
      expected: "foo (bar) baz",
    },
  ];
  for (const c of cases) {
    test(c.name, () => {
      expect(normalizeHeading(c.input)).toBe(c.expected);
    });
  }
});

describe("matchSection", () => {
  test("suffix-carrying heading matches bare key", () => {
    expect(matchSection("## Verification Strategy (MANDATORY)", "verification strategy")).toBe(true);
  });

  test("prefix match where key is prefix of heading", () => {
    expect(matchSection("Decisions Needed / Defaults Applied", "decisions needed")).toBe(true);
  });

  test("exact match", () => {
    expect(matchSection("## Context", "context")).toBe(true);
  });

  test("non-match", () => {
    expect(matchSection("## Context", "todos")).toBe(false);
  });

  test("key longer than heading does not match", () => {
    expect(matchSection("## Ctx", "context")).toBe(false);
  });

  test("case-insensitive", () => {
    expect(matchSection("## TODOS", "todos")).toBe(true);
  });
});

describe("splitSections synthetic", () => {
  test("fenced ## is content not a heading, exactly 2 H2", () => {
    const src = "# T\n\n## A\n```\n## NOT-A-HEADING\n```\n## B\n";
    const { title, sections } = splitSections(src);
    expect(title).toBe("T");
    const h2 = sections.filter((s) => s.level === 2);
    expect(h2.length).toBe(2);
    expect(h2.map((s) => s.heading)).toEqual(["## A", "## B"]);
    expect(h2.map((s) => s.normalized)).toEqual(["a", "b"]);
    const a = h2[0]!;
    expect(a.lines).toContain("## NOT-A-HEADING");
    expect(a.lines).toContain("```");
  });

  test("H1 text becomes title, preamble before H1 does not crash", () => {
    const src = "preamble line\n# Real Title\n## S\n";
    const { title, sections } = splitSections(src);
    expect(title).toBe("Real Title");
    expect(sections.filter((s) => s.level === 2).map((s) => s.normalized)).toEqual(["s"]);
  });

  test("preamble before H1 records a ParseWarning", () => {
    const src = "preamble line\n# Real Title\n## S\n";
    const { warnings } = splitSections(src);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]?.line).toBe(0);
  });

  test("H3 emitted in document order after parent H2, tagged level 3", () => {
    const src = "# T\n## Parent\nintro\n### Child\nchildbody\n## Next\n";
    const { sections } = splitSections(src);
    expect(sections.map((s) => [s.level, s.normalized])).toEqual([
      [2, "parent"],
      [3, "child"],
      [2, "next"],
    ]);
    const child = sections.find((s) => s.normalized === "child")!;
    expect(child.level).toBe(3);
    expect(child.lines).toContain("childbody");
    const parent = sections.find((s) => s.normalized === "parent")!;
    expect(parent.lines).toContain("intro");
    expect(parent.lines).not.toContain("childbody");
  });

  test("startLine reflects the heading line index", () => {
    const src = "# T\n## A\n## B\n";
    const { sections } = splitSections(src);
    const a = sections.find((s) => s.normalized === "a")!;
    const b = sections.find((s) => s.normalized === "b")!;
    expect(a.startLine).toBe(1);
    expect(b.startLine).toBe(2);
  });
});

const EXPECTED_H2_KEYS = [
  "tl;dr",
  "context",
  "work objectives",
  "verification strategy",
  "execution strategy",
  "decisions needed / defaults applied",
  "todos",
  "final verification wave",
  "commit strategy",
  "success criteria",
];

describe("splitSections golden fixture", () => {
  const golden = normalizeSource(readFileSync("test/fixtures/golden-plan.md", "utf8"));

  test("H1 title parsed", () => {
    const { title } = splitSections(golden);
    expect(title).toBe(
      "Widget Service: consolidate the CLI into the shared worker image (k8s queue/blob flow)",
    );
  });

  test("H2 sections in source order with correct normalized keys", () => {
    const { sections } = splitSections(golden);
    const h2 = sections.filter((s) => s.level === 2).map((s) => s.normalized);
    expect(h2).toEqual(EXPECTED_H2_KEYS);
  });

  test("exactly 10 H2 sections, fenced bash H1 not counted", () => {
    const { sections } = splitSections(golden);
    expect(sections.filter((s) => s.level === 2).length).toBe(10);
  });

  test("fenced wave art never emitted as section headings", () => {
    const { sections } = splitSections(golden);
    for (const s of sections) {
      expect(s.heading.startsWith("├──")).toBe(false);
      expect(s.heading.startsWith("└──")).toBe(false);
    }
  });
});

describe("CRLF vs LF equivalence", () => {
  test("CRLF input produces sections deep-equal to LF equivalent", () => {
    const lf = "# T\n## A\nbody a\n### Child\nkid\n## B\nbody b\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    const fromLf = splitSections(normalizeSource(lf));
    const fromCrlf = splitSections(normalizeSource(crlf));
    expect(fromCrlf).toEqual(fromLf);
  });

  test("golden CRLF equals golden LF", () => {
    const golden = readFileSync("test/fixtures/golden-plan.md", "utf8");
    const lf = normalizeSource(golden);
    const crlf = normalizeSource(golden.replace(/\n/g, "\r\n"));
    expect(splitSections(crlf)).toEqual(splitSections(lf));
  });
});

const _typeAnchor: RawSection = {
  heading: "## A",
  normalized: "a",
  level: 2,
  lines: [],
  startLine: 0,
};
void _typeAnchor;
