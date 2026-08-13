import type { ParseWarning, Task, TaskField, TaskState } from "../model";
import type { RawSection } from "./core";
import { scanLines } from "./core";

export interface TasksResult {
  tasks: Task[];
  warnings: ParseWarning[];
}

const TASK_LINE_RE = /^- \[( |x|X)\] ([A-Za-z0-9][A-Za-z0-9-]*)\.[ \t]+(.*)$/;
const CANDIDATE_LINE_RE = /^- \[[ xX]\][ \t]/;
const FIELD_LABEL_RE = /^[ \t]*\*\*(.+?)\*\*:[ \t]?(.*)$/;
const COMMENT_RE = /<!--([\s\S]*?)-->/;
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
const CHECKLIST_ITEM_RE = /^[ \t]*- \[[ xX]\]/;

interface FieldAccumulator {
  label: string;
  lines: string[];
}

function splitTitleAndComment(rest: string): { title: string; comment?: string } {
  const match = COMMENT_RE.exec(rest);
  if (!match) {
    return { title: rest.trim() };
  }
  const title = rest.slice(0, match.index).trim();
  const comment = match[1]!.trim();
  return { title, comment };
}

function deriveState(checked: boolean, comment: string | undefined): TaskState {
  const state: TaskState = {};

  if (comment) {
    const upper = comment.toUpperCase();
    if (upper.includes("MERGED")) {
      state.badge = "merged";
    } else if (upper.includes("DEFERRED")) {
      state.badge = "deferred";
    } else if (upper.includes("VERIFICATION-ONLY") || upper.includes("VERIFIED")) {
      state.badge = "verified";
    } else if (upper.includes("REVIEW_REQUIRED")) {
      state.badge = "review";
    } else if (upper.includes("DONE") || upper.includes("SHIPPED")) {
      state.badge = "shipped";
    }

    const ref = extractRef(comment);
    if (ref !== undefined) state.ref = ref;
  }

  if (state.badge === undefined && checked) {
    state.badge = "shipped";
  }

  return state;
}

function extractRef(comment: string): string | undefined {
  const pr = /#(\d+)/.exec(comment);
  if (pr) return `PR #${pr[1]}`;
  const sha = /\b([0-9a-fA-F]{7,40})\b/.exec(comment);
  if (sha) return sha[1]!;
  return undefined;
}

function stripFenceMarkers(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (FENCE_RE.test(line)) continue;
    out.push(line);
  }
  return out;
}

function dedent(lines: string[]): string {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const lead = line.length - line.replace(/^[ \t]+/, "").length;
    if (lead < min) min = lead;
  }
  if (!Number.isFinite(min) || min === 0) {
    return lines.join("\n").replace(/^\n+|\n+$/g, "");
  }
  return lines.map((l) => (l.trim() === "" ? "" : l.slice(min))).join("\n").replace(/^\n+|\n+$/g, "");
}

function classifyField(bodyLines: string[]): { kind: TaskField["kind"]; content: string } {
  const hasFence = bodyLines.some((l) => FENCE_RE.test(l));
  if (hasFence) {
    const inner = stripFenceMarkers(bodyLines);
    return { kind: "fenced", content: dedent(inner) };
  }

  const nonBlank = bodyLines.filter((l) => l.trim() !== "");
  if (nonBlank.length > 0) {
    const checklistCount = nonBlank.filter((l) => CHECKLIST_ITEM_RE.test(l)).length;
    if (checklistCount * 2 >= nonBlank.length) {
      return { kind: "checklist", content: dedent(bodyLines) };
    }
  }

  return { kind: "text", content: dedent(bodyLines) };
}

function buildFields(bodyLines: string[]): TaskField[] {
  const fields: TaskField[] = [];
  const scanned = scanLines(bodyLines.join("\n"));

  let current: FieldAccumulator | null = null;

  const flush = () => {
    if (current === null) return;
    const { kind, content } = classifyField(current.lines);
    fields.push({ label: current.label, content, kind });
    current = null;
  };

  for (const { line, inFence } of scanned) {
    if (!inFence) {
      const labelMatch = FIELD_LABEL_RE.exec(line);
      if (labelMatch) {
        flush();
        current = { label: labelMatch[1]!.trim(), lines: [] };
        const inline = labelMatch[2]!;
        if (inline.trim() !== "") current.lines.push(inline);
        continue;
      }
    }
    if (current !== null) {
      current.lines.push(line);
    }
  }

  flush();
  return fields;
}

export function parseTasks(section: RawSection): TasksResult {
  const tasks: Task[] = [];
  const warnings: ParseWarning[] = [];

  const scanned = scanLines(section.lines.join("\n"));

  interface Pending {
    id: string;
    checked: boolean;
    title: string;
    stateComment?: string;
    bodyLines: string[];
  }

  let pending: Pending | null = null;

  const flush = () => {
    if (pending === null) return;
    const state = deriveState(pending.checked, pending.stateComment);
    const task: Task = {
      id: pending.id,
      checked: pending.checked,
      title: pending.title,
      state,
      fields: buildFields(pending.bodyLines),
    };
    if (pending.stateComment !== undefined) task.stateComment = pending.stateComment;
    tasks.push(task);
    pending = null;
  };

  for (const { line, index, inFence } of scanned) {
    if (!inFence && CANDIDATE_LINE_RE.test(line)) {
      const match = TASK_LINE_RE.exec(line);
      if (match) {
        flush();
        const checked = match[1] !== " ";
        const { title, comment } = splitTitleAndComment(match[3]!);
        pending = {
          id: match[2]!,
          checked,
          title,
          bodyLines: [],
        };
        if (comment !== undefined) pending.stateComment = comment;
        continue;
      }

      flush();
      warnings.push({
        line: section.startLine + index + 1,
        message: `Skipped malformed task line (missing "<id>." prefix): ${line.trim()}`,
      });
      continue;
    }

    if (pending !== null) {
      pending.bodyLines.push(line);
    }
  }

  flush();
  return { tasks, warnings };
}
