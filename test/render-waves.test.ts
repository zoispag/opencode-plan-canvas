import { describe, test, expect } from "bun:test";
import type { Plan, Task, Wave, Objectives } from "../src/model";
import { renderWaves, categoryClass } from "../src/render/waves";
import { sixWavePlan } from "./helpers/fixture-model";

const emptyObjectives: Objectives = { mustHave: [], mustNot: [], other: [] };

function basePlan(overrides: Partial<Plan>): Plan {
  return {
    title: "Inline Fixture",
    tldr: [],
    objectives: emptyObjectives,
    waves: [],
    decisions: [],
    tasks: [],
    finalTasks: [],
    warnings: [],
    ...overrides,
  };
}

describe("categoryClass", () => {
  test("known categories map to cat {name}", () => {
    expect(categoryClass("deep")).toBe("cat deep");
    expect(categoryClass("ultrabrain")).toBe("cat ultrabrain");
    expect(categoryClass("quick")).toBe("cat quick");
    expect(categoryClass("unspecified-high")).toBe("cat unspecified-high");
    expect(categoryClass("writing")).toBe("cat writing");
    expect(categoryClass("oracle")).toBe("cat oracle");
  });

  test("unknown category falls back to cat other", () => {
    expect(categoryClass("visual-engineering")).toBe("cat other");
    expect(categoryClass("")).toBe("cat other");
    expect(categoryClass("DEEP")).toBe("cat other");
  });
});

describe("renderWaves color cycling", () => {
  test("6 waves cycle w1,w2,w3,w4,wf then wrap to w1", () => {
    const { html } = renderWaves(sixWavePlan);
    const colors = [...html.matchAll(/<div class="wave ([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(colors).toEqual([
      "w1 done",
      "w2",
      "w3",
      "w4",
      "wf",
      "w1",
    ]);
  });

  test("fully-checked wave gets .done class", () => {
    const { html } = renderWaves(sixWavePlan);
    expect(html).toContain('<div class="wave w1 done">');
  });

  test("waves render in source order", () => {
    const { html } = renderWaves(sixWavePlan);
    const names = [...html.matchAll(/<div class="whead"><span>([^<]+)<\/span>/g)].map(
      (m) => m[1],
    );
    expect(names).toEqual([
      "Wave 1",
      "Wave 2",
      "Wave 3",
      "Wave 4",
      "Wave 5",
      "Wave 6",
    ]);
  });
});

describe("renderWaves count badge", () => {
  test("0-entry wave renders cnt '0 tasks'", () => {
    const plan = basePlan({
      waves: [{ name: "Empty Wave", entries: [] }],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain('<span class="cnt">0 tasks</span>');
  });

  test("wave with done entries renders '{n} done'", () => {
    const { html } = renderWaves(sixWavePlan);
    expect(html).toContain('<span class="cnt">2 done</span>');
  });

  test("wave with no done entries but with entries renders '{n} tasks'", () => {
    const { html } = renderWaves(sixWavePlan);
    expect(html).toContain('<span class="cnt">2 tasks</span>');
  });
});

describe("renderWaves task cards", () => {
  test("checked body-less entry renders static div, shipped class, check prefix", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave 1",
          entries: [{ id: "A1", checked: true, title: "Done thing", needs: [], blocks: [] }],
        },
      ],
      tasks: [{ id: "A1", checked: true, title: "Done thing", state: {}, fields: [] }],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain('<div class="tcard shipped">');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary>");
    expect(html).toContain('<span class="tid">\u2713 A1</span>');
    expect(html).toContain('<span class="ttitle">Done thing</span>');
  });

  test("unchecked body-less entry renders static div, no shipped class, plain id", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave 1",
          entries: [{ id: "A2", checked: false, title: "Todo thing", needs: [], blocks: [] }],
        },
      ],
      tasks: [{ id: "A2", checked: false, title: "Todo thing", state: {}, fields: [] }],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain('<div class="tcard">\n');
    expect(html).not.toContain("<details");
    expect(html).toContain('<span class="tid">A2</span>');
  });

  test("entry with body fields renders expandable details + summary", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave 1",
          entries: [{ id: "B1", checked: false, title: "Has body", needs: [], blocks: [] }],
        },
      ],
      tasks: [
        {
          id: "B1",
          checked: false,
          title: "Has body",
          state: {},
          fields: [{ label: "What", kind: "text", content: "do it" }],
        },
      ],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain('<details class="tcard"><summary>');
    expect(html).toContain('<div class="tbody">');
  });

  test("badge and ref render in tmeta", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave 1",
          entries: [{ id: "A3", checked: true, title: "Thing", needs: [], blocks: [] }],
        },
      ],
      tasks: [
        {
          id: "A3",
          checked: true,
          title: "Thing",
          state: { badge: "merged", ref: "PR #99" },
          fields: [],
        },
      ],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain(
      '<div class="tmeta"><span class="badge merged">merged</span><span class="dep muted">PR #99</span></div>',
    );
  });
});

describe("renderWaves field rendering", () => {
  test("fenced field escapes HTML and preserves whitespace in .qa pre", () => {
    const fenced: Task = {
      id: "Q1",
      checked: false,
      title: "Fenced task",
      state: {},
      fields: [
        {
          label: "Verification",
          kind: "fenced",
          content: "<b>not-bold</b>\n  \u251c\u2500\u2500 tree",
        },
      ],
    };
    const plan = basePlan({
      waves: [
        { name: "Wave 1", entries: [{ id: "Q1", checked: false, title: "Fenced task", needs: [], blocks: [] }] },
      ],
      tasks: [fenced],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain('<pre class="qa">');
    expect(html).toContain("&lt;b&gt;not-bold&lt;/b&gt;");
    expect(html).toContain("\n  \u251c\u2500\u2500 tree");
    expect(html).not.toContain("<b>not-bold</b>");
  });

  test("checklist field renders ul.clean with check/box markers", () => {
    const cl: Task = {
      id: "C1",
      checked: false,
      title: "Checklist task",
      state: {},
      fields: [
        {
          label: "Acceptance",
          kind: "checklist",
          content: "[x] first done\n[ ] second pending",
        },
      ],
    };
    const plan = basePlan({
      waves: [
        { name: "Wave 1", entries: [{ id: "C1", checked: false, title: "Checklist task", needs: [], blocks: [] }] },
      ],
      tasks: [cl],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain('<ul class="clean">');
    expect(html).toContain("<li>\u2713 first done</li>");
    expect(html).toContain("<li>\u2610 second pending</li>");
  });

  test("text field renders in .box with inline markdown", () => {
    const tx: Task = {
      id: "TX1",
      checked: false,
      title: "Text task",
      state: {},
      fields: [{ label: "What", kind: "text", content: "use `go.mod` here" }],
    };
    const plan = basePlan({
      waves: [
        { name: "Wave 1", entries: [{ id: "TX1", checked: false, title: "Text task", needs: [], blocks: [] }] },
      ],
      tasks: [tx],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain(
      '<div><div class="lbl">What</div><div class="box">use <code>go.mod</code> here</div></div>',
    );
  });

  test("fields render in source order", () => {
    const t: Task = {
      id: "O1",
      checked: false,
      title: "Ordered",
      state: {},
      fields: [
        { label: "First", kind: "text", content: "one" },
        { label: "Second", kind: "text", content: "two" },
        { label: "Third", kind: "text", content: "three" },
      ],
    };
    const plan = basePlan({
      waves: [
        { name: "Wave 1", entries: [{ id: "O1", checked: false, title: "Ordered", needs: [], blocks: [] }] },
      ],
      tasks: [t],
    });
    const { html } = renderWaves(plan);
    const iFirst = html.indexOf("First");
    const iSecond = html.indexOf("Second");
    const iThird = html.indexOf("Third");
    expect(iFirst).toBeLessThan(iSecond);
    expect(iSecond).toBeLessThan(iThird);
  });
});

describe("renderWaves normalized reconciliation (T1 <-> task 1)", () => {
  test("T-prefixed wave entry pairs numbered task and renders its body", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave 1",
          entries: [{ id: "T1", checked: false, title: "Rename", needs: [], blocks: [] }],
        },
      ],
      tasks: [
        {
          id: "1",
          checked: false,
          title: "Rename",
          state: {},
          fields: [{ label: "What to do", kind: "text", content: "do it" }],
        },
      ],
    });
    const { html, warnings } = renderWaves(plan);
    expect(html).toContain('<details class="tcard"><summary>');
    expect(html).toContain('<div class="tbody">');
    expect(html).toContain('<div class="lbl">What to do</div>');
    expect(html).not.toContain("<span>Unassigned</span>");
    expect(warnings).toEqual([]);
  });

  test("F-wave entry maps to finalTask: bodyless card, no warning, no Unassigned", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave FINAL",
          entries: [{ id: "F1", checked: false, title: "Plan audit", needs: [], blocks: [] }],
        },
      ],
      tasks: [
        {
          id: "1",
          checked: false,
          title: "Rename",
          state: {},
          fields: [{ label: "What to do", kind: "text", content: "do it" }],
        },
      ],
      finalTasks: [
        { id: "F1", checked: false, title: "Plan audit", description: "" },
      ],
    });
    const { html, warnings } = renderWaves(plan);
    expect(html).toContain(
      '<span class="ttitle"><a class="tlink" href="#final-f1">Plan audit</a></span>',
    );
    expect(warnings.some((w) => w.message.includes("F1"))).toBe(false);
    expect(html).toContain("<span>Unassigned</span>");
    expect(html).toContain('<span class="ttitle">Rename</span>');
  });
});

describe("renderWaves reconciliation + warnings", () => {
  test("unpaired wave entry renders title-only card + records warning", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave 1",
          entries: [{ id: "GHOST", checked: false, title: "No task here", needs: [], blocks: [] }],
        },
      ],
      tasks: [],
    });
    const { html, warnings } = renderWaves(plan);
    expect(html).toContain('<span class="ttitle">No task here</span>');
    expect(html).toContain('<div class="tcard">');
    expect(html).not.toContain("<details");
    expect(html).not.toContain('<div class="tbody">');
    expect(warnings.some((w) => w.message.includes("GHOST"))).toBe(true);
  });

  test("unassigned task gets synthetic Unassigned wave + warning", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave 1",
          entries: [{ id: "A", checked: true, title: "In wave", needs: [], blocks: [] }],
        },
      ],
      tasks: [
        { id: "A", checked: true, title: "In wave", state: {}, fields: [] },
        { id: "LONE", checked: false, title: "Not in any wave", state: {}, fields: [] },
      ],
    });
    const { html, warnings } = renderWaves(plan);
    expect(html).toContain("<span>Unassigned</span>");
    expect(html).toContain('<span class="ttitle">Not in any wave</span>');
    expect(warnings.some((w) => w.message.includes("LONE"))).toBe(true);
  });

  test("no warnings when every entry pairs and every task is assigned", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave 1",
          entries: [{ id: "A", checked: true, title: "T", needs: [], blocks: [] }],
        },
      ],
      tasks: [{ id: "A", checked: true, title: "T", state: {}, fields: [] }],
    });
    const { warnings } = renderWaves(plan);
    expect(warnings).toEqual([]);
  });
});

describe("renderWaves section structure", () => {
  test("emits section#waves with golden h2 and .waves grid", () => {
    const { html } = renderWaves(sixWavePlan);
    expect(html.startsWith('<section id="waves">')).toBe(true);
    expect(html).toContain(
      '<h2><span class="dot"></span>Execution Waves &amp; Tasks</h2>',
    );
    expect(html).toContain('<div class="waves">');
    expect(html.trimEnd().endsWith("</section>")).toBe(true);
  });

  test("final-named wave always gets wf regardless of position", () => {
    const waves: Wave[] = [
      { name: "Wave 1", entries: [{ id: "x", checked: false, title: "x", needs: [], blocks: [] }] },
      { name: "Final Review", entries: [{ id: "y", checked: false, title: "y", needs: [], blocks: [] }] },
      { name: "Wave 2", entries: [{ id: "z", checked: false, title: "z", needs: [], blocks: [] }] },
    ];
    const plan = basePlan({ waves });
    const { html } = renderWaves(plan);
    const colors = [...html.matchAll(/<div class="wave ([^"]+)"/g)].map((m) => m[1]);
    expect(colors).toEqual(["w1", "wf", "w2"]);
  });
});

describe("renderWaves entry category badge", () => {
  test("wave entry category renders as a colored .cat badge", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave 1",
          entries: [{ id: "A1", checked: false, title: "Do it", category: "quick", needs: [], blocks: [] }],
        },
      ],
      tasks: [{ id: "A1", checked: false, title: "Do it", state: {}, fields: [] }],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain('<span class="cat quick">quick</span>');
    expect(html).not.toContain("[quick]");
  });

  test("unknown category falls back to cat other", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave 1",
          entries: [
            { id: "A1", checked: false, title: "X", category: "visual-engineering", needs: [], blocks: [] },
          ],
        },
      ],
      tasks: [{ id: "A1", checked: false, title: "X", state: {}, fields: [] }],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain('<span class="cat other">visual-engineering</span>');
  });

  test("entry without a category emits no cat badge", () => {
    const plan = basePlan({
      waves: [{ name: "Wave 1", entries: [{ id: "A1", checked: false, title: "X", needs: [], blocks: [] }] }],
      tasks: [{ id: "A1", checked: false, title: "X", state: {}, fields: [] }],
    });
    const { html } = renderWaves(plan);
    expect(html).not.toContain('class="cat');
  });
});

describe("renderWaves final-entry linking to #final", () => {
  test("a final (F) wave entry links its title to the #final anchor", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave FINAL",
          entries: [{ id: "F1", checked: false, title: "Plan compliance audit", needs: [], blocks: [] }],
        },
      ],
      finalTasks: [
        { id: "F1", checked: false, title: "Plan Compliance Audit", description: "" },
      ],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain('<a class="tlink" href="#final-f1">');
    expect(html).toContain("tcard-linked");
  });

  test("verbose 'Task F1' entry also links to #final-f1", () => {
    const plan = basePlan({
      waves: [
        {
          name: "Wave FINAL",
          entries: [{ id: "Task F1", checked: false, title: "Plan compliance audit", needs: [], blocks: [] }],
        },
      ],
      finalTasks: [
        { id: "F1", checked: false, title: "Plan Compliance Audit", description: "" },
      ],
    });
    const { html } = renderWaves(plan);
    expect(html).toContain('href="#final-f1"');
  });

  test("non-final entries do not get a tlink", () => {
    const plan = basePlan({
      waves: [{ name: "Wave 1", entries: [{ id: "A1", checked: false, title: "X", needs: [], blocks: [] }] }],
      tasks: [{ id: "A1", checked: false, title: "X", state: {}, fields: [] }],
    });
    const { html } = renderWaves(plan);
    expect(html).not.toContain("tlink");
  });
});
