import type { ParseWarning, TldrEntry } from "../model";
import type { RawSection } from "./core";

export interface TldrResult {
  entries: TldrEntry[];
  warnings: ParseWarning[];
}

const LABEL_RE = /^\*\*(.+?)\*\*:\s?(.*)$/;

function blockquoteContent(line: string): string | null {
  if (!line.startsWith(">")) return null;
  const rest = line.slice(1);
  return rest.startsWith(" ") ? rest.slice(1) : rest;
}

export function parseTldr(section: RawSection): TldrResult {
  const entries: TldrEntry[] = [];
  const warnings: ParseWarning[] = [];

  let currentLabel: string | null = null;
  let acc: string[] = [];
  let sawLabel = false;

  const flush = () => {
    if (currentLabel === null) return;
    entries.push({ label: currentLabel, value: acc.join("\n").trim() });
    currentLabel = null;
    acc = [];
  };

  for (let i = 0; i < section.lines.length; i++) {
    const raw = section.lines[i]!;
    const content = blockquoteContent(raw);

    if (content === null) {
      flush();
      continue;
    }

    const m = content.match(LABEL_RE);
    if (m) {
      flush();
      currentLabel = m[1]!;
      sawLabel = true;
      acc = [m[2]!];
      continue;
    }

    if (currentLabel !== null) {
      acc.push(content);
      continue;
    }

    if (content.trim() !== "") {
      warnings.push({
        line: section.startLine + 1 + i,
        message: `TL;DR blockquote line before any label, skipped: ${content.trim()}`,
      });
    }
  }

  flush();

  if (!sawLabel && entries.length === 0) {
    const hadBlockquote = section.lines.some(
      (l) => blockquoteContent(l) !== null && blockquoteContent(l)!.trim() !== "",
    );
    if (hadBlockquote && warnings.length === 0) {
      warnings.push({
        line: section.startLine + 1,
        message: "TL;DR section has no bold-label entries",
      });
    }
  }

  return { entries, warnings };
}
