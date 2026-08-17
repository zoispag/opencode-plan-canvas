import type { FinalTask, ParseWarning, Task, Wave, WaveEntry } from "../model";
import type { RawSection } from "./core";
import { scanLines } from "./core";

/**
 * Normalize a wave-entry or task id so that the ASCII-tree conventions (`T1`,
 * `F1`, `T8b`) and the verbose `Task N` convention reconcile with the
 * numbered-task convention (`1`, `8b`).
 *
 * Rules:
 * - A `T`/`F` prefix immediately followed by digits and an optional single
 *   trailing lowercase letter (e.g. `T1`, `F3`, `T8b`) normalizes to the part
 *   AFTER the prefix (`T1`→`1`, `F1`→`1`, `T8b`→`8b`).
 * - A verbose `Task N` id — the literal word `Task` (case-insensitive),
 *   one-or-more spaces, then digits and an optional trailing lowercase letter
 *   (e.g. `Task 1`, `Task 8b`, `task 3`) — normalizes to just that trailing
 *   number (`Task 1`→`1`, `Task 8b`→`8b`, `task 3`→`3`). This lets plans that
 *   write wave entries as `├── Task 1: …` reconcile with a numbered TODO `1`.
 * - Any other id — a bare number (`1`), a hyphenated id (`T-WIDGET-CORE`), or a
 *   bare `T` with no digits — is returned unchanged.
 *
 * Exported so the renderer (`src/render/waves.ts`) shares the exact same
 * matching logic and the two modules cannot drift.
 */
const NORMALIZE_RE = /^([TF])(\d+[a-z]?)$/;
const TASK_ID_RE = /^Task\s+(F?)(\d+[a-z]?)$/i;
export function normalizeEntryId(id: string): string {
  const taskMatch = TASK_ID_RE.exec(id);
  if (taskMatch) {
    const prefix = taskMatch[1]!.toUpperCase();
    return `${prefix}${taskMatch[2]!}`;
  }
  const m = NORMALIZE_RE.exec(id);
  return m ? m[2]! : id;
}

// Like normalizeEntryId but PRESERVES a leading F (F1 stays "F1", not "1"). Used
// for dependency ids so a `depends: F1` reference targets final entry F1 and does
// not silently collide with numbered entry `1` (normalizeEntryId strips the F).
const DEP_FINAL_RE = /^([Ff])(\d+[a-z]?)$/;
const DEP_TASK_FINAL_RE = /^Task\s+([Ff])(\d+[a-z]?)$/i;
export function depKey(token: string): string {
  const t = token.trim();
  const taskFinal = DEP_TASK_FINAL_RE.exec(t);
  if (taskFinal) return `F${taskFinal[2]!}`;
  const final = DEP_FINAL_RE.exec(t);
  if (final) return `F${final[2]!}`;
  return normalizeEntryId(t);
}

export function buildTaskLookup(tasks: Task[]): Map<string, Task> {
  const lookup = new Map<string, Task>();
  for (const t of tasks) {
    if (!lookup.has(t.id)) lookup.set(t.id, t);
  }
  for (const t of tasks) {
    const key = normalizeEntryId(t.id);
    if (!lookup.has(key)) lookup.set(key, t);
  }
  return lookup;
}

export function finalAnchorId(id: string): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `final-${slug}`;
}

const FINAL_ID_RE = /^F\d+[a-z]?$/;
export function isFinalEntry(entry: WaveEntry, finalIds: Set<string>): boolean {
  return resolveFinalId(entry, finalIds) !== undefined;
}

// The F-id (e.g. "F1") a wave entry maps to, or undefined if it is not a final
// entry. Both `F1` and the verbose `Task F1` forms resolve to `F1`.
export function resolveFinalId(
  entry: WaveEntry,
  finalIds: Set<string>,
): string | undefined {
  if (FINAL_ID_RE.test(entry.id) && finalIds.has(entry.id)) return entry.id;
  const normalized = normalizeEntryId(entry.id);
  if (FINAL_ID_RE.test(normalized) && finalIds.has(normalized)) return normalized;
  return undefined;
}

// A Final Verification Wave entry (F1..Fn) belongs to `finalTasks`, never the
// TODO `tasks` list. It must be excluded from task matching FIRST, otherwise its
// normalized key (F1→1) would collide with numbered task `1` and steal its body.
export function matchEntryToTask(
  entry: WaveEntry,
  lookup: Map<string, Task>,
  finalIds?: Set<string>,
): Task | undefined {
  if (finalIds && isFinalEntry(entry, finalIds)) return undefined;
  return lookup.get(entry.id) ?? lookup.get(normalizeEntryId(entry.id));
}

export interface ParseWavesResult {
  waves: Wave[];
  criticalPath?: string;
  warnings: ParseWarning[];
}

export interface ReconcileResult {
  pairs: Map<string, Task>;
  entriesWithoutTasks: ParseWarning[];
  tasksWithoutEntries: ParseWarning[];
}

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
const WAVE_HEADER_RE = /^Wave\b(.*):\s*$/;
const GLYPH_RE = /^[\s│]*(?:├──|└──)?\s*/;
const ENTRY_RE = /^(Task\s+F?\d+[a-z]?|[A-Za-z0-9][A-Za-z0-9-]*):\s*(.*)$/i;
const CHECKBOX_RE = /^\[( |x|X)\]\s*(.*)$/;
const TRAILING_NOTE_RE = /\s*\(([^()]*)\)\s*$/;
const TRAILING_CATEGORY_RE = /\s*\[([A-Za-z][A-Za-z0-9-]*)\]\s*$/;
const CRITICAL_PATH_RE = /^Critical Path:\s*(.*)$/i;
const DEPENDS_RE = /^depends\s*:\s*(.*)$/i;
const DEP_TOKEN_RE = /^(Task\s+)?(F?\d+[a-z]?|T-?[A-Za-z0-9][A-Za-z0-9-]*)$/i;

// Parse a "depends: 1, 9" note body into normalized dependency ids. Ids are
// comma / + / & / whitespace separated; scanning STOPS at the first non-id token
// so trailing prose ("8 for /api/status field" -> ["8"]) is discarded. Ids keep
// a leading F via depKey so final references don't collide with numbered ids.
function extractDepends(noteBody: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of noteBody.split(/[\s,+&]+/)) {
    if (tok === "") continue;
    if (!DEP_TOKEN_RE.test(tok)) break;
    const key = depKey(tok);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function stripWaveAnnotations(s: string): string {
  return s.replace(/\s*[—-]\s*✅.*$/u, "").trim();
}

function parseWaveHeader(line: string): { name: string; description?: string } | null {
  const match = WAVE_HEADER_RE.exec(line);
  if (!match) return null;
  const rest = stripWaveAnnotations(match[1]!);

  const parenIndex = rest.indexOf("(");
  if (parenIndex >= 0) {
    const name = `Wave ${rest.slice(0, parenIndex).trim()}`.trim();
    const close = rest.indexOf(")", parenIndex);
    const description =
      close > parenIndex ? rest.slice(parenIndex + 1, close).trim() : undefined;
    const wave: { name: string; description?: string } = { name };
    if (description !== undefined && description.length > 0) wave.description = description;
    return wave;
  }

  return { name: `Wave ${rest.trim()}`.trim() };
}

export function parseEntry(rawLine: string): WaveEntry | null {
  const stripped = rawLine.replace(GLYPH_RE, "");
  const entryMatch = ENTRY_RE.exec(stripped);
  if (!entryMatch) return null;

  const id = entryMatch[1]!;
  let remainder = entryMatch[2]!;
  let checked = false;

  const checkboxMatch = CHECKBOX_RE.exec(remainder);
  if (checkboxMatch) {
    checked = checkboxMatch[1] !== " ";
    remainder = checkboxMatch[2]!;
  }

  let title = remainder.trim();

  let category: string | undefined;
  const categoryMatch = TRAILING_CATEGORY_RE.exec(title);
  if (categoryMatch) {
    category = categoryMatch[1]!.trim();
    title = title.slice(0, categoryMatch.index).trim();
  }

  let note: string | undefined;
  let needs: string[] = [];
  const noteMatch = TRAILING_NOTE_RE.exec(title);
  if (noteMatch) {
    const body = noteMatch[1]!.trim();
    title = title.slice(0, noteMatch.index).trim();
    const dependsMatch = DEPENDS_RE.exec(body);
    if (dependsMatch) {
      needs = extractDepends(dependsMatch[1]!);
    } else {
      note = body;
    }
  }

  const entry: WaveEntry = { id, checked, title, needs, blocks: [] };
  if (note !== undefined && note.length > 0) entry.note = note;
  if (category !== undefined && category.length > 0) entry.category = category;
  return entry;
}

function findFenceRange(lines: string[]): { start: number; end: number } | null {
  const scanned = scanLines(lines.join("\n"));
  let openIndex = -1;
  for (const { line, index, inFence } of scanned) {
    if (inFence && FENCE_RE.test(line)) {
      if (openIndex === -1) {
        openIndex = index;
      } else {
        return { start: openIndex, end: index };
      }
    }
  }
  return null;
}

export function parseWaves(section: RawSection): ParseWavesResult {
  const warnings: ParseWarning[] = [];
  const lines = section.lines;

  const range = findFenceRange(lines);
  if (range === null) {
    warnings.push({
      line: section.startLine,
      message: `No fenced Parallel Execution Waves block found in "${section.heading.trim()}"`,
    });
    return { waves: [], warnings };
  }

  const inner = lines.slice(range.start + 1, range.end);

  const waves: Wave[] = [];
  let criticalPath: string | undefined;
  let current: Wave | null = null;

  for (const rawLine of inner) {
    if (rawLine.trim() === "") continue;

    const criticalMatch = CRITICAL_PATH_RE.exec(rawLine.trim());
    if (criticalMatch && current === null) {
      const value = criticalMatch[1]!.trim();
      if (value.length > 0) criticalPath = value;
      continue;
    }

    const header = parseWaveHeader(rawLine);
    if (header) {
      current = { name: header.name, entries: [] };
      if (header.description !== undefined) current.description = header.description;
      waves.push(current);
      continue;
    }

    if (current === null) continue;

    const entry = parseEntry(rawLine);
    if (entry) {
      current.entries.push(entry);
    }
  }

  deriveWaveBlocks(waves);

  const result: ParseWavesResult = { waves, warnings };
  if (criticalPath !== undefined) result.criticalPath = criticalPath;
  return result;
}

// Populate each entry's `blocks` (reverse edges) from every entry's `needs`: if X
// needs Y, then Y blocks X. Entries are keyed by depKey (final-aware) with first
// wins; iteration follows wave/entry source order so output stays deterministic.
export function deriveWaveBlocks(waves: Wave[]): void {
  const byKey = new Map<string, WaveEntry>();
  for (const wave of waves) {
    for (const entry of wave.entries) {
      const key = depKey(entry.id);
      if (!byKey.has(key)) byKey.set(key, entry);
    }
  }
  for (const wave of waves) {
    for (const entry of wave.entries) {
      const selfKey = depKey(entry.id);
      for (const need of entry.needs) {
        const target = byKey.get(need);
        if (target && !target.blocks.includes(selfKey)) target.blocks.push(selfKey);
      }
    }
  }
}

export function reconcile(
  waves: Wave[],
  tasks: Task[],
  finalTasks: FinalTask[] = [],
): ReconcileResult {
  const lookup = buildTaskLookup(tasks);
  const finalIds = new Set<string>();
  for (const f of finalTasks) finalIds.add(f.id);

  const pairs = new Map<string, Task>();
  const entriesWithoutTasks: ParseWarning[] = [];
  const pairedTasks = new Set<Task>();

  for (const wave of waves) {
    for (const entry of wave.entries) {
      const task = matchEntryToTask(entry, lookup, finalIds);
      if (task) {
        if (!pairs.has(entry.id)) pairs.set(entry.id, task);
        pairedTasks.add(task);
      } else if (!isFinalEntry(entry, finalIds)) {
        entriesWithoutTasks.push({
          message: `Wave "${wave.name}" entry ${entry.id} has no matching task`,
        });
      }
    }
  }

  const tasksWithoutEntries: ParseWarning[] = [];
  for (const t of tasks) {
    if (!pairedTasks.has(t)) {
      tasksWithoutEntries.push({
        message: `Task ${t.id} is not present in any wave; placed under "Unassigned"`,
      });
    }
  }

  return { pairs, entriesWithoutTasks, tasksWithoutEntries };
}
