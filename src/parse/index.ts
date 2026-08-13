import type { Plan, ParseWarning } from "../model";
import type { RawSection } from "./core";
import { normalizeSource, splitSections, matchSection } from "./core";
import { parseTldr } from "./tldr";
import { parseTasks } from "./tasks";
import { parseWaves } from "./waves";
import { parseObjectives } from "./objectives";
import { parseDecisions } from "./decisions";
import { parseFinal } from "./final";

function emptyPlan(title: string): Plan {
  return {
    title,
    tldr: [],
    objectives: { mustHave: [], mustNot: [], other: [] },
    waves: [],
    decisions: [],
    tasks: [],
    finalTasks: [],
    warnings: [],
  };
}

const KNOWN_KEYS = [
  "tl;dr",
  "context",
  "work objectives",
  "verification strategy",
  "execution strategy",
  "decisions needed / defaults applied",
  "todos",
  "final verification wave",
  "commit strategy",
  "success criteria",
] as const;

function isKnownSection(section: RawSection): boolean {
  if (section.level !== 2) return true;
  return KNOWN_KEYS.some((key) => matchSection(section.heading, key));
}

function reconstructObjectivesBody(
  sections: RawSection[],
  h2Index: number,
): RawSection {
  const h2 = sections[h2Index]!;
  const lines: string[] = [...h2.lines];
  for (let j = h2Index + 1; j < sections.length; j++) {
    const next = sections[j]!;
    if (next.level === 2) break;
    lines.push(next.heading);
    for (const line of next.lines) lines.push(line);
  }
  return {
    heading: h2.heading,
    normalized: h2.normalized,
    level: h2.level,
    lines,
    startLine: h2.startLine,
  };
}

function findTldrValue(
  tldr: Plan["tldr"],
  label: string,
): string | undefined {
  const entry = tldr.find((e) => e.label === label);
  if (!entry) return undefined;
  const value = entry.value.trim();
  return value.length > 0 ? value : undefined;
}

export function parsePlan(source: string): Plan {
  const normalized = normalizeSource(source);
  const split = splitSections(normalized);
  const plan = emptyPlan(split.title);
  const warnings: ParseWarning[] = [...split.warnings];

  const sections = split.sections;

  let wavesCriticalPath: string | undefined;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;

    if (matchSection(section.heading, "tl;dr") && section.level === 2) {
      const result = parseTldr(section);
      plan.tldr = result.entries;
      warnings.push(...result.warnings);
      continue;
    }

    if (matchSection(section.heading, "todos") && section.level === 2) {
      const result = parseTasks(section);
      plan.tasks = result.tasks;
      warnings.push(...result.warnings);
      continue;
    }

    if (matchSection(section.heading, "work objectives") && section.level === 2) {
      const body = reconstructObjectivesBody(sections, i);
      const result = parseObjectives(body);
      plan.objectives = result.objectives;
      warnings.push(...result.warnings);
      continue;
    }

    if (
      matchSection(section.heading, "decisions needed / defaults applied") &&
      section.level === 2
    ) {
      const result = parseDecisions(section);
      plan.decisions = result.decisions;
      warnings.push(...result.warnings);
      continue;
    }

    if (
      matchSection(section.heading, "final verification wave") &&
      section.level === 2
    ) {
      const result = parseFinal(section);
      plan.finalTasks = result.finalTasks;
      warnings.push(...result.warnings);
      continue;
    }

    if (
      matchSection(section.heading, "parallel execution waves") &&
      section.level === 3
    ) {
      const result = parseWaves(section);
      plan.waves = result.waves;
      if (result.criticalPath !== undefined) wavesCriticalPath = result.criticalPath;
      warnings.push(...result.warnings);
      continue;
    }

    if (
      matchSection(section.heading, "verification strategy") &&
      section.level === 2
    ) {
      const lines = section.lines
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length > 0) plan.verificationRaw = lines.join("\n");
      continue;
    }

    if (!isKnownSection(section)) {
      warnings.push({
        line: section.startLine,
        message: `Unknown section "${section.heading.trim()}" ignored`,
      });
    }
  }

  const tldrCriticalPath = findTldrValue(plan.tldr, "Critical Path");
  const criticalPath = tldrCriticalPath ?? wavesCriticalPath;
  if (criticalPath !== undefined) plan.criticalPath = criticalPath;

  plan.warnings = warnings;
  return plan;
}
