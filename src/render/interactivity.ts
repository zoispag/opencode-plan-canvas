import type { Plan } from "../model";

export const CONTROLS_MARKUP = [
  `<div class="controls" data-controls hidden>`,
  `<div class="controls-row">`,
  `<button type="button" class="ctl-btn" data-expand-all>Expand all</button>`,
  `<button type="button" class="ctl-btn" data-collapse-all>Collapse all</button>`,
  `<label class="ctl-field"><span class="ctl-lbl">Wave</span>`,
  `<select class="ctl-sel" data-filter-wave><option value="">All waves</option></select></label>`,
  `<label class="ctl-field"><span class="ctl-lbl">Category</span>`,
  `<select class="ctl-sel" data-filter-cat><option value="">All categories</option></select></label>`,
  `<label class="ctl-field"><span class="ctl-lbl">Status</span>`,
  `<select class="ctl-sel" data-filter-status><option value="all">All</option><option value="done">Done</option><option value="pending">Pending</option></select></label>`,
  `<label class="ctl-field ctl-jump"><span class="ctl-lbl">Jump to</span>`,
  `<input type="text" class="ctl-inp" list="task-ids" data-jump placeholder="task id…" autocomplete="off"></label>`,
  `<datalist id="task-ids"></datalist>`,
  `<button type="button" class="ctl-btn ctl-toggle ctl-theme" data-theme-toggle aria-pressed="false">`,
  `<span class="ctl-theme-ico" data-theme-ico aria-hidden="true">\u263e</span>`,
  `<span data-theme-lbl>Dark</span></button>`,
  `</div>`,
  `</div>`,
].join("");

const RAW_SCRIPT = String.raw`
(function () {
  "use strict";
  try {
    if (typeof document === "undefined") return;
    var ready = function (fn) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn, { once: true });
      } else {
        fn();
      }
    };
    ready(function () {
      try {
        init();
      } catch (e) {
        try { console.warn("plan-canvas interactivity disabled:", e); } catch (_) {}
      }
    });

    function init() {
      var root = document.querySelector("[data-controls]");
      var allCards = Array.prototype.slice.call(document.querySelectorAll(".tcard"));
      var detailCards = Array.prototype.slice.call(document.querySelectorAll("details.tcard"));

      if (root) root.hidden = false;

      setupProgress(allCards);
      if (!root) return;

      setupExpandCollapse(root, detailCards);
      setupWaveFilter(root);
      setupCategoryFilter(root, allCards);
      setupStatusFilter(root, allCards);
      setupJump(root);
      setupThemeToggle(root);
    }

    var THEME_KEY = "plan-canvas-theme";

    function storedTheme() {
      try {
        var v = window.localStorage.getItem(THEME_KEY);
        return v === "light" || v === "dark" ? v : null;
      } catch (e) { return null; }
    }

    function persistTheme(theme) {
      try { window.localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    }

    function prefersLight() {
      try {
        return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
      } catch (e) { return false; }
    }

    function applyTheme(theme, btn) {
      var el = document.documentElement;
      if (theme === "light") el.setAttribute("data-theme", "light");
      else el.removeAttribute("data-theme");
      if (!btn) return;
      var isLight = theme === "light";
      btn.setAttribute("aria-pressed", isLight ? "true" : "false");
      var ico = btn.querySelector("[data-theme-ico]");
      var lbl = btn.querySelector("[data-theme-lbl]");
      if (ico) ico.textContent = isLight ? "\u2600" : "\u263e";
      if (lbl) lbl.textContent = isLight ? "Light" : "Dark";
    }

    function setupThemeToggle(root) {
      var btn = root.querySelector("[data-theme-toggle]");
      if (!btn) return;
      var initial = storedTheme();
      if (!initial) initial = prefersLight() ? "light" : "dark";
      applyTheme(initial, btn);
      btn.addEventListener("click", function () {
        var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
        applyTheme(next, btn);
        persistTheme(next);
      });
    }

    function isShipped(card) {
      return card.classList.contains("shipped");
    }

    function setupProgress(allCards) {
      var total = allCards.length;
      var done = 0;
      for (var i = 0; i < allCards.length; i++) {
        if (isShipped(allCards[i])) done++;
      }
      var hero = document.querySelector("header.hero");
      if (!hero) return;
      var pct = total > 0 ? Math.round((done / total) * 100) : 0;
      var bar = document.createElement("div");
      bar.className = "progressbar";
      bar.setAttribute("data-progress", "");
      var fill = document.createElement("div");
      fill.className = "progressbar-fill";
      fill.style.width = pct + "%";
      var label = document.createElement("div");
      label.className = "progressbar-label";
      label.textContent = done + "/" + total + " tasks done (" + pct + "%)";
      bar.appendChild(fill);
      bar.appendChild(label);
      hero.appendChild(bar);
    }

    function setupExpandCollapse(root, detailCards) {
      var expand = root.querySelector("[data-expand-all]");
      var collapse = root.querySelector("[data-collapse-all]");
      if (expand) {
        expand.addEventListener("click", function () {
          for (var i = 0; i < detailCards.length; i++) detailCards[i].open = true;
        });
      }
      if (collapse) {
        collapse.addEventListener("click", function () {
          for (var i = 0; i < detailCards.length; i++) detailCards[i].open = false;
        });
      }
    }

    function waveColumns() {
      return Array.prototype.slice.call(document.querySelectorAll(".waves > .wave"));
    }

    function waveName(col) {
      var head = col.querySelector(".whead > span");
      return head ? (head.textContent || "").trim() : "";
    }

    function setupWaveFilter(root) {
      var sel = root.querySelector("[data-filter-wave]");
      if (!sel) return;
      var cols = waveColumns();
      var seen = {};
      for (var i = 0; i < cols.length; i++) {
        var name = waveName(cols[i]);
        if (!name || seen[name]) continue;
        seen[name] = true;
        var opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", function () {
        var want = sel.value;
        for (var j = 0; j < cols.length; j++) {
          var match = want === "" || waveName(cols[j]) === want;
          cols[j].classList.toggle("cv-hidden", !match);
        }
      });
    }

    function cardCategories(card) {
      var out = [];
      var badges = card.querySelectorAll(".cat");
      for (var i = 0; i < badges.length; i++) {
        var t = (badges[i].textContent || "").trim();
        if (t) out.push(t);
      }
      return out;
    }

    function setupCategoryFilter(root, allCards) {
      var sel = root.querySelector("[data-filter-cat]");
      if (!sel) return;
      var seen = {};
      var ordered = [];
      for (var i = 0; i < allCards.length; i++) {
        var cats = cardCategories(allCards[i]);
        for (var j = 0; j < cats.length; j++) {
          if (!seen[cats[j]]) {
            seen[cats[j]] = true;
            ordered.push(cats[j]);
          }
        }
      }
      if (ordered.length === 0) {
        var field = sel.closest(".ctl-field");
        if (field) field.hidden = true;
        return;
      }
      for (var k = 0; k < ordered.length; k++) {
        var opt = document.createElement("option");
        opt.value = ordered[k];
        opt.textContent = ordered[k];
        sel.appendChild(opt);
      }
      sel.addEventListener("change", function () {
        var want = sel.value;
        for (var m = 0; m < allCards.length; m++) {
          var cats = cardCategories(allCards[m]);
          var match = want === "" || cats.indexOf(want) !== -1;
          allCards[m].classList.toggle("cv-cat-hidden", !match);
        }
        refreshCounts();
      });
    }

    function setupStatusFilter(root, allCards) {
      var sel = root.querySelector("[data-filter-status]");
      if (!sel) return;
      sel.addEventListener("change", function () {
        var want = sel.value;
        for (var i = 0; i < allCards.length; i++) {
          var shipped = isShipped(allCards[i]);
          var match = want === "all" || (want === "done" && shipped) || (want === "pending" && !shipped);
          allCards[i].classList.toggle("cv-status-hidden", !match);
        }
        refreshCounts();
      });
    }

    function isVisibleCard(card) {
      return !card.classList.contains("cv-status-hidden") && !card.classList.contains("cv-cat-hidden");
    }

    function refreshCounts() {
      var cols = waveColumns();
      for (var i = 0; i < cols.length; i++) {
        var cnt = cols[i].querySelector(".whead .cnt");
        if (!cnt) continue;
        var cards = cols[i].querySelectorAll(".tcard");
        var visible = 0;
        var done = 0;
        for (var j = 0; j < cards.length; j++) {
          if (!isVisibleCard(cards[j])) continue;
          visible++;
          if (isShipped(cards[j])) done++;
        }
        cnt.textContent = done > 0 ? done + " done" : visible + " tasks";
      }
    }

    function taskIds() {
      var ids = [];
      var seen = {};
      var tids = document.querySelectorAll(".tcard .tid");
      for (var i = 0; i < tids.length; i++) {
        var raw = (tids[i].textContent || "").trim();
        raw = raw.replace(/^\u2713\s*/, "");
        if (raw && !seen[raw]) {
          seen[raw] = true;
          ids.push(raw);
        }
      }
      return ids;
    }

    function cardForId(id) {
      var tids = document.querySelectorAll(".tcard .tid");
      for (var i = 0; i < tids.length; i++) {
        var raw = (tids[i].textContent || "").trim().replace(/^\u2713\s*/, "");
        if (raw === id) {
          var card = tids[i].closest(".tcard");
          if (card) return card;
        }
      }
      return null;
    }

    function setupJump(root) {
      var input = root.querySelector("[data-jump]");
      var list = document.getElementById("task-ids");
      if (!input || !list) return;
      var ids = taskIds();
      for (var i = 0; i < ids.length; i++) {
        var opt = document.createElement("option");
        opt.value = ids[i];
        list.appendChild(opt);
      }
      var jump = function () {
        var id = input.value.trim();
        if (!id) return;
        var card = cardForId(id);
        if (!card) return;
        card.open = true;
        var prev = document.querySelector(".highlight");
        if (prev) prev.classList.remove("highlight");
        card.classList.add("highlight");
        if (typeof card.scrollIntoView === "function") {
          card.scrollIntoView({ block: "center" });
        }
        window.setTimeout(function () {
          card.classList.remove("highlight");
        }, 1600);
      };
      input.addEventListener("change", jump);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          jump();
        }
      });
    }
  } catch (e) {
    try { console.warn("plan-canvas interactivity failed to load:", e); } catch (_) {}
  }
})();
`;

export const INLINE_SCRIPT = `<script>${RAW_SCRIPT}</script>`;

export function firstUncheckedTaskId(plan: Plan): string | undefined {
  for (const t of plan.tasks) {
    if (!t.checked) return t.id;
  }
  return undefined;
}

export interface TaskAction {
  taskId: string;
  prompt: string;
  url?: string;
}

const FULL_URL_RE = /\bhttps?:\/\/[^\s)"'<>\]]+/;

function firstFullUrl(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(FULL_URL_RE);
  if (!match) return undefined;
  const url = match[0];
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return undefined;
}

export function resolveTaskActions(plan: Plan): TaskAction[] {
  const actions: TaskAction[] = [];
  for (const task of plan.tasks) {
    let whatToDo = "";
    for (const field of task.fields) {
      if (field.label.trim().toLowerCase() === "what to do") {
        whatToDo = field.content;
        break;
      }
    }
    const prompt = whatToDo ? `${task.title}\n\n${whatToDo}` : task.title;

    let url = firstFullUrl(task.state.ref);
    if (!url) url = firstFullUrl(task.stateComment);
    if (!url) {
      for (const field of task.fields) {
        url = firstFullUrl(field.content);
        if (url) break;
      }
    }

    actions.push({ taskId: task.id, prompt, url });
  }
  return actions;
}

function escapeForJson(s: string): string {
  // Safe-JSON-in-HTML: escape <>& so a literal </script> in plan text cannot
  // break out of the <script> data island. Valid JSON escapes; stays parseable.
  return JSON.stringify(s)
    .slice(1, -1)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export function actionsDataIsland(actions: TaskAction[]): string {
  const rows = actions.map((a) => {
    const parts = [`"taskId":"${escapeForJson(a.taskId)}"`, `"prompt":"${escapeForJson(a.prompt)}"`];
    if (a.url) parts.push(`"url":"${escapeForJson(a.url)}"`);
    return `{${parts.join(",")}}`;
  });
  const json = `[${rows.join(",")}]`;
  return `<script type="application/json" id="plan-actions">${json}</script>`;
}

const RAW_ACTIONS_SCRIPT = String.raw`
(function () {
  "use strict";
  try {
    if (typeof document === "undefined") return;
    var ready = function (fn) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn, { once: true });
      } else {
        fn();
      }
    };
    ready(function () {
      try { initActions(); } catch (e) {
        try { console.warn("plan-canvas actions disabled:", e); } catch (_) {}
      }
    });

    function loadActions() {
      var node = document.getElementById("plan-actions");
      if (!node) return [];
      try { return JSON.parse(node.textContent || "[]"); } catch (e) { return []; }
    }

    function cardForId(id) {
      var tids = document.querySelectorAll(".tcard .tid");
      for (var i = 0; i < tids.length; i++) {
        var raw = (tids[i].textContent || "").trim().replace(/^\u2713\s*/, "");
        if (raw === id) {
          var card = tids[i].closest(".tcard");
          if (card) return card;
        }
      }
      return null;
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (e) {}
      return null;
    }

    function flash(btn, text) {
      var old = btn.textContent;
      btn.textContent = text;
      window.setTimeout(function () { btn.textContent = old; }, 1200);
    }

    function initActions() {
      var actions = loadActions();
      for (var i = 0; i < actions.length; i++) {
        var a = actions[i];
        var card = cardForId(a.taskId);
        if (!card) continue;
        var summary = card.querySelector("summary");
        if (!summary) continue;
        if (summary.querySelector(".action-row")) continue;
        var row = document.createElement("div");
        row.className = "action-row";
        row.setAttribute("data-actions-for", a.taskId);

        var copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "action-btn action-copy";
        copyBtn.setAttribute("data-action", "copy-prompt");
        copyBtn.textContent = "copy task prompt";
        (function (btn, prompt) {
          btn.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            copyText(prompt);
            flash(btn, "copied");
          });
        })(copyBtn, a.prompt || "");
        row.appendChild(copyBtn);

        if (a.url) {
          var openBtn = document.createElement("button");
          openBtn.type = "button";
          openBtn.className = "action-btn action-open";
          openBtn.setAttribute("data-action", "open-ref");
          openBtn.textContent = "open ref";
          (function (btn, taskId) {
            btn.addEventListener("click", function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              try {
                fetch("/action", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ type: "open-ref", taskId: taskId }),
                }).then(function (res) {
                  flash(btn, res.ok ? "opened" : "failed");
                }).catch(function () { flash(btn, "failed"); });
              } catch (e) { flash(btn, "failed"); }
            });
          })(openBtn, a.taskId);
          row.appendChild(openBtn);
        }

        summary.appendChild(row);
      }
    }
  } catch (e) {
    try { console.warn("plan-canvas actions failed to load:", e); } catch (_) {}
  }
})();
`;

export const ACTIONS_SCRIPT = `<script>${RAW_ACTIONS_SCRIPT}</script>`;

export const ACTIONS_STYLE = [
  `<style>`,
  `.action-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}`,
  `.action-btn{font:inherit;font-size:12px;font-weight:600;color:var(--ink);background:var(--chip);border:1px solid var(--border);border-radius:8px;padding:4px 10px;cursor:pointer}`,
  `.action-btn:hover{border-color:var(--accent);color:var(--accent)}`,
  `</style>`,
].join("");

export function injectActions(html: string, actions: TaskAction[]): string {
  const block = `${ACTIONS_STYLE}\n${actionsDataIsland(actions)}\n${ACTIONS_SCRIPT}\n`;
  const marker = "</body>";
  const idx = html.lastIndexOf(marker);
  if (idx === -1) return `${html}\n${block}`;
  return `${html.slice(0, idx)}${block}${html.slice(idx)}`;
}

export function applyInprogress(body: string): string {
  const idx = body.indexOf(`<details class="tcard">`);
  if (idx === -1) return body;
  return (
    body.slice(0, idx) +
    `<details class="tcard inprogress">` +
    body.slice(idx + `<details class="tcard">`.length)
  );
}

export const MESSAGING_MAX_LEN = 8000;

const RAW_MESSAGING_SCRIPT = String.raw`
(function () {
  "use strict";
  try {
    if (typeof document === "undefined") return;
    var MAX_LEN = ${MESSAGING_MAX_LEN};
    var ready = function (fn) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn, { once: true });
      } else {
        fn();
      }
    };
    ready(function () {
      try { initMessaging(); } catch (e) {
        try { console.warn("plan-canvas messaging disabled:", e); } catch (_) {}
      }
    });

    function postPrompt(text, taskId) {
      var payload = { text: text };
      if (taskId) payload.taskId = taskId;
      return fetch("/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then(function (res) {
        return res.status === 202 || res.ok;
      });
    }

    function flash(el, text) {
      var old = el.textContent;
      el.textContent = text;
      window.setTimeout(function () { el.textContent = old; }, 1400);
    }

    function buildBar() {
      var bar = document.createElement("div");
      bar.className = "msg-bar";
      bar.setAttribute("data-msg-bar", "");

      var input = document.createElement("textarea");
      input.className = "msg-input";
      input.setAttribute("rows", "1");
      input.setAttribute("placeholder", "Message the agent\u2026 (e.g. add a task to do xyz)");
      input.setAttribute("maxlength", String(MAX_LEN));

      var send = document.createElement("button");
      send.type = "button";
      send.className = "msg-send";
      send.textContent = "Send";

      var submit = function () {
        var text = (input.value || "").trim();
        if (!text) return;
        send.disabled = true;
        postPrompt(text, null).then(function (ok) {
          send.disabled = false;
          if (ok) {
            input.value = "";
            flash(send, "Sent");
          } else {
            flash(send, "Failed");
          }
        }).catch(function () {
          send.disabled = false;
          flash(send, "Failed");
        });
      };

      send.addEventListener("click", submit);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault();
          submit();
        }
      });

      bar.appendChild(input);
      bar.appendChild(send);
      return bar;
    }

    function taskCards() {
      return Array.prototype.slice.call(document.querySelectorAll("details.tcard"));
    }

    function taskIdOf(card) {
      var tid = card.querySelector(".tid");
      if (!tid) return "";
      return (tid.textContent || "").trim().replace(/^\u2713\s*/, "");
    }

    function addTaskButton(card) {
      var summary = card.querySelector("summary");
      if (!summary) return;
      if (summary.querySelector(".msg-task-btn")) return;
      var id = taskIdOf(card);
      if (!id) return;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "msg-task-btn";
      btn.setAttribute("data-msg-task", id);
      btn.textContent = "send message";
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openTaskComposer(card, id, btn);
      });

      var row = summary.querySelector(".action-row");
      if (row) {
        row.appendChild(btn);
      } else {
        var wrap = document.createElement("div");
        wrap.className = "action-row";
        wrap.appendChild(btn);
        summary.appendChild(wrap);
      }
    }

    function openTaskComposer(card, id, btn) {
      var body = card.querySelector(".tbody") || card;
      var existing = card.querySelector(".msg-composer");
      if (existing) {
        var ta = existing.querySelector("textarea");
        if (ta) ta.focus();
        return;
      }
      card.open = true;

      var box = document.createElement("div");
      box.className = "msg-composer";

      var ta = document.createElement("textarea");
      ta.className = "msg-input";
      ta.setAttribute("rows", "2");
      ta.setAttribute("maxlength", String(MAX_LEN));
      ta.setAttribute("placeholder", "Message about task " + id + "\u2026");

      var send = document.createElement("button");
      send.type = "button";
      send.className = "msg-send";
      send.textContent = "Send";

      var submit = function () {
        var text = (ta.value || "").trim();
        if (!text) return;
        send.disabled = true;
        postPrompt(text, id).then(function (ok) {
          send.disabled = false;
          if (ok) {
            flash(send, "Sent");
            window.setTimeout(function () {
              if (box.parentNode) box.parentNode.removeChild(box);
            }, 700);
          } else {
            flash(send, "Failed");
          }
        }).catch(function () {
          send.disabled = false;
          flash(send, "Failed");
        });
      };

      send.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        submit();
      });
      ta.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault();
          submit();
        }
      });

      box.appendChild(ta);
      box.appendChild(send);
      body.appendChild(box);
      ta.focus();
    }

    function initMessaging() {
      var wrap = document.querySelector(".wrap") || document.body;
      if (wrap && !document.querySelector("[data-msg-bar]")) {
        wrap.insertBefore(buildBar(), wrap.firstChild);
      }
      var cards = taskCards();
      for (var i = 0; i < cards.length; i++) addTaskButton(cards[i]);
    }
  } catch (e) {
    try { console.warn("plan-canvas messaging failed to load:", e); } catch (_) {}
  }
})();
`;

export const MESSAGING_SCRIPT = `<script>${RAW_MESSAGING_SCRIPT}</script>`;

export const MESSAGING_STYLE = [
  `<style>`,
  `.msg-bar{display:flex;gap:8px;align-items:flex-start;margin:0 0 14px;padding:10px 12px;background:var(--panel,#161b22);border:1px solid var(--border,#30363d);border-radius:10px}`,
  `.msg-input{flex:1;min-width:0;font:inherit;font-size:13px;color:var(--ink,#c9d1d9);background:var(--bg,#0d1117);border:1px solid var(--border,#30363d);border-radius:8px;padding:8px 10px;resize:vertical;line-height:1.4}`,
  `.msg-input:focus{outline:none;border-color:var(--accent,#58a6ff)}`,
  `.msg-send{font:inherit;font-size:13px;font-weight:600;color:#fff;background:var(--accent,#238636);border:1px solid var(--accent,#238636);border-radius:8px;padding:8px 16px;cursor:pointer;white-space:nowrap}`,
  `.msg-send:hover{filter:brightness(1.1)}`,
  `.msg-send:disabled{opacity:.6;cursor:default}`,
  `.msg-task-btn{font:inherit;font-size:12px;font-weight:600;color:var(--ink,#c9d1d9);background:var(--chip,#21262d);border:1px solid var(--border,#30363d);border-radius:8px;padding:4px 10px;cursor:pointer}`,
  `.msg-task-btn:hover{border-color:var(--accent,#58a6ff);color:var(--accent,#58a6ff)}`,
  `.msg-composer{display:flex;gap:8px;align-items:flex-start;margin-top:10px}`,
  `</style>`,
].join("");

export function injectMessaging(html: string): string {
  const block = `${MESSAGING_STYLE}\n${MESSAGING_SCRIPT}\n`;
  const marker = "</body>";
  const idx = html.lastIndexOf(marker);
  if (idx === -1) return `${html}\n${block}`;
  return `${html.slice(0, idx)}${block}${html.slice(idx)}`;
}
