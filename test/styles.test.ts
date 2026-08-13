import { describe, it, expect } from "bun:test";
import { GOLDEN_CSS, EXTENSION_CSS } from "../src/render/styles";

describe("styles module", () => {
  it("GOLDEN_CSS is byte-identical to the fixture's <style> content", async () => {
    // Read the fixture HTML
    const html = await Bun.file("test/fixtures/golden-canvas.html").text();

    // Extract the <style> inner content via regex
    const match = html.match(/<style>([\s\S]*?)<\/style>/);
    expect(match).toBeDefined();
    expect(match?.[1]).toBeDefined();

    const fixtureCSS = match![1];

    // Assert byte-identity (exact string match)
    expect(GOLDEN_CSS).toBe(fixtureCSS);

    // Log the length for evidence
    console.log(`✓ GOLDEN_CSS byte-identical: ${GOLDEN_CSS.length} bytes`);
  });

  it("EXTENSION_CSS contains .cat.other rule", () => {
    expect(EXTENSION_CSS).toContain(".cat.other");
  });

  it("EXTENSION_CSS contains no external references (http/https/url/@import)", () => {
    const externalRefPattern = /https?:|url\(|@import/;
    expect(externalRefPattern.test(EXTENSION_CSS)).toBe(false);
  });

  it("EXTENSION_CSS contains the wide-layout .wrap override", () => {
    expect(EXTENSION_CSS).toContain(".wrap{max-width:min(96vw,1800px)}");
  });

  it("EXTENSION_CSS contains the opt-in light-theme selector overriding vars", () => {
    expect(EXTENSION_CSS).toContain(`:root[data-theme="light"]`);
    expect(EXTENSION_CSS).toContain("--bg:#ffffff");
  });

  it("GOLDEN_CSS contains all expected .cat classes", () => {
    const expectedCategories = [
      ".cat.deep",
      ".cat.ultrabrain",
      ".cat.quick",
      ".cat.unspecified-high",
      ".cat.writing",
      ".cat.oracle"
    ];

    for (const cat of expectedCategories) {
      expect(GOLDEN_CSS).toContain(cat);
    }
  });

  it("GOLDEN_CSS contains .repotag styles", () => {
    expect(GOLDEN_CSS).toContain(".repotag");
    expect(GOLDEN_CSS).toContain(".repotag.x");
  });

  it("GOLDEN_CSS contains wave color variables", () => {
    const waveColors = ["--w1:", "--w2:", "--w3:", "--w4:", "--wf:"];
    for (const color of waveColors) {
      expect(GOLDEN_CSS).toContain(color);
    }
  });
});
