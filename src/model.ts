/**
 * Typed plan model — pure TypeScript interfaces with no logic.
 * 
 * This module defines the complete contract for parsing and rendering
 * work-plan documents. Every parser and renderer depends on
 * these exact exported type names and shapes.
 * 
 * Reference regions (from test/fixtures/golden-plan.md):
 * - TldrEntry & TL;DR section: L3-24 (free-form bold labels, no enum)
 * - Objectives: L84-121 (Must Have / Must NOT Have + Core Objective)
 * - Waves (WaveEntry): L156-189 (fence syntax with [x]/[ ], id, title, note)
 * - Decisions: L212-224 (status field + statusText for compound strings like "Resolved · KEY DECISION")
 * - Tasks (Task & TaskField): L238-274, L276-315, etc. (multi-field structure: title, state badge, sub-fields with kind)
 * - Final Tasks (FinalTask): L889-909 (category as string, not enum; id, checked, title, description, output, stateComment)
 * - Parse Warnings (ParseWarning): line number optional; message required
 */

/**
 * Root plan document.
 * 
 * Maps golden-plan structure:
 * - title: L1 heading
 * - tldr: L3-24 TL;DR entries (free-form labels)
 * - contextRaw: optional raw context section (L28-121 pre-objectives)
 * - objectives: L84-121 (Must Have / Must NOT Have / Core Objective)
 * - verificationRaw: optional verification strategy (L125-148)
 * - waves: L156-189 (fenced wave blocks)
 * - criticalPath: optional L23 critical path summary
 * - decisions: L212-223 (Decisions Needed / Defaults Applied)
 * - tasks: L238+ (TODOs: tasks with checklist, title, state, fields)
 * - finalTasks: L889-909 (Final Verification Wave)
 * - warnings: parse-time warnings (line number, message)
 */
export interface Plan {
  title: string;
  tldr: TldrEntry[];
  contextRaw?: string;
  objectives: Objectives;
  verificationRaw?: string;
  waves: Wave[];
  criticalPath?: string;
  decisions: Decision[];
  tasks: Task[];
  finalTasks: FinalTask[];
  warnings: ParseWarning[];
}

/**
 * TL;DR entry (L3-24).
 * 
 * Bold labels are free-form (no enum): "Quick Summary", "Scope boundary", "Deliverables", etc.
 * Multi-line values are concatenated with spaces or preserved as single string.
 * Example: { label: "Quick Summary", value: "..." }
 */
export interface TldrEntry {
  label: string;
  value: string;
}

/**
 * Work objectives (L84-121).
 * 
 * Maps:
 * - Must Have: L103-108 (checklist bullets, unordered)
 * - Must NOT Have: L110-121 (guardrails, unordered)
 * - Other: named sections like "Core Objective" (L86-87)
 */
export interface Objectives {
  mustHave: string[];
  mustNot: string[];
  other: NamedSection[];
}

/**
 * Named section with heading and line content.
 * Example: { heading: "Core Objective", lines: ["...", "..."] }
 */
export interface NamedSection {
  heading: string;
  lines: string[];
}

/**
 * Execution wave (L156-189).
 * 
 * Parsed from fenced (```) wave blocks.
 * Example:
 * ```
 * Wave 1–2 (description):
 * ├── T1: [x] title (ref)
 * └── T7: [ ] title (ref)
 * ```
 * 
 * name: "Wave 1–2"
 * description: "description" (optional)
 * entries: [WaveEntry, ...]
 */
export interface Wave {
  name: string;
  description?: string;
  entries: WaveEntry[];
}

/**
 * Single entry in a wave (L157-164, L166-175, etc.).
 * 
 * Example: `├── T1: [x] Rename repo/module → widget-service (PR #12)`
 * 
 * id: "T1" (may have suffixes like "T-WIDGET-CORE")
 * checked: true if [x], false if [ ]
 * title: "Rename repo/module → widget-service"
 * note: optional trailing note like "(PR #136)"
 * needs: dependency ids parsed from an inline "(depends: 1, 9)" note (empty if none)
 * blocks: reverse-dependency ids, derived from other entries' needs (empty if none)
 */
export interface WaveEntry {
  id: string;
  checked: boolean;
  title: string;
  note?: string;
  category?: string;
  needs: string[];
  blocks: string[];
}

/**
 * Task from TODOs section (L238+).
 * 
 * Structure (L238-274 example):
 * - [x] 1. Title (optional comment)
 * - **What to do**: ...
 * - **Must NOT do**: ...
 * - ... (other fields)
 * - **Commit**: ... (final field)
 * 
 * id: "1", "2", "3", "T-WIDGET-CORE", etc.
 * checked: [x] = true, [ ] = false
 * title: task title
 * stateComment: optional trailing comment like "<!-- commit f672a6a; ... -->"
 * state: optional badge (shipped, merged, done, etc.)
 * fields: ordered list of **FieldName**: content entries
 *   - kind: 'text' (prose), 'fenced' (code block), 'checklist' (bullet list)
 *   - source order preserved
 */
export interface Task {
  id: string;
  checked: boolean;
  title: string;
  stateComment?: string;
  state: TaskState;
  fields: TaskField[];
}

/**
 * Task state badge (L159, L276, etc. implicit).
 * 
 * Optional badge marker (shipped, merged, done, deferred, verified, review).
 * Optional ref for context (PR, commit, link).
 * Example: { badge: "shipped", ref: "PR #136" }
 */
export interface TaskState {
  badge?: "shipped" | "merged" | "done" | "deferred" | "verified" | "review";
  ref?: string;
}

/**
 * Task field (a **Label**: content block).
 * 
 * Example (L241-244):
 * **What to do**:
 * - Rename the GitHub repo ...
 * - Edit `go.mod` ...
 * 
 * label: "What to do"
 * content: raw content (may span multiple lines)
 * kind: 'text' for prose, 'fenced' for code blocks, 'checklist' for bullet lists
 * Source order preserved (first **What to do**, then **Must NOT do**, etc.)
 */
export interface TaskField {
  label: string;
  content: string;
  kind: "text" | "fenced" | "checklist";
}

/**
 * Decision entry (L212-223).
 * 
 * Example (L214):
 * **RESOLVED (reframe)**: consolidation = COORDINATED ... runtime stays; ...
 * 
 * name: "RESOLVED (reframe)"
 * status: "resolved", "open", or "default"
 * statusText: full text like "Resolved · KEY DECISION" (preserves compound strings)
 * body: full decision body text
 */
export interface Decision {
  name: string;
  status: "resolved" | "open" | "default";
  statusText: string;
  body: string;
}

/**
 * Final task from Final Verification Wave (L889-909).
 * 
 * Example (L893):
 * - [x] F1. **Plan Compliance Audit** — `oracle` <!-- ... -->
 * 
 * id: "F1", "F2", "F3", "F4"
 * checked: [x] = true, [ ] = false
 * title: "Plan Compliance Audit"
 * category: "oracle", "unspecified-high", etc. (PLAIN STRING, NOT ENUM)
 * description: body text (L894-895)
 * output: optional summary output format (L895)
 * stateComment: optional trailing comment like "<!-- APPROVE (user okay ...) -->"
 */
export interface FinalTask {
  id: string;
  checked: boolean;
  title: string;
  category?: string;
  description: string;
  output?: string;
  stateComment?: string;
}

/**
 * Parse warning or error.
 * 
 * line: optional line number in source markdown
 * message: diagnostic message
 */
export interface ParseWarning {
  line?: number;
  message: string;
}
