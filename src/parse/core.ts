import type { ParseWarning } from "../model";

export interface ScannedLine {
  line: string;
  index: number;
  inFence: boolean;
}

export interface RawSection {
  heading: string;
  normalized: string;
  level: 2 | 3;
  lines: string[];
  startLine: number;
}

export interface SplitResult {
  title: string;
  sections: RawSection[];
  warnings: ParseWarning[];
}

const BOM = "\uFEFF";

export function normalizeSource(s: string): string {
  const withoutBom = s.startsWith(BOM) ? s.slice(BOM.length) : s;
  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

type FenceKind = "`" | "~" | null;

function fenceKindOf(line: string): Exclude<FenceKind, null> | null {
  const t = line.trim();
  if (/^`{3,}/.test(t)) return "`";
  if (/^~{3,}/.test(t)) return "~";
  return null;
}

export function scanLines(source: string): ScannedLine[] {
  const lines = source.split("\n");
  const out: ScannedLine[] = [];
  let openFence: FenceKind = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const kind = fenceKindOf(line);
    if (openFence === null) {
      const inFence = kind !== null;
      out.push({ line, index, inFence });
      if (kind !== null) openFence = kind;
    } else {
      out.push({ line, index, inFence: true });
      if (kind === openFence) openFence = null;
    }
  }
  return out;
}

export function normalizeHeading(s: string): string {
  let h = s.replace(/^#+/, "").trim();
  h = h.replace(/\s*\([^)]*\)\s*$/, "");
  return h.trim().toLowerCase();
}

export function matchSection(heading: string, key: string): boolean {
  const h = normalizeHeading(heading);
  const k = normalizeHeading(key);
  return h === k || h.startsWith(k);
}

function headingLevel(line: string): 2 | 3 | null {
  if (line.startsWith("### ")) return 3;
  if (line.startsWith("## ")) return 2;
  return null;
}

export function splitSections(source: string): SplitResult {
  const scanned = scanLines(source);
  const warnings: ParseWarning[] = [];

  let title = "";
  let titleFound = false;
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let sawContentBeforeTitle = false;

  for (const { line, index, inFence } of scanned) {
    if (!inFence && !titleFound && line.startsWith("# ") && !line.startsWith("## ")) {
      title = line.slice(2).trim();
      titleFound = true;
      continue;
    }

    const level = inFence ? null : headingLevel(line);
    if (level !== null) {
      current = {
        heading: line,
        normalized: normalizeHeading(line),
        level,
        lines: [],
        startLine: index,
      };
      sections.push(current);
      continue;
    }

    if (current) {
      current.lines.push(line);
    } else if (!titleFound && line.trim() !== "") {
      sawContentBeforeTitle = true;
    }
  }

  if (sawContentBeforeTitle) {
    warnings.push({ line: 0, message: "content found before the H1 title" });
  }

  return { title, sections, warnings };
}
