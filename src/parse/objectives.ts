import type { Objectives, NamedSection, ParseWarning } from "../model";
import type { RawSection } from "./core";
import { normalizeHeading } from "./core";

export interface ObjectivesResult {
  objectives: Objectives;
  warnings: ParseWarning[];
}

interface H3Group {
  heading: string;
  normalized: string;
  lines: string[];
}

function stripListItem(line: string): string | null {
  const m = /^[ \t]*[-*][ \t]+(.*)$/.exec(line);
  if (!m) return null;
  return m[1]!.trim();
}

function listItemsOf(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const item = stripListItem(line);
    if (item !== null && item !== "") out.push(item);
  }
  return out;
}

function trimTrailingBlanks(lines: string[]): string[] {
  const copy = [...lines];
  while (copy.length > 0 && copy[copy.length - 1]!.trim() === "") copy.pop();
  return copy;
}

export function parseObjectives(section: RawSection): ObjectivesResult {
  const warnings: ParseWarning[] = [];
  const groups: H3Group[] = [];
  let current: H3Group | null = null;

  for (const line of section.lines) {
    if (line.startsWith("### ")) {
      const heading = line.slice(4).trim();
      current = { heading, normalized: normalizeHeading(line), lines: [] };
      groups.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  let mustHave: string[] = [];
  let mustNot: string[] = [];
  const other: NamedSection[] = [];

  for (const g of groups) {
    const content = trimTrailingBlanks(g.lines);
    if (g.normalized === "must have") {
      mustHave = listItemsOf(content);
    } else if (g.normalized === "must not have") {
      mustNot = listItemsOf(content);
    } else {
      other.push({ heading: g.heading, lines: content });
    }
  }

  return { objectives: { mustHave, mustNot, other }, warnings };
}
