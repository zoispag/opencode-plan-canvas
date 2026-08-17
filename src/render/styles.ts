/**
 * CSS constants for opencode-plan-canvas.
 * 
 * GOLDEN_CSS: Byte-for-byte copy of the <style> content from
 * test/fixtures/golden-canvas.html. This is the immutable contract.
 * 
 * EXTENSION_CSS: Generator-only CSS additions (e.g., .cat.other for
 * unknown agent categories). This block can be extended by future tasks.
 */

export const GOLDEN_CSS = "\n  :root{\n    --bg:#0d1117; --panel:#161b22; --panel2:#1c2430; --border:#30363d;\n    --ink:#e6edf3; --muted:#9198a1; --faint:#6e7681;\n    --accent:#58a6ff; --go:#7ee787; --warn:#e3b341; --danger:#f85149;\n    --purple:#bc8cff; --pink:#f778ba; --cyan:#39c5cf;\n    --w1:#1f6feb; --w2:#238636; --w3:#9e6a03; --w4:#8957e5; --wf:#bc4c00;\n    --chip:#21262d;\n    --radius:12px; --shadow:0 1px 0 rgba(255,255,255,.03), 0 8px 24px rgba(0,0,0,.4);\n  }\n  *{box-sizing:border-box}\n  html{scroll-behavior:smooth}\n  body{\n    margin:0; background:radial-gradient(1200px 600px at 20% -10%, #12233b 0%, var(--bg) 55%) fixed;\n    color:var(--ink); font:15px/1.55 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Inter,Roboto,Helvetica,Arial,sans-serif;\n    -webkit-font-smoothing:antialiased;\n  }\n  code,kbd,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,\"Liberation Mono\",monospace}\n  a{color:var(--accent);text-decoration:none}\n  a:hover{text-decoration:underline}\n  .wrap{max-width:1180px;margin:0 auto;padding:32px 22px 96px}\n  header.hero{\n    border:1px solid var(--border);border-radius:16px;padding:26px 28px;margin-bottom:26px;\n    background:linear-gradient(135deg, rgba(88,166,255,.10), rgba(188,140,255,.06)); box-shadow:var(--shadow);\n  }\n  .kicker{color:var(--accent);font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:11px}\n  h1{margin:.35em 0 .2em;font-size:29px;line-height:1.15;letter-spacing:-.01em}\n  .subtitle{color:var(--muted);max-width:80ch;font-size:14.5px}\n  .repos{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}\n  .repo{font-size:12px;padding:5px 11px;border-radius:999px;background:var(--chip);border:1px solid var(--border);color:var(--ink)}\n  .repo.archived{color:var(--faint);text-decoration:line-through}\n  .repo b{color:var(--go)}\n  .metagrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:18px}\n  .meta{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px}\n  .meta .l{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint)}\n  .meta .v{margin-top:4px;font-weight:600}\n  nav.toc{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:6px;\n    padding:10px 0 12px;margin:-8px 0 22px;backdrop-filter:blur(8px);\n    background:linear-gradient(var(--bg),rgba(13,17,23,.65));border-bottom:1px solid var(--border)}\n  nav.toc a{font-size:12.5px;padding:6px 11px;border-radius:8px;background:var(--panel);border:1px solid var(--border);color:var(--muted)}\n  nav.toc a:hover{color:var(--ink);border-color:var(--accent);text-decoration:none}\n  section{margin:34px 0}\n  h2{font-size:19px;margin:0 0 14px;display:flex;align-items:center;gap:10px}\n  h2 .dot{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent)}\n  h3{font-size:14px;color:var(--muted);margin:18px 0 8px;text-transform:uppercase;letter-spacing:.06em}\n  .card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px;box-shadow:var(--shadow)}\n  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}\n  @media(max-width:820px){.grid2{grid-template-columns:1fr}}\n  ul.clean{margin:.2em 0;padding-left:1.15em}\n  ul.clean li{margin:.28em 0}\n  .muted{color:var(--muted)}\n  .mono-inline{background:var(--panel2);border:1px solid var(--border);border-radius:5px;padding:.5px 5px;font-size:12.5px}\n  .cat{font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:6px;text-transform:uppercase;border:1px solid transparent;white-space:nowrap}\n  .cat.deep{background:rgba(88,166,255,.15);color:#79c0ff;border-color:rgba(88,166,255,.35)}\n  .cat.ultrabrain{background:rgba(188,140,255,.15);color:var(--purple);border-color:rgba(188,140,255,.35)}\n  .cat.quick{background:rgba(126,231,135,.13);color:var(--go);border-color:rgba(126,231,135,.3)}\n  .cat.unspecified-high{background:rgba(227,179,65,.13);color:var(--warn);border-color:rgba(227,179,65,.3)}\n  .cat.writing{background:rgba(57,197,207,.13);color:var(--cyan);border-color:rgba(57,197,207,.3)}\n  .cat.oracle{background:rgba(247,120,186,.14);color:var(--pink);border-color:rgba(247,120,186,.32)}\n  .repotag{font-size:10px;font-weight:700;padding:2px 6px;border-radius:5px;background:var(--chip);border:1px solid var(--border);color:var(--muted)}\n  .repotag.x{color:var(--warn);border-color:rgba(227,179,65,.35)}\n  .waves{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}\n  .wave{border:1px solid var(--border);border-radius:var(--radius);background:var(--panel);overflow:hidden}\n  .wave > .whead{padding:11px 14px;font-weight:700;font-size:13px;letter-spacing:.03em;display:flex;justify-content:space-between;align-items:center;color:#fff}\n  .wave.w1 .whead{background:linear-gradient(90deg,var(--w1),#2b7de9)}\n  .wave.w2 .whead{background:linear-gradient(90deg,var(--w2),#2ea043)}\n  .wave.w3 .whead{background:linear-gradient(90deg,var(--w3),#bb8009)}\n  .wave.w4 .whead{background:linear-gradient(90deg,var(--w4),#a371f7)}\n  .wave.wf .whead{background:linear-gradient(90deg,var(--wf),#db6d28)}\n  .whead .cnt{font-size:11px;font-weight:600;opacity:.9;background:rgba(0,0,0,.25);padding:2px 8px;border-radius:999px}\n  .wbody{padding:10px;display:flex;flex-direction:column;gap:8px}\n  .tcard{border:1px solid var(--border);border-radius:9px;background:var(--panel2);padding:10px 11px;c‍ursor:pointer;transition:border-color .15s,transform .05s}\n  .tcard:hover{border-color:var(--accent)}\n  .tcard summary{list-style:none;outline:none}\n  .tcard summary::-webkit-details-marker{display:none}\n  .trow{display:flex;align-items:center;gap:8px}\n  .tid{font-weight:800;font-size:12px;color:var(--faint);min-width:26px}\n  .ttitle{font-weight:600;font-size:13px;flex:1;line-height:1.35}\n  .tmeta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}\n  .tbody{margin-top:10px;border-top:1px dashed var(--border);padding-top:10px;font-size:13px;color:var(--muted);display:flex;flex-direction:column;gap:9px}\n  .tbody .lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);font-weight:700;margin-bottom:2px}\n  .tbody .box{background:var(--panel);border:1px solid var(--border);border-radius:7px;padding:8px 10px}\n  .tbody code{font-size:12px;color:var(--go)}\n  .dep{font-size:11px}\n  .dep .b{color:var(--danger)}.dep .a{color:var(--go)}\n  .qa{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:#c9d1d9;background:#0b0f14;border:1px solid var(--border);border-radius:7px;padding:9px 10px;overflow:auto}\n  .must{display:grid;grid-template-columns:1fr 1fr;gap:14px}\n  @media(max-width:820px){.must{grid-template-columns:1fr}}\n  .must .col{border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px}\n  .must .have{background:linear-gradient(180deg,rgba(126,231,135,.06),transparent)}\n  .must .not{background:linear-gradient(180deg,rgba(248,81,73,.06),transparent)}\n  .must h4{margin:0 0 8px;font-size:13px}\n  .must .have h4{color:var(--go)}.must .not h4{color:var(--danger)}\n  .must .have li{list-style:\"✓  \"}\n  .must .not li{list-style:\"✕  \"}\n  .callout{border-left:3px solid var(--accent);background:var(--panel);border-radius:0 10px 10px 0;padding:12px 16px;margin:12px 0}\n  .callout.warn{border-color:var(--warn)}\n  .callout.danger{border-color:var(--danger)}\n  .callout.ok{border-color:var(--go)}\n  .callout .t{font-weight:700;margin-bottom:3px}\n  .flow{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12.5px}\n  .flow .n{background:var(--panel2);border:1px solid var(--border);border-radius:7px;padding:6px 10px;font-weight:600}\n  .flow .arr{color:var(--faint)}\n  .flow .n.f{border-color:var(--wf);color:#ffa657}\n  .flow .n.gate{border-color:var(--go);color:var(--go)}\n  .decisions{display:grid;grid-template-columns:1fr 1fr;gap:14px}\n  @media(max-width:820px){.decisions{grid-template-columns:1fr}}\n  .dcard{border:1px solid var(--border);border-radius:10px;padding:13px 15px;background:var(--panel)}\n  .dcard .name{font-weight:700;font-family:ui-monospace,monospace;font-size:12.5px;color:var(--warn)}\n  .badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.05em}\n  .badge.resolved{background:rgba(126,231,135,.15);color:var(--go)}\n  .badge.open{background:rgba(227,179,65,.15);color:var(--warn)}\n  .badge.default{background:rgba(88,166,255,.13);color:var(--accent)}\n  .fwave{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}\n  .fcard{border:1px solid var(--border);border-left:3px solid var(--wf);border-radius:0 10px 10px 0;padding:13px 15px;background:var(--panel)}\n  .fcard .h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}\n  .fcard .h b{font-size:13.5px}\n  .fcard .out{font-family:ui-monospace,monospace;font-size:11px;color:var(--faint);margin-top:8px;background:#0b0f14;border:1px solid var(--border);border-radius:6px;padding:6px 8px}\n  footer{margin-top:40px;border-top:1px solid var(--border);padding-top:16px;color:var(--faint);font-size:12.5px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}\n  .legend{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 0}\n  .hint{font-size:11.5px;color:var(--faint);margin-top:4px}\n  .done{color:var(--go);font-weight:700}\n  .repo.oos{color:var(--warn);border-color:rgba(227,179,65,.35)}\n  .badge.shipped{background:rgba(126,231,135,.15);color:var(--go)}\n  .wave.done .whead{background:linear-gradient(90deg,#2d6a34,#3fb950);opacity:.85}\n  .tcard.shipped{opacity:.82}\n  .flow .n.ok{border-color:var(--go);color:var(--go);opacity:.7}\n";

/**
 * Extension CSS for generator-only additions.
 * Initially contains .cat.other (neutral gray badge) mirroring the
 * .repotag colors from GOLDEN_CSS.
 * 
 * v2 tasks may append interactive/interactivity styles here.
 * This block is separate from GOLDEN_CSS to preserve immutability
 * of the golden theme.
 */
export const EXTENSION_CSS = `
  /* Generator-only CSS additions */
  
  /* Neutral gray badge for unknown/unmapped agent categories (fallback) */
  .cat.other{background:var(--chip);color:var(--muted);border-color:var(--border)}

  /* Final-wave cards link to their detailed #final card. */
  .tcard-linked{cursor:pointer}
  .tcard-linked:hover{border-color:var(--accent)}
  a.tlink{color:inherit;text-decoration:none}
  a.tlink:hover{color:var(--accent);text-decoration:none}
  .tcard-linked:hover a.tlink{color:var(--accent)}

  /* Subtle per-card dependency line: "Needs 2, 5   Blocks 3, 4". */
  .tdeps{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px}
  .tdeps .dep{color:var(--muted)}
  .tdeps .dep .lbl{display:inline;font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);font-weight:700;margin:0}

  /* Done tasks read as complete WITHOUT relying on a badge: a green left accent
     bar plus a stronger dim + desaturate so finished cards recede from active
     ones. Overrides GOLDEN_CSS .tcard.shipped{opacity:.82} (later rule wins). */
  .tcard.shipped{opacity:.6;filter:saturate(.7);border-left:3px solid var(--go)}
  .tcard.shipped:hover{opacity:1;filter:none}

  /* Inline <code> gets a GitHub-style red-on-gray chip; <pre>/.qa blocks opt out. */
  code{background:var(--panel2);color:var(--danger);border:1px solid var(--border);border-radius:5px;padding:.5px 5px;font-size:12.5px}
  pre code,.qa code{background:none;color:inherit;border:0;border-radius:0;padding:0;font-size:inherit}
  .tbody code{background:var(--panel2);color:var(--danger)}
  :root[data-theme="light"] code{background:#eff1f3;color:var(--danger)}

  /* v2 read-only interactivity (progressive enhancement, injected inline) */
  .controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:0 0 22px;padding:14px 16px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}
  .controls[hidden]{display:none}
  .controls-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;width:100%}
  .ctl-btn{font:inherit;font-size:13px;font-weight:600;color:var(--ink);background:var(--chip);border:1px solid var(--border);border-radius:8px;padding:6px 12px;cursor:pointer}
  .ctl-btn:hover{border-color:var(--accent);color:var(--accent)}
  .ctl-field{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
  .ctl-field[hidden]{display:none}
  .ctl-lbl{text-transform:uppercase;letter-spacing:.08em;font-weight:700;font-size:10px}
  .ctl-sel,.ctl-inp{font:inherit;font-size:13px;color:var(--ink);background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:5px 9px}
  .ctl-sel:focus,.ctl-inp:focus{outline:none;border-color:var(--accent)}
  .ctl-jump .ctl-inp{min-width:150px}
  .progressbar{position:relative;margin-top:18px;height:22px;background:var(--chip);border:1px solid var(--border);border-radius:999px;overflow:hidden}
  .progressbar-fill{height:100%;background:linear-gradient(90deg,var(--w2),var(--go));transition:width .3s ease}
  .progressbar-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--ink);letter-spacing:.03em}
  .tcard.inprogress{outline:2px solid var(--warn);outline-offset:1px}
  .tcard.highlight{outline:2px solid var(--accent);outline-offset:1px;animation:cv-flash 1.6s ease}
  @keyframes cv-flash{0%{background:rgba(88,166,255,.18)}100%{background:transparent}}
  .cv-hidden,.cv-status-hidden,.cv-cat-hidden{display:none}

  .ctl-toggle{margin-left:auto}
  .ctl-theme{display:inline-flex;align-items:center;gap:6px}
  .ctl-theme .ctl-theme-ico{font-size:14px;line-height:1}

  /* Part A: wider layout overrides (golden caps .wrap at 1180px) */
  .wrap{max-width:min(96vw,1800px)}
  .subtitle{max-width:90ch}
  .waves{grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:18px}
  .metagrid{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
  .fwave{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
  @media(min-width:1500px){
    .waves{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
  }

  /* Part B: light theme, opt-in via data-theme="light" (default dark untouched) */
  :root[data-theme="light"]{
    --bg:#ffffff; --panel:#f6f8fa; --panel2:#eaeef2; --border:#d0d7de;
    --ink:#1f2328; --muted:#59636e; --faint:#818b98;
    --accent:#0969da; --go:#1a7f37; --warn:#9a6700; --danger:#cf222e;
    --purple:#8250df; --pink:#bf3989; --cyan:#1b7c83;
    --w1:#0969da; --w2:#1a7f37; --w3:#9a6700; --w4:#8250df; --wf:#bc4c00;
    --chip:#eff2f5;
    --shadow:0 1px 0 rgba(27,31,36,.04), 0 3px 12px rgba(140,149,159,.2);
  }
  /* light overrides for golden's hardcoded (non-var) colors */
  :root[data-theme="light"] body{
    background:radial-gradient(1200px 600px at 20% -10%, #ddeeff 0%, var(--bg) 55%) fixed;
  }
  :root[data-theme="light"] header.hero{
    background:linear-gradient(135deg, rgba(9,105,218,.08), rgba(130,80,223,.05));
  }
  :root[data-theme="light"] nav.toc{
    background:linear-gradient(var(--bg),rgba(255,255,255,.7));
  }
  :root[data-theme="light"] .qa{background:#f6f8fa;color:#1f2328}
  :root[data-theme="light"] .fcard .out{background:#f6f8fa}
  :root[data-theme="light"] .flow .n.f{color:#bc4c00}
  body{transition:background-color .2s ease,color .2s ease}
`;
