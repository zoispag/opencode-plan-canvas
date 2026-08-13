import { describe, test, expect } from "bun:test";
import type { Plan } from "../src/model";
import {
  renderCriticalPath,
  renderGuardrails,
  renderVerification,
  renderDecisions,
  renderFinal,
} from "../src/render/sections";

function basePlan(overrides: Partial<Plan>): Plan {
  return {
    title: "Inline Plan",
    tldr: [],
    objectives: { mustHave: [], mustNot: [], other: [] },
    waves: [],
    decisions: [],
    tasks: [],
    finalTasks: [],
    warnings: [],
    ...overrides,
  };
}

describe("renderCriticalPath", () => {
  test("splits on top-level arrows, marks done/gate nodes and arrows", () => {
    const plan = basePlan({
      criticalPath: "[done T1\u2192T2] \u2192 T-NEW \u2192 F1\u2013F4 \u2192 user okay",
      finalTasks: [
        {
          id: "F1",
          checked: true,
          title: "Audit",
          category: "oracle",
          description: "d",
        },
      ],
    });
    const html = renderCriticalPath(plan);

    expect(html).toContain(`<section id="crit">`);
    expect(html).toContain(`<div class="flow">`);
    expect(html).toContain(
      `<span class="n ok">[done T1\u2192T2]</span>`,
    );
    expect(html).toContain(`<span class="n gate">user okay</span>`);
    expect(html).toContain(`<span class="arr">\u2192</span>`);

    const arrows = html.match(/<span class="arr">/g) ?? [];
    expect(arrows.length).toBe(3);

    const bracketNode = html.indexOf(`<span class="n ok">[done`);
    const newNode = html.indexOf(`>T-NEW<`);
    expect(bracketNode).toBeGreaterThan(-1);
    expect(newNode).toBeGreaterThan(bracketNode);
  });

  test("legend derives categories from finalTasks (not fixed six)", () => {
    const plan = basePlan({
      criticalPath: "A \u2192 user okay",
      finalTasks: [
        { id: "F1", checked: true, title: "t", category: "oracle", description: "d" },
        { id: "F2", checked: false, title: "t", category: "deep", description: "d" },
      ],
    });
    const html = renderCriticalPath(plan);
    expect(html).toContain(`<div class="legend">`);
    expect(html).toContain(`<span class="cat oracle">oracle</span>`);
    expect(html).toContain(`<span class="cat deep">deep</span>`);
    expect(html).not.toContain(`<span class="cat ultrabrain">`);
    expect(html).not.toContain(`<span class="cat quick">`);
  });

  test("unknown category falls to cat other in legend", () => {
    const plan = basePlan({
      criticalPath: "A \u2192 B",
      finalTasks: [
        { id: "F1", checked: true, title: "t", category: "mystery", description: "d" },
      ],
    });
    const html = renderCriticalPath(plan);
    expect(html).toContain(`<span class="cat other">mystery</span>`);
  });

  test("omits legend when no categories present", () => {
    const plan = basePlan({ criticalPath: "A \u2192 B" });
    const html = renderCriticalPath(plan);
    expect(html).toContain(`<div class="flow">`);
    expect(html).not.toContain(`<div class="legend">`);
  });

  test("supports -> arrow form", () => {
    const plan = basePlan({ criticalPath: "A -> B -> user okay" });
    const html = renderCriticalPath(plan);
    const arrows = html.match(/<span class="arr">/g) ?? [];
    expect(arrows.length).toBe(2);
    expect(html).toContain(`<span class="n gate">user okay</span>`);
  });

  test("checkmark-prefixed segment gets ok class", () => {
    const plan = basePlan({ criticalPath: "\u2713 T1 \u2192 T2" });
    const html = renderCriticalPath(plan);
    expect(html).toContain(`<span class="n ok">\u2713 T1</span>`);
  });

  test("returns empty string when criticalPath absent or empty", () => {
    expect(renderCriticalPath(basePlan({}))).toBe("");
    expect(renderCriticalPath(basePlan({ criticalPath: "" }))).toBe("");
    expect(renderCriticalPath(basePlan({ criticalPath: "   " }))).toBe("");
  });
});

describe("renderGuardrails", () => {
  test("renders mustHave into .have and mustNot into .not", () => {
    const plan = basePlan({
      objectives: {
        mustHave: ["Have `X`", "Have Y"],
        mustNot: ["Not Z"],
        other: [],
      },
    });
    const html = renderGuardrails(plan);
    expect(html).toContain(`<section id="guardrails">`);
    expect(html).toContain(`<div class="must">`);
    expect(html).toContain(`<div class="col have"><h4>Must Have</h4>`);
    expect(html).toContain(`<div class="col not"><h4>Must NOT Have</h4>`);
    expect(html).toContain(`<li>Have <code>X</code></li>`);
    expect(html).toContain(`<li>Have Y</li>`);
    expect(html).toContain(`<li>Not Z</li>`);
  });

  test("returns empty string when both lists empty", () => {
    expect(renderGuardrails(basePlan({}))).toBe("");
  });
});

describe("renderVerification", () => {
  test("renders verificationRaw lines into grid2 cards", () => {
    const plan = basePlan({
      verificationRaw: "First check\nSecond check `cmd`",
    });
    const html = renderVerification(plan);
    expect(html).toContain(`<section id="verify">`);
    expect(html).toContain(`<div class="grid2">`);
    expect(html).toContain(`<div class="card">`);
    expect(html).toContain(`<ul class="clean">`);
    expect(html).toContain(`<li>First check</li>`);
    expect(html).toContain(`<li>Second check <code>cmd</code></li>`);
  });

  test("falls back to objectives.other named sections", () => {
    const plan = basePlan({
      objectives: {
        mustHave: [],
        mustNot: [],
        other: [{ heading: "QA", lines: ["run tests", "lint"] }],
      },
    });
    const html = renderVerification(plan);
    expect(html).toContain(`<h3 style="margin-top:0">QA</h3>`);
    expect(html).toContain(`<li>run tests</li>`);
  });

  test("returns empty string when nothing to render", () => {
    expect(renderVerification(basePlan({}))).toBe("");
  });
});

describe("renderDecisions", () => {
  test("compound resolved statusText shown verbatim with resolved badge", () => {
    const plan = basePlan({
      decisions: [
        {
          name: "D-MULTI-REGION",
          status: "resolved",
          statusText: "Resolved \u00b7 KEY DECISION",
          body: "Registry mirroring `set up`.",
        },
      ],
    });
    const html = renderDecisions(plan);
    expect(html).toContain(`<section id="decisions">`);
    expect(html).toContain(`<div class="decisions">`);
    expect(html).toContain(`<div class="dcard">`);
    expect(html).toContain(`<span class="name">D-MULTI-REGION</span>`);
    expect(html).toContain(
      `<span class="badge resolved">Resolved \u00b7 KEY DECISION</span>`,
    );
    expect(html).toContain(`Registry mirroring <code>set up</code>.`);
  });

  test("open and default statuses map to correct badge classes", () => {
    const plan = basePlan({
      decisions: [
        { name: "A", status: "open", statusText: "Open \u00b7 non-blocking", body: "b" },
        { name: "B", status: "default", statusText: "Override anytime", body: "b" },
      ],
    });
    const html = renderDecisions(plan);
    expect(html).toContain(`<span class="badge open">Open \u00b7 non-blocking</span>`);
    expect(html).toContain(`<span class="badge default">Override anytime</span>`);
  });

  test("preserves source order", () => {
    const plan = basePlan({
      decisions: [
        { name: "First", status: "resolved", statusText: "R", body: "b" },
        { name: "Second", status: "open", statusText: "O", body: "b" },
      ],
    });
    const html = renderDecisions(plan);
    expect(html.indexOf("First")).toBeLessThan(html.indexOf("Second"));
  });

  test("returns empty string when decisions empty", () => {
    expect(renderDecisions(basePlan({ decisions: [] }))).toBe("");
  });
});

describe("renderFinal", () => {
  test("renders fcard with h, state badge, cat oracle, and out box", () => {
    const plan = basePlan({
      finalTasks: [
        {
          id: "F1",
          checked: true,
          title: "Plan Compliance Audit",
          category: "oracle",
          description: "Verify `must-haves`.",
          output: "VERDICT: APPROVE",
        },
      ],
    });
    const html = renderFinal(plan);
    expect(html).toContain(`<section id="final">`);
    expect(html).toContain(`<div class="fwave">`);
    expect(html).toContain(`<div class="fcard">`);
    expect(html).toContain(`<div class="h">`);
    expect(html).toContain(`<b>F1 \u00b7 Plan Compliance Audit</b>`);
    expect(html).toContain(`<span class="badge shipped">done</span>`);
    expect(html).toContain(`<span class="cat oracle">oracle</span>`);
    expect(html).toContain(`<div class="muted">Verify <code>must-haves</code>.</div>`);
    expect(html).toContain(`<div class="out">VERDICT: APPROVE</div>`);
  });

  test("unchecked task omits state badge; missing output omits out box", () => {
    const plan = basePlan({
      finalTasks: [
        {
          id: "F2",
          checked: false,
          title: "Review",
          category: "deep",
          description: "d",
        },
      ],
    });
    const html = renderFinal(plan);
    expect(html).toContain(`<span class="cat deep">deep</span>`);
    expect(html).not.toContain(`<span class="badge shipped">`);
    expect(html).not.toContain(`<div class="out">`);
  });

  test("returns empty string when finalTasks empty", () => {
    expect(renderFinal(basePlan({}))).toBe("");
  });
});
