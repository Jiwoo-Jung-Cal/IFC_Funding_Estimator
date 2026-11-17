/* IFC Funding Estimator — web client.
 * All state (budgets + investment log) lives in localStorage; the server is a
 * stateless prediction API. Business rules mirror the desktop app (app.py). */
(() => {
  "use strict";

  const REGIONS = [1, 2, 3, 4, 5];
  const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
  const STORE_KEY = "ifc-estimator:v1";
  const THEME_KEY = "ifc-estimator:theme";
  const CSV_COLS = ["id", "Region", "Quarter", "Project Type", "Climate", "Gender", "Invested"];

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  };
  const icon = (path) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.innerHTML = path;
    return s;
  };

  // ---------- money ----------
  const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
  const fmt = (x) => usd2.format(Number(x) || 0);
  const fmtShort = (x) => (Math.abs(x) >= 1e6 ? compact.format(x) : usd0.format(Math.round(x)));
  const parseMoney = (s) => {
    const n = parseFloat(String(s ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  // ---------- business-area normalisation (mirrors app.py) ----------
  const normalizeBA = (s) =>
    String(s ?? "")
      .trim()
      .toUpperCase()
      .replace(/&/g, " AND ")
      .replace(/[‐-―]/g, "-")
      .replace(/[^A-Z0-9\-\/\s:]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*-\s*/g, "-")
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s*:\s*/g, ":");
  const fingerprint = (s) => normalizeBA(s).replace(/[^A-Z0-9]/g, "");
  const yes = (v) => ["yes", "y", "true", "1"].includes(String(v).trim().toLowerCase());
  const normQuarter = (q) => (QUARTERS.includes(String(q).trim().toUpperCase()) ? String(q).trim().toUpperCase() : "Q1");
  const normRegion = (r) => {
    const m = String(r ?? "").match(/\d+/);
    const n = m ? parseInt(m[0], 10) : 1;
    return REGIONS.includes(n) ? n : 1;
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(16).slice(2) + Date.now().toString(16));

  // ---------- state ----------
  const blankBudgets = () => Object.fromEntries(REGIONS.map((r) => [r, 0]));
  let state = { budgets: blankBudgets(), log: [] };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (raw && typeof raw === "object") {
        state.budgets = { ...blankBudgets(), ...(raw.budgets || {}) };
        state.log = Array.isArray(raw.log) ? raw.log.map(cleanEntry) : [];
      }
    } catch (_) { /* storage unavailable: start empty */ }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
  }
  function cleanEntry(r) {
    return {
      id: String(r.id || uid()),
      region: normRegion(r.region ?? r.Region),
      quarter: normQuarter(r.quarter ?? r.Quarter),
      projectType: normalizeBA(r.projectType ?? r["Project Type"]),
      climate: yes(r.climate ?? r.Climate) ? "Yes" : "No",
      gender: yes(r.gender ?? r.Gender) ? "Yes" : "No",
      invested: Math.max(0, round2(parseMoney(r.invested ?? r.Invested))),
    };
  }

  const investedBy = () => {
    const t = blankBudgets();
    for (const r of state.log) t[r.region] += r.invested;
    return t;
  };
  const remainingBy = () => {
    const inv = investedBy();
    return Object.fromEntries(REGIONS.map((r) => [r, round2((Number(state.budgets[r]) || 0) - inv[r])]));
  };
  const remainingFor = (region) => Math.max(0, remainingBy()[region]);

  // ---------- UI state ----------
  const ui = { region: 1, quarter: "Q1", editingBudgets: false, result: null, editingRow: null, plan: null, types: [], typeFp: new Set(), typeNorm: new Set() };

  // ---------- toasts & dialog ----------
  function toast(msg, kind = "info") {
    const t = el("div", { class: `toast ${kind === "error" ? "error" : ""}`, role: "status", text: msg });
    $("#toasts").append(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 220); }, kind === "error" ? 5200 : 3200);
  }
  function confirmDialog(title, text, okLabel = "Confirm") {
    const dlg = $("#confirm-dialog");
    $("#dlg-title").textContent = title;
    $("#dlg-text").textContent = text;
    $("#dlg-ok").textContent = okLabel;
    if (typeof dlg.showModal !== "function") return Promise.resolve(window.confirm(`${title}\n\n${text}`));
    return new Promise((resolve) => {
      dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
      dlg.returnValue = "";
      dlg.showModal();
    });
  }

  // ---------- segmented controls ----------
  function segmented(container, options, get, set) {
    container.replaceChildren(
      ...options.map((o) =>
        el("button", {
          type: "button", role: "radio", "aria-checked": String(get() === o.value), text: o.label,
          onclick: () => { set(o.value); renderSegments(); },
        })
      )
    );
  }
  function renderSegments() {
    segmented($("#seg-region"), REGIONS.map((r) => ({ value: r, label: `Region ${r}` })), () => ui.region, (v) => { ui.region = v; renderRegionHint(); });
    segmented($("#seg-quarter"), QUARTERS.map((q) => ({ value: q, label: q })), () => ui.quarter, (v) => (ui.quarter = v));
    if (window.matchMedia("(max-width: 600px)").matches) {
      $("#seg-region").querySelectorAll("button").forEach((b, i) => (b.textContent = `R${REGIONS[i]}`));
    }
  }
  function renderRegionHint() { $("#region-remaining").textContent = fmt(remainingFor(ui.region)); }

  // ---------- overview + budgets ----------
  function renderOverview() {
    const inv = investedBy();
    const rem = remainingBy();
    const total = REGIONS.reduce((s, r) => s + (Number(state.budgets[r]) || 0), 0);
    const alloc = REGIONS.reduce((s, r) => s + inv[r], 0);
    $("#kpi-budget").textContent = fmtShort(total);
    $("#kpi-allocated").textContent = fmtShort(alloc);
    $("#kpi-allocated-pct").textContent = total > 0 ? `${((alloc / total) * 100).toFixed(1)}% of budget` : "No budget set";
    $("#kpi-remaining").textContent = fmtShort(total - alloc);
    $("#kpi-count").textContent = String(state.log.length);

    const grid = $("#regions");
    grid.replaceChildren(
      ...REGIONS.map((r) => {
        const budget = Number(state.budgets[r]) || 0;
        const used = budget > 0 ? inv[r] / budget : inv[r] > 0 ? 1.01 : 0;
        const pct = Math.min(100, used * 100);
        const fill = el("span", { class: `bar-fill ${used > 1 ? "over" : used > 0.85 ? "warn" : ""}` });
        requestAnimationFrame(() => (fill.style.width = `${pct}%`));
        const card = el("div", { class: "region" },
          el("div", { class: "region-top" },
            el("span", { class: "region-name", text: `Region ${r}` }),
            el("span", { class: "region-pct", text: budget > 0 ? `${Math.round(used * 100)}% used` : "" })
          )
        );
        if (ui.editingBudgets) {
          card.append(
            el("div", { class: "money-input" },
              el("span", { text: "$" }),
              el("input", { name: `budget_${r}`, inputmode: "decimal", value: budget ? budget.toFixed(2) : "", placeholder: "0.00", "aria-label": `Region ${r} budget` })
            ),
            el("div", { class: "hint", text: `Invested so far: ${fmt(inv[r])}` })
          );
        } else {
          card.append(
            el("div", { class: `region-remaining ${rem[r] < 0 ? "neg" : ""}`, text: fmt(rem[r]), title: "Remaining" }),
            el("div", { class: "region-of", text: `remaining of ${fmt(budget)}` }),
            el("div", { class: "bar" }, fill)
          );
        }
        return card;
      })
    );
    $("#budget-actions").hidden = !ui.editingBudgets;
    $("#btn-edit-budgets").hidden = ui.editingBudgets;
    renderRegionHint();
  }

  function startEditBudgets() {
    ui.editingBudgets = true;
    renderOverview();
    $("#regions input")?.focus();
  }

  $("#btn-edit-budgets").addEventListener("click", startEditBudgets);
  $("#btn-cancel-budgets").addEventListener("click", () => { ui.editingBudgets = false; renderOverview(); });
  $("#budget-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    for (const r of REGIONS) state.budgets[r] = Math.max(0, round2(parseMoney(fd.get(`budget_${r}`))));
    ui.editingBudgets = false;
    save();
    renderAll();
    toast("Budgets updated.");
  });

  // ---------- project type combobox ----------
  const ptype = $("#ptype");
  const plist = $("#ptype-list");
  let activeIdx = -1;

  const isKnown = (s) => ui.typeNorm.has(normalizeBA(s)) || ui.typeFp.has(fingerprint(s));

  function rankTypes(q) {
    const qn = normalizeBA(q);
    const qf = fingerprint(q);
    if (!qn) return ui.types.slice();
    const tokens = qn.split(/[\s\-\/:]+/).filter((t) => t.length >= 2);
    const scored = [];
    for (const t of ui.types) {
      const fp = fingerprint(t);
      let s = 0;
      if (t.startsWith(qn)) s = 4;
      else if (qf && fp.startsWith(qf)) s = 3;
      else if (t.includes(qn)) s = 2;
      else if (qf && fp.includes(qf)) s = 1.5;
      else if (tokens.length) {
        const hits = tokens.filter((tk) => t.includes(tk)).length;
        if (hits === tokens.length) s = 1;
        else if (hits > 0) s = hits / tokens.length / 2;
      }
      if (s > 0) scored.push([s, t]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
    return scored.map((x) => x[1]).slice(0, 50);
  }

  function highlight(text, q) {
    const qn = normalizeBA(q);
    const i = qn ? text.indexOf(qn) : -1;
    if (i < 0) return [document.createTextNode(text)];
    return [text.slice(0, i), el("mark", { text: text.slice(i, i + qn.length) }), text.slice(i + qn.length)];
  }

  function openList() {
    const q = ptype.value;
    const matches = rankTypes(q);
    activeIdx = -1;
    if (!ui.types.length) {
      plist.replaceChildren(el("li", { class: "none", text: "Loading project types…" }));
    } else if (!matches.length) {
      plist.replaceChildren(el("li", { class: "none", text: "No known match — you can still estimate with this text." }));
    } else {
      plist.replaceChildren(
        ...matches.map((m, i) =>
          el("li", {
            role: "option", id: `opt-${i}`, "aria-selected": "false", "data-value": m,
            onmousedown: (e) => { e.preventDefault(); choose(m); },
          }, ...highlight(m, q))
        )
      );
    }
    plist.hidden = false;
    ptype.setAttribute("aria-expanded", "true");
  }
  function closeList() {
    plist.hidden = true;
    ptype.setAttribute("aria-expanded", "false");
    ptype.removeAttribute("aria-activedescendant");
  }
  function choose(v) {
    ptype.value = v;
    closeList();
    updateKnownBadge();
  }
  function updateKnownBadge() {
    const badge = $("#ptype-badge");
    const v = ptype.value.trim();
    if (!v || !ui.types.length) { badge.hidden = true; return; }
    const known = isKnown(v);
    badge.hidden = false;
    badge.className = `badge ${known ? "ok" : "warn"}`;
    badge.textContent = known ? "Known type" : "Not in data";
    $("#ptype-hint").textContent = known
      ? "This business area appears in the training data."
      : "Not in the training data — the model can still estimate from the text, but accuracy may be lower.";
  }
  function moveActive(d) {
    const items = [...plist.querySelectorAll("li[role=option]")];
    if (!items.length) return;
    activeIdx = (activeIdx + d + items.length) % items.length;
    items.forEach((it, i) => it.setAttribute("aria-selected", String(i === activeIdx)));
    items[activeIdx].scrollIntoView({ block: "nearest" });
    ptype.setAttribute("aria-activedescendant", items[activeIdx].id);
  }

  ptype.addEventListener("focus", openList);
  ptype.addEventListener("click", () => plist.hidden && openList());
  ptype.addEventListener("input", () => { openList(); updateKnownBadge(); });
  ptype.addEventListener("blur", () => setTimeout(() => { closeList(); updateKnownBadge(); }, 120));
  ptype.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); plist.hidden ? openList() : moveActive(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
    else if (e.key === "Escape") closeList();
    else if (e.key === "Enter" && !plist.hidden && activeIdx >= 0) {
      e.preventDefault();
      const item = plist.querySelectorAll("li[role=option]")[activeIdx];
      if (item) choose(item.dataset.value);
    }
  });

  async function loadTypes() {
    try {
      const res = await fetch("/api/project-types");
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      ui.types = data.matches || [];
      ui.typeNorm = new Set(ui.types.map(normalizeBA));
      ui.typeFp = new Set(ui.types.map(fingerprint));
      if (!plist.hidden) openList();
      updateKnownBadge();
    } catch (_) {
      toast("Couldn't load project types. Check your connection and reload.", "error");
    }
  }

  // ---------- estimate ----------
  $("#estimate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const projectType = ptype.value.trim();
    if (!projectType) { ptype.focus(); return; }
    closeList();
    const btn = $("#btn-estimate");
    btn.classList.add("loading");
    btn.disabled = true;
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: ui.region, quarter: ui.quarter, project_type: projectType,
          climate: $("#climate").checked, gender: $("#gender").checked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

      const before = remainingFor(ui.region);
      const recommended = round2(Math.min(data.ratio * before, before));
      ui.result = {
        region: ui.region, quarter: ui.quarter, projectType: data.project_type, known: data.known,
        climate: $("#climate").checked ? "Yes" : "No", gender: $("#gender").checked ? "Yes" : "No",
        ratio: data.ratio, ratioModel: data.ratio_model, ratioHistory: data.ratio_history, alpha: data.alpha,
        before, recommended, after: round2(Math.max(0, before - recommended)),
      };
      renderResult();
      if (before <= 0) toast(`Region ${ui.region} has no remaining budget. Set budgets first.`, "error");
      if (window.matchMedia("(max-width: 860px)").matches) $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      toast(`Estimate failed: ${err.message}`, "error");
    } finally {
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  });

  function renderResult() {
    const r = ui.result;
    $("#result-empty").hidden = !!r;
    $("#result-body").hidden = !r;
    if (!r) return;
    $("#result-meta").replaceChildren(...[
      el("span", { class: "badge neutral", text: `Region ${r.region}` }),
      el("span", { class: "badge neutral", text: r.quarter }),
      el("span", { class: `badge ${r.known ? "ok" : "warn"}`, text: r.known ? "Known type" : "Not in data" }),
      r.climate === "Yes" ? el("span", { class: "badge neutral", text: "Climate" }) : null,
      r.gender === "Yes" ? el("span", { class: "badge neutral", text: "Gender" }) : null,
      el("span", { class: "badge neutral mono", text: r.projectType, title: r.projectType, style: "max-width:100%;overflow:hidden;text-overflow:ellipsis" }),
    ].filter(Boolean));
    $("#result-amount").textContent = fmt(r.recommended);
    $("#result-ratio").textContent = `${(r.ratio * 100).toFixed(2)}%`;
    $("#result-before").textContent = fmt(r.before);
    $("#result-after").textContent = fmt(r.after);
    const bar = $("#result-bar");
    bar.style.width = "0";
    requestAnimationFrame(() => (bar.style.width = `${Math.min(100, r.ratio * 100)}%`));
    $("#x-model").textContent = `${(r.ratioModel * 100).toFixed(2)}%`;
    $("#x-hist").textContent = `${(r.ratioHistory * 100).toFixed(2)}%`;
    $("#x-alpha").textContent = `${Math.round(r.alpha * 100)} / ${Math.round((1 - r.alpha) * 100)}`;
    $("#confirm-amount").value = r.recommended.toFixed(2);
  }

  $("#confirm-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const r = ui.result;
    if (!r) return;
    const remaining = remainingFor(r.region);
    let amount = Math.max(0, round2(parseMoney($("#confirm-amount").value)));
    let capped = false;
    if (amount > remaining) { amount = round2(remaining); capped = true; }
    state.log.push({ id: uid(), region: r.region, quarter: r.quarter, projectType: normalizeBA(r.projectType), climate: r.climate, gender: r.gender, invested: amount });
    save();
    ui.result = null;
    renderAll();
    toast(capped ? `Logged ${fmt(amount)} (capped at remaining budget).` : `Logged ${fmt(amount)} to Region ${r.region}.`);
  });

  // ---------- log table ----------
  const filterRegion = $("#filter-region");
  const filterQuarter = $("#filter-quarter");
  filterRegion.append(el("option", { value: "", text: "All regions" }), ...REGIONS.map((r) => el("option", { value: r, text: `Region ${r}` })));
  filterQuarter.append(el("option", { value: "", text: "All quarters" }), ...QUARTERS.map((q) => el("option", { value: q, text: q })));
  filterRegion.addEventListener("change", renderLog);
  filterQuarter.addEventListener("change", renderLog);

  const ICON_EDIT = '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>';
  const ICON_DEL = '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>';

  function renderLog() {
    // Running "remaining after" follows log order (oldest first), like the desktop app.
    const running = Object.fromEntries(REGIONS.map((r) => [r, Number(state.budgets[r]) || 0]));
    const rows = state.log.map((r) => {
      running[r.region] = round2(running[r.region] - r.invested);
      return { ...r, after: running[r.region] };
    });
    const fr = filterRegion.value, fq = filterQuarter.value;
    const shown = rows.filter((r) => (!fr || String(r.region) === fr) && (!fq || r.quarter === fq)).reverse();

    const body = $("#log-body");
    body.replaceChildren(
      ...shown.map((r) => {
        const editing = ui.editingRow === r.id;
        let investedCell;
        if (editing) {
          const input = el("input", { value: r.invested.toFixed(2), inputmode: "decimal", "aria-label": "Invested amount" });
          const commit = () => updateEntry(r.id, input.value);
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { ui.editingRow = null; renderLog(); }
          });
          investedCell = el("td", { colspan: 2 },
            el("div", { class: "edit-cell" },
              el("div", { class: "money-input" }, el("span", { text: "$" }), input),
              el("button", { class: "btn btn-primary btn-sm", type: "button", text: "Save", onclick: commit }),
              el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Cancel", onclick: () => { ui.editingRow = null; renderLog(); } })
            )
          );
          requestAnimationFrame(() => { input.focus(); input.select(); });
        }
        return el("tr", {},
          el("td", {}, el("span", { class: "chip", text: `R${r.region}` })),
          el("td", { text: r.quarter }),
          el("td", { class: "ptype", text: r.projectType }),
          el("td", {}, el("div", { class: "tags" },
            r.climate === "Yes" ? el("span", { class: "badge ok", text: "Climate" }) : null,
            r.gender === "Yes" ? el("span", { class: "badge neutral", text: "Gender" }) : null,
            r.climate !== "Yes" && r.gender !== "Yes" ? el("span", { class: "muted", text: "—" }) : null
          )),
          ...(editing ? [investedCell] : [
            el("td", { class: "num", text: fmt(r.invested) }),
            el("td", { class: `num ${r.after < 0 ? "neg" : ""}`, text: fmt(r.after) }),
          ]),
          el("td", {}, el("div", { class: "row-actions" },
            editing ? null : el("button", { class: "btn btn-ghost", type: "button", title: "Edit amount", "aria-label": "Edit amount", onclick: () => { ui.editingRow = r.id; renderLog(); } }, icon(ICON_EDIT)),
            el("button", { class: "btn btn-ghost del", type: "button", title: "Delete", "aria-label": "Delete entry", onclick: () => deleteEntry(r.id) }, icon(ICON_DEL))
          ))
        );
      })
    );
    const empty = state.log.length === 0;
    $("#log-table").hidden = shown.length === 0;
    $("#log-empty").hidden = shown.length > 0;
    $("#log-empty p").textContent = empty ? "No projects logged yet. Estimates you confirm will appear here." : "No projects match these filters.";
    $("#log-sub").textContent = empty
      ? "Logged projects, newest first."
      : `${shown.length} of ${state.log.length} project${state.log.length === 1 ? "" : "s"}, newest first. “Remaining after” is the region's running balance.`;
  }

  function updateEntry(id, raw) {
    const entry = state.log.find((r) => r.id === id);
    if (!entry) return;
    let v = Math.max(0, round2(parseMoney(raw)));
    const maxAllowed = round2(remainingFor(entry.region) + entry.invested);
    const capped = v > maxAllowed;
    if (capped) v = maxAllowed;
    entry.invested = v;
    ui.editingRow = null;
    save();
    renderAll();
    toast(capped ? `Updated to ${fmt(v)} (capped at available budget).` : "Investment amount updated.");
  }

  async function deleteEntry(id) {
    const entry = state.log.find((r) => r.id === id);
    if (!entry) return;
    const ok = await confirmDialog("Delete this entry?", `${entry.projectType} — ${fmt(entry.invested)} in Region ${entry.region}, ${entry.quarter}.`, "Delete");
    if (!ok) return;
    state.log = state.log.filter((r) => r.id !== id);
    save();
    renderAll();
    toast("Entry deleted.");
  }

  // ---------- distribution (mirrors app.py, cent-exact) ----------
  function distributeCents(total, weights) {
    const cents = Math.round(Math.max(0, total) * 100);
    const raw = weights.map((w) => w * cents);
    const base = raw.map(Math.floor);
    let rem = cents - base.reduce((a, b) => a + b, 0);
    const order = raw.map((x, i) => [x - base[i], i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    for (let k = 0; rem > 0; k++, rem--) base[order[k % base.length]] += 1;
    return base.map((c) => c / 100);
  }
  const weightsOf = (rows) => {
    const tot = rows.reduce((s, r) => s + r.invested, 0);
    return tot > 0 ? rows.map((r) => r.invested / tot) : null;
  };

  function planDistribution(quarter, regionSel, mode, custom) {
    const rem = remainingBy();
    const remC = Object.fromEntries(REGIONS.map((r) => [r, Math.max(0, rem[r])]));
    const regions = regionSel === "all" ? REGIONS : [Number(regionSel)];
    const available = regions.reduce((s, r) => s + remC[r], 0);
    const total = round2(mode === "custom" ? Math.min(Math.max(0, custom), available) : available);

    let perRegion;
    if (regions.length === 1) perRegion = { [regions[0]]: total };
    else if (mode === "custom") {
      const parts = available > 0 ? distributeCents(total, REGIONS.map((r) => remC[r] / available)) : REGIONS.map(() => 0);
      perRegion = Object.fromEntries(REGIONS.map((r, i) => [r, parts[i]]));
    } else perRegion = Object.fromEntries(REGIONS.map((r) => [r, round2(remC[r])]));

    const rows = [], warnings = [];
    let distributed = 0;
    for (const region of regions) {
      const amt = perRegion[region] || 0;
      if (amt <= 0) continue;
      const eligible = state.log.filter((r) => r.region === region && r.quarter === quarter);
      if (!eligible.length) { warnings.push(`Region ${region}: no projects logged in ${quarter}`); continue; }
      const w = weightsOf(eligible);
      if (!w) { warnings.push(`Region ${region}: eligible projects total $0`); continue; }
      distributeCents(amt, w).forEach((add, i) => {
        const r = eligible[i];
        rows.push({ id: r.id, region, quarter, projectType: r.projectType, current: r.invested, add, next: round2(r.invested + add) });
        distributed += add;
      });
    }
    return { quarter, regionSel, mode, custom, total, distributed: round2(distributed), rows, warnings };
  }

  const distQuarter = $("#dist-quarter"), distRegion = $("#dist-region"), distMode = $("#dist-mode"), distCustom = $("#dist-custom");
  distQuarter.append(...QUARTERS.map((q) => el("option", { value: q, text: q })));
  distRegion.append(el("option", { value: "all", text: "All regions" }), ...REGIONS.map((r) => el("option", { value: r, text: `Region ${r}` })));
  distMode.addEventListener("change", () => {
    distCustom.disabled = distMode.value !== "custom";
    if (distCustom.disabled) distCustom.value = "";
    else distCustom.focus();
  });
  [distQuarter, distRegion, distMode, distCustom].forEach((n) => n.addEventListener("input", () => { ui.plan = null; renderPlan(); }));

  $("#dist-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const plan = planDistribution(distQuarter.value, distRegion.value, distMode.value, parseMoney(distCustom.value));
    if (plan.total <= 0) { toast("Nothing to distribute — no remaining budget in the selected region(s).", "error"); return; }
    if (!plan.rows.length) { toast(`No eligible projects. ${plan.warnings.join("; ")}.`, "error"); return; }
    ui.plan = plan;
    renderPlan();
  });

  function renderPlan() {
    const p = ui.plan;
    $("#dist-preview").hidden = !p;
    if (!p) return;
    $("#dist-summary").replaceChildren(...[
      el("span", { class: "badge neutral", text: p.quarter }),
      el("span", { class: "badge neutral", text: p.regionSel === "all" ? "All regions" : `Region ${p.regionSel}` }),
      el("span", { class: "badge ok", text: `${fmt(p.distributed)} to ${p.rows.length} project${p.rows.length === 1 ? "" : "s"}` }),
      p.warnings.length ? el("div", { class: "note", text: `Skipped — ${p.warnings.join("; ")}.` }) : null,
    ].filter(Boolean));
    $("#dist-body").replaceChildren(
      ...p.rows.map((r) =>
        el("tr", {},
          el("td", {}, el("span", { class: "chip", text: `R${r.region}` })),
          el("td", { text: r.quarter }),
          el("td", { class: "ptype", text: r.projectType }),
          el("td", { class: "num", text: fmt(r.current) }),
          el("td", { class: "num add", text: `+${fmt(r.add)}` }),
          el("td", { class: "num", text: fmt(r.next) })
        )
      )
    );
  }

  $("#btn-dist-cancel").addEventListener("click", () => { ui.plan = null; renderPlan(); });
  $("#btn-dist-apply").addEventListener("click", () => {
    if (!ui.plan) return;
    // Recompute against current state so a stale preview can never over-allocate.
    const p = ui.plan;
    const fresh = planDistribution(p.quarter, p.regionSel, p.mode, p.custom);
    const adds = new Map(fresh.rows.map((r) => [r.id, r.add]));
    for (const r of state.log) if (adds.has(r.id)) r.invested = round2(r.invested + adds.get(r.id));
    save();
    ui.plan = null;
    renderAll();
    toast(`Distributed ${fmt(fresh.distributed)} across ${fresh.rows.length} project${fresh.rows.length === 1 ? "" : "s"}.`);
  });

  // ---------- CSV ----------
  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function toCSV() {
    const lines = [CSV_COLS.join(",")];
    for (const r of state.log) lines.push([r.id, r.region, r.quarter, r.projectType, r.climate, r.gender, r.invested.toFixed(2)].map(csvCell).join(","));
    return lines.join("\n") + "\n";
  }
  function parseCSV(text) {
    const rows = [];
    let row = [], cur = "", q = false;
    text = text.replace(/^﻿/, "");
    const delim = (text.split(/\r?\n/)[0].match(/;/g) || []).length > (text.split(/\r?\n/)[0].match(/,/g) || []).length ? ";" : ",";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.some((x) => x.trim() !== "")) rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur);
    if (row.some((x) => x.trim() !== "")) rows.push(row);
    return rows;
  }

  $("#btn-export").addEventListener("click", () => {
    const blob = new Blob([toCSV()], { type: "text/csv" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "investment_log.csv" });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  });

  $("#file-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const rows = parseCSV(await file.text());
      if (rows.length < 1) throw new Error("file is empty");
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const col = (name) => head.indexOf(name.toLowerCase());
      if (col("Project Type") < 0 || col("Invested") < 0) throw new Error("expected columns: Region, Quarter, Project Type, Climate, Gender, Invested");
      const entries = rows.slice(1).map((r) => cleanEntry(Object.fromEntries(CSV_COLS.map((c) => [c, col(c) >= 0 ? r[col(c)] : ""])))).filter((r) => r.projectType);
      const replace = state.log.length === 0 || (await confirmDialog("Replace current log?", `Importing ${entries.length} entries will replace the ${state.log.length} entries currently logged. Budgets are kept.`, "Replace"));
      if (!replace) return;
      state.log = entries;
      save();
      renderAll();
      toast(`Imported ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`);
    } catch (err) {
      toast(`Import failed: ${err.message}`, "error");
    }
  });

  // ---------- menu ----------
  const menuBtn = $("#btn-menu"), menuPop = $("#menu-pop");
  const setMenu = (open) => { menuPop.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); };
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(menuPop.hidden); });
  document.addEventListener("click", (e) => { if (!menuPop.contains(e.target)) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  $("#btn-clear-log").addEventListener("click", async () => {
    setMenu(false);
    if (!(await confirmDialog("Clear the investment log?", "All logged projects will be removed. Budgets are kept. Export first if you need a copy.", "Clear log"))) return;
    state.log = [];
    save(); ui.plan = null; renderAll(); toast("Log cleared.");
  });
  $("#btn-clear-all").addEventListener("click", async () => {
    setMenu(false);
    if (!(await confirmDialog("Clear log and budgets?", "This removes every logged project and resets all regional budgets to $0.", "Clear everything"))) return;
    state = { budgets: blankBudgets(), log: [] };
    save(); ui.plan = null; ui.result = null; renderAll(); toast("Log and budgets cleared.");
  });
  $("#btn-demo").addEventListener("click", () => {
    setMenu(false);
    for (const r of REGIONS) state.budgets[r] = 3000000;
    save(); renderAll(); toast("Set every region's budget to $3,000,000.");
  });

  // ---------- theme ----------
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (_) {}
  $("#btn-theme").addEventListener("click", () => {
    setMenu(false);
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
  });

  // ---------- boot ----------
  function renderAll() {
    renderOverview();
    renderResult();
    renderLog();
    renderPlan();
  }
  load();
  renderSegments();
  window.matchMedia("(max-width: 600px)").addEventListener("change", renderSegments);
  renderAll();
  loadTypes();
  if (REGIONS.every((r) => !state.budgets[r])) {
    startEditBudgets();
    $("#regions input")?.blur();
  }
})();
