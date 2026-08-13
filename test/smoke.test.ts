import { test, expect } from "bun:test";
import { readFileSync } from "fs";

test("smoke: golden fixtures exist and are non-empty", () => {
  const planPath = "test/fixtures/golden-plan.md";
  const canvasPath = "test/fixtures/golden-canvas.html";

  const plan = readFileSync(planPath, "utf8");
  expect(plan.length).toBeGreaterThan(0);
  expect(plan).toContain("# ");

  const canvas = readFileSync(canvasPath, "utf8");
  expect(canvas.length).toBeGreaterThan(0);
  expect(canvas).toContain("<");
});

test("smoke: Bun.version is defined", () => {
  expect(Bun.version).toBeDefined();
  expect(typeof Bun.version).toBe("string");
});
