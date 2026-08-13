import type { Plan } from "../model";
import { escapeHtml } from "../text";
import { GOLDEN_CSS, EXTENSION_CSS } from "./styles";
import { CONTROLS_MARKUP, INLINE_SCRIPT, applyInprogress } from "./interactivity";

export interface RenderPageOptions {
  interactive?: boolean;
}

const MIDDLE_DOT = "\u00b7";

interface TocSection {
  id: string;
  label: string;
}

const TOC_SECTIONS: TocSection[] = [
  { id: "crit", label: "Critical Path" },
  { id: "waves", label: "Waves & Tasks" },
  { id: "guardrails", label: "Objectives & Guardrails" },
  { id: "verify", label: "Verification" },
  { id: "decisions", label: "Decisions" },
  { id: "final", label: "Final Review" },
];

function taskProgress(plan: Plan): { done: number; total: number } {
  const total = plan.tasks.length;
  let done = 0;
  for (const t of plan.tasks) {
    if (t.checked) done++;
  }
  return { done, total };
}

export function renderToc(plan: Plan, presentSectionIds: string[]): string {
  const present = new Set(presentSectionIds);
  const anchors = TOC_SECTIONS.filter((s) => present.has(s.id)).map(
    (s) => `<a href="#${s.id}">${escapeHtml(s.label)}</a>`,
  );
  return `<nav class="toc">${anchors.join("")}</nav>`;
}

export function renderFooter(plan: Plan, sourceLabel?: string): string {
  const { done, total } = taskProgress(plan);
  const source = sourceLabel ?? plan.title;
  return [
    `<footer>`,
    `<span>Source: ${escapeHtml(source)} ${MIDDLE_DOT} rendered by opencode-plan-canvas</span>`,
    `<span>${escapeHtml(`${done}/${total} tasks done`)}</span>`,
    `</footer>`,
  ].join("\n");
}

export function renderPage(
  plan: Plan,
  body: string,
  sourceLabel?: string,
  options?: RenderPageOptions,
): string {
  const css = GOLDEN_CSS + EXTENSION_CSS;
  const interactive = options?.interactive !== false;

  const bodyHtml = interactive ? applyInprogress(body) : body;

  const parts: string[] = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
    `<title>${escapeHtml(plan.title)}</title>`,
    `<style>${css}</style>`,
    `</head>`,
    `<body>`,
    `<div class="wrap">`,
  ];
  if (interactive) parts.push(CONTROLS_MARKUP);
  parts.push(bodyHtml, renderFooter(plan, sourceLabel), `</div>`);
  if (interactive) parts.push(INLINE_SCRIPT);
  parts.push(`</body>`, `</html>`);
  return parts.join("\n");
}
