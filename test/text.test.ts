import { describe, expect, test } from "bun:test";
import { escapeHtml, renderInline } from "../src/text";

describe("escapeHtml", () => {
  const cases: Array<[string, string, string]> = [
    ["ampersand first", "a & b", "a &amp; b"],
    ["less-than", "<", "&lt;"],
    ["greater-than", ">", "&gt;"],
    ["double-quote", '"', "&quot;"],
    ["single-quote", "'", "&#39;"],
    ["all five together", `&<>"'`, "&amp;&lt;&gt;&quot;&#39;"],
    ["empty string", "", ""],
    ["no special chars", "hello world", "hello world"],
    [
      "script tag neutralized",
      "<script>alert(1)</script>",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    ],
    // Ordering proof: existing entity must be double-escaped (& first).
    ["ampersand order safety", "&amp;", "&amp;amp;"],
  ];

  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(escapeHtml(input)).toBe(expected);
    });
  }
});

describe("renderInline — escaping baseline", () => {
  test("script tag renders escaped, no live <script>", () => {
    const out = renderInline("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });

  test("empty string → empty string", () => {
    expect(renderInline("")).toBe("");
  });

  test("raw HTML from plan content renders as visible escaped text", () => {
    // Golden plans may contain literal <code>/<b>; policy: escape everything.
    const out = renderInline("literal <code>x</code> and <b>y</b>");
    expect(out).toContain("&lt;code&gt;x&lt;/code&gt;");
    expect(out).toContain("&lt;b&gt;y&lt;/b&gt;");
    expect(out).not.toContain("<code>x</code>");
  });

  test("angle-bracket placeholder like <owner> escaped", () => {
    const out = renderInline("push to oci://ghcr.io/<owner>");
    expect(out).toContain("&lt;owner&gt;");
    expect(out).not.toContain("<owner>");
  });
});

describe("renderInline — code spans", () => {
  test("happy path", () => {
    expect(renderInline("`c`")).toBe("<code>c</code>");
  });

  test("& inside a code span is escaped", () => {
    expect(renderInline("`a & b`")).toBe("<code>a &amp; b</code>");
  });

  test("angle brackets inside code span escaped", () => {
    expect(renderInline("`<x>`")).toBe("<code>&lt;x&gt;</code>");
  });

  test("code span embedded in text", () => {
    expect(renderInline("use `foo` here")).toBe("use <code>foo</code> here");
  });

  test("unmatched single backtick renders literally", () => {
    expect(renderInline("a ` b")).toBe("a ` b");
  });
});

describe("renderInline — bold", () => {
  test("happy path", () => {
    expect(renderInline("**b**")).toBe("<b>b</b>");
  });

  test("bold embedded in text", () => {
    expect(renderInline("very **bold** text")).toBe("very <b>bold</b> text");
  });

  test("unmatched ** renders as escaped literal (no closer)", () => {
    // Single dangling ** must not become a tag.
    const out = renderInline("**not closed");
    expect(out).not.toContain("<b>");
    expect(out).toContain("**not closed");
  });

  test("special chars inside bold escaped", () => {
    expect(renderInline("**a & b**")).toBe("<b>a &amp; b</b>");
  });
});

describe("renderInline — nesting: bold containing code", () => {
  test("code span processed, bold wraps it", () => {
    // Contract: code spans resolved first, then bold wraps the result.
    expect(renderInline("**bold with `code` inside**")).toBe(
      "<b>bold with <code>code</code> inside</b>",
    );
  });

  test("bold markers not consumed by an open code span", () => {
    expect(renderInline("**`x`**")).toBe("<b><code>x</code></b>");
  });
});

describe("renderInline — links (allowlist)", () => {
  test("https happy path", () => {
    expect(renderInline("[x](https://e.com)")).toBe(
      '<a href="https://e.com">x</a>',
    );
  });

  test("http scheme allowed", () => {
    expect(renderInline("[x](http://e.com)")).toBe(
      '<a href="http://e.com">x</a>',
    );
  });

  test("#-anchor allowed", () => {
    expect(renderInline("[x](#sec)")).toBe('<a href="#sec">x</a>');
  });

  test("javascript: scheme REJECTED — no anchor, escaped literal present", () => {
    const out = renderInline("[x](javascript:alert(1))");
    expect(out).not.toContain("<a ");
    expect(out).toContain("[x](javascript:alert(1))");
  });

  test("data: scheme REJECTED", () => {
    const out = renderInline("[img](data:text/html,<script>)");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("<script>");
  });

  test("relative/other scheme (mailto) REJECTED as literal", () => {
    const out = renderInline("[m](mailto:a@b.com)");
    expect(out).not.toContain("<a ");
    expect(out).toContain("[m](mailto:a@b.com)");
  });

  test("label is escaped but not re-linked", () => {
    const out = renderInline("[a<b](https://e.com)");
    expect(out).toBe('<a href="https://e.com">a&lt;b</a>');
  });
});

describe("renderInline — combined", () => {
  test("script + bold + code together", () => {
    const out = renderInline("<script>alert(1)</script> **b** `c`");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("<b>b</b>");
    expect(out).toContain("<code>c</code>");
    expect(out).not.toContain("<script>");
  });
});
