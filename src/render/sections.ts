import type { Plan, Decision, FinalTask, NamedSection } from "../model";
import { escapeHtml, renderInline } from "../text";

const KNOWN_CATEGORIES = new Set([
  "deep",
  "ultrabrain",
  "quick",
  "unspecified-high",
  "writing",
  "oracle",
]);

function catClass(category: string): string {
  const c = category.trim();
  return KNOWN_CATEGORIES.has(c) ? `cat ${c}` : "cat other";
}

function splitCriticalPath(path: string): string[] {
  const segments: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]!;
    if (ch === "[") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === "]") {
      if (depth > 0) depth--;
      current += ch;
      continue;
    }
    if (depth === 0 && ch === "\u2192") {
      segments.push(current);
      current = "";
      continue;
    }
    if (depth === 0 && ch === "-" && path[i + 1] === ">") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

function isDoneSegment(segment: string): boolean {
  return segment.startsWith("\u2713") || segment.includes("[done");
}

function isGateSegment(segment: string): boolean {
  return /user\s+okay/i.test(segment);
}

function usedCategories(plan: Plan): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const ft of plan.finalTasks) {
    if (ft.category) {
      const c = ft.category.trim();
      if (c.length > 0 && !set.has(c)) {
        set.add(c);
        seen.push(c);
      }
    }
  }
  return seen;
}

export function renderCriticalPath(plan: Plan): string {
  const path = plan.criticalPath;
  if (!path || path.trim().length === 0) return "";

  const segments = splitCriticalPath(path);
  if (segments.length === 0) return "";

  const lastIndex = segments.length - 1;
  const nodeParts: string[] = [];
  segments.forEach((seg, i) => {
    const classes = ["n"];
    if (isDoneSegment(seg)) classes.push("ok");
    if (i === lastIndex && isGateSegment(seg)) classes.push("gate");
    nodeParts.push(`<span class="${classes.join(" ")}">${renderInline(seg)}</span>`);
    if (i < lastIndex) {
      nodeParts.push(`<span class="arr">\u2192</span>`);
    }
  });

  const legendCats = usedCategories(plan);
  const legendParts = legendCats.map(
    (c) => `<span class="${catClass(c)}">${escapeHtml(c)}</span>`,
  );

  const parts: string[] = [];
  parts.push(`<section id="crit">`);
  parts.push(`<h2><span class="dot"></span>Critical Path</h2>`);
  parts.push(`<div class="card">`);
  parts.push(`<div class="flow">${nodeParts.join("")}</div>`);
  if (legendParts.length > 0) {
    parts.push(`<div class="legend">${legendParts.join("")}</div>`);
  }
  parts.push(`</div>`);
  parts.push(`</section>`);
  return parts.join("\n");
}

export function renderGuardrails(plan: Plan): string {
  const { mustHave, mustNot } = plan.objectives;
  if (mustHave.length === 0 && mustNot.length === 0) return "";

  const haveItems = mustHave.map((s) => `<li>${renderInline(s)}</li>`).join("");
  const notItems = mustNot.map((s) => `<li>${renderInline(s)}</li>`).join("");

  const parts: string[] = [];
  parts.push(`<section id="guardrails">`);
  parts.push(`<h2><span class="dot"></span>Objectives &amp; Guardrails</h2>`);
  parts.push(`<div class="must">`);
  parts.push(`<div class="col have"><h4>Must Have</h4><ul class="clean">${haveItems}</ul></div>`);
  parts.push(`<div class="col not"><h4>Must NOT Have</h4><ul class="clean">${notItems}</ul></div>`);
  parts.push(`</div>`);
  parts.push(`</section>`);
  return parts.join("\n");
}

function verificationSections(plan: Plan): NamedSection[] {
  const raw = plan.verificationRaw;
  if (raw && raw.trim().length > 0) {
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) {
      return [{ heading: "Verification Strategy", lines }];
    }
  }
  return plan.objectives.other.filter((s) => s.lines.length > 0);
}

export function renderVerification(plan: Plan): string {
  const sections = verificationSections(plan);
  if (sections.length === 0) return "";

  const cards = sections.map((s) => {
    const items = s.lines.map((l) => `<li>${renderInline(l)}</li>`).join("");
    return `<div class="card"><h3 style="margin-top:0">${escapeHtml(
      s.heading,
    )}</h3><ul class="clean">${items}</ul></div>`;
  });

  const parts: string[] = [];
  parts.push(`<section id="verify">`);
  parts.push(`<h2><span class="dot"></span>Verification Strategy</h2>`);
  parts.push(`<div class="grid2">${cards.join("")}</div>`);
  parts.push(`</section>`);
  return parts.join("\n");
}

function decisionBadgeClass(status: Decision["status"]): string {
  if (status === "resolved") return "resolved";
  if (status === "open") return "open";
  return "default";
}

export function renderDecisions(plan: Plan): string {
  if (plan.decisions.length === 0) return "";

  const cards = plan.decisions.map((d) => {
    const badgeClass = decisionBadgeClass(d.status);
    return (
      `<div class="dcard">` +
      `<div style="display:flex;justify-content:space-between;align-items:center">` +
      `<span class="name">${escapeHtml(d.name)}</span>` +
      `<span class="badge ${badgeClass}">${escapeHtml(d.statusText)}</span>` +
      `</div>` +
      `<p class="muted" style="margin:.5em 0 0">${renderInline(d.body)}</p>` +
      `</div>`
    );
  });

  const parts: string[] = [];
  parts.push(`<section id="decisions">`);
  parts.push(`<h2><span class="dot"></span>Decisions</h2>`);
  parts.push(`<div class="decisions">${cards.join("")}</div>`);
  parts.push(`</section>`);
  return parts.join("\n");
}

function finalCardHead(ft: FinalTask): string {
  const head: string[] = [];
  head.push(`<b>${escapeHtml(ft.id)} \u00b7 ${renderInline(ft.title)}</b>`);
  if (ft.checked) {
    head.push(`<span class="badge shipped">done</span>`);
  }
  if (ft.category && ft.category.trim().length > 0) {
    const c = ft.category.trim();
    head.push(`<span class="${catClass(c)}">${escapeHtml(c)}</span>`);
  }
  return `<div class="h">${head.join("")}</div>`;
}

export function renderFinal(plan: Plan): string {
  if (plan.finalTasks.length === 0) return "";

  const cards = plan.finalTasks.map((ft) => {
    const parts: string[] = [];
    parts.push(`<div class="fcard">`);
    parts.push(finalCardHead(ft));
    parts.push(`<div class="muted">${renderInline(ft.description)}</div>`);
    if (ft.output && ft.output.trim().length > 0) {
      parts.push(`<div class="out">${renderInline(ft.output)}</div>`);
    }
    parts.push(`</div>`);
    return parts.join("");
  });

  const parts: string[] = [];
  parts.push(`<section id="final">`);
  parts.push(`<h2><span class="dot"></span>Final Verification Wave</h2>`);
  parts.push(`<div class="fwave">${cards.join("")}</div>`);
  parts.push(`</section>`);
  return parts.join("\n");
}
