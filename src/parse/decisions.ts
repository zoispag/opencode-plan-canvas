import type { Decision, ParseWarning } from "../model";
import type { RawSection } from "./core";

export interface DecisionsResult {
  decisions: Decision[];
  warnings: ParseWarning[];
}

type Status = "resolved" | "open" | "default";

const LIST_RE = /^[ \t]*[-*][ \t]+\*\*(.+?)\*\*:[ \t]?(.*)$/;
const PARA_RE = /^\*\*(.+?)\*\*:?[ \t]?(.*)$/;
const TRAILING_PAREN_RE = /\s*\(([^()]*)\)\s*$/;

function mapStatus(statusText: string): { status: Status; warn: boolean } {
  const t = statusText.trim();
  if (/^RESOLVED\b/i.test(t)) return { status: "resolved", warn: false };
  if (/^OPEN\b/i.test(t)) return { status: "open", warn: false };
  if (/default/i.test(t)) return { status: "default", warn: false };
  return { status: "open", warn: true };
}

function makeDecision(
  name: string,
  statusText: string,
  body: string,
  hadParenthetical: boolean,
  lineNo: number,
  warnings: ParseWarning[],
): Decision {
  if (!hadParenthetical) {
    warnings.push({
      line: lineNo,
      message: `Decision "${name}" has no (status); defaulting to open`,
    });
    return { name, status: "open", statusText: "", body };
  }
  const { status, warn } = mapStatus(statusText);
  if (warn) {
    warnings.push({
      line: lineNo,
      message: `Decision "${name}" has unrecognized status "${statusText}"; defaulting to open`,
    });
  }
  return { name, status, statusText, body };
}

export function parseDecisions(section: RawSection): DecisionsResult {
  const decisions: Decision[] = [];
  const warnings: ParseWarning[] = [];
  const base = section.startLine + 1;

  for (let i = 0; i < section.lines.length; i++) {
    const raw = section.lines[i]!;
    const lineNo = base + i;

    const list = LIST_RE.exec(raw);
    if (list) {
      const inner = list[1]!.trim();
      const body = list[2]!.trim();
      const pm = TRAILING_PAREN_RE.exec(inner);
      if (pm) {
        const statusText = pm[1]!.trim();
        decisions.push(
          makeDecision(inner, statusText, body, true, lineNo, warnings),
        );
      } else {
        decisions.push(
          makeDecision(inner, "", body, false, lineNo, warnings),
        );
      }
      continue;
    }

    const para = PARA_RE.exec(raw);
    if (para) {
      const inner = para[1]!.trim();
      const rest = para[2]!.trim();
      const { status, warn } = mapStatus(inner);
      if (warn) {
        warnings.push({
          line: lineNo,
          message: `Decision paragraph "${inner}" has unrecognized status; defaulting to open`,
        });
      }
      decisions.push({ name: inner, status, statusText: inner, body: rest });
      continue;
    }
  }

  return { decisions, warnings };
}
