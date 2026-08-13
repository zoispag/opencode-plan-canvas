# Architecture

`opencode-plan-canvas` is a small pipeline: read Markdown, parse it into a typed
model, render that model to a single HTML string. No I/O happens in the core;
the CLI is the only layer that touches the filesystem.

## Module map

```
src/
  cli.ts            Argument parsing, file I/O, atomic write, exit codes.
  index.ts          generate(source) -> { html, warnings }. Core entry point.
  model.ts          Typed Plan model. Pure interfaces, no logic.
  text.ts           escapeHtml + renderInline (the escape-everything policy).
  parse/
    core.ts         normalizeSource, scanLines (fence-aware), splitSections,
                    normalizeHeading, matchSection.
    tldr.ts         TL;DR blockquote bold-label entries.
    objectives.ts   Must Have / Must NOT Have + other named subsections.
    waves.ts        Fenced ASCII-tree wave blocks + critical path + reconcile.
    tasks.ts        TODOs task grammar (id, state comment, fields).
    decisions.ts    Bold-label decisions with status badges.
    final.ts        Final Verification Wave F-grammar.
    index.ts        parsePlan: dispatch each section to its parser.
  render/
    styles.ts       GOLDEN_CSS + EXTENSION_CSS string constants.
    shell.ts        renderPage (document skeleton), renderToc, renderFooter.
    hero.ts         renderHero (title, summary, repo chips, meta tiles).
    waves.ts        renderWaves (wave columns, task cards, fields).
    sections.ts     renderCriticalPath, renderGuardrails, renderVerification,
                    renderDecisions, renderFinal.
    index.ts        renderPlan: assemble present sections into the page body.
```

The core imports nothing outside `src/`. It has zero runtime dependencies.

## Data flow

```
  plan.md (string)
       |
       v
  normalizeSource        strip BOM, CRLF/CR -> LF                (parse/core.ts)
       |
       v
  splitSections          fence-aware line scan; pull the H1 title,
       |                 cut the doc into RawSection[] on ##/###  (parse/core.ts)
       v
  per-section parsers    matchSection dispatches each RawSection  (parse/index.ts)
       |                 to tldr / objectives / waves / tasks /
       |                 decisions / final; each returns data +
       |                 ParseWarning[]
       v
  Plan model             one typed object: title, tldr, objectives,
       |                 waves, tasks, decisions, finalTasks,
       |                 criticalPath, warnings                   (model.ts)
       v
  renderers              renderHero / renderWaves / renderCritical
       |                 Path / renderGuardrails / renderVerification /
       |                 renderDecisions / renderFinal; empty
       |                 sections return ""                       (render/*.ts)
       v
  renderPage             wrap hero + TOC + present sections in the
       |                 HTML skeleton, inline GOLDEN_CSS +
       |                 EXTENSION_CSS in one <style>             (render/shell.ts)
       v
  HTML (string)          generate() appends a trailing newline    (index.ts)
```

`generate(source)` is the seam. `parsePlan` produces the model, `renderPlan`
produces the HTML plus any render-time warnings, and `generate` concatenates the
parse and render warnings and guarantees a trailing newline. The CLI wraps
`generate`: it reads the input file, prints each warning to stderr as
`warn: <line>: <message>`, writes the HTML to a temp file, then atomically
renames it into place.

Only sections that produced content are emitted. `renderPlan` builds the ordered
list of section HTML, filters out the empty strings, and passes the surviving
section ids to `renderToc` so the table of contents only links to sections that
exist.

## Extending a section renderer

To add or change a rendered section:

1. If the section needs new data, add or extend a type in `src/model.ts` and a
   parser in `src/parse/`. Wire it into `parsePlan` in `src/parse/index.ts`:
   add the section key to `KNOWN_KEYS` (so it is not warned as unknown) and add
   a `matchSection(section.heading, "<key>")` branch that calls your parser and
   pushes its warnings.
2. Write a renderer in `src/render/` that takes the `Plan` and returns an HTML
   string, returning `""` when there is nothing to show (this is how lenient
   omission works).
3. Register it in `renderPlan` (`src/render/index.ts`): add an entry to
   `orderedSections` with a stable `id`. Add the matching `{ id, label }` to
   `TOC_SECTIONS` in `src/render/shell.ts` so the anchor appears in the TOC when
   the section is present.
4. Keep the escape policy: emit plan text through `escapeHtml` (or
   `renderInline` for the inline-markdown allowlist) from `src/text.ts`. Never
   interpolate raw plan text into markup.
5. Add a unit test in `test/render-*.ts` and, if you touched parsing, a
   `test/parse-*.ts` test. Then re-bless the golden master (below).

## Re-blessing the golden master

`test/fixtures/golden-master.html` is the generator's own output for
`test/fixtures/golden-plan.md`. It is a snapshot of what the tool produces, not
a hand-written target and not byte-compared against the legacy
`golden-canvas.html`. When you make an intentional change to the output, you
must re-bless it on purpose and review the diff:

1. Regenerate the snapshot from the golden plan into the fixture path:

   ```sh
   bun run src/cli.ts test/fixtures/golden-plan.md -o test/fixtures/golden-master.html
   ```

2. Review the diff and confirm every change is intended:

   ```sh
   git diff -- test/fixtures/golden-master.html
   ```

3. Run the suite so the golden-master test compares against the new snapshot:

   ```sh
   bun test
   ```

4. Commit the fixture alongside the code change that caused it, with a message
   that says why the output changed:

   ```sh
   git add test/fixtures/golden-master.html
   git commit -m "test: re-bless golden master (<reason>)"
   ```

Never edit `golden-master.html` by hand. If the diff shows a change you did not
intend, fix the code, do not edit the fixture.
