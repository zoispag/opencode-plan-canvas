import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";

const tmpTestDir = join(tmpdir(), "opencode-cli-test");

const pkgVersion = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf-8"),
).version as string;

beforeAll(() => {
  mkdirSync(tmpTestDir, { recursive: true });
});

afterAll(() => {
  if (existsSync(tmpTestDir)) {
    rmSync(tmpTestDir, { recursive: true });
  }
});

describe("CLI", () => {
  it("--help exits 0 and prints usage", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--help"], {
      cwd: import.meta.dirname + "/..",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: opencode-plan-canvas");
    expect(stdout).toContain("--help");
    expect(stdout).toContain("--version");
  });

  it("-h also exits 0 and prints usage", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "-h"], {
      cwd: import.meta.dirname + "/..",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage:");
  });

  it("--version exits 0 and prints version from package.json", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--version"], {
      cwd: import.meta.dirname + "/..",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkgVersion);
  });

  it("-v also exits 0 and prints version", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "-v"], {
      cwd: import.meta.dirname + "/..",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkgVersion);
  });

  it("missing input file exits 1 with error containing filename", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "/nonexistent.md"], {
      cwd: import.meta.dirname + "/..",
      stdio: ["inherit", "pipe", "pipe"],
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    const output = stdout + stderr;
    expect(output).toContain("/nonexistent.md");
    expect(output).toContain("error");
  });

  it("watch subcommand on missing file exits 1", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "watch", "/nonexistent-watch.md"], {
      cwd: import.meta.dirname + "/..",
      stdio: ["inherit", "pipe", "pipe"],
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("/nonexistent-watch.md");
  });

  it("watch subcommand starts a localhost server and prints its url", async () => {
    const inputFile = join(tmpTestDir, "watch-plan.md");
    writeFileSync(
      inputFile,
      `# Watch Plan\n\n## TODOs\n\n- [x] 1. Task.\n`,
      "utf-8"
    );

    const proc = Bun.spawn(
      ["bun", "run", "src/cli.ts", "watch", inputFile, "--port", "4577", "--no-open"],
      {
        cwd: import.meta.dirname + "/..",
        stdio: ["inherit", "pipe", "pipe"],
      }
    );

    let url = "";
    const deadline = Date.now() + 5000;
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      url += decoder.decode(value);
      if (url.includes("http://127.0.0.1:")) break;
    }
    reader.releaseLock();

    expect(url).toContain("http://127.0.0.1:4577");

    let served = "";
    try {
      const res = await fetch("http://127.0.0.1:4577/");
      served = await res.text();
    } catch {}

    proc.kill("SIGINT");
    await proc.exited;

    expect(served).toContain('id="waves"');
    expect(served).toContain("EventSource");
  });

  it("default command with valid file writes output and exits 0", async () => {
    const inputFile = join(tmpTestDir, "test-plan.md");
    const outputFile = join(tmpTestDir, "test-plan.canvas.html");

    writeFileSync(
      inputFile,
      `# Test Plan

## TL;DR

> **Quick Summary**: Test case

## TODOs

- [x] 1. Test task.
`,
      "utf-8"
    );

    const proc = Bun.spawn(["bun", "run", "src/cli.ts", inputFile], {
      cwd: import.meta.dirname + "/..",
    });

    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(outputFile)).toBe(true);

    const content = readFileSync(outputFile, "utf-8");
    expect(content).toContain("<!doctype html");
  });

  it("-o flag specifies custom output path", async () => {
    const inputFile = join(tmpTestDir, "test-plan-2.md");
    const customOutput = join(tmpTestDir, "custom-output.html");

    writeFileSync(
      inputFile,
      `# Test Plan 2

## TL;DR

> **Quick Summary**: Test

## TODOs

- [x] 1. Task.
`,
      "utf-8"
    );

    const proc = Bun.spawn(
      ["bun", "run", "src/cli.ts", inputFile, "-o", customOutput],
      {
        cwd: import.meta.dirname + "/..",
      }
    );

    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(customOutput)).toBe(true);

    const content = readFileSync(customOutput, "utf-8");
    expect(content).toContain("<!doctype html");
  });

  it("--output flag also works", async () => {
    const inputFile = join(tmpTestDir, "test-plan-3.md");
    const customOutput = join(tmpTestDir, "custom-output-2.html");

    writeFileSync(
      inputFile,
      `# Test Plan 3

## TL;DR

> **Quick Summary**: Test

## TODOs

- [x] 1. Task.
`,
      "utf-8"
    );

    const proc = Bun.spawn(
      ["bun", "run", "src/cli.ts", inputFile, "--output", customOutput],
      {
        cwd: import.meta.dirname + "/..",
      }
    );

    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(existsSync(customOutput)).toBe(true);
  });

  it("stdout remains clean during file output, warnings go to stderr", async () => {
    const inputFile = join(tmpTestDir, "test-plan-warn.md");
    const outputFile = join(tmpTestDir, "test-plan-warn.canvas.html");

    writeFileSync(
      inputFile,
      `# Test Plan

## TL;DR

> unpaired line

## TODOs

- [x] 1. Task.
`,
      "utf-8"
    );

    const proc = Bun.spawn(["bun", "run", "src/cli.ts", inputFile], {
      cwd: import.meta.dirname + "/..",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(existsSync(outputFile)).toBe(true);
  });
});
