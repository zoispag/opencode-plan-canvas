/**
 * Text utilities — HTML escaping policy + inline-markdown mini renderer.
 *
 * SECURITY POLICY (escape everything; NO raw-HTML pass-through):
 * All plan-derived text is HTML-escaped BEFORE any transformation. There is no
 * mechanism to inject raw HTML from plan content. Consequently, golden plans that
 * contain literal `<code>` / `<b>` / `<owner>` etc. render as VISIBLE escaped text
 * (e.g. `&lt;code&gt;`). This is an accepted trade-off (see plan Defaults section):
 * correctness/XSS-safety is prioritized over honoring embedded HTML.
 *
 * renderInline transforms ONLY the generator's own inline-markdown allowlist, and
 * it does so on the ALREADY-ESCAPED text. The allowlist markers (backtick,
 * asterisk, `[](...)`) are characters that escapeHtml does not touch, so the
 * patterns operate safely on escaped output.
 */

const HTML_ESCAPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&/g, "&amp;"],
  [/</g, "&lt;"],
  [/>/g, "&gt;"],
  [/"/g, "&quot;"],
  [/'/g, "&#39;"],
];

export function escapeHtml(s: string): string {
  let out = s;
  for (const [pattern, replacement] of HTML_ESCAPES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

const CODE_SPAN = /`([^`]+)`/g;
const BOLD = /\*\*([\s\S]+?)\*\*/g;
const LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

function isAllowedUrl(url: string): boolean {
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("#")
  );
}

export function renderInline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(CODE_SPAN, (_m, body: string) => `<code>${body}</code>`);
  out = out.replace(BOLD, (_m, body: string) => `<b>${body}</b>`);
  out = out.replace(LINK, (match, label: string, url: string) =>
    isAllowedUrl(url) ? `<a href="${url}">${label}</a>` : match,
  );
  return out;
}
