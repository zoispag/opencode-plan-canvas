import { describe, test, expect } from "bun:test";
import { parseDecisions } from "../src/parse/decisions";
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
    heading: "## Decisions Needed / Defaults Applied",
    normalized: "decisions needed / defaults applied",
    level: 2,
    lines,
    startLine: 0,
  };
}

describe("parseDecisions — real golden Decisions", () => {
  const section = sectionFrom(GOLDEN, "decisions needed / defaults applied");
  const { decisions } = parseDecisions(section);

  test("captures the leading RESOLVED bold-paragraph pseudo-decision", () => {
    const resolved = decisions.find((d) => d.name === "RESOLVED (reframe)");
    expect(resolved).toBeDefined();
    expect(resolved!.status).toBe("resolved");
    expect(resolved!.body).toContain("COORDINATED PARALLEL RELEASE");
  });

  test("captures the Defaults Applied bold-paragraph as a default pseudo-decision", () => {
    const def = decisions.find((d) => /Defaults Applied/i.test(d.name));
    expect(def).toBeDefined();
    expect(def!.status).toBe("default");
  });

  test("D-MULTI-REGION compound RESOLVED status kept verbatim", () => {
    const jp = decisions.find((d) => d.name.startsWith("D-MULTI-REGION"));
    expect(jp).toBeDefined();
    expect(jp!.status).toBe("resolved");
    expect(jp!.statusText).toBe("RESOLVED — multi-region mirroring");
    expect(jp!.body).toContain("cross-region mirroring");
  });

  test("bare list decisions (no status) default to open", () => {
    const owner = decisions.find((d) => d.name === "D-API-OWNER");
    expect(owner).toBeDefined();
    expect(owner!.status).toBe("open");
    expect(owner!.statusText).toBe("");
  });

  test("all 7 D- list decisions present", () => {
    const names = decisions.map((d) => d.name);
    expect(names).toContain("D-MULTI-REGION (RESOLVED — multi-region mirroring)");
    expect(names).toContain("D-API-OWNER");
    expect(names).toContain("D-TOOL-VERSION");
    expect(names).toContain("D-TOKEN-SECRET");
    expect(names).toContain("D-DOCS-PUBLISH");
    expect(names).toContain("D-EXPOSE-PORT");
    expect(names).toContain("D-VERSION-SCHEME");
  });

  test("every decision status is a valid enum value", () => {
    for (const d of decisions) {
      expect(["resolved", "open", "default"]).toContain(d.status);
    }
  });
});

describe("parseDecisions — status mapping + warnings", () => {
  test("list decision with RESOLVED parenthetical → resolved, verbatim statusText", () => {
    const { decisions, warnings } = parseDecisions(
      synthetic(["- **D-X (RESOLVED — foo bar)**: some body"]),
    );
    expect(decisions[0]!.status).toBe("resolved");
    expect(decisions[0]!.statusText).toBe("RESOLVED — foo bar");
    expect(warnings.length).toBe(0);
  });

  test("OPEN parenthetical → open", () => {
    const { decisions } = parseDecisions(
      synthetic(["- **D-Y (OPEN — pending)**: body"]),
    );
    expect(decisions[0]!.status).toBe("open");
    expect(decisions[0]!.statusText).toBe("OPEN — pending");
  });

  test("contains 'default' (case-insensitive) → default", () => {
    const { decisions } = parseDecisions(
      synthetic(["- **D-Z (Default applied)**: body"]),
    );
    expect(decisions[0]!.status).toBe("default");
    expect(decisions[0]!.statusText).toBe("Default applied");
  });

  test("unknown parenthetical → open + warning", () => {
    const { decisions, warnings } = parseDecisions(
      synthetic(["- **D-W (needs review)**: body"]),
    );
    expect(decisions[0]!.status).toBe("open");
    expect(decisions[0]!.statusText).toBe("needs review");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  test("bare decision (no parenthetical) → open, empty statusText, +warning", () => {
    const { decisions, warnings } = parseDecisions(
      synthetic(["- **D-BARE**: some question"]),
    );
    expect(decisions.length).toBe(1);
    expect(decisions[0]!.name).toBe("D-BARE");
    expect(decisions[0]!.status).toBe("open");
    expect(decisions[0]!.statusText).toBe("");
    expect(decisions[0]!.body).toBe("some question");
    expect(warnings.length).toBe(1);
  });

  test("bold-paragraph RESOLVED → resolved pseudo-decision", () => {
    const { decisions } = parseDecisions(
      synthetic(["**RESOLVED (x)**: para body here"]),
    );
    expect(decisions[0]!.status).toBe("resolved");
    expect(decisions[0]!.name).toBe("RESOLVED (x)");
    expect(decisions[0]!.body).toContain("para body here");
  });

  test("bold-paragraph Defaults Applied → default pseudo-decision", () => {
    const { decisions } = parseDecisions(
      synthetic(["**Defaults Applied (override anytime):**"]),
    );
    expect(decisions[0]!.status).toBe("default");
  });

  test("empty section → no decisions, no crash", () => {
    const { decisions, warnings } = parseDecisions(synthetic([]));
    expect(decisions).toEqual([]);
    expect(Array.isArray(warnings)).toBe(true);
  });
});
