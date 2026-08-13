import type { FinalTask, ParseWarning } from "../model";
import type { RawSection } from "./core";

export interface FinalResult {
  finalTasks: FinalTask[];
  warnings: ParseWarning[];
}

const F_LINE_RE =
  /^[ \t]*[-*][ \t]+\[([ xX])\][ \t]+(F[A-Za-z0-9-]*)\.[ \t]+\*\*(.+?)\*\*[ \t]*(.*)$/;
const CATEGORY_RE = /^[—-][ \t]*`([^`]+)`/;
const COMMENT_RE = /<!--([\s\S]*?)-->/;
const OUTPUT_RE = /^[ \t]*Output:[ \t]*(.*)$/;

function stripBackticks(s: string): string {
  let out = s.trim();
  if (out.startsWith("`") && out.endsWith("`") && out.length >= 2) {
    out = out.slice(1, -1);
  }
  return out.trim();
}

function parseMeta(rest: string): {
  category?: string;
  stateComment?: string;
} {
  let category: string | undefined;
  let stateComment: string | undefined;

  const trimmed = rest.trim();
  const cat = CATEGORY_RE.exec(trimmed);
  if (cat) category = cat[1]!.trim();

  const comment = COMMENT_RE.exec(rest);
  if (comment) stateComment = comment[1]!.trim();

  return { category, stateComment };
}

export function parseFinal(section: RawSection): FinalResult {
  const finalTasks: FinalTask[] = [];
  const warnings: ParseWarning[] = [];

  interface Acc {
    task: FinalTask;
    descLines: string[];
  }
  let current: Acc | null = null;

  const flush = () => {
    if (!current) return;
    const desc = current.descLines.join("\n").trim();
    current.task.description = desc;
    finalTasks.push(current.task);
    current = null;
  };

  for (const raw of section.lines) {
    const m = F_LINE_RE.exec(raw);
    if (m) {
      flush();
      const checked = m[1] === "x" || m[1] === "X";
      const id = m[2]!;
      const title = m[3]!.trim();
      const { category, stateComment } = parseMeta(m[4]!);
      const task: FinalTask = {
        id,
        checked,
        title,
        description: "",
      };
      if (category !== undefined) task.category = category;
      if (stateComment !== undefined) task.stateComment = stateComment;
      current = { task, descLines: [] };
      continue;
    }

    if (!current) continue;

    const out = OUTPUT_RE.exec(raw);
    if (out) {
      current.task.output = stripBackticks(out[1]!);
      continue;
    }

    current.descLines.push(raw);
  }

  flush();
  return { finalTasks, warnings };
}
