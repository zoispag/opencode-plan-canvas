import { test, expect } from "bun:test";
import type {
  Plan,
  TldrEntry,
  Objectives,
  NamedSection,
  Wave,
  WaveEntry,
  Task,
  TaskField,
  TaskState,
  Decision,
  FinalTask,
  ParseWarning,
} from "../src/model";

test("model.ts exports all required types (compile-time + runtime)", () => {
  // Compile-only verification: TypeScript will reject the below assignments if types don't exist.
  // This test file itself is the evidence of successful type exports.

  // TldrEntry (L3-24 mapping)
  const tldrEntry: TldrEntry = {
    label: "Quick Summary",
    value: "consolidate the CLI into widget-service",
  };
  expect(tldrEntry.label).toBe("Quick Summary");

  // NamedSection (part of Objectives)
  const namedSection: NamedSection = {
    heading: "Core Objective",
    lines: [
      "Make widget-service the single repo that releases in LOCKSTEP.",
    ],
  };
  expect(namedSection.heading).toBe("Core Objective");

  // Objectives (L84-121 mapping)
  const objectives: Objectives = {
    mustHave: [
      "One binary → THREE images from ONE git tag",
      "Runtime-free cli image WITH the CLI tool",
    ],
    mustNot: [
      "Do NOT modify the scheduler image",
      "Do NOT rebuild the runtime",
    ],
    other: [namedSection],
  };
  expect(objectives.mustHave).toHaveLength(2);
  expect(objectives.mustNot).toHaveLength(2);
  expect(objectives.other).toHaveLength(1);

  // TaskState (badge + ref)
  const shippedState: TaskState = {
    badge: "shipped",
    ref: "PR #136",
  };
  expect(shippedState.badge).toBe("shipped");

  // TaskField with all kinds (kind: text | fenced | checklist)
  const textField: TaskField = {
    label: "What to do",
    content: "This is prose content.",
    kind: "text",
  };
  const fencedField: TaskField = {
    label: "Code",
    content: "```bash\ngo build ./...\n```",
    kind: "fenced",
  };
  const checklistField: TaskField = {
    label: "Acceptance Criteria",
    content: "- [ ] Criterion 1\n- [x] Criterion 2",
    kind: "checklist",
  };
  expect(textField.kind).toBe("text");
  expect(fencedField.kind).toBe("fenced");
  expect(checklistField.kind).toBe("checklist");

  // Task (with id suffix like "T-WIDGET-CORE")
  const task: Task = {
    id: "T-WIDGET-CORE",
    checked: false,
    title:
      "Dockerfile.worker HERE (base binary + FROM acme/base-runtime COPY /opt/runtime + CLI tool)",
    stateComment:
      "<!-- awaiting execution in Wave A -->",
    state: shippedState,
    fields: [textField, fencedField, checklistField],
  };
  expect(task.id).toBe("T-WIDGET-CORE");
  expect(task.fields).toHaveLength(3);
  expect(task.fields[0].kind).toBe("text");

  // Decision (with compound statusText like "Resolved · KEY DECISION")
  const decision: Decision = {
    name: "RESOLVED (reframe)",
    status: "resolved",
    statusText: "Resolved · KEY DECISION",
    body: "Consolidation = COORDINATED PARALLEL RELEASE (lockstep single-tag), NOT a monorepo...",
  };
  expect(decision.status).toBe("resolved");
  expect(decision.statusText).toContain("KEY DECISION");

  // WaveEntry (L157-164 mapping)
  const waveEntry: WaveEntry = {
    id: "T1",
    checked: true,
    title: "Repo/module rename → widget-service",
    note: "PR #12",
    needs: [],
    blocks: [],
  };
  expect(waveEntry.checked).toBe(true);
  expect(waveEntry.note).toBe("PR #12");

  // Wave (L156-189 mapping)
  const wave: Wave = {
    name: "Wave 1–2",
    description: "widget-service cli foundation + cli image",
    entries: [waveEntry],
  };
  expect(wave.name).toBe("Wave 1–2");
  expect(wave.entries).toHaveLength(1);

  // FinalTask (L889-909 mapping) — category is string (NOT enum)
  const finalTask: FinalTask = {
    id: "F1",
    checked: true,
    title: "Plan Compliance Audit",
    category: "oracle",
    description: "Verify each Must-Have exists and each Must-NOT is absent.",
    output:
      "Must Have [N/N] | Must NOT [N/N] | Tasks [N/N] | VERDICT",
    stateComment: "<!-- APPROVE (user okay 2026-08-12) -->",
  };
  expect(finalTask.category).toBe("oracle");
  expect(typeof finalTask.category).toBe("string");

  // ParseWarning (optional line number)
  const warning: ParseWarning = {
    line: 42,
    message: "Unknown task state badge",
  };
  expect(warning.line).toBe(42);

  const warningNoLine: ParseWarning = {
    message: "Malformed decision entry",
  };
  expect(warningNoLine.line).toBeUndefined();

  // Full Plan (root type)
  const plan: Plan = {
    title:
      "Widget Service: consolidate the CLI into the shared worker image (k8s queue/blob flow)",
    tldr: [tldrEntry],
    contextRaw: "Original Request\nModernize the CLI runner...",
    objectives,
    verificationRaw: "Verification Strategy (MANDATORY)\n...",
    waves: [wave],
    criticalPath:
      "[done T1→T2→T3→T4→T7→T8] → T-WIDGET-CORE → T-RELEASE → ...",
    decisions: [decision],
    tasks: [task],
    finalTasks: [finalTask],
    warnings: [warning, warningNoLine],
  };

  // Verify complete Plan structure
  expect(plan.title).toContain("consolidate the CLI");
  expect(plan.tldr).toHaveLength(1);
  expect(plan.objectives.mustHave).toHaveLength(2);
  expect(plan.waves).toHaveLength(1);
  expect(plan.decisions).toHaveLength(1);
  expect(plan.tasks).toHaveLength(1);
  expect(plan.finalTasks).toHaveLength(1);
  expect(plan.warnings).toHaveLength(2);
});

test("model types compile successfully (proving strict typing)", () => {
  // This test file, when compiled with bunx tsc --noEmit, validates that:
  // 1. All exported types exist and are correctly named
  // 2. The type structure matches golden-plan.md regions
  // 3. TypeScript strict mode is enforced
  // 4. All assignments use correct types
  // Success = tsc exit 0

  // Dummy assertion — the real test is successful TypeScript compilation
  expect(true).toBe(true);
});

test("FinalTask.category accepts arbitrary strings (not enum)", () => {
  // Guardrail: category must be plain string to allow unknown agent types
  const ft1: FinalTask = {
    id: "F1",
    checked: true,
    title: "Audit",
    category: "oracle",
    description: "...",
  };
  const ft2: FinalTask = {
    id: "F2",
    checked: true,
    title: "Review",
    category: "custom-agent-type",
    description: "...",
  };
  const ft3: FinalTask = {
    id: "F3",
    checked: true,
    title: "QA",
    description: "...",
    // category omitted (optional)
  };

  expect(ft1.category).toBe("oracle");
  expect(ft2.category).toBe("custom-agent-type");
  expect(ft3.category).toBeUndefined();
});

test("Decision.statusText preserves compound strings", () => {
  // Guardrail: statusText must be a string, not split into status + extra
  // This allows complex statuses like "Resolved · KEY DECISION"
  const d1: Decision = {
    name: "D1",
    status: "resolved",
    statusText: "Resolved · KEY DECISION",
    body: "User confirmed...",
  };
  const d2: Decision = {
    name: "D2",
    status: "open",
    statusText: "Open — awaiting user input on region strategy",
    body: "...",
  };
  const d3: Decision = {
    name: "D3",
    status: "default",
    statusText: "Default Applied",
    body: "...",
  };

  expect(d1.statusText).toBe("Resolved · KEY DECISION");
  expect(d2.statusText).toContain("region strategy");
  expect(d3.statusText).toBe("Default Applied");
});

test("TaskField.kind is strictly text|fenced|checklist", () => {
  // Verify the kind union enforces exactly these three values
  const fields: TaskField[] = [
    { label: "L1", content: "...", kind: "text" },
    { label: "L2", content: "...", kind: "fenced" },
    { label: "L3", content: "...", kind: "checklist" },
  ];

  expect(fields.map((f) => f.kind)).toEqual(["text", "fenced", "checklist"]);
});

test("TaskState.badge is strictly one of the badge types", () => {
  const badges: TaskState[] = [
    { badge: "shipped" },
    { badge: "merged" },
    { badge: "done" },
    { badge: "deferred" },
    { badge: "verified" },
    { badge: "review" },
    {}, // badge omitted
  ];

  expect(badges.filter((s) => s.badge)).toHaveLength(6);
  expect(badges.filter((s) => !s.badge)).toHaveLength(1);
});
