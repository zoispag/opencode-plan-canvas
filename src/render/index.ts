import type { Plan, ParseWarning } from "../model";
import { renderHero } from "./hero";
import { renderToc, renderPage } from "./shell";
import { renderWaves } from "./waves";
import {
  renderCriticalPath,
  renderGuardrails,
  renderVerification,
  renderDecisions,
  renderFinal,
} from "./sections";

export interface RenderPlanResult {
  html: string;
  warnings: ParseWarning[];
}

export function renderPlan(plan: Plan, sourceLabel?: string): RenderPlanResult {
  const warnings: ParseWarning[] = [];

  const crit = renderCriticalPath(plan);
  const wavesResult = renderWaves(plan);
  warnings.push(...wavesResult.warnings);
  const waves = wavesResult.html;
  const guardrails = renderGuardrails(plan);
  const verify = renderVerification(plan);
  const decisions = renderDecisions(plan);
  const final = renderFinal(plan);

  const orderedSections: { id: string; html: string }[] = [
    { id: "crit", html: crit },
    { id: "waves", html: waves },
    { id: "guardrails", html: guardrails },
    { id: "verify", html: verify },
    { id: "decisions", html: decisions },
    { id: "final", html: final },
  ];

  const presentSectionIds = orderedSections
    .filter((s) => s.html.length > 0)
    .map((s) => s.id);

  const hero = renderHero(plan);
  const toc = renderToc(plan, presentSectionIds);

  const bodyParts: string[] = [hero, toc];
  for (const section of orderedSections) {
    if (section.html.length > 0) bodyParts.push(section.html);
  }
  const body = bodyParts.join("\n");

  const html = renderPage(plan, body, sourceLabel);
  return { html, warnings };
}
