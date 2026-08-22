/* ==========================================================================
   DISCOVERY — Foodbridge Module Customer — Stock Audit & Health
   A distributor field-operations hub, mobile-first.

   Mounts through shell.js's mountShell exactly like customers.js does — same
   sidebar, same topbar, same drawer/toast primitives (window.FB_SHELL) — so
   this stays a real peer of B2B Customers / Retail Customers under Customer
   Management. Everything BELOW that shared header is this feature's own
   small app: a stack-based router (go/back, mirroring Delivery Management's
   DM.go/DM.back) and a persistent bottom nav bar that stays on screen
   through every view, exactly like Delivery Management's own `.dm-nav`.

   The UX loop, top to bottom of this file:
     Who needs attention → Why → What should I do next → Start Audit
     Create Visit → Understand Customer → Audit Stock → Capture Exceptions
       → Complete Audit → Get Actions → Build Customer History

   Views (CURRENT.view below):
     customers        Landing hub — KPI strip, Needs Attention, and the
                       Customer Health list (cards, not a dense table — this
                       is a field tool, not a warehouse inventory grid).
     audits            Secondary view: every audit across every customer,
                       newest first — the "Audits" tab in the bottom nav.
     customer-detail   One customer's health tiles, Attention Needed and
                       full audit history (View Customer lands here).
     create-customer   Wizard step 1 — pick a customer (skipped when Start
                       Audit is tapped from a screen that already has one).
     create-location   Wizard step 2 — pick the visit location.
     create-details    Wizard step 3 — audit purpose + auto-filled auditor
                       and date/time, then Create Audit.
     brief             Visit Brief — last audit, last order, ordering cycle,
                       previous issues, products needing attention.
     workspace         Audit Workspace — the actual count: search/scan,
                       per-product stepper + condition + shelf toggle, notes.
     complete          Complete Audit — score, risk breakdown, recommended
                       actions (replenish / pull & rotate / follow up).

   Persistence: customers.js's Store key (fb-discovery-customers-v1) is read
   here too, so a customer renamed/edited in the admin list shows correctly;
   this page never writes to it. Audits get their own key
   (fb-discovery-stock-audits-v1), seeded from SEED.stockAudits.
   ========================================================================== */

(function () {
  "use strict";

  const SEED = window.SEED;
  const { $, esc, titleCase, debounce, toast, mountShell } = window.FB_SHELL;

  const nameOf = (c) => (c && (typeof c.name === "object" ? c.name?.en : c.name)) || "";
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const now = () => new Date();
  const DAY = 86400000;

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
  function fmtDateShort(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  }
  function daysBetween(iso) {
    return Math.round((now() - new Date(iso)) / DAY);
  }
  function addressLine(addr, state, pin) {
    return [addr, state && state.name, pin].filter(Boolean).join(", ") || "No address on file";
  }

  /* --------------------------------------------------------- bottom sheet */

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

  // A customer's visitable locations. Most have one (their registered
  // address); a few in the seed carry a genuinely different shipping
  // address (e.g. store vs warehouse), which becomes a real second choice
  // here rather than an invented field.
  function locationsFor(c) {
    const locs = [{ id: "primary", label: "Store / Registered Address", line: addressLine(c.adress1, c.state?.name, c.postnr) }];
    const sameAsPrimary =
      !c.adress2 ||
      (c.adress2 === c.adress1 && (c.shippingState?.code || "") === (c.state?.code || ""));
    if (!sameAsPrimary) {
      locs.push({ id: "shipping", label: "Warehouse / Shipping Address", line: addressLine(c.adress2, c.shippingState?.name, c.shippingPostnumber) });
    }
    return locs;
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
    allCustomerIds() {
      return Object.keys(this.state).filter((id) => this.state[id] && this.state[id].length);
    },
  };

  const products = SEED.products || [];
  const productById = (id) => products.find((p) => p.id === id);
  const productName = (id) => (productById(id) || {}).name || id;

  const CONDITIONS = [
    { k: "ok", label: "OK", icon: "✓" },
    { k: "damaged", label: "Damaged", icon: "⚠️" },
    { k: "expired", label: "Expired", icon: "⏳" },
    { k: "near_expiry", label: "Near Expiry", icon: "⏰" },
    { k: "out_of_stock", label: "Out of Stock", icon: "🚫" },
  ];
  const condMeta = (k) => CONDITIONS.find((c) => c.k === k) || { label: k, icon: "•" };
  const FLAGGED = new Set(["damaged", "expired", "near_expiry", "out_of_stock"]);

  const PURPOSES = [
    { k: "routine", label: "Routine Stock Check", icon: "📋", sub: "Regular scheduled visit" },
    { k: "followup", label: "Follow-up Visit", icon: "🔁", sub: "Returning after a flagged issue" },
    { k: "stockout", label: "Stock-out Investigation", icon: "📉", sub: "Checking a reported shortage" },
    { k: "preorder", label: "Pre-Order Review", icon: "🧾", sub: "Before placing next order" },
    { k: "onboarding", label: "New Customer Onboarding", icon: "🆕", sub: "First stock count at this store" },
  ];
  const purposeMeta = (k) => PURPOSES.find((p) => p.k === k) || { label: k || "Visit", icon: "📋" };

  function lineVariance(line) {
    return (line.counted || 0) - (line.system || 0);
  }
  function flaggedLines(audit) {
    return (audit ? audit.lines : []).filter((l) => FLAGGED.has(l.condition));
  }
  function varianceLines(audit) {
    return (audit ? audit.lines : []).filter((l) => lineVariance(l) !== 0);
  }
  function isOverstock(l) {
    const d = lineVariance(l);
    return d >= 5 || (l.system > 0 && l.counted >= l.system * 2 && d > 0);
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

  /* ------------------------------------------------------- health signals */

  // Audit-visit cadence — independent of ordering. "Never audited" counts
  // as overdue for a VISIT, but only once the customer has actually been
  // around long enough to expect one — a store added yesterday hasn't
  // missed anything, it just hasn't been reached yet. That grace period can
  // only ever land on "normal" or "due", never "recent": a customer that has
  // genuinely never been audited was never *recently* audited either.
  function visitBucketFor(customerId) {
    const latest = auditsFor(customerId)[0];
    if (latest) {
      const days = daysBetween(latest.at);
      if (days <= 7) return "recent";
      if (days <= 14) return "normal";
      if (days <= 21) return "due";
      return "overdue";
    }
    const age = daysBetween((loadCustomer(customerId) || {}).createdAt || "1970-01-01");
    if (age <= 14) return "normal";
    if (age <= 21) return "due";
    return "overdue";
  }

  function healthBucketFor(customerId) {
    const latest = auditsFor(customerId)[0];
    if (!latest) return "unknown";
    if (flaggedLines(latest).length) return "at_risk";
    if (varianceLines(latest).length) return "watch";
    return "healthy";
  }
  const HEALTH_LABEL = { healthy: "Healthy", watch: "Watch", at_risk: "At Risk", unknown: "Unknown" };

  // Reorder cadence — synthesized signal (see SEED.orderingSignals). Absent
  // on purpose for customers with no signal yet: "Unknown" is the honest
  // answer, not a guessed "On Track".
  function orderingStatusFor(customerId) {
    const sig = SEED.orderingSignals && SEED.orderingSignals[customerId];
    if (!sig) return { bucket: "unknown", label: "Unknown" };
    const expected = new Date(sig.lastOrderAt).getTime() + sig.avgCycleDays * DAY;
    const days = Math.round((now() - expected) / DAY);
    let bucket, label;
    if (days > 5) { bucket = "overdue"; label = "Overdue"; }
    else if (days > 0) { bucket = "slipping"; label = "Slipping"; }
    else { bucket = "on_track"; label = "On Track"; }
    return { bucket, label, lastOrderAt: sig.lastOrderAt, avgCycleDays: sig.avgCycleDays, expectedAt: expected, daysOverdue: days };
  }
  const ORDER_LABEL = { on_track: "On Track", slipping: "Slipping", overdue: "Overdue", unknown: "Unknown" };

  // The four Needs-Attention triggers named in the brief: stock-out risk,
  // expiry risk, overdue audits, and customers outside their ordering cycle.
  function reasonsFor(customerId) {
    const reasons = [];
    const latest = auditsFor(customerId)[0];
    if (latest) {
      if (latest.lines.some((l) => l.condition === "out_of_stock")) reasons.push({ k: "stockout", label: "Stock-out risk", cls: "danger" });
      if (latest.lines.some((l) => l.condition === "expired" || l.condition === "near_expiry")) reasons.push({ k: "expiry", label: "Expiry risk", cls: "warn" });
    }
    if (visitBucketFor(customerId) === "overdue") reasons.push({ k: "overdue", label: latest ? "Audit overdue" : "Never audited", cls: "neutral" });
    if (orderingStatusFor(customerId).bucket === "overdue") reasons.push({ k: "ordering", label: "Outside ordering cycle", cls: "followup" });
    return reasons;
  }

  function nextActionFor(customerId) {
    const latest = auditsFor(customerId)[0];
    if (latest && latest.followUp && latest.followUp.required) return "Follow up";
    const reasons = reasonsFor(customerId);
    if (reasons.some((r) => r.k === "stockout" || r.k === "expiry")) return "Review flags";
    if (reasons.some((r) => r.k === "overdue")) return latest ? "Audit overdue" : "Start audit";
    if (reasons.some((r) => r.k === "ordering")) return "Review ordering cycle";
    if (!latest) return "Start audit";
    if (visitBucketFor(customerId) === "due") return "Schedule visit";
    return "On track";
  }

  const FILTERS = [
    { k: "all", label: "All" },
    { k: "attention", label: "Needs Attention" },
    { k: "due", label: "Due for Visit" },
    { k: "recent", label: "Recently Audited" },
    { k: "overdue", label: "Overdue" },
  ];
  function matchesFilter(customerId, filter) {
    if (filter === "all") return true;
    if (filter === "attention") return reasonsFor(customerId).length > 0;
    return visitBucketFor(customerId) === filter;
  }
  function filterCount(all, filter) {
    return all.filter((c) => matchesFilter(c._id, filter)).length;
  }

  function computeKPIs(all) {
    let visitsPlanned = 0, attentionCount = 0, auditsDue = 0, completedThisWeek = 0;
    const weekAgo = now().getTime() - 7 * DAY;
    for (const c of all) {
      const vb = visitBucketFor(c._id);
      if (vb === "due") visitsPlanned++;
      if (vb === "overdue") auditsDue++;
      if (reasonsFor(c._id).length) attentionCount++;
    }
    Object.keys(AuditStore.state).forEach((cid) => {
      AuditStore.list(cid).forEach((a) => {
        if (new Date(a.at).getTime() >= weekAgo) completedThisWeek++;
      });
    });
    return { visitsPlanned, completedThisWeek, attentionCount, auditsDue };
  }

  /* ------------------------------------------------------------------ router */

  let PAGE = null;
  let STACK = [];
  let CURRENT = { view: "customers", params: {} };
  let DRAFT = null; // in-progress audit while the wizard/workspace is open

  function go(view, params, replace) {
    if (!replace) STACK.push(CURRENT);
    CURRENT = { view, params: params || {} };
    renderCurrent();
  }
  function back() {
    const prev = STACK.pop();
    if (prev) { CURRENT = prev; renderCurrent(); }
    else go("customers", {}, true);
  }

  function renderCurrent() {
    ({
      customers: renderCustomers,
      audits: renderAudits,
      "customer-detail": () => renderCustomerDetail(CURRENT.params.customerId, CURRENT.params.openAuditId),
      "create-customer": renderCreateCustomer,
      "create-location": renderCreateLocation,
      "create-details": renderCreateDetails,
      brief: renderBrief,
      workspace: renderWorkspace,
      complete: renderComplete,
    })[CURRENT.view]?.();
  }

  function startAuditFor(customerId) {
    DRAFT = { customerId, locationId: null, purpose: "", at: new Date().toISOString().slice(0, 16), auditor: "Mahesh", notes: "", lines: {} };
    go("create-location", { customerId });
  }

  /* --------------------------------------------------------- persistent nav */

  function navActiveKey(view) {
    if (view === "audits") return "audits";
    return null;
  }

  // Trimmed to three per the product owner's call: this is a field tool, not
  // a place to browse — Audit History to look back, New Audit to act, Back
  // to retrace steps within a visit. "Customers" and the "Attention" shortcut
  // are still real views (reached from row actions and the landing filter
  // chips), just not permanent nav real estate.
  function navHTML(view) {
    const active = navActiveKey(view);
    const canBack = STACK.length > 0;
    return `
      <div class="sah-nav">
        <button class="nav-btn ${active === "audits" ? "active" : ""}" data-nav="audits"><span class="ic">🗂️</span>Audit History</button>
        <button class="nav-btn fab-slot" data-nav="create"><span class="nav-fab">+</span><span class="lbl">New Audit</span></button>
        <button class="nav-btn ${canBack ? "" : "disabled"}" data-nav="back" ${canBack ? "" : "disabled"}><span class="ic">←</span>Back</button>
      </div>`;
  }
  function wireNav() {
    PAGE.querySelectorAll("[data-nav]").forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.nav;
        if (k === "audits") go("audits", {}, true);
        else if (k === "create") { DRAFT = null; go("create-customer", {}); }
        else if (k === "back") back();
      };
    });
  }

  // Every view's HTML + the persistent nav, optionally with a sticky action
  // bar sitting just above the nav (foot).
  function frame(bodyHTML, { foot } = {}) {
    PAGE.innerHTML = `<div class="sah-wrap${foot ? " has-foot" : ""}">${bodyHTML}</div>${foot || ""}${navHTML(CURRENT.view)}`;
    wireNav();
  }

  /* ----------------------------------------------------------- shared bits */

  function wireSearchInput(id, onInput) {
    const box = $("#" + id, PAGE);
    if (!box) return;
    box.oninput = debounce(() => {
      onInput(box.value);
      const b = $("#" + id, PAGE);
      if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
    }, 220);
  }

  function reasonChipsHTML(reasons) {
    return reasons.map((r) => `<span class="status-tag ${r.cls}">${esc(r.label)}</span>`).join("");
  }

  /* ================================================================= VIEW: customers (landing) */

  let CUST_STATE = { q: "", filter: "all" };

  function renderCustomers() {
    if (CURRENT.params.filter) { CUST_STATE.filter = CURRENT.params.filter; CURRENT.params = {}; }
    const all = loadCustomers();
    const kpi = computeKPIs(all);
    const q = CUST_STATE.q.trim().toLowerCase();
    let rows = q ? all.filter((c) => [nameOf(c), c.phone, c.email].some((v) => String(v || "").toLowerCase().includes(q))) : all;
    rows = rows.filter((c) => matchesFilter(c._id, CUST_STATE.filter));

    const attention = all
      .map((c) => ({ c, reasons: reasonsFor(c._id) }))
      .filter((x) => x.reasons.length)
      .sort((a, b) => b.reasons.length - a.reasons.length)
      .slice(0, 4);

    frame(`
      <div class="sah-page-head">
        <div class="row">
          <div><h1>Customer Stock Audits</h1><p>Who needs a visit, why, and what to do next.</p></div>
          <button class="sah-cta" id="headCta">+ Create Audit</button>
        </div>
      </div>

      <div class="sah-search-row"><div class="sah-search"><input type="search" id="custQ" value="${esc(CUST_STATE.q)}" placeholder="Search customers…"></div></div>
      <div class="chips">
        ${FILTERS.map((f) => `<button class="chip ${CUST_STATE.filter === f.k ? "on" : ""}" data-f="${f.k}">${esc(f.label)} <span class="count">${filterCount(all, f.k)}</span></button>`).join("")}
      </div>

      <div class="sah-tiles">
        <div class="sah-tile navy"><div class="n">${kpi.visitsPlanned}</div><div class="l">Visits Planned</div></div>
        <div class="sah-tile green"><div class="n">${kpi.completedThisWeek}</div><div class="l">Audits Completed (7d)</div></div>
        <div class="sah-tile orange"><div class="n">${kpi.attentionCount}</div><div class="l">Need Attention</div></div>
        <div class="sah-tile red"><div class="n">${kpi.auditsDue}</div><div class="l">Audits Due</div></div>
      </div>

      ${attention.length ? `
        <div class="sec-label">Needs Attention <span class="count">${attention.length}</span></div>
        <div class="sah-body" style="padding-top:0">
          ${attention.map(({ c, reasons }) => `
            <div class="reason-card" data-goto="${c._id}">
              <div class="top">
                <div><div class="nm">${esc(titleCase(nameOf(c)))}</div><div class="loc">${esc(addressLine(c.adress1, c.state?.name, c.postnr))}</div></div>
                <button class="go" data-start="${c._id}">Start Audit</button>
              </div>
              <div class="reasons">${reasonChipsHTML(reasons)}</div>
            </div>`).join("")}
        </div>` : ""}

      <div class="sec-label">Customer Health <span class="count">${rows.length}</span></div>
      ${rows.length ? `<div class="customer-list">${rows.map(customerCardHTML).join("")}</div>` : `<div class="sah-empty"><div class="big">🔍</div><p>No customers match this view.</p></div>`}
    `);

    $("#headCta", PAGE).onclick = () => { DRAFT = null; go("create-customer", {}); };
    wireSearchInput("custQ", (v) => { CUST_STATE.q = v; renderCustomers(); });
    PAGE.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { CUST_STATE.filter = b.dataset.f; renderCustomers(); }));
    PAGE.querySelectorAll("[data-goto]").forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest("[data-start]")) return;
        go("customer-detail", { customerId: el.dataset.goto });
      };
    });
    PAGE.querySelectorAll("[data-start]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); startAuditFor(b.dataset.start); }));
    PAGE.querySelectorAll("[data-view-cust]").forEach((b) => (b.onclick = () => go("customer-detail", { customerId: b.dataset.viewCust })));
  }

  function customerCardHTML(c) {
    const health = healthBucketFor(c._id);
    const order = orderingStatusFor(c._id);
    const latest = auditsFor(c._id)[0];
    return `
      <div class="customer-card">
        <div class="top">
          <div><div class="nm">${esc(titleCase(nameOf(c)))}</div><div class="loc">${esc(addressLine(c.adress1, c.state?.name, c.postnr))}</div></div>
        </div>
        <div class="badges">
          <span class="health-badge ${health}">${esc(HEALTH_LABEL[health])}</span>
          <span class="order-badge ${order.bucket}">Ordering: ${esc(ORDER_LABEL[order.bucket])}</span>
        </div>
        <div class="meta">
          <span class="last">${latest ? "Last audit " + esc(fmtDateShort(latest.at)) : "Never audited"}</span>
          <span class="next">${esc(nextActionFor(c._id))}</span>
        </div>
        <div class="acts">
          <button class="btn-cc ghost" data-view-cust="${c._id}">View Customer</button>
          <button class="btn-cc primary" data-start="${c._id}">Start Audit</button>
        </div>
      </div>`;
  }

  /* ================================================================= VIEW: audits (secondary) */

  let AUD_STATE = { q: "" };

  function renderAudits() {
    const all = loadCustomers();
    const custMap = {};
    all.forEach((c) => (custMap[c._id] = c));
    let rows = [];
    AuditStore.allCustomerIds().forEach((cid) => {
      AuditStore.list(cid).forEach((a) => rows.push({ audit: a, customerId: cid, customer: custMap[cid] }));
    });
    rows.sort((a, b) => new Date(b.audit.at) - new Date(a.audit.at));

    const q = AUD_STATE.q.trim().toLowerCase();
    if (q) rows = rows.filter((r) => nameOf(r.customer).toLowerCase().includes(q) || (r.audit.notes || "").toLowerCase().includes(q));

    frame(`
      <div class="sah-page-head">
        <div class="row"><div><h1>Audit History</h1><p>Every visit across every customer, newest first.</p></div></div>
      </div>
      <div class="sah-search-row"><div class="sah-search"><input type="search" id="audQ" value="${esc(AUD_STATE.q)}" placeholder="Search by customer or note…"></div></div>
      ${rows.length ? rows.map(auditRowCardHTML).join("") : `<div class="sah-empty"><div class="big">🗂️</div><p>No audits recorded yet.</p></div>`}
    `);

    wireSearchInput("audQ", (v) => { AUD_STATE.q = v; renderAudits(); });
    PAGE.querySelectorAll("[data-open-audit]").forEach((el) => {
      el.onclick = () => go("customer-detail", { customerId: el.dataset.customer, openAuditId: el.dataset.openAudit });
    });
  }

  function auditRowCardHTML({ audit: a, customerId, customer }) {
    const variance = varianceLines(a).length;
    const flagged = flaggedLines(a).length;
    return `
      <div class="audit-row-card" data-open-audit="${a.id}" data-customer="${customerId}">
        <div class="top">
          <div><div class="nm">${esc(titleCase(nameOf(customer || {})))}</div><div class="when">${esc(fmtDate(a.at))} · ${esc(a.auditor || "—")}</div></div>
        </div>
        <span class="purpose">${esc(purposeMeta(a.purpose).icon)} ${esc(purposeMeta(a.purpose).label)}</span>
        <div class="stats">
          ${variance ? `<span class="status-tag warn">${variance} variance${variance === 1 ? "" : "s"}</span>` : `<span class="status-tag neutral">All matched</span>`}
          ${flagged ? `<span class="status-tag danger">${flagged} flagged</span>` : ""}
          ${a.followUp && a.followUp.required ? `<span class="status-tag followup">Follow-up needed</span>` : ""}
        </div>
      </div>`;
  }

  /* ================================================================= VIEW: customer-detail */

  let HIST = { q: "", filter: "all", openId: null };

  function renderCustomerDetail(customerId, openAuditId) {
    const customer = loadCustomer(customerId);
    if (!customer) {
      frame(`<div class="sah-empty" style="padding-top:60px"><div class="big">🔍</div><p>Customer not found.</p></div>`);
      return;
    }
    if (openAuditId) { HIST = { q: "", filter: "all", openId: openAuditId }; CURRENT.params = { customerId }; }

    const audits = auditsFor(customerId);
    const latest = audits[0] || null;
    const openVariances = latest ? varianceLines(latest).length : 0;
    const attention = latest ? flaggedLines(latest) : [];
    const followUpCount = audits.filter((a) => a.followUp && a.followUp.required).length;
    const order = orderingStatusFor(customerId);

    let visible = audits;
    if (HIST.filter === "followup") visible = visible.filter((a) => a.followUp && a.followUp.required);
    const q = HIST.q.trim().toLowerCase();
    if (q) visible = visible.filter((a) => (a.notes || "").toLowerCase().includes(q) || a.lines.some((l) => productName(l.productId).toLowerCase().includes(q)));

    frame(`
      <div class="sah-hero">
        <a class="back" href="stock-audit.html">← Back to Stock Audit &amp; Health</a>
        <div class="row">
          <div>
            <p class="eyebrow">Customer · Ordering ${esc(ORDER_LABEL[order.bucket])}</p>
            <h1>${esc(titleCase(nameOf(customer)))}</h1>
            <p class="sub">${esc(addressLine(customer.adress1, customer.state?.name, customer.postnr))}${customer.phone ? " · " + esc(customer.phone) : ""}</p>
          </div>
          <button class="sah-cta" id="startAudit">+ Start Audit</button>
        </div>
      </div>
      <div class="sah-tiles">
        <div class="sah-tile navy"><div class="n">${openVariances}</div><div class="l">Open Variances</div></div>
        <div class="sah-tile orange"><div class="n">${attention.length}</div><div class="l">Attention Items</div></div>
        <div class="sah-tile green"><div class="n">${products.length}</div><div class="l">Products Tracked</div></div>
        <div class="sah-tile red"><div class="n">${followUpCount}</div><div class="l">Follow-ups Open</div></div>
      </div>
      <div class="sah-body">
        ${latest ? `<div class="sec-label">Attention Needed — since ${esc(fmtDate(latest.at))}</div>` : ""}
        ${latest && attention.length ? attentionProductsHTML(attention) : latest ? `<p style="color:var(--muted);font-size:13px;margin:-4px 0 26px">Nothing flagged in the last audit — shelf looked healthy.</p>` : ""}
        <div class="sec-label">Audit History</div>
        <div class="sah-search-row"><div class="sah-search"><input type="search" id="histQ" value="${esc(HIST.q)}" placeholder="Search by product or note…"></div></div>
        <div class="chips">
          <button class="chip ${HIST.filter === "all" ? "on" : ""}" data-hf="all">All (${audits.length})</button>
          <button class="chip ${HIST.filter === "followup" ? "on" : ""}" data-hf="followup">Follow-up needed (${followUpCount})</button>
        </div>
        ${visible.length ? visible.map(auditCardHTML).join("") : `<div class="sah-empty"><div class="big">🗂️</div><p>${audits.length ? "No audits match this view." : "No audits yet — start the first one above."}</p></div>`}
      </div>
    `);

    $("#startAudit", PAGE).onclick = () => startAuditFor(customerId);
    wireSearchInput("histQ", (v) => { HIST.q = v; renderCustomerDetail(customerId); });
    PAGE.querySelectorAll("[data-hf]").forEach((b) => (b.onclick = () => { HIST.filter = b.dataset.hf; renderCustomerDetail(customerId); }));
    PAGE.querySelectorAll("[data-toggle]").forEach((el) => (el.onclick = () => { HIST.openId = HIST.openId === el.dataset.toggle ? null : el.dataset.toggle; renderCustomerDetail(customerId); }));
    PAGE.querySelectorAll("[data-fu-save]").forEach((b) => (b.onclick = () => {
      const a = audits.find((x) => x.id === b.dataset.fuSave);
      if (!a) return;
      const ta = PAGE.querySelector(`[data-fu-note="${a.id}"]`);
      a.followUp = { required: true, note: ta ? ta.value.trim() : "", at: new Date().toISOString() };
      AuditStore.save();
      toast("Follow-up flagged.");
      renderCustomerDetail(customerId);
    }));
    PAGE.querySelectorAll("[data-fu-clear]").forEach((b) => (b.onclick = () => {
      const a = audits.find((x) => x.id === b.dataset.fuClear);
      if (!a) return;
      a.followUp = { required: false, note: "", at: "" };
      AuditStore.save();
      toast("Follow-up cleared.");
      renderCustomerDetail(customerId);
    }));
  }

  function attentionProductsHTML(lines) {
    return `<div class="attn-card">
      ${lines.map((l) => {
        const p = productById(l.productId) || {};
        return `<div class="attn-row">
          <span class="thumb">${p.emoji || "📦"}</span>
          <span class="nm">${esc(p.name || l.productId)}<small>Art No: ${esc(p.artNo || "—")}</small></span>
          ${conditionBadgeHTML(l.condition)}
          ${l.shelfAvailable ? "" : `<span class="shelf-badge off">⛔ Off shelf</span>`}
        </div>`;
      }).join("")}
    </div>`;
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
            <div class="who">${esc(a.auditor || "—")} · ${esc(purposeMeta(a.purpose).label)} · ${a.lines.length} product${a.lines.length === 1 ? "" : "s"}</div>
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
          ${a.lines.map((l) => {
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
          }).join("")}
          ${followUpHTML(a)}
        </div>
      </div>`;
  }

  function followUpHTML(a) {
    const set = a.followUp && a.followUp.required;
    return `<div class="followup-box ${set ? "set" : ""}">
      ${set
        ? `<p><b>Follow-up flagged</b> — ${esc(a.followUp.note || "No note added.")}</p>
           <div class="btn-row"><button class="btn-sm danger" data-fu-clear="${a.id}">Clear follow-up</button></div>`
        : `<p>Need a return visit before the next scheduled audit?</p>
           <textarea data-fu-note="${a.id}" placeholder="e.g. Restock 250ML PET, shelf was empty"></textarea>
           <div class="btn-row"><button class="btn-sm primary" data-fu-save="${a.id}">Flag for follow-up</button></div>`
      }
    </div>`;
  }

  /* ================================================================= VIEW: create-customer (wizard step 1) */

  let PICK_STATE = { q: "" };

  function wizardStepsHTML(step) {
    return `<div class="wizard-steps">${[1, 2, 3].map((n) => `<span class="dot ${n < step ? "done" : n === step ? "on" : ""}"></span>`).join("")}</div>`;
  }

  function renderCreateCustomer() {
    const all = loadCustomers();
    const q = PICK_STATE.q.trim().toLowerCase();
    const rows = q ? all.filter((c) => [nameOf(c), c.phone].some((v) => String(v || "").toLowerCase().includes(q))) : all;

    frame(`
      ${wizardStepsHTML(1)}
      <p class="wizard-label">Create Audit · Step 1 of 3</p>
      <h2 class="wizard-title">Select Customer</h2>
      <p class="wizard-sub">Who are you visiting?</p>
      <div class="sah-search-row"><div class="sah-search"><input type="search" id="pickQ" value="${esc(PICK_STATE.q)}" placeholder="Search customers…"></div></div>
      <div class="picker-list">${rows.length ? rows.map((c) => `
        <button type="button" class="picker-row" data-pick="${c._id}">
          <span class="av">${esc(titleCase(nameOf(c)).charAt(0) || "C")}</span>
          <span><span class="nm">${esc(titleCase(nameOf(c)))}</span><div class="sub">${esc(addressLine(c.adress1, c.state?.name, c.postnr))}</div></span>
        </button>`).join("") : `<div class="sah-empty">No customers found</div>`}
      </div>
    `);

    wireSearchInput("pickQ", (v) => { PICK_STATE.q = v; renderCreateCustomer(); });
    PAGE.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => {
      DRAFT = { customerId: b.dataset.pick, locationId: null, purpose: "", at: new Date().toISOString().slice(0, 16), auditor: "Mahesh", notes: "", lines: {} };
      go("create-location", { customerId: b.dataset.pick });
    }));
  }

  /* ================================================================= VIEW: create-location (wizard step 2) */

  function renderCreateLocation() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer) { go("create-customer", {}, true); return; }
    if (!DRAFT) DRAFT = { customerId: customer._id, locationId: null, purpose: "", at: new Date().toISOString().slice(0, 16), auditor: "Mahesh", notes: "", lines: {} };
    const locs = locationsFor(customer);
    if (!DRAFT.locationId && locs.length === 1) DRAFT.locationId = locs[0].id;

    frame(`
      ${wizardStepsHTML(2)}
      <p class="wizard-label">Create Audit · Step 2 of 3 · ${esc(titleCase(nameOf(customer)))}</p>
      <h2 class="wizard-title">Select Location</h2>
      <p class="wizard-sub">Which of this customer's locations are you visiting?</p>
      ${locs.map((l) => `
        <button type="button" class="location-card ${DRAFT.locationId === l.id ? "on" : ""}" data-loc="${l.id}">
          <span class="ic">${l.id === "shipping" ? "🏭" : "🏬"}</span>
          <span><div class="nm">${esc(l.label)}</div><div class="sub">${esc(l.line)}</div></span>
        </button>`).join("")}
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="locBack">Back</button>
        <button class="btn-wide primary" id="locNext" ${DRAFT.locationId ? "" : "disabled"}>Continue</button>
      </div></div>` });

    PAGE.querySelectorAll("[data-loc]").forEach((b) => (b.onclick = () => { DRAFT.locationId = b.dataset.loc; renderCreateLocation(); }));
    $("#locBack", PAGE).onclick = back;
    $("#locNext", PAGE).onclick = () => { if (DRAFT.locationId) go("create-details", { customerId: customer._id }); };
  }

  /* ================================================================= VIEW: create-details (wizard step 3) */

  function renderCreateDetails() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer || !DRAFT) { go("create-customer", {}, true); return; }

    frame(`
      ${wizardStepsHTML(3)}
      <p class="wizard-label">Create Audit · Step 3 of 3 · ${esc(titleCase(nameOf(customer)))}</p>
      <h2 class="wizard-title">Audit Purpose</h2>
      <p class="wizard-sub">What's the reason for this visit?</p>
      <div class="purpose-grid">${PURPOSES.map((p) => `
        <button type="button" class="purpose-card ${DRAFT.purpose === p.k ? "on" : ""}" data-purpose="${p.k}">
          <span class="ic">${p.icon}</span><span class="nm">${esc(p.label)}</span><span class="sub">${esc(p.sub)}</span>
        </button>`).join("")}
      </div>
      <div class="info-card">
        <div class="info-row"><span class="ic">📅</span><span class="lbl">Date &amp; Time</span><span class="val"><input type="datetime-local" id="draftAt" value="${esc(DRAFT.at)}" style="border:none;background:none;font:inherit;font-weight:700;text-align:right"></span></div>
        <div class="info-row"><span class="ic">🧑‍💼</span><span class="lbl">Auditor</span><span class="val">Mahesh</span></div>
        <div class="info-row"><span class="ic">🏷️</span><span class="lbl">Role · Team</span><span class="val">Field Auditor · Distribution Team</span></div>
      </div>
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="detBack">Back</button>
        <button class="btn-wide primary" id="detNext" ${DRAFT.purpose ? "" : "disabled"}>Create Audit</button>
      </div></div>` });

    PAGE.querySelectorAll("[data-purpose]").forEach((b) => (b.onclick = () => { DRAFT.purpose = b.dataset.purpose; renderCreateDetails(); }));
    $("#draftAt", PAGE).oninput = (e) => (DRAFT.at = e.target.value);
    $("#detBack", PAGE).onclick = back;
    $("#detNext", PAGE).onclick = () => { if (DRAFT.purpose) go("brief", { customerId: customer._id }); };
  }

  /* ================================================================= VIEW: brief */

  function renderBrief() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer || !DRAFT) { go("customers", {}, true); return; }
    const audits = auditsFor(customer._id);
    const last = audits[0] || null;
    const order = orderingStatusFor(customer._id);
    const attention = last ? flaggedLines(last) : [];
    const issues = audits
      .filter((a) => a.followUp && a.followUp.note)
      .slice(0, 3)
      .map((a) => ({ at: a.at, note: a.followUp.note }));

    frame(`
      <div class="sah-hero">
        <p class="eyebrow">Visit Brief</p>
        <h1>${esc(titleCase(nameOf(customer)))}</h1>
        <p class="sub">${esc(purposeMeta(DRAFT.purpose).icon)} ${esc(purposeMeta(DRAFT.purpose).label)} · ${esc(fmtDate(DRAFT.at))}</p>
      </div>
      <div class="brief-card">
        <div class="brief-row"><span class="lbl">Last Audit</span><span class="val">${last ? esc(fmtDate(last.at)) : "Never"}${last ? `<small>${esc(purposeMeta(last.purpose).label)}</small>` : ""}</span></div>
        <div class="brief-row"><span class="lbl">Last Order</span><span class="val">${order.lastOrderAt ? esc(fmtDateShort(order.lastOrderAt)) : "Unknown"}</span></div>
        <div class="brief-row"><span class="lbl">Ordering Cycle</span><span class="val">${order.avgCycleDays ? `Every ~${order.avgCycleDays}d` : "Unknown"}<small>${esc(ORDER_LABEL[order.bucket])}</small></span></div>
      </div>
      ${issues.length ? `<div class="sec-label">Previous Issues</div><div class="issue-list">${issues.map((i) => `<div class="issue-item"><span class="ic">🚩</span><span>${esc(fmtDateShort(i.at))} — ${esc(i.note)}</span></div>`).join("")}</div>` : ""}
      <div class="sec-label">Products Needing Attention</div>
      ${attention.length ? attentionProductsHTML(attention) : `<p style="color:var(--muted);font-size:13px;margin:-4px 0 20px">Nothing flagged last visit.</p>`}
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="briefBack">Back</button>
        <button class="btn-wide primary" id="briefGo">Begin Audit →</button>
      </div></div>` });

    $("#briefBack", PAGE).onclick = back;
    $("#briefGo", PAGE).onclick = () => go("workspace", { customerId: customer._id });
  }

  /* ================================================================= VIEW: workspace (capture) */

  let WS_STATE = { q: "" };

  function capCardHTML(p) {
    const line = DRAFT.lines[p.id];
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

  function renderWorkspace() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer || !DRAFT) { go("customers", {}, true); return; }
    const q = WS_STATE.q.trim().toLowerCase();
    const list = products.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.artNo).toLowerCase().includes(q));
    const entered = Object.keys(DRAFT.lines).filter((id) => DRAFT.lines[id].counted !== "" && DRAFT.lines[id].counted != null).length;
    const pct = products.length ? Math.round((entered / products.length) * 100) : 0;

    frame(`
      <div class="sah-hero">
        <button type="button" class="back" id="wsBack">← ${esc(titleCase(nameOf(customer)))}</button>
        <div class="row"><div><p class="eyebrow">Audit Workspace</p><h1>Count What's On The Shelf</h1><p class="sub">${esc(purposeMeta(DRAFT.purpose).label)}</p></div></div>
      </div>
      <div class="cap-progress"><span class="txt">${entered} / ${products.length} captured</span><div class="bar"><span style="width:${pct}%"></span></div></div>
      <div class="sah-search-row">
        <div class="sah-search"><input type="search" id="wsQ" value="${esc(WS_STATE.q)}" placeholder="Search or scan a product…"></div>
        <button type="button" class="scan-btn" id="wsScan">📷 Scan</button>
      </div>
      <div class="cap-grid" id="capGrid">${list.length ? list.map(capCardHTML).join("") : `<div class="sah-empty">No products found</div>`}</div>
      <textarea class="workspace-notes" id="wsNotes" placeholder="Notes for this visit (optional)">${esc(DRAFT.notes)}</textarea>
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="wsCancel">Cancel</button>
        <button class="btn-wide primary" id="wsComplete" ${entered ? "" : "disabled"}>Complete Audit</button>
      </div></div>` });

    wireWorkspace(customer, list);
  }

  function wireWorkspace(customer, list) {
    $("#wsBack", PAGE).onclick = back;
    $("#wsCancel", PAGE).onclick = () => go("customer-detail", { customerId: customer._id }, true);
    $("#wsNotes", PAGE).oninput = (e) => (DRAFT.notes = e.target.value);
    wireSearchInput("wsQ", (v) => { WS_STATE.q = v; renderWorkspace(); });

    $("#wsScan", PAGE).onclick = () => {
      const next = products.find((p) => !DRAFT.lines[p.id] || DRAFT.lines[p.id].counted === "" || DRAFT.lines[p.id].counted == null);
      if (!next) { toast("All products already counted.", "info"); return; }
      const line = ensureLine(next.id);
      line.counted = String((line.counted === "" || line.counted == null ? 0 : Number(line.counted)) + 1);
      toast(`Scanned ${next.name}.`);
      renderWorkspace();
    };

    function ensureLine(id) {
      if (!DRAFT.lines[id]) DRAFT.lines[id] = { counted: "", condition: "ok", shelfAvailable: true };
      return DRAFT.lines[id];
    }
    function updateProgress() {
      const entered = Object.keys(DRAFT.lines).filter((id) => DRAFT.lines[id].counted !== "" && DRAFT.lines[id].counted != null).length;
      const pct = products.length ? Math.round((entered / products.length) * 100) : 0;
      const txt = $(".cap-progress .txt", PAGE);
      if (txt) txt.textContent = `${entered} / ${products.length} captured`;
      const bar = $(".cap-progress .bar > span", PAGE);
      if (bar) bar.style.width = pct + "%";
      const btn = $("#wsComplete", PAGE);
      if (btn) btn.disabled = entered === 0;
    }
    function syncCard(p) {
      const card = PAGE.querySelector(`.cap-card[data-p="${p.id}"]`);
      if (!card) return;
      const line = DRAFT.lines[p.id];
      card.classList.toggle("touched", line != null);
      const counted = line ? line.counted : "";
      const v = counted === "" || counted == null ? null : Number(counted) - p.systemStock;
      const varEl = card.querySelector(".var");
      varEl.className = "var" + (v == null ? "" : v === 0 ? " match" : v > 0 ? " up" : " down");
      varEl.textContent = v == null ? "—" : v === 0 ? "Match" : (v > 0 ? "+" : "") + v;
      const input = card.querySelector(".cap-stepper input");
      const shown = counted === "" || counted == null ? "" : String(counted);
      if (input.value !== shown) input.value = shown;
      card.querySelectorAll(".cond-chip").forEach((chip) => {
        const on = !!line && line.condition === chip.dataset.cond;
        chip.className = "cond-chip" + (on ? " on " + chip.dataset.cond : "");
      });
      card.querySelector(".switch").classList.toggle("on", line ? line.shelfAvailable !== false : true);
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
      card.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => {
        const line = ensureLine(p.id);
        const cur = line.counted === "" || line.counted == null ? 0 : Number(line.counted);
        setCounted(String(Math.max(0, cur + Number(b.dataset.step))));
      }));
      card.querySelectorAll("[data-cond]").forEach((chip) => (chip.onclick = () => { ensureLine(p.id).condition = chip.dataset.cond; syncCard(p); }));
      card.querySelector("[data-shelf]").onclick = () => {
        const line = ensureLine(p.id);
        line.shelfAvailable = !(line.shelfAvailable !== false);
        syncCard(p);
      };
    });

    $("#wsComplete", PAGE).onclick = () => completeAudit(customer);
  }

  function completeAudit(customer) {
    const lines = Object.keys(DRAFT.lines)
      .filter((id) => DRAFT.lines[id].counted !== "" && DRAFT.lines[id].counted != null)
      .map((id) => {
        const p = productById(id);
        const line = DRAFT.lines[id];
        return { productId: id, system: p ? p.systemStock : 0, counted: Number(line.counted), condition: line.condition || "ok", shelfAvailable: line.shelfAvailable !== false };
      });
    if (!lines.length) return;

    const audit = {
      id: "aud-" + customer._id + "-" + Date.now().toString(36),
      at: DRAFT.at ? new Date(DRAFT.at).toISOString() : new Date().toISOString(),
      auditor: DRAFT.auditor || "Mahesh",
      purpose: DRAFT.purpose,
      locationId: DRAFT.locationId,
      notes: (DRAFT.notes || "").trim(),
      lines,
      followUp: { required: false, note: "", at: "" },
    };
    AuditStore.list(customer._id).unshift(audit);
    AuditStore.save();
    toast("Audit saved.");
    go("complete", { customerId: customer._id, auditId: audit.id }, true);
  }

  /* ================================================================= VIEW: complete */

  function computeAuditScore(a) {
    const flagged = flaggedLines(a).length;
    const variance = varianceLines(a).length;
    const fu = a.followUp && a.followUp.required;
    let score = 100 - flagged * 12 - variance * 5 - (fu ? 10 : 0);
    score = Math.max(0, Math.min(100, score));
    const cls = score >= 80 ? "good" : score >= 55 ? "fair" : "poor";
    const label = score >= 80 ? "Healthy Customer" : score >= 55 ? "Fair — Keep An Eye On It" : "Needs Attention";
    return { score, cls, label };
  }
  function shelfHealthPct(a) {
    if (!a.lines.length) return 100;
    return Math.round((a.lines.filter((l) => l.shelfAvailable).length / a.lines.length) * 100);
  }
  function recommendedActions(a) {
    const oos = a.lines.filter((l) => l.condition === "out_of_stock").map((l) => productName(l.productId));
    const bad = a.lines.filter((l) => l.condition === "damaged" || l.condition === "expired" || l.condition === "near_expiry").map((l) => productName(l.productId));
    const over = a.lines.filter(isOverstock).map((l) => productName(l.productId));
    const acts = [];
    if (oos.length) acts.push({ ic: "📦", title: "Replenish", text: oos.join(", ") });
    if (bad.length) acts.push({ ic: "🧹", title: "Pull &amp; rotate stock", text: bad.join(", ") });
    if (over.length) acts.push({ ic: "📉", title: "Slow-moving / overstock", text: over.join(", ") + " — consider a push offer" });
    if (a.followUp && a.followUp.required) acts.push({ ic: "🚩", title: "Follow-up scheduled", text: a.followUp.note || "Return visit flagged", done: true });
    else if (flaggedLines(a).length) acts.push({ ic: "🚩", title: "Consider a follow-up visit", text: "This audit found flagged items.", flag: a.id });
    if (!acts.length) acts.push({ ic: "✅", title: "All clear", text: "No issues found — shelf looks healthy." });
    return acts;
  }

  function renderComplete() {
    const customer = loadCustomer(CURRENT.params.customerId);
    const audits = auditsFor(CURRENT.params.customerId);
    const a = audits.find((x) => x.id === CURRENT.params.auditId) || audits[0];
    if (!customer || !a) { go("customers", {}, true); return; }

    const score = computeAuditScore(a);
    const oosCount = a.lines.filter((l) => l.condition === "out_of_stock").length;
    const overCount = a.lines.filter(isOverstock).length;
    const expiryCount = a.lines.filter((l) => l.condition === "expired" || l.condition === "near_expiry").length;
    const shelfPct = shelfHealthPct(a);
    const acts = recommendedActions(a);

    frame(`
      <div class="sah-page-head"><div class="row"><div><h1>Audit Complete</h1><p>${esc(titleCase(nameOf(customer)))} · ${esc(fmtDate(a.at))}</p></div></div></div>

      <div class="score-card">
        <div class="score-ring ${score.cls}">${score.score}</div>
        <div><div class="lbl">Customer Health Score</div><div class="desc">${esc(score.label)}</div><div class="sub">${a.lines.length} product${a.lines.length === 1 ? "" : "s"} counted this visit</div></div>
      </div>

      <div class="sec-label">Summary</div>
      <div class="summary-grid">
        <div class="summary-tile ${oosCount ? "flag" : ""}"><div class="n">${oosCount}</div><div class="l">Stock-out risk</div></div>
        <div class="summary-tile ${overCount ? "flag" : ""}"><div class="n">${overCount}</div><div class="l">Overstock</div></div>
        <div class="summary-tile ${expiryCount ? "flag" : ""}"><div class="n">${expiryCount}</div><div class="l">Expiry risk</div></div>
        <div class="summary-tile"><div class="n">${shelfPct}%</div><div class="l">Shelf availability</div></div>
      </div>

      <div class="sec-label">Recommended Actions</div>
      <div class="action-list">
        ${acts.map((x) => `
          <div class="action-item">
            <span class="ic">${x.ic}</span>
            <span class="txt"><b>${esc(x.title)}</b>${esc(x.text)}</span>
            ${x.flag ? `<button data-flag="${x.flag}">Flag</button>` : x.done ? `<button disabled>Flagged</button>` : ""}
          </div>`).join("")}
      </div>
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="doneList">Customer List</button>
        <button class="btn-wide primary" id="doneCust">Done → View Customer</button>
      </div></div>` });

    $("#doneList", PAGE).onclick = () => go("customers", {}, true);
    $("#doneCust", PAGE).onclick = () => go("customer-detail", { customerId: customer._id }, true);
    PAGE.querySelectorAll("[data-flag]").forEach((b) => (b.onclick = () => {
      a.followUp = { required: true, note: "Flagged from Complete Audit summary.", at: new Date().toISOString() };
      AuditStore.save();
      toast("Follow-up flagged.");
      renderComplete();
    }));
  }

  /* ------------------------------------------------------------------ mount */

  function mount() {
    PAGE = mountShell($("#app"), { screen: "stock-audit", crumb: "Stock Audit & Health", tenant: SEED.tenant });
    AuditStore.load();

    const params = new URLSearchParams(location.search);
    const id = params.get("customer");
    if (id) go("customer-detail", { customerId: id }, true);
    else go("customers", {}, true);
  }

  window.SAH = { mount };
})();
