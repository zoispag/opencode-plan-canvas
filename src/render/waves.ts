import type { Plan, Task, Wave, WaveEntry, TaskField, ParseWarning } from "../model";
import { escapeHtml, renderInline } from "../text";
import {
  buildTaskLookup,
  finalAnchorId,
  matchEntryToTask,
  resolveFinalId,
} from "../parse/waves";

const WAVE_COLORS = ["w1", "w2", "w3", "w4", "wf"] as const;

const KNOWN_CATEGORIES = new Set([
  "deep",
  "ultrabrain",
  "quick",
  "unspecified-high",
  "writing",
  "oracle",
]);

export function categoryClass(category: string): string {
  return KNOWN_CATEGORIES.has(category) ? `cat ${category}` : "cat other";
}

export interface RenderResult {
  html: string;
  warnings: ParseWarning[];
}

interface RenderContext {
  tasksById: Map<string, Task>;
  finalIds: Set<string>;
  paired: Set<Task>;
  warnings: ParseWarning[];
}

function isFinalWave(wave: Wave): boolean {
  return /final/i.test(wave.name);
}

function allChecked(wave: Wave): boolean {
  return wave.entries.length > 0 && wave.entries.every((e) => e.checked);
}

function countDone(wave: Wave): number {
  let n = 0;
  for (const e of wave.entries) {
    if (e.checked) n++;
  }
  return n;
}

function countBadge(wave: Wave): string {
  const done = countDone(wave);
  if (done > 0) return `${done} done`;
  return `${wave.entries.length} tasks`;
}

function renderChecklist(content: string): string {
  const items: string[] = [];
  for (const raw of content.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const checked = /^\[x\]/i.test(trimmed);
    const rest = trimmed.replace(/^\[[ xX]\]\s*/, "");
    const marker = checked ? "\u2713" : "\u2610";
    items.push(`<li>${marker} ${renderInline(rest)}</li>`);
  }
  return `<ul class="clean">${items.join("")}</ul>`;
}

function renderField(field: TaskField): string {
  const label = escapeHtml(field.label);
  if (field.kind === "fenced") {
    return `<div><div class="lbl">${label}</div><pre class="qa">${escapeHtml(
      field.content,
    )}</pre></div>`;
  }
  if (field.kind === "checklist") {
    return `<div><div class="lbl">${label}</div>${renderChecklist(
      field.content,
    )}</div>`;
  }
  return `<div><div class="lbl">${label}</div><div class="box">${renderInline(
    field.content,
  )}</div></div>`;
}

function renderMeta(entry: WaveEntry, task: Task | undefined): string {
  const parts: string[] = [];
  if (entry.category) {
    parts.push(
      `<span class="${categoryClass(entry.category)}">${escapeHtml(entry.category)}</span>`,
    );
  }
  if (task && task.state.badge) {
    parts.push(`<span class="badge ${task.state.badge}">${task.state.badge}</span>`);
  }
  if (task && task.state.ref) {
    parts.push(`<span class="dep muted">${renderInline(task.state.ref)}</span>`);
  }
  if (parts.length === 0) return "";
  return `<div class="tmeta">${parts.join("")}</div>`;
}

function renderCard(
  entry: WaveEntry,
  task: Task | undefined,
  finalHref?: string,
): string {
  const cls = entry.checked ? "tcard shipped" : "tcard";
  const tid = entry.checked ? `\u2713 ${entry.id}` : entry.id;
  const meta = renderMeta(entry, task);
  const titleHtml = renderInline(entry.title);
  const title = finalHref
    ? `<a class="tlink" href="${escapeHtml(finalHref)}">${titleHtml}</a>`
    : titleHtml;
  const row =
    `<div class="trow"><span class="tid">${escapeHtml(tid)}</span>` +
    `<span class="ttitle">${title}</span></div>` +
    (meta ? `\n${meta}` : "");

  const fields = task ? task.fields : [];
  if (fields.length === 0) {
    // No body content: render a non-interactive static row rather than an empty
    // <details> that would show a disclosure triangle and expand to nothing.
    const linkCls = finalHref ? `${cls} tcard-linked` : cls;
    return `<div class="${linkCls}">\n${row}\n</div>`;
  }
  const body = fields.map(renderField).join("");
  return (
    `<details class="${cls}"><summary>\n${row}\n</summary>` +
    `\n<div class="tbody">${body}</div></details>`
  );
}

function renderWaveColumn(wave: Wave, color: string, ctx: RenderContext): string {
  const classes = ["wave", color];
  if (allChecked(wave)) classes.push("done");

  const cards: string[] = [];
  for (const entry of wave.entries) {
    const task = matchEntryToTask(entry, ctx.tasksById, ctx.finalIds);
    let finalHref: string | undefined;
    if (task) {
      ctx.paired.add(task);
    } else {
      const finalId = resolveFinalId(entry, ctx.finalIds);
      if (finalId) {
        finalHref = `#${finalAnchorId(finalId)}`;
      } else {
        ctx.warnings.push({
          message: `Wave "${wave.name}" entry ${entry.id} has no matching task`,
        });
      }
    }
    cards.push(renderCard(entry, task, finalHref));
  }

  return (
    `<div class="${classes.join(" ")}">` +
    `<div class="whead"><span>${renderInline(wave.name)}</span>` +
    `<span class="cnt">${escapeHtml(countBadge(wave))}</span></div>` +
    `<div class="wbody">${cards.join("")}</div></div>`
  );
}

export function renderWaves(plan: Plan): RenderResult {
  const finalIds = new Set<string>();
  for (const f of plan.finalTasks) finalIds.add(f.id);
  const ctx: RenderContext = {
    tasksById: buildTaskLookup(plan.tasks),
    finalIds,
    paired: new Set<Task>(),
    warnings: [],
  };

  const columns: string[] = [];
  let nonFinalIndex = 0;

  for (const wave of plan.waves) {
    let color: string;
    if (isFinalWave(wave)) {
      color = "wf";
    } else {
      color = WAVE_COLORS[nonFinalIndex % WAVE_COLORS.length];
      nonFinalIndex++;
    }
    columns.push(renderWaveColumn(wave, color, ctx));
  }

  const unassigned: Task[] = plan.tasks.filter((t) => !ctx.paired.has(t));
  if (unassigned.length > 0) {
    for (const t of unassigned) {
      ctx.warnings.push({
        message: `Task ${t.id} is not present in any wave; placed under "Unassigned"`,
      });
    }
    const syntheticWave: Wave = {
      name: "Unassigned",
      entries: unassigned.map((t) => ({
        id: t.id,
        checked: t.checked,
        title: t.title,
      })),
    };
    const color = WAVE_COLORS[nonFinalIndex % WAVE_COLORS.length];
    columns.push(renderWaveColumn(syntheticWave, color, ctx));
  }

  const html =
    `<section id="waves">\n` +
    `<h2><span class="dot"></span>Execution Waves &amp; Tasks</h2>\n` +
    `<div class="waves">${columns.join("")}</div>\n` +
    `</section>`;

  return { html, warnings: ctx.warnings };
}
