import type { ParseWarning } from "./model";
import { parsePlan } from "./parse/index";
import { renderPlan } from "./render/index";

export interface GenerateResult {
  html: string;
  warnings: ParseWarning[];
}

export function generate(source: string, opts?: { sourceLabel?: string }): GenerateResult {
  const plan = parsePlan(source);
  const { html, warnings: renderWarnings } = renderPlan(plan, opts?.sourceLabel);
  const withTrailingNewline = html.endsWith("\n") ? html : `${html}\n`;
  return {
    html: withTrailingNewline,
    warnings: [...plan.warnings, ...renderWarnings],
  };
}
