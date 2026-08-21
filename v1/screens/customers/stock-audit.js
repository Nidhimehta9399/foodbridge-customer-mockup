/* ==========================================================================
   DISCOVERY — Foodbridge Module Customer — Stock Audit & Health

   Mounts through shell.js's mountShell exactly like customers.js does — same
   sidebar, same topbar, same drawer/toast primitives (window.FB_SHELL) — so
   this is a real peer of B2B Customers / Retail Customers in the Customer
   Management group, not a one-off tool bolted on the side.

   One route (stock-audit.html), two views, switched by ?customer=<id>:

     list     Every B2B customer with a stock-health summary (last audit,
              open variances, follow-up flag) — the table chrome
              b2b-customers.html uses, so it reads as a sibling screen.
              This is what the sidebar link opens.
     detail   That customer's health tiles, "Attention Needed" (the latest
              audit's flagged lines), searchable/filterable Audit History
              with an inline follow-up action, and the New Audit capture
              flow (VIEW = 'home' | 'capture' below). Visual language here
              is borrowed from Delivery Management (teal hero card, colour
              tiles, status-tag pills, card lists, bottom-sheet
              confirmation) — see stock-audit.css's header.

   Persistence: customers.js's Store key (fb-discovery-customers-v1) is read
   here too, so a customer renamed/edited in the admin list shows correctly;
   this page never writes to it. Audits get their own key
   (fb-discovery-stock-audits-v1), seeded from SEED.stockAudits.
   ========================================================================== */

(function () {
  "use strict";

  const SEED = window.SEED;
  const I = window.FB_ICONS;
  const { $, esc, titleCase, debounce, toast, mountShell } = window.FB_SHELL;

  const nameOf = (c) => (c && (typeof c.name === "object" ? c.name?.en : c.name)) || "";
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return (
      d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
      ", " +
      d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    );
  }

  /* --------------------------------------------------------- bottom sheet */

  // actions = [{ label, cls: 'primary'|'ghost', onClick }] — mirrors Delivery
  // Management's DM.sheet, the confirmation pattern this page borrows.
  // FB_SHELL has no bottom-sheet primitive (only drawer/modal/menu), so this
  // stays local to the page that actually uses it.
  function sheet({ eyebrow, title, sub, actions }) {
    document.querySelectorAll(".sah-sheet-scrim").forEach((n) => n.remove());
    const scrim = document.createElement("div");
    scrim.className = "sah-sheet-scrim";
    scrim.innerHTML = `<div class="sah-sheet"><div class="grip"></div>
      ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}
      ${title ? `<h2>${esc(title)}</h2>` : ""}
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
      <div class="sheet-acts">${(actions || [])
        .map((a, i) => `<button class="sheet-btn ${a.cls || "ghost"}" data-a="${i}">${esc(a.label)}</button>`)
        .join("")}</div>
    </div>`;
    document.body.appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add("show"));
    const close = () => {
      scrim.classList.remove("show");
      setTimeout(() => scrim.remove(), 200);
    };
    scrim.addEventListener("click", (e) => {
      if (e.target === scrim) close();
    });
    (actions || []).forEach((a, i) =>
      scrim.querySelector(`[data-a="${i}"]`).addEventListener("click", () => {
        if (a.onClick && a.onClick() === false) return;
        close();
      }),
    );
    return { close };
  }

  /* ------------------------------------------------------------- customer */

  // Read-only mirror of customers.js's Store — this page never writes here.
  const CUSTOMERS_KEY = "fb-discovery-customers-v1";
  function loadCustomers() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(CUSTOMERS_KEY) || "null");
    } catch (e) {
      saved = null;
    }
    return (saved && saved.b2b) || SEED.b2b || [];
  }
  function loadCustomer(id) {
    return loadCustomers().find((c) => c._id === id) || null;
  }

  /* --------------------------------------------------------------- audits */

  const AUDITS_KEY = "fb-discovery-stock-audits-v1";
  const AuditStore = {
    state: null,
    load() {
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(AUDITS_KEY) || "null");
      } catch (e) {
        saved = null;
      }
      this.state = saved || clone(SEED.stockAudits || {});
      return this.state;
    },
    save() {
      try {
        localStorage.setItem(AUDITS_KEY, JSON.stringify(this.state));
      } catch (e) {
        /* private mode — the prototype still works, it just doesn't persist */
      }
    },
    list(customerId) {
      return this.state[customerId] || (this.state[customerId] = []);
    },
  };

  const products = SEED.products || [];
  const productById = (id) => products.find((p) => p.id === id);

  const CONDITIONS = [
    { k: "ok", label: "OK", icon: "✓" },
    { k: "damaged", label: "Damaged", icon: "⚠️" },
    { k: "expired", label: "Expired", icon: "⏳" },
    { k: "near_expiry", label: "Near Expiry", icon: "⏰" },
    { k: "out_of_stock", label: "Out of Stock", icon: "🚫" },
  ];
  const condMeta = (k) => CONDITIONS.find((c) => c.k === k) || { label: k, icon: "•" };
  const FLAGGED = new Set(["damaged", "expired", "near_expiry", "out_of_stock"]);

  function lineVariance(line) {
    return (line.counted || 0) - (line.system || 0);
  }
  function flaggedLines(audit) {
    return (audit ? audit.lines : []).filter((l) => FLAGGED.has(l.condition));
  }
  function varianceLines(audit) {
    return (audit ? audit.lines : []).filter((l) => lineVariance(l) !== 0);
  }
  function conditionBadgeHTML(k) {
    const m = condMeta(k);
    return `<span class="cond-badge ${esc(k)}">${m.icon} ${esc(m.label)}</span>`;
  }
  function auditsFor(customerId) {
    return AuditStore.list(customerId)
      .slice()
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  /* ------------------------------------------------------------------ state */

  let PAGE = null; // the #page host mountShell hands back
  let CUSTOMER = null;
  let VIEW = "home"; // 'home' | 'capture' — only meaningful once a customer is open
  let HIST = { q: "", filter: "all", openId: null };
  let CAP = null;
  let LIST = { q: "" };

  function render() {
    if (VIEW === "capture") renderCapture();
    else renderHome();
  }

  /* ------------------------------------------------------------- customer list */

  function healthOf(customerId) {
    const audits = auditsFor(customerId);
    const latest = audits[0] || null;
    return {
      audits,
      latest,
      openVariances: latest ? varianceLines(latest).length : 0,
      flagged: latest ? flaggedLines(latest).length : 0,
      followUp: audits.some((a) => a.followUp && a.followUp.required),
    };
  }

  function listRowsHTML(rows) {
    return rows
      .map((c) => {
        const h = healthOf(c._id);
        return `
        <tr data-id="${c._id}">
          <td class="name">${esc(titleCase(nameOf(c)))}</td>
          <td class="phone">${esc(c.phone)}</td>
          <td>${h.latest ? esc(fmtDate(h.latest.at)) : `<span class="muted">Never audited</span>`}</td>
          <td>${h.openVariances ? `<span class="status-tag warn">${h.openVariances} variance${h.openVariances === 1 ? "" : "s"}</span>` : h.latest ? `<span class="status-tag neutral">All matched</span>` : "—"}</td>
          <td>${h.flagged ? `<span class="status-tag danger">${h.flagged} flagged</span>` : "—"}</td>
          <td>${h.followUp ? `<span class="status-tag followup">Follow-up needed</span>` : "—"}</td>
          <td class="r"><a class="btn-open" href="stock-audit.html?customer=${encodeURIComponent(c._id)}">Open →</a></td>
        </tr>`;
      })
      .join("");
  }

  function renderList() {
    const q = LIST.q.trim().toLowerCase();
    const all = loadCustomers();
    const rows = q
      ? all.filter((c) => [nameOf(c), c.phone, c.email].some((v) => String(v || "").toLowerCase().includes(q)))
      : all;

    PAGE.innerHTML = `
      <div class="head-card">
        <div class="page-head">
          <div>
            <h1>Stock Audit &amp; Health</h1>
            <p>Visit customers, count what's on the shelf, and track their stock health over time.</p>
          </div>
        </div>
      </div>
      <div class="searchbar">
        <div class="field">
          ${I.Search}
          <input type="search" id="sah-list-q" value="${esc(LIST.q)}" placeholder="Search b2b customers…" />
        </div>
      </div>
      ${
        rows.length
          ? `<div class="table-wrap"><div class="table-scroll">
               <table class="grid">
                 <thead><tr>
                   <th>Name</th><th style="min-width:11rem">Phone</th><th>Last Audit</th>
                   <th>Variances</th><th>Flagged</th><th>Follow-up</th><th></th>
                 </tr></thead>
                 <tbody>${listRowsHTML(rows)}</tbody>
               </table>
             </div></div>`
          : `<div class="empty">
               <div class="art">${I.Users}</div>
               <h2>We're sorry, no customers found.</h2>
               <p>${LIST.q ? "Try clearing the search." : "Add a B2B customer to start auditing their stock."}</p>
             </div>`
      }`;

    const box = $("#sah-list-q", PAGE);
    box.oninput = debounce(() => {
      LIST.q = box.value;
      renderList();
      const b = $("#sah-list-q", PAGE);
      if (b) {
        b.focus();
        b.setSelectionRange(b.value.length, b.value.length);
      }
    }, 250);
  }

  /* ---------------------------------------------------------------- detail: home */

  function heroHTML() {
    const name = titleCase(nameOf(CUSTOMER));
    const addr = [CUSTOMER.adress1, CUSTOMER.state && CUSTOMER.state.name].filter(Boolean).join(", ") || "No address on file";
    return `
      <div class="sah-hero">
        <a class="back" href="stock-audit.html">← Back to Stock Audit &amp; Health</a>
        <div class="row">
          <div>
            <p class="eyebrow">Customer</p>
            <h1>${esc(name)}</h1>
            <p class="sub">${esc(addr)}${CUSTOMER.phone ? " · " + esc(CUSTOMER.phone) : ""}</p>
          </div>
          <button class="sah-cta" id="newAudit">+ Start New Audit</button>
        </div>
      </div>`;
  }

  function attentionHTML(lines) {
    return `<div class="attn-card">
      ${lines
        .map((l) => {
          const p = productById(l.productId) || {};
          return `<div class="attn-row">
            <span class="thumb">${p.emoji || "📦"}</span>
            <span class="nm">${esc(p.name || l.productId)}<small>Art No: ${esc(p.artNo || "—")}</small></span>
            ${conditionBadgeHTML(l.condition)}
            ${l.shelfAvailable ? "" : `<span class="shelf-badge off">⛔ Off shelf</span>`}
          </div>`;
        })
        .join("")}
    </div>`;
  }

  function historyControlsHTML(audits) {
    const fuCount = audits.filter((a) => a.followUp && a.followUp.required).length;
    return `
      <div class="sah-search-row">
        <div class="sah-search"><input type="search" id="histQ" value="${esc(HIST.q)}" placeholder="Search by product or note…"></div>
      </div>
      <div class="chips">
        <button class="chip ${HIST.filter === "all" ? "on" : ""}" data-f="all">All (${audits.length})</button>
        <button class="chip ${HIST.filter === "followup" ? "on" : ""}" data-f="followup">Follow-up needed (${fuCount})</button>
      </div>`;
  }

  function filteredAudits(audits) {
    let list = audits;
    if (HIST.filter === "followup") list = list.filter((a) => a.followUp && a.followUp.required);
    const q = HIST.q.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          (a.notes || "").toLowerCase().includes(q) ||
          a.lines.some((l) => ((productById(l.productId) || {}).name || "").toLowerCase().includes(q)),
      );
    }
    return list;
  }

  function auditCardHTML(a) {
    const open = HIST.openId === a.id;
    const variance = varianceLines(a).length;
    const flagged = flaggedLines(a).length;
    return `
      <div class="audit-card ${open ? "open" : ""}" data-id="${a.id}">
        <div class="top" data-toggle="${a.id}">
          <div>
            <div class="when">${esc(fmtDate(a.at))}</div>
            <div class="who">${esc(a.auditor || "—")} · ${a.lines.length} product${a.lines.length === 1 ? "" : "s"} counted</div>
            <div class="stats">
              ${variance ? `<span class="status-tag warn">${variance} variance${variance === 1 ? "" : "s"}</span>` : `<span class="status-tag neutral">All matched</span>`}
              ${flagged ? `<span class="status-tag danger">${flagged} flagged</span>` : ""}
              ${a.followUp && a.followUp.required ? `<span class="status-tag followup">Follow-up needed</span>` : ""}
            </div>
          </div>
          <span class="chev">▾</span>
        </div>
        <div class="audit-detail">
          ${a.notes ? `<p class="notes">"${esc(a.notes)}"</p>` : ""}
          ${a.lines
            .map((l) => {
              const p = productById(l.productId) || {};
              const v = lineVariance(l);
              const vCls = v === 0 ? "match" : v > 0 ? "up" : "down";
              const vTxt = v === 0 ? "Match" : (v > 0 ? "+" : "") + v;
              return `<div class="detail-line">
                <span class="pn">${esc(p.name || l.productId)}<small>Art No: ${esc(p.artNo || "—")} · System ${l.system}${esc(p.unit ? " " + p.unit : "")}</small></span>
                <span class="cnt">Counted ${l.counted}${esc(p.unit ? " " + p.unit : "")}</span>
                ${conditionBadgeHTML(l.condition)}
                <span class="var ${vCls}">${vTxt}</span>
              </div>`;
            })
            .join("")}
          ${followUpHTML(a)}
        </div>
      </div>`;
  }

  function followUpHTML(a) {
    const set = a.followUp && a.followUp.required;
    return `<div class="followup-box ${set ? "set" : ""}">
      ${
        set
          ? `<p><b>Follow-up flagged</b> — ${esc(a.followUp.note || "No note added.")}</p>
             <div class="btn-row"><button class="btn-sm danger" data-fu-clear="${a.id}">Clear follow-up</button></div>`
          : `<p>Need a return visit before the next scheduled audit?</p>
             <textarea data-fu-note="${a.id}" placeholder="e.g. Restock 250ML PET, shelf was empty"></textarea>
             <div class="btn-row"><button class="btn-sm primary" data-fu-save="${a.id}">Flag for follow-up</button></div>`
      }
    </div>`;
  }

  function renderHome() {
    const audits = auditsFor(CUSTOMER._id);
    const latest = audits[0] || null;
    const openVariances = latest ? varianceLines(latest).length : 0;
    const attention = latest ? flaggedLines(latest) : [];
    const followUpCount = audits.filter((a) => a.followUp && a.followUp.required).length;
    const visible = filteredAudits(audits);

    PAGE.innerHTML = `
      <div class="sah-wrap">
        ${heroHTML()}
        <div class="sah-tiles">
          <div class="sah-tile navy"><div class="n">${openVariances}</div><div class="l">Open Variances</div></div>
          <div class="sah-tile orange"><div class="n">${attention.length}</div><div class="l">Attention Items</div></div>
          <div class="sah-tile green"><div class="n">${products.length}</div><div class="l">Products Tracked</div></div>
          <div class="sah-tile red"><div class="n">${followUpCount}</div><div class="l">Follow-ups Open</div></div>
        </div>
        <div class="sah-body">
          ${latest ? `<div class="sec-label">Attention Needed — since ${esc(fmtDate(latest.at))}</div>` : ""}
          ${latest && attention.length ? attentionHTML(attention) : latest ? `<p style="color:var(--muted);font-size:13px;margin:-4px 0 26px">Nothing flagged in the last audit — shelf looked healthy.</p>` : ""}
          <div class="sec-label">Audit History</div>
          ${historyControlsHTML(audits)}
          ${visible.length ? visible.map(auditCardHTML).join("") : `<div class="sah-empty"><div class="big">🗂️</div><p>${audits.length ? "No audits match this view." : "No audits yet — start the first one above."}</p></div>`}
        </div>
      </div>`;

    wireHome(audits);
  }

  function wireHome(audits) {
    $("#newAudit", PAGE).onclick = startCapture;

    const q = $("#histQ", PAGE);
    if (q) {
      q.oninput = debounce(() => {
        HIST.q = q.value;
        renderHome();
        const box = $("#histQ", PAGE);
        if (box) {
          box.focus();
          box.setSelectionRange(box.value.length, box.value.length);
        }
      }, 200);
    }

    PAGE.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { HIST.filter = b.dataset.f; renderHome(); }));

    PAGE.querySelectorAll("[data-toggle]").forEach((el) => (el.onclick = () => {
      const id = el.dataset.toggle;
      HIST.openId = HIST.openId === id ? null : id;
      renderHome();
    }));

    PAGE.querySelectorAll("[data-fu-save]").forEach((b) => (b.onclick = () => {
      const id = b.dataset.fuSave;
      const a = audits.find((x) => x.id === id);
      if (!a) return;
      const ta = PAGE.querySelector(`[data-fu-note="${id}"]`);
      a.followUp = { required: true, note: ta ? ta.value.trim() : "", at: new Date().toISOString() };
      AuditStore.save();
      toast("Follow-up flagged.");
      renderHome();
    }));

    PAGE.querySelectorAll("[data-fu-clear]").forEach((b) => (b.onclick = () => {
      const id = b.dataset.fuClear;
      const a = audits.find((x) => x.id === id);
      if (!a) return;
      a.followUp = { required: false, note: "", at: "" };
      AuditStore.save();
      toast("Follow-up cleared.");
      renderHome();
    }));
  }

  /* ------------------------------------------------------------- capture */

  function startCapture() {
    CAP = {
      at: new Date().toISOString().slice(0, 16),
      auditor: "Mahesh",
      notes: "",
      q: "",
      lines: {}, // productId -> { counted, condition, shelfAvailable }
    };
    VIEW = "capture";
    render();
  }

  function capCardHTML(p) {
    const line = CAP.lines[p.id];
    const counted = line ? line.counted : "";
    const condition = (line && line.condition) || "ok";
    const shelfAvailable = line ? line.shelfAvailable !== false : true;
    const touched = line != null;
    const v = counted === "" || counted == null ? null : Number(counted) - p.systemStock;
    const vCls = v == null ? "" : v === 0 ? "match" : v > 0 ? "up" : "down";
    const vTxt = v == null ? "—" : v === 0 ? "Match" : (v > 0 ? "+" : "") + v;
    return `
      <div class="cap-card ${touched ? "touched" : ""}" data-p="${p.id}">
        <div class="head">
          <span class="thumb">${p.emoji || "📦"}</span>
          <div><div class="pn">${esc(p.name)}</div><div class="art">Art No: ${esc(p.artNo)} · ${esc(p.category)}</div></div>
          <div class="sys">System<b>${p.systemStock} ${esc(p.unit)}</b></div>
        </div>
        <div class="cap-stepper">
          <button type="button" data-step="-1">−</button>
          <input type="text" inputmode="numeric" placeholder="0" value="${counted === "" || counted == null ? "" : counted}">
          <button type="button" data-step="1">+</button>
          <span class="var ${vCls}">${vTxt}</span>
        </div>
        <div class="cond-row">
          ${CONDITIONS.map((c) => `<button type="button" class="cond-chip ${condition === c.k ? "on " + c.k : ""}" data-cond="${c.k}">${esc(c.label)}</button>`).join("")}
        </div>
        <div class="shelf-row">
          <span class="lbl">Available on shelf</span>
          <button type="button" class="switch ${shelfAvailable ? "on" : ""}" data-shelf></button>
        </div>
      </div>`;
  }

  function renderCapture() {
    const q = CAP.q.trim().toLowerCase();
    const list = products.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.artNo).toLowerCase().includes(q));
    const entered = Object.keys(CAP.lines).filter((id) => CAP.lines[id].counted !== "" && CAP.lines[id].counted != null).length;
    const pct = products.length ? Math.round((entered / products.length) * 100) : 0;

    PAGE.innerHTML = `
      <div class="sah-wrap">
        <div class="sah-hero">
          <button type="button" class="back" id="capBack">← ${esc(titleCase(nameOf(CUSTOMER)))}</button>
          <div class="row">
            <div>
              <p class="eyebrow">New Stock Audit</p>
              <h1>Count What's On The Shelf</h1>
              <p class="sub">${esc(titleCase(nameOf(CUSTOMER)))}</p>
            </div>
          </div>
        </div>
        <div class="sah-body">
          <div class="cap-meta">
            <div><label for="capAt">Audit Date &amp; Time</label><input type="datetime-local" id="capAt" value="${esc(CAP.at)}"></div>
            <div><label for="capAuditor">Auditor</label><input type="text" id="capAuditor" value="${esc(CAP.auditor)}"></div>
            <div><label for="capNotes">Notes <span style="opacity:.6">(optional)</span></label><input type="text" id="capNotes" value="${esc(CAP.notes)}" placeholder="e.g. Monthly audit — aisle 3 &amp; 4"></div>
          </div>
          <div class="cap-progress">
            <span class="txt">${entered} / ${products.length} captured</span>
            <div class="bar"><span style="width:${pct}%"></span></div>
          </div>
          <div class="sah-search-row"><div class="sah-search"><input type="search" id="capQ" value="${esc(CAP.q)}" placeholder="Search by product name or article number…"></div></div>
          <div class="cap-grid" id="capGrid">${list.length ? list.map(capCardHTML).join("") : `<div class="sah-empty">No products found</div>`}</div>
        </div>
      </div>
      <div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="capCancel">Cancel</button>
        <button class="btn-wide primary" id="capComplete" ${entered ? "" : "disabled"}>Complete Audit</button>
      </div></div>`;

    wireCapture(list);
  }

  function wireCapture(list) {
    const backToHome = () => {
      VIEW = "home";
      CAP = null;
      render();
    };
    $("#capBack", PAGE).onclick = backToHome;
    $("#capCancel", PAGE).onclick = backToHome;

    $("#capAt", PAGE).oninput = (e) => (CAP.at = e.target.value);
    $("#capAuditor", PAGE).oninput = (e) => (CAP.auditor = e.target.value);
    $("#capNotes", PAGE).oninput = (e) => (CAP.notes = e.target.value);

    const q = $("#capQ", PAGE);
    q.oninput = debounce(() => {
      CAP.q = q.value;
      renderCapture();
      const box = $("#capQ", PAGE);
      if (box) {
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      }
    }, 200);

    function ensureLine(id) {
      if (!CAP.lines[id]) CAP.lines[id] = { counted: "", condition: "ok", shelfAvailable: true };
      return CAP.lines[id];
    }

    function updateProgress() {
      const entered = Object.keys(CAP.lines).filter((id) => CAP.lines[id].counted !== "" && CAP.lines[id].counted != null).length;
      const pct = products.length ? Math.round((entered / products.length) * 100) : 0;
      const txt = $(".cap-progress .txt", PAGE);
      if (txt) txt.textContent = `${entered} / ${products.length} captured`;
      const bar = $(".cap-progress .bar > span", PAGE);
      if (bar) bar.style.width = pct + "%";
      const btn = $("#capComplete", PAGE);
      if (btn) btn.disabled = entered === 0;
    }

    function syncCard(p) {
      const card = PAGE.querySelector(`.cap-card[data-p="${p.id}"]`);
      if (!card) return;
      const line = CAP.lines[p.id];
      const touched = line != null;
      card.classList.toggle("touched", touched);
      const counted = line ? line.counted : "";
      const v = counted === "" || counted == null ? null : Number(counted) - p.systemStock;
      const varEl = card.querySelector(".var");
      varEl.className = "var" + (v == null ? "" : v === 0 ? " match" : v > 0 ? " up" : " down");
      varEl.textContent = v == null ? "—" : v === 0 ? "Match" : (v > 0 ? "+" : "") + v;
      const input = card.querySelector(".cap-stepper input");
      const shownCounted = counted === "" || counted == null ? "" : String(counted);
      if (input.value !== shownCounted) input.value = shownCounted;
      card.querySelectorAll(".cond-chip").forEach((chip) => {
        const on = !!line && line.condition === chip.dataset.cond;
        chip.className = "cond-chip" + (on ? " on " + chip.dataset.cond : "");
      });
      const sw = card.querySelector(".switch");
      const shelfAvailable = line ? line.shelfAvailable !== false : true;
      sw.classList.toggle("on", shelfAvailable);
    }

    list.forEach((p) => {
      const card = PAGE.querySelector(`.cap-card[data-p="${p.id}"]`);
      if (!card) return;
      const input = card.querySelector(".cap-stepper input");

      const setCounted = (val) => {
        const line = ensureLine(p.id);
        line.counted = val === "" ? "" : String(Math.max(0, Number(val) || 0));
        syncCard(p);
        updateProgress();
      };
      input.oninput = () => setCounted(input.value);

      card.querySelectorAll("[data-step]").forEach((b) => {
        b.onclick = () => {
          const line = ensureLine(p.id);
          const cur = line.counted === "" || line.counted == null ? 0 : Number(line.counted);
          setCounted(String(Math.max(0, cur + Number(b.dataset.step))));
        };
      });

      card.querySelectorAll("[data-cond]").forEach((chip) => {
        chip.onclick = () => {
          const line = ensureLine(p.id);
          line.condition = chip.dataset.cond;
          syncCard(p);
        };
      });

      card.querySelector("[data-shelf]").onclick = () => {
        const line = ensureLine(p.id);
        line.shelfAvailable = !(line.shelfAvailable !== false);
        syncCard(p);
      };
    });

    $("#capComplete", PAGE).onclick = completeAudit;
  }

  function completeAudit() {
    const lines = Object.keys(CAP.lines)
      .filter((id) => CAP.lines[id].counted !== "" && CAP.lines[id].counted != null)
      .map((id) => {
        const p = productById(id);
        const line = CAP.lines[id];
        return {
          productId: id,
          system: p ? p.systemStock : 0,
          counted: Number(line.counted),
          condition: line.condition || "ok",
          shelfAvailable: line.shelfAvailable !== false,
        };
      });
    if (!lines.length) return;

    const variance = lines.filter((l) => l.counted - l.system !== 0).length;
    const flagged = lines.filter((l) => FLAGGED.has(l.condition)).length;

    sheet({
      eyebrow: "Stock audit",
      title: variance === 0 && flagged === 0 ? "All clear" : `${variance} variance${variance === 1 ? "" : "s"} · ${flagged} flagged`,
      sub: "Review before saving, or save this audit to the customer's history.",
      actions: [
        { label: "Keep Editing", cls: "ghost" },
        { label: "Save Audit", cls: "primary", onClick: () => saveAudit(lines) },
      ],
    });
  }

  function saveAudit(lines) {
    const audit = {
      id: "aud-" + CUSTOMER._id + "-" + Date.now().toString(36),
      at: CAP.at ? new Date(CAP.at).toISOString() : new Date().toISOString(),
      auditor: CAP.auditor.trim() || "Unknown",
      notes: CAP.notes.trim(),
      lines,
      followUp: { required: false, note: "", at: "" },
    };
    AuditStore.list(CUSTOMER._id).unshift(audit);
    AuditStore.save();
    toast("Stock audit saved.");
    VIEW = "home";
    HIST.openId = audit.id;
    CAP = null;
    render();
  }

  /* ------------------------------------------------------------------ mount */

  function mount() {
    PAGE = mountShell($("#app"), { screen: "stock-audit", crumb: "Stock Audit & Health", tenant: SEED.tenant });
    AuditStore.load();

    const params = new URLSearchParams(location.search);
    const id = params.get("customer");

    if (!id) {
      CUSTOMER = null;
      renderList();
      return;
    }

    CUSTOMER = loadCustomer(id);
    if (!CUSTOMER) {
      PAGE.innerHTML = `<div class="sah-empty" style="padding-top:80px">
        <div class="big">🔍</div>
        <p>Customer not found.<br>It may have been removed, or the link is stale.</p>
        <p style="margin-top:14px"><a href="stock-audit.html" style="color:var(--teal)">← Back to Stock Audit &amp; Health</a></p>
      </div>`;
      return;
    }
    VIEW = "home";
    HIST = { q: "", filter: "all", openId: null };
    render();
  }

  window.SAH = { mount };
})();
