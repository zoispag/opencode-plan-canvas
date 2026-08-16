import type { Plan, TldrEntry } from "../model";
import { escapeHtml, renderInline } from "../text";

const MIDDLE_DOT = "\u00b7";

const META_LABELS = ["Estimated Effort", "Parallel Execution"];

function findTldr(plan: Plan, label: string): TldrEntry | undefined {
  return plan.tldr.find((e) => e.label === label);
}

function taskProgress(plan: Plan): { done: number; total: number } {
  const total = plan.tasks.length;
  let done = 0;
  for (const t of plan.tasks) {
    if (t.checked) done++;
  }
  return { done, total };
}

export function renderHero(plan: Plan): string {
  const { done, total } = taskProgress(plan);

  const parts: string[] = [];
  parts.push(`<header class="hero">`);
  parts.push(
    `<div class="kicker">Prometheus ${MIDDLE_DOT} Work Plan ${MIDDLE_DOT} ${escapeHtml(
      `${done}/${total} tasks done`,
    )}</div>`,
  );
  parts.push(`<h1>${renderInline(plan.title)}</h1>`);

  const summary = findTldr(plan, "Quick Summary");
  if (summary) {
    parts.push(`<p class="subtitle">${renderInline(summary.value)}</p>`);
  }

  const repos = findTldr(plan, "Repos");
  if (repos) {
    const chips = repos.value
      .split(MIDDLE_DOT)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => `<span class="repo">${escapeHtml(s)}</span>`);
    if (chips.length > 0) {
      parts.push(`<div class="repos">${chips.join("")}</div>`);
    }
  }

  const tiles: string[] = [];
  for (const label of META_LABELS) {
    const entry = findTldr(plan, label);
    if (entry) {
      tiles.push(
        `<div class="meta"><div class="l">${escapeHtml(
          entry.label,
        )}</div><div class="v">${renderInline(entry.value)}</div></div>`,
      );
    }
  }
  tiles.push(
    `<div class="meta"><div class="l">Progress</div><div class="v">${escapeHtml(
      `${done}/${total} tasks`,
    )}</div></div>`,
  );
  parts.push(`<div class="metagrid">${tiles.join("")}</div>`);

  parts.push(`</header>`);
  return parts.join("\n");
}
