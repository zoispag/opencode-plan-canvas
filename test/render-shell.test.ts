import { test, expect, describe } from "bun:test";
import { renderHero } from "../src/render/hero";
import { renderPage, renderToc, renderFooter } from "../src/render/shell";
import { fixturePlan, emptyTldrPlan } from "./helpers/fixture-model";

describe("renderHero", () => {
  test("emits header with hero class and h1", () => {
    const h = renderHero(fixturePlan);
    expect(h).toContain(`<header class="hero">`);
    expect(h).toContain("<h1>");
  });

  test("subtitle equals Quick Summary inline-rendered", () => {
    const h = renderHero(fixturePlan);
    expect(h).toContain(`<p class="subtitle">Test summary <code>x</code></p>`);
  });

  test("repos chips split on middle dot and escaped", () => {
    const h = renderHero(fixturePlan);
    expect(h).toContain(`<div class="repos">`);
    expect(h).toContain(`<span class="repo">owner/repo-a</span>`);
    expect(h).toContain(`<span class="repo">owner/repo-b</span>`);
  });

  test("metagrid derives tiles from present tldr entries plus Progress", () => {
    const h = renderHero(fixturePlan);
    expect(h).toContain(`<div class="metagrid">`);
    expect(h).toContain(`<div class="l">Estimated Effort</div>`);
    expect(h).toContain(`<div class="l">Parallel Execution</div>`);
    expect(h).toContain(`<div class="l">Progress</div>`);
  });

  test("hero omits the Critical Path tile (shown in its own section instead)", () => {
    const h = renderHero(fixturePlan);
    expect(h).not.toContain(`<div class="l">Critical Path</div>`);
  });

  test("kicker carries derived task progress", () => {
    const h = renderHero(fixturePlan);
    expect(h).toContain("2/3 tasks done");
  });

  test("no script substring", () => {
    const h = renderHero(fixturePlan);
    expect(h).not.toContain("<script");
  });

  test("empty tldr degrades gracefully: h1 + header/hero, no absent meta tiles, no throw", () => {
    let h = "";
    expect(() => {
      h = renderHero(emptyTldrPlan);
    }).not.toThrow();
    expect(h).toContain("<h1>");
    expect(h).toContain(`<header class="hero">`);
    expect(h).not.toContain(`<div class="l">Estimated Effort</div>`);
    expect(h).not.toContain(`<div class="l">Parallel Execution</div>`);
    expect(h).not.toContain(`<div class="l">Critical Path</div>`);
    expect(h).not.toContain(`<p class="subtitle">`);
    expect(h).not.toContain(`<div class="repos">`);
    expect(h).toContain(`<div class="l">Progress</div>`);
  });
});

describe("renderToc", () => {
  test("only anchors for present sections, golden ids", () => {
    const toc = renderToc(fixturePlan, ["crit", "waves", "final"]);
    expect(toc).toContain(`<nav class="toc">`);
    expect(toc).toContain(`<a href="#crit">Critical Path</a>`);
    expect(toc).toContain(`<a href="#waves">Waves &amp; Tasks</a>`);
    expect(toc).toContain(`<a href="#final">Final Review</a>`);
    expect(toc).not.toContain(`href="#verify"`);
    expect(toc).not.toContain(`href="#decisions"`);
  });

  test("empty presence yields empty nav", () => {
    const toc = renderToc(fixturePlan, []);
    expect(toc).toBe(`<nav class="toc"></nav>`);
  });
});

describe("renderFooter", () => {
  test("carries source label and progress", () => {
    const f = renderFooter(fixturePlan, ".sisyphus/plans/x.md");
    expect(f).toContain("<footer>");
    expect(f).toContain(".sisyphus/plans/x.md");
    expect(f).toContain("rendered by opencode-plan-canvas");
    expect(f).toContain("2/3 tasks done");
  });

  test("falls back to plan title when no source label", () => {
    const f = renderFooter(fixturePlan);
    expect(f).toContain("Fixture Plan");
  });
});

describe("renderPage", () => {
  test("full document with head, style, wrap, body, footer", () => {
    const body = renderHero(fixturePlan) + renderToc(fixturePlan, ["crit"]);
    const page = renderPage(fixturePlan, body);
    expect(page).toContain("<!doctype html>");
    expect(page).toContain(`<meta charset="utf-8">`);
    expect(page).toContain(`<meta name="viewport"`);
    expect(page).toContain("<title>Fixture Plan `title`</title>");
    expect(page).toContain("<style>");
    expect(page).toContain(`<div class="wrap">`);
    expect(page).toContain(`<header class="hero">`);
    expect(page).toContain(`<nav class="toc">`);
    expect(page).toContain(`<div class="metagrid">`);
    expect(page).toContain("<footer>");
    expect(page).toContain("</html>");
  });

  test("injects inline interactivity script + controls by default", () => {
    const body = renderHero(fixturePlan);
    const page = renderPage(fixturePlan, body);
    expect(page).toContain("<script>");
    expect(page).toContain(`data-controls`);
    expect(page).toContain("</script>");
  });

  test("omits script + controls when interactive is false", () => {
    const body = renderHero(fixturePlan);
    const page = renderPage(fixturePlan, body, undefined, { interactive: false });
    expect(page).not.toContain("<script");
    expect(page).not.toContain(`data-controls`);
  });

  test("embeds golden + extension css", () => {
    const page = renderPage(fixturePlan, renderHero(fixturePlan));
    expect(page).toContain(".cat.other");
    expect(page).toContain(":root{");
  });
});
