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
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
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
  // "Today, 10:15 AM" / "Yesterday" / "N days ago" / "Never audited" — the
  // relative phrasing the customer list reads against, instead of a bare date.
  function fmtRelative(iso) {
    if (!iso) return "Never audited";
    const days = daysBetween(iso);
    if (days <= 0) return "Today, " + new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return "Yesterday";
    return days + " days ago";
  }
  function addressLine(addr, state, pin) {
    return [addr, state && state.name, pin].filter(Boolean).join(", ") || "No address on file";
  }

  /* --------------------------------------------------------- bottom sheet */

  function sheet({ eyebrow, title, sub, body, actions }) {
    document.querySelectorAll(".sah-sheet-scrim").forEach((n) => n.remove());
    const scrim = document.createElement("div");
    scrim.className = "sah-sheet-scrim";
    scrim.innerHTML = `<div class="sah-sheet"><div class="grip"></div>
      ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}
      ${title ? `<h2>${esc(title)}</h2>` : ""}
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ""}
      ${body || ""}
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
    // An action's onClick returning false keeps the sheet open, which is how
    // a sheet with a form reports a validation failure.
    return { close, el: scrim };
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

  // Every audit belongs to exactly one location — stock is never mixed
  // across two physical places in one visit. Customer-level intelligence is
  // the aggregate of the location-level history, not a shortcut around it.
  //
  // Type is not decoration: it decides which questions the capture screen is
  // allowed to ask. A warehouse has no shelf, so shelf availability and
  // facings must not be asked there.
  const LOCATION_TYPES = {
    retail_store: { label: "Retail Store", icon: "🏬", shelf: true },
    outlet: { label: "Outlet", icon: "🏪", shelf: true },
    warehouse: { label: "Warehouse", icon: "🏭", shelf: false },
    other: { label: "Other", icon: "📍", shelf: false },
  };
  const locationTypeMeta = (k) => LOCATION_TYPES[k] || LOCATION_TYPES.other;

  const LOCATIONS_KEY = "fb-discovery-stock-locations-v1";
  // Locations a rep added in the field. The customer record only knows the
  // addresses it was set up with, and a visit to anywhere else would
  // otherwise have nowhere to belong.
  const LocationStore = {
    state: {},
    load() {
      try {
        this.state = JSON.parse(localStorage.getItem(LOCATIONS_KEY) || "null") || {};
      } catch (e) {
        this.state = {};
      }
      return this.state;
    },
    save() {
      try {
        localStorage.setItem(LOCATIONS_KEY, JSON.stringify(this.state));
      } catch (e) {
        /* private mode — the prototype still works, it just doesn't persist */
      }
    },
    list(customerId) {
      return this.state[customerId] || [];
    },
    add(customerId, loc) {
      (this.state[customerId] || (this.state[customerId] = [])).push(loc);
      this.save();
      return loc;
    },
  };

  // Most customers have one location — their registered address. A few in the
  // seed carry a genuinely different shipping address (store vs warehouse),
  // which becomes a real second choice here rather than an invented field.
  function locationsFor(c) {
    if (!c) return [];
    const locs = [{
      id: "primary",
      name: "Main Store",
      type: "retail_store",
      line: addressLine(c.adress1, c.state?.name, c.postnr),
    }];
    const sameAsPrimary =
      !c.adress2 ||
      (c.adress2 === c.adress1 && (c.shippingState?.code || "") === (c.state?.code || ""));
    if (!sameAsPrimary) {
      locs.push({
        id: "shipping",
        name: "Warehouse",
        type: "warehouse",
        line: addressLine(c.adress2, c.shippingState?.name, c.shippingPostnumber),
      });
    }
    return locs.concat(LocationStore.list(c._id));
  }
  function locationFor(c, id) {
    return locationsFor(c).find((l) => l.id === id) || null;
  }
  // Does this location have a shelf worth asking about?
  function locationHasShelf(c, id) {
    const l = locationFor(c, id);
    return l ? locationTypeMeta(l.type).shelf : true;
  }
  // "Acme Retail · Kothrud" — the where-am-I line every capture screen carries.
  function placeLine(c, id) {
    const l = locationFor(c, id);
    return [titleCase(nameOf(c)), l && l.name].filter(Boolean).join(" · ");
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
      const raw = saved || clone(SEED.stockAudits || {});
      // Migrate on read — see normalizeAudit. Covers both the seed and any
      // records a rep already has in localStorage from an earlier build.
      Object.keys(raw).forEach((cid) => (raw[cid] = (raw[cid] || []).map((a) => normalizeAudit(a, cid))));
      this.state = raw;
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

  const DRAFTS_KEY = "fb-discovery-stock-draft-audits-v1";
  // An audit in progress. A rep walks out of a store mid-count all the time —
  // a delivery blocks the aisle, the shutters come down, the phone rings —
  // and losing the count because the page reloaded would make the whole
  // feature untrustworthy. One open draft per customer: a rep is in one
  // store at a time, but may have left one half-done at another.
  const DraftStore = {
    state: {},
    load() {
      try {
        this.state = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "null") || {};
      } catch (e) {
        this.state = {};
      }
      return this.state;
    },
    save() {
      try {
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(this.state));
      } catch (e) {
        /* private mode — the prototype still works, it just doesn't persist */
      }
    },
    get(customerId) { return this.state[customerId] || null; },
    put(draft) { if (draft && draft.customerId) { this.state[draft.customerId] = draft; this.save(); } },
    clear(customerId) { delete this.state[customerId]; this.save(); },
    ids() { return Object.keys(this.state); },
  };
  function persistDraft() {
    if (!DRAFT || !DRAFT.customerId) return;
    // Opening a product screen creates its line so the fields have something
    // to write into; one the rep backed out of without counting is not part
    // of the visit, so it doesn't belong in the saved draft.
    Object.keys(DRAFT.lines).forEach((id) => {
      if (!lineIsCaptured(DRAFT.lines[id])) delete DRAFT.lines[id];
    });
    DraftStore.put(DRAFT);
  }
  function draftProgress(d) {
    const captured = Object.keys(d.lines || {}).filter((id) => d.lines[id] && lineIsCaptured(d.lines[id])).length;
    return { captured, total: (SEED.products || []).length };
  }

  const products = SEED.products || [];
  const productById = (id) => products.find((p) => p.id === id);
  const productName = (id) => (productById(id) || {}).name || id;
  // A real photo when the product has one, the emoji glyph as a fallback —
  // every `.thumb` in the app renders through this so the two never drift.
  const thumbHTML = (p) => (p && p.image ? `<img src="${esc(p.image)}" alt="">` : esc((p && p.emoji) || "📦"));

  /* ---------------------------------------------------- observation model */

  // A line on an audit is an OBSERVATION, not a count — what was expected,
  // what was physically found, how that physical stock breaks down by
  // condition and by where it was stored, plus whatever exception detail the
  // condition made relevant (expiry/batch, disposition, damage type). The
  // point is that the record still describes the visit six months later:
  // "20 counted" has already thrown away the fact that 5 of them were expired.
  //
  // Everything derivable — variance, condition totals, whether a line is
  // flagged, audit coverage, the health axes — is computed on read and never
  // stored, so a hand-edited seed can't end up disagreeing with itself.

  // Physical stock splits four ways, and the four must reconcile to the
  // total. That rule is enforced where it's entered, not here.
  const CONDITION_KEYS = [
    { k: "good", label: "Good", legacy: "ok", icon: "✓" },
    { k: "nearExpiry", label: "Near Expiry", legacy: "near_expiry", icon: "⏰" },
    { k: "expired", label: "Expired", legacy: "expired", icon: "⏳" },
    { k: "damaged", label: "Damaged", legacy: "damaged", icon: "⚠️" },
  ];
  // Where the stock physically was. Shelf vs backroom is a real distinction:
  // an empty-looking shelf with 12 units sitting in the back is a
  // merchandising problem, not a stock problem.
  const STORAGE_KEYS = [
    { k: "shelf", label: "On shelf", icon: "🧺" },
    { k: "backroom", label: "Backroom", icon: "🚪" },
    { k: "warehouse", label: "Warehouse", icon: "🏭" },
    { k: "other", label: "Other", icon: "📍" },
  ];
  const SHELF_AVAILABILITY = [
    { k: "available", label: "Available", cls: "ok" },
    { k: "partial", label: "Partially available", cls: "warn" },
    { k: "not_on_shelf", label: "Not on shelf", cls: "danger" },
  ];
  // "Couldn't find it" and "confirmed zero on hand" are different business
  // states and must not collapse into each other — one is an unverified
  // line, the other is a stock-out. Hence a line status of its own.
  const NOT_FOUND_REASONS = [
    { k: "not_on_shelf", label: "Not on shelf" },
    { k: "not_in_backroom", label: "Not in backroom" },
    { k: "customer_says_oos", label: "Customer says out of stock" },
    { k: "no_access", label: "Unable to access" },
    { k: "other", label: "Other" },
  ];
  const DISPOSITIONS = [
    { k: "pull", label: "Pull from shelf" },
    { k: "return", label: "Return" },
    { k: "dispose", label: "Dispose" },
    { k: "customer", label: "Customer decision" },
  ];
  const DAMAGE_TYPES = [
    { k: "packaging", label: "Packaging" },
    { k: "product", label: "Product damage" },
    { k: "leakage", label: "Leakage" },
    { k: "other", label: "Other" },
  ];

  // Badge vocabulary — the single worst thing true about a line, for the many
  // places a list has room for one pill rather than a whole breakdown.
  const CONDITIONS = [
    { k: "ok", label: "OK", icon: "✓" },
    { k: "damaged", label: "Damaged", icon: "⚠️" },
    { k: "expired", label: "Expired", icon: "⏳" },
    { k: "near_expiry", label: "Near Expiry", icon: "⏰" },
    { k: "out_of_stock", label: "Out of Stock", icon: "🚫" },
    { k: "not_found", label: "Not Found", icon: "❓" },
  ];
  const condMeta = (k) => CONDITIONS.find((c) => c.k === k) || { label: k, icon: "•" };
  const shelfMeta = (k) => SHELF_AVAILABILITY.find((x) => x.k === k) || { label: "Not rated", cls: "neutral" };
  const notFoundMeta = (k) => NOT_FOUND_REASONS.find((x) => x.k === k) || { label: "Not found" };

  // Lifecycle. A completed audit is an immutable snapshot of a visit —
  // corrections after the fact are meant to become their own record rather
  // than silently rewriting what the rep saw on the day.
  const AUDIT_STATUS = {
    draft: { label: "Draft", cls: "neutral" },
    in_progress: { label: "In Progress", cls: "info" },
    paused: { label: "Paused", cls: "warn" },
    review: { label: "In Review", cls: "info" },
    completed: { label: "Completed", cls: "ok" },
    cancelled: { label: "Cancelled", cls: "neutral" },
    abandoned: { label: "Abandoned", cls: "danger" },
  };
  const statusMeta = (k) => AUDIT_STATUS[k] || AUDIT_STATUS.completed;
  // Reasons a visit stopped early. Abandoned means it never really started;
  // partial means it ran and got cut short — see the closure screen.
  const PARTIAL_REASONS = [
    { k: "store_closing", label: "Store closing" },
    { k: "product_unavailable", label: "Product unavailable" },
    { k: "access_restricted", label: "Access restricted" },
    { k: "time", label: "Time constraint" },
    { k: "other", label: "Other" },
  ];
  const OPEN_STATUSES = new Set(["draft", "in_progress", "paused", "review"]);

  // The signed-in rep. Auto-populated everywhere the spec says "do not make
  // the employee type their own name, role, team".
  const AUDITOR = { id: "u-mahesh", name: "Mahesh", role: "Sales Executive", team: "Pune Team" };

  const emptyCondition = () => ({ good: 0, nearExpiry: 0, expired: 0, damaged: 0 });
  const emptyStorage = () => ({ shelf: 0, backroom: 0, warehouse: 0, other: 0 });
  const sumOf = (obj) => Object.keys(obj || {}).reduce((n, k) => n + (Number(obj[k]) || 0), 0);

  function blankLine(productId, expected) {
    return {
      productId,
      expected: Number(expected) || 0,
      physical: null,
      conditionBreakdown: emptyCondition(),
      storageBreakdown: emptyStorage(),
      shelfAvailability: null,
      facings: null,
      expiryDetails: [],
      disposition: null,
      damageType: null,
      notes: "",
      evidence: [],
      status: "pending",
      notFoundReason: null,
    };
  }

  // Audits written before the observation model existed — the original seed,
  // plus whatever is already sitting in a rep's localStorage — carried one
  // enum per line: {system, counted, condition, shelfAvailable}. Read them
  // forward instead of dropping them: the history IS the value of this
  // feature, and migrating on read costs one function and loses nothing.
  function normalizeLine(raw) {
    if (!raw) return null;
    // Discriminate on the LEGACY fields, not on the presence of a
    // conditionBreakdown: a not-found line legitimately has no condition
    // buckets at all, and testing for them sent it down the migration path.
    const legacy = "counted" in raw || "system" in raw;
    if (!legacy) {
      // Already the observation shape, but very likely terse — the seed only
      // spells out the buckets that are non-zero. Fill in the rest so every
      // reader can assume the whole shape is present.
      const line = Object.assign(blankLine(raw.productId, raw.expected), raw);
      line.conditionBreakdown = Object.assign(emptyCondition(), raw.conditionBreakdown);
      line.storageBreakdown = Object.assign(emptyStorage(), raw.storageBreakdown);
      line.expiryDetails = raw.expiryDetails || [];
      line.evidence = raw.evidence || [];
      // Physical stock IS the sum of its condition buckets — that's the
      // reconciliation rule, so deriving it here rather than repeating it in
      // the seed keeps the two from ever disagreeing.
      if (line.physical == null && line.status === "audited") line.physical = sumOf(line.conditionBreakdown);
      return line;
    }
    const physical = Number(raw.counted) || 0;
    const line = blankLine(raw.productId, raw.system);
    line.physical = physical;
    line.status = "audited";
    const bucket = { ok: "good", near_expiry: "nearExpiry", expired: "expired", damaged: "damaged" }[raw.condition];
    // out_of_stock has no bucket to land in — physical is 0, so every bucket
    // is 0 too, and the stock-out reads off expected-vs-physical instead.
    if (bucket) line.conditionBreakdown[bucket] = physical;
    const onShelf = raw.shelfAvailable !== false;
    line.storageBreakdown[onShelf ? "shelf" : "backroom"] = physical;
    line.shelfAvailability = onShelf ? "available" : "not_on_shelf";
    return line;
  }

  function normalizeAudit(raw, customerId) {
    const a = raw || {};
    a.customerId = a.customerId || customerId;
    a.lines = (a.lines || []).map(normalizeLine).filter(Boolean);
    // Anything that predates the lifecycle is, by definition, history.
    if (!a.status) a.status = "completed";
    if (!a.createdAt) a.createdAt = a.at;
    if (!a.completedAt && a.status === "completed") a.completedAt = a.at;
    if (!a.auditor) a.auditor = AUDITOR.name;
    // Who did what, so a half-finished visit picked up by a second rep still
    // reads correctly afterwards.
    if (!a.actors) {
      const done = a.status === "completed";
      a.actors = { createdBy: a.auditor, startedBy: a.auditor, lastEditedBy: a.auditor, completedBy: done ? a.auditor : null };
    }
    if (!a.evidence) a.evidence = [];
    if (!a.finalNote) a.finalNote = "";
    if (!("outcome" in a)) a.outcome = null;
    if (!a.partial) a.partial = { isPartial: false, reason: null, note: "" };
    if (!a.followUp) a.followUp = { required: false, note: "", at: "" };
    // Replenish/pull live in Sales Orders, a different module — this just
    // remembers that a rep already asked, so re-opening the record doesn't
    // invite them to ask again.
    if (!a.actionsTaken) a.actionsTaken = { replenish: false, pull: false };
    return a;
  }


  // Why the rep is standing in this store. Purpose is the one thing on the
  // details step the system genuinely can't infer, so it's the only question
  // asked there — everything else is auto-populated.
  const PURPOSES = [
    { k: "routine", label: "Routine stock check", icon: "📋", sub: "Regular scheduled visit" },
    { k: "replenishment", label: "Replenishment check", icon: "📦", sub: "Is there enough to last the cycle?" },
    { k: "stockout", label: "Stock-out investigation", icon: "📉", sub: "Chasing a reported shortage" },
    { k: "shelf", label: "Shelf audit", icon: "🧺", sub: "Facings, placement and availability" },
    { k: "expiry", label: "Expiry / pull-stock check", icon: "⏳", sub: "Rotating or pulling ageing stock" },
    { k: "followup", label: "Follow-up visit", icon: "🔁", sub: "Returning after a flagged issue" },
    { k: "request", label: "Customer request", icon: "📞", sub: "The store asked us to come" },
    { k: "other", label: "Other", icon: "•", sub: "" },
  ];
  const purposeMeta = (k) => PURPOSES.find((p) => p.k === k) || { label: k || "Visit", icon: "📋" };

  const linePhysical = (l) => (l.physical == null ? 0 : Number(l.physical) || 0);
  const lineExpected = (l) => Number(l.expected) || 0;
  const lineVariance = (l) => linePhysical(l) - lineExpected(l);
  const lineIsCaptured = (l) => l.status === "audited" || l.status === "not_found";
  const auditLines = (a) => (a && a.lines) || [];

  // The single worst thing true about a line, as a badge key. "Not found"
  // outranks everything because it means the line was never verified at all.
  function dominantCondition(l) {
    if (l.status === "not_found") return "not_found";
    if (l.conditionBreakdown.expired > 0) return "expired";
    if (l.conditionBreakdown.damaged > 0) return "damaged";
    if (l.conditionBreakdown.nearExpiry > 0) return "near_expiry";
    if (lineExpected(l) > 0 && linePhysical(l) === 0) return "out_of_stock";
    return "ok";
  }
  // Approaching stock-out, not merely low: no sellable stock at all, or —
  // only where the expected quantity is big enough for a percentage to mean
  // anything — a quarter or less of it left in good condition.
  function isStockOutRisk(l) {
    if (l.status !== "audited") return false;
    const exp = lineExpected(l);
    if (exp <= 0) return false;
    const good = l.conditionBreakdown.good || 0;
    if (good === 0) return true;
    return exp >= 5 && good <= Math.round(exp * 0.25);
  }
  function isOverstock(l) {
    if (l.status !== "audited") return false;
    const d = lineVariance(l);
    const exp = lineExpected(l);
    return d >= 5 || (exp > 0 && linePhysical(l) >= exp * 2 && d > 0);
  }
  function flaggedLines(audit) {
    return auditLines(audit).filter((l) => lineIsCaptured(l) && dominantCondition(l) !== "ok");
  }
  function varianceLines(audit) {
    return auditLines(audit).filter((l) => l.status === "audited" && lineVariance(l) !== 0);
  }
  function expiryLines(audit) {
    return auditLines(audit).filter((l) => (l.conditionBreakdown.expired || 0) + (l.conditionBreakdown.nearExpiry || 0) > 0);
  }
  function stockOutLines(audit) {
    return auditLines(audit).filter(isStockOutRisk);
  }
  function conditionTotals(a) {
    const t = emptyCondition();
    auditLines(a).forEach((l) => CONDITION_KEYS.forEach((c) => (t[c.k] += Number(l.conditionBreakdown[c.k]) || 0)));
    return t;
  }
  // Coverage is about confidence, not health: how much of what we set out to
  // check actually got checked. `expected` is snapshotted onto the audit at
  // creation so a later catalogue change can't retroactively move the
  // denominator on a closed visit.
  function auditCoverage(a) {
    const lines = auditLines(a);
    const audited = lines.filter((l) => l.status === "audited").length;
    const notFound = lines.filter((l) => l.status === "not_found").length;
    const expected = (a && a.expectedProducts) || lines.length || products.length;
    const skipped = Math.max(0, expected - audited - notFound);
    return { expected, audited, notFound, skipped, pct: expected ? Math.round((audited / expected) * 100) : 0 };
  }
  // Only a shelf a rep can't sell from earns a stop sign; "partially
  // available" is a nudge, and an unrated shelf (a warehouse visit) says
  // nothing at all.
  function shelfBadgeHTML(l) {
    if (!l.shelfAvailability || l.shelfAvailability === "available") return "";
    const m = shelfMeta(l.shelfAvailability);
    const icon = l.shelfAvailability === "not_on_shelf" ? "⛔" : "◐";
    return `<span class="shelf-badge ${esc(l.shelfAvailability)}">${icon} ${esc(m.label)}</span>`;
  }
  // A visit that was abandoned in the doorway is not a visit where
  // everything matched — say which it was before showing any counts.
  function auditStatusHTML(a) {
    if (a.status === "completed") return "";
    const m = statusMeta(a.status);
    const why = a.partial && a.partial.reason ? " · " + (ABANDON_REASONS.find((r) => r.k === a.partial.reason) || PARTIAL_REASONS.find((r) => r.k === a.partial.reason) || { label: "" }).label : "";
    return `<span class="status-tag ${m.cls}">${esc(m.label)}${esc(why)}</span>`;
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
  // Every health signal reads off the last COMPLETED visit, never simply the
  // last record. A visit that was abandoned in the doorway observed nothing,
  // and letting it stand as "the latest audit" would wipe out the findings of
  // the real one before it and leave the customer looking freshly checked.
  // The history view still shows every record, abandoned ones included.
  function lastCompleted(customerId) {
    return auditsFor(customerId).find((a) => a.status === "completed") || null;
  }
  // The completed visit right before a given one — what a rep is really
  // asking when they open an old audit and wonder "was this better or worse
  // than last time".
  function previousCompleted(customerId, auditId) {
    const list = auditsFor(customerId);
    const idx = list.findIndex((a) => a.id === auditId);
    if (idx === -1) return null;
    for (let i = idx + 1; i < list.length; i++) if (list[i].status === "completed") return list[i];
    return null;
  }

  /* ------------------------------------------------------- health signals */

  // Audit-visit cadence — independent of ordering. "Never audited" counts
  // as overdue for a VISIT, but only once the customer has actually been
  // around long enough to expect one — a store added yesterday hasn't
  // missed anything, it just hasn't been reached yet. That grace period can
  // only ever land on "normal" or "due", never "recent": a customer that has
  // genuinely never been audited was never *recently* audited either.
  function visitBucketFor(customerId) {
    const latest = lastCompleted(customerId);
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

  // Reorder cadence — synthesized signal (see SEED.orderingSignals). Absent
  // on purpose for customers with no signal yet: "Unknown" is the honest
  // answer, not a guessed "On Track".
  function orderingStatusFor(customerId) {
    const sig = SEED.orderingSignals && SEED.orderingSignals[customerId];
    const orders = (sig && sig.orders) || [];
    if (!sig || !orders.length) return { bucket: "unknown", label: "Unknown", orders: [] };
    const last = orders[0];
    const expected = new Date(last.at).getTime() + sig.avgCycleDays * DAY;
    const days = Math.round((now() - expected) / DAY);
    let bucket, label;
    if (days > 5) { bucket = "overdue"; label = "Overdue"; }
    else if (days > 0) { bucket = "slipping"; label = "Slipping"; }
    else { bucket = "on_track"; label = "On Track"; }
    // The cycle the customer actually keeps, alongside the one we expect of
    // them. When those two disagree, the expectation is the thing that's
    // wrong, and a rep staring at "usually every 7 days" deserves to know.
    let observedCycle = null;
    if (orders.length > 1) {
      const spans = orders.slice(0, -1).map((o, i) => (new Date(o.at) - new Date(orders[i + 1].at)) / DAY);
      observedCycle = Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
    }
    const avgValue = Math.round(orders.reduce((n, o) => n + (o.value || 0), 0) / orders.length);
    return {
      bucket, label, orders,
      lastOrderAt: last.at, lastOrderValue: last.value,
      avgCycleDays: sig.avgCycleDays, observedCycle, avgValue,
      expectedAt: expected, daysOverdue: days,
    };
  }
  const ORDER_LABEL = { on_track: "On Track", slipping: "Slipping", overdue: "Overdue", unknown: "Unknown" };
  // "In ~2 days" is what a rep can act on; a timestamp is not.
  function expectedOrderText(order) {
    if (!order.expectedAt) return "Unknown";
    const days = -order.daysOverdue;
    if (days > 1) return `In ~${days} days`;
    if (days === 1) return "Tomorrow";
    if (days === 0) return "Due today";
    return `Overdue by ${plural(-days, "day")}`;
  }
  const money = (n) => (n == null ? "" : "₹" + Number(n).toLocaleString("en-IN"));

  // The four Needs-Attention triggers named in the brief: stock-out risk,
  // expiry risk, overdue audits, and customers outside their ordering cycle.
  function reasonsFor(customerId) {
    const reasons = [];
    const latest = lastCompleted(customerId);
    if (latest) {
      if (stockOutLines(latest).length) reasons.push({ k: "stockout", label: "Stock-out risk", cls: "danger" });
      if (expiryLines(latest).length) reasons.push({ k: "expiry", label: "Expiry risk", cls: "warn" });
    }
    if (visitBucketFor(customerId) === "overdue") reasons.push({ k: "overdue", label: latest ? "Audit overdue" : "Never audited", cls: "neutral" });
    if (orderingStatusFor(customerId).bucket === "overdue") reasons.push({ k: "ordering", label: "Outside ordering cycle", cls: "followup" });
    return reasons;
  }

  // One-line "why", specific to this customer — the detail line under a
  // reason chip in the Needs Attention drill-down. Generic labels ("Stock-out
  // risk") tell you the category; this tells you which product or how late.
  function reasonDetailText(customerId, kind) {
    const latest = lastCompleted(customerId);
    if (kind === "stockout") {
      const names = stockOutLines(latest).map((l) => productName(l.productId));
      return names.length ? "Out of stock: " + names.join(", ") : "";
    }
    if (kind === "expiry") {
      const names = expiryLines(latest).map((l) => productName(l.productId));
      return names.length ? "Expiring soon: " + names.join(", ") : "";
    }
    if (kind === "overdue") return latest ? "Last audited " + fmtRelative(latest.at) : "Never audited";
    if (kind === "ordering") {
      const os = orderingStatusFor(customerId);
      return os.daysOverdue > 0 ? `Order overdue by ${os.daysOverdue} day${os.daysOverdue === 1 ? "" : "s"}` : "Outside its usual ordering cycle";
    }
    return "";
  }

  function nextActionFor(customerId) {
    const latest = lastCompleted(customerId);
    if (latest && latest.followUp && latest.followUp.required) return "Follow up";
    const reasons = reasonsFor(customerId);
    if (reasons.some((r) => r.k === "stockout" || r.k === "expiry")) return "Review flags";
    if (reasons.some((r) => r.k === "overdue")) return latest ? "Audit overdue" : "Start audit";
    if (reasons.some((r) => r.k === "ordering")) return "Review ordering cycle";
    if (!latest) return "Start audit";
    if (visitBucketFor(customerId) === "due") return "Schedule visit";
    return "On track";
  }

  // Raw 0-100 score from one audit — shared by the per-customer health ring
  // (customerScoreFor, 4-tier label) and the Complete Audit summary
  // (computeAuditScore, its own 3-tier copy) so the two never drift apart on
  // the underlying math, only on how each screen chooses to describe it.
  // Four axes rather than one number, because "78/100" on its own doesn't
  // tell a rep what to go fix. Each is null when this visit says nothing
  // about it — a warehouse audit captures no shelf data, and a customer with
  // no ordering signal has no ordering score — and nulls drop out of the
  // roll-up instead of being counted as zero.
  function healthBreakdown(a) {
    const lines = auditLines(a).filter((l) => l.status === "audited");
    const out = { stock: null, shelf: null, expiry: null, ordering: null };

    if (lines.length) {
      const clean = lines.filter((l) => !isStockOutRisk(l) && !isOverstock(l) && lineVariance(l) === 0).length;
      out.stock = Math.round((clean / lines.length) * 100);

      const shelfLines = lines.filter((l) => l.shelfAvailability);
      if (shelfLines.length) {
        const pts = shelfLines.reduce((s, l) => s + (l.shelfAvailability === "available" ? 1 : l.shelfAvailability === "partial" ? 0.5 : 0), 0);
        out.shelf = Math.round((pts / shelfLines.length) * 100);
      }

      // Share of the units actually on hand that are still sellable for long
      // enough to matter. Damaged stock is a stock-quality problem, not an
      // expiry one, so it stays out of this axis.
      const units = lines.reduce((s, l) => s + linePhysical(l), 0);
      const risky = lines.reduce((s, l) => s + (l.conditionBreakdown.nearExpiry || 0) + (l.conditionBreakdown.expired || 0), 0);
      out.expiry = units ? Math.round((1 - risky / units) * 100) : 100;
    }

    const os = a.customerId ? orderingStatusFor(a.customerId) : { bucket: "unknown" };
    out.ordering = { on_track: 100, slipping: 70, overdue: 40 }[os.bucket] ?? null;
    return out;
  }
  const HEALTH_AXES = [
    { k: "stock", label: "Stock", weight: 0.4 },
    { k: "shelf", label: "Shelf", weight: 0.2 },
    { k: "expiry", label: "Expiry", weight: 0.25 },
    { k: "ordering", label: "Ordering", weight: 0.15 },
  ];

  // Raw 0-100 roll-up from one audit — shared by the per-customer health ring
  // (customerScoreFor, 4-tier label) and the Complete Audit summary
  // (computeAuditScore, its own 3-tier copy) so the two never drift apart on
  // the underlying math, only on how each screen chooses to describe it.
  // Partial coverage deliberately does NOT cost points: auditing 42 of 50
  // products makes the score less certain, not the customer less healthy.
  function scoreFromAudit(a) {
    const hb = healthBreakdown(a);
    let sum = 0, weight = 0;
    HEALTH_AXES.forEach((ax) => {
      if (hb[ax.k] == null) return;
      sum += hb[ax.k] * ax.weight;
      weight += ax.weight;
    });
    let score = weight ? sum / weight : 100;
    // An open follow-up is a known unresolved issue, not just a past one.
    if (a.followUp && a.followUp.required) score -= 8;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function scoreLabel(score) {
    if (score == null) return { cls: "unknown", label: "Not Audited" };
    if (score >= 90) return { cls: "excellent", label: "Excellent" };
    if (score >= 75) return { cls: "good", label: "Good" };
    if (score >= 55) return { cls: "fair", label: "Fair" };
    return { cls: "poor", label: "Needs Attention" };
  }
  // null (not a 0) for "never audited" — a customer with no visit yet has no
  // score to show, not a score of zero.
  function customerScoreFor(customerId) {
    const latest = lastCompleted(customerId);
    return latest ? scoreFromAudit(latest) : null;
  }

  const FILTERS = [
    { k: "all", label: "All" },
    { k: "attention", label: "Needs Attention" },
    { k: "due", label: "Due for Visit" },
    { k: "overdue", label: "Overdue" },
  ];
  function matchesFilter(customerId, filter) {
    if (filter === "all") return true;
    if (filter === "attention") return reasonsFor(customerId).length > 0;
    if (filter === "stockout") return reasonsFor(customerId).some((r) => r.k === "stockout");
    if (filter === "expiry") return reasonsFor(customerId).some((r) => r.k === "expiry");
    if (filter === "needs_visit") { const vb = visitBucketFor(customerId); return vb === "due" || vb === "overdue"; }
    return visitBucketFor(customerId) === filter;
  }
  function filterCount(all, filter) {
    return all.filter((c) => matchesFilter(c._id, filter)).length;
  }

  /* ------------------------------------------------------------------ router */

  let PAGE = null;
  let STACK = [];
  let CURRENT = { view: "customers", params: {} };
  let DRAFT = null; // in-progress audit while the wizard/workspace is open

  function go(view, params, replace) {
    const changed = view !== CURRENT.view;
    if (!replace) STACK.push(CURRENT);
    CURRENT = { view, params: params || {} };
    renderCurrent();
    if (changed) scrollTop();
  }
  function back() {
    const prev = STACK.pop();
    if (prev) { CURRENT = prev; renderCurrent(); scrollTop(); }
    else go("customers", {}, true);
  }
  function scrollTop() {
    const el = document.scrollingElement || document.documentElement;
    if (el) el.scrollTop = 0;
  }

  function renderCurrent() {
    ({
      customers: renderCustomers,
      "needs-attention": renderNeedsAttention,
      audits: renderAudits,
      "customer-detail": () => renderCustomerDetail(CURRENT.params.customerId),
      inventory: renderInventory,
      audit: renderAudit,
      "customer-audits": renderCustomerAudits,
      "create-customer": renderCreateCustomer,
      "create-location": renderCreateLocation,
      "create-details": renderCreateDetails,
      brief: renderBrief,
      workspace: renderWorkspace,
      product: renderProduct,
      review: renderReview,
      closure: renderClosure,
      complete: renderComplete,
    })[CURRENT.view]?.();
  }

  function startButtonHTML(customerId) {
    return DraftStore.get(customerId)
      ? `<button type="button" class="btn-start-sm resume" data-resume="${esc(customerId)}">Resume</button>`
      : `<button type="button" class="btn-start-sm" data-start="${esc(customerId)}">Start Audit</button>`;
  }

  function newDraft(customerId) {
    const stamp = new Date();
    return {
      customerId,
      locationId: null,
      purpose: "",
      at: stamp.toISOString().slice(0, 16),
      auditor: AUDITOR.name,
      status: "draft",
      createdAt: stamp.toISOString(),
      startedAt: null,
      pausedAt: null,
      notes: "",
      lines: {},
    };
  }

  // Entry into the wizard from anywhere that already knows the customer.
  // Select Location always shows, even for a customer with exactly one —
  // renderCreateLocation pre-checks that single option, but the rep still
  // sees where they're about to be recorded as visiting and taps Continue
  // themselves. The step is never satisfied silently on their behalf.
  function beginWizard(customerId) {
    const open = DraftStore.get(customerId);
    if (open) { resumeOrRestartSheet(customerId, open); return; }
    DRAFT = newDraft(customerId);
    go("create-location", { customerId });
  }
  const startAuditFor = beginWizard;

  function resumeDraft(customerId) {
    const d = DraftStore.get(customerId);
    if (!d) { beginWizard(customerId); return; }
    DRAFT = d;
    DRAFT.status = "in_progress";
    DRAFT.pausedAt = null;
    DRAFT.actorsLastEditedBy = AUDITOR.name;
    persistDraft();
    go("workspace", { customerId }, true);
  }

  // Starting fresh would throw away a real count, so it's a decision the rep
  // makes explicitly rather than something a stray tap does for them.
  function resumeOrRestartSheet(customerId, open) {
    const prog = draftProgress(open);
    const customer = loadCustomer(customerId);
    sheet({
      eyebrow: placeLine(customer, open.locationId),
      title: "You have a visit in progress here",
      sub: `${prog.captured} of ${prog.total} products counted, paused ${fmtRelative(open.pausedAt || open.startedAt || open.createdAt).toLowerCase()}.`,
      actions: [
        { label: "Resume that visit", cls: "primary", onClick: () => resumeDraft(customerId) },
        {
          label: "Start a new one instead",
          cls: "ghost",
          onClick: () => {
            DraftStore.clear(customerId);
            DRAFT = newDraft(customerId);
            go("create-location", { customerId });
          },
        },
      ],
    });
  }

  /* --------------------------------------------------------- persistent nav */

  function navActiveKey(view) {
    if (view === "customers" || view === "customer-detail") return "customers";
    if (view === "audits") return "audits";
    return null;
  }

  // Customers / Audits History / + New Audit — three, per the product
  // owner's call. Needs Attention and Back are still real, reachable views
  // (the landing page's own Needs Attention block, and each view's own back
  // affordance), just not permanent nav real estate.
  function navHTML(view) {
    const active = navActiveKey(view);
    return `
      <div class="sah-nav">
        <button class="nav-btn ${active === "customers" ? "active" : ""}" data-nav="customers"><span class="ic">🏬</span>Customers</button>
        <button class="nav-btn ${active === "audits" ? "active" : ""}" data-nav="audits"><span class="ic">🗂️</span>Audit History</button>
        <button class="nav-btn" data-nav="create"><span class="ic">+</span>New Audit</button>
      </div>`;
  }
  function wireNav() {
    PAGE.querySelectorAll("[data-nav]").forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.nav;
        if (k === "customers") go("customers", {}, true);
        else if (k === "audits") go("audits", {}, true);
        else if (k === "create") { DRAFT = null; go("create-customer", {}); }
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

  /* ================================================================= VIEW: customers (landing) */

  let CUST_STATE = { q: "", filter: "all", sort: "health" };

  // Deterministic, purely-decorative avatar colour/icon per customer — the
  // reference design varies these for scannability, not to encode meaning
  // (health is already the score ring's job).
  const AVATAR_COLORS = ["#16a34a", "#d08420", "#eab308", "#15803d", "#64748b", "#2563eb"];
  function avatarFor(c, i) {
    return { color: AVATAR_COLORS[i % AVATAR_COLORS.length], icon: i % 2 ? "🛒" : "🏬" };
  }

  function sortCustomers(rows, sort) {
    const list = rows.slice();
    if (sort === "name") return list.sort((a, b) => titleCase(nameOf(a)).localeCompare(titleCase(nameOf(b))));
    if (sort === "last_audit") return list.sort((a, b) => {
      const la = auditsFor(a._id)[0], lb = auditsFor(b._id)[0];
      if (!la && !lb) return 0;
      if (!la) return -1; // never-audited reads as most urgent
      if (!lb) return 1;
      return new Date(la.at) - new Date(lb.at);
    });
    // "health": worst first — null (never audited) is the most urgent case,
    // so it sorts ahead of every numeric score.
    return list.sort((a, b) => {
      const sa = customerScoreFor(a._id), sb = customerScoreFor(b._id);
      if (sa == null && sb == null) return 0;
      if (sa == null) return -1;
      if (sb == null) return 1;
      return sa - sb;
    });
  }

  function renderCustomers() {
    if (CURRENT.params.filter) { CUST_STATE.filter = CURRENT.params.filter; CURRENT.params = {}; }
    const all = loadCustomers();
    const q = CUST_STATE.q.trim().toLowerCase();
    const searching = q.length > 0;

    // While searching, the query is the whole story: it overrides the chip
    // filter (rather than combining with it) and everything else below the
    // search box — chips, Needs Attention, the Customers/Sort header — steps
    // aside so the result list isn't sitting under stats that don't describe it.
    let rows;
    if (searching) {
      rows = all.filter((c) =>
        [nameOf(c), c.phone, c.email, addressLine(c.adress1, c.state?.name, c.postnr)]
          .some((v) => String(v || "").toLowerCase().includes(q)),
      );
    } else {
      rows = all.filter((c) => matchesFilter(c._id, CUST_STATE.filter));
    }
    rows = sortCustomers(rows, CUST_STATE.sort);

    const stockoutCount = filterCount(all, "stockout");
    const needsVisitCount = filterCount(all, "needs_visit");
    const expiryCount = filterCount(all, "expiry");

    frame(`
      <div class="sah-page-head">
        <h1>Customer Stock Audits</h1><p>Plan visits, track health and take action.</p>
      </div>

      <div class="sah-search-row">
        <div class="sah-search"><input type="search" id="custQ" value="${esc(CUST_STATE.q)}" placeholder="Search customers or locations…"></div>
      </div>
      ${searching ? "" : `
      <div class="chips">
        ${FILTERS.map((f) => `<button class="chip ${CUST_STATE.filter === f.k ? "on" : ""}" data-f="${f.k}">${esc(f.label)} (${filterCount(all, f.k)})</button>`).join("")}
      </div>

      <div class="section-head-row">
        <h2>Needs Attention</h2>
        <button type="button" class="link-chev" id="naViewAll">View all ›</button>
      </div>
      <div class="issue-card">
        <button type="button" class="issue-row" data-na="stockout">
          <span class="ic-circle danger">⚠️</span>
          <span class="txt">${stockoutCount} customer${stockoutCount === 1 ? "" : "s"} approaching stock-out</span>
          <span class="n">${stockoutCount}</span><span class="chev">›</span>
        </button>
        <button type="button" class="issue-row" data-issue="needs_visit">
          <span class="ic-circle warn">📅</span>
          <span class="txt">${needsVisitCount} customer${needsVisitCount === 1 ? "" : "s"} due for audit</span>
          <span class="n">${needsVisitCount}</span><span class="chev">›</span>
        </button>
        <button type="button" class="issue-row" data-na="expiry">
          <span class="ic-circle warn">⏰</span>
          <span class="txt">${expiryCount} customer${expiryCount === 1 ? "" : "s"} with expiry risk</span>
          <span class="n">${expiryCount}</span><span class="chev">›</span>
        </button>
      </div>

      <div class="section-head-row">
        <h2>Customers</h2>
        <label class="sort-field">Sort:
          <select id="custSort">
            <option value="health" ${CUST_STATE.sort === "health" ? "selected" : ""}>Health</option>
            <option value="name" ${CUST_STATE.sort === "name" ? "selected" : ""}>Name</option>
            <option value="last_audit" ${CUST_STATE.sort === "last_audit" ? "selected" : ""}>Last Audit</option>
          </select>
        </label>
      </div>`}
      ${rows.length
        ? `<div class="customer-list">${rows.map((c, i) => customerCardHTML(c, i)).join("")}</div>`
        : `<div class="sah-empty"><div class="big">🔍</div><p>No customers match this view.</p></div>`}
    `);

    wireSearchInput("custQ", (v) => { CUST_STATE.q = v; renderCustomers(); });
    const sortSel = $("#custSort", PAGE);
    if (sortSel) sortSel.onchange = (e) => { CUST_STATE.sort = e.target.value; renderCustomers(); };
    PAGE.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { CUST_STATE.filter = b.dataset.f; renderCustomers(); }));
    PAGE.querySelectorAll("[data-issue]").forEach((b) => (b.onclick = () => { CUST_STATE.filter = b.dataset.issue; renderCustomers(); }));
    const naViewAll = $("#naViewAll", PAGE);
    if (naViewAll) naViewAll.onclick = () => go("needs-attention", { filter: "all" });
    PAGE.querySelectorAll("[data-na]").forEach((b) => (b.onclick = () => go("needs-attention", { filter: b.dataset.na })));
    PAGE.querySelectorAll("[data-goto]").forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest("[data-start],[data-resume]")) return;
        go("customer-detail", { customerId: el.dataset.goto });
      };
    });
    wireStartButtons();
  }

  function wireStartButtons() {
    PAGE.querySelectorAll("[data-start]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); startAuditFor(b.dataset.start); }));
    PAGE.querySelectorAll("[data-resume]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); resumeDraft(b.dataset.resume); }));
  }

  function customerCardHTML(c, i) {
    const score = customerScoreFor(c._id);
    const sl = scoreLabel(score);
    const av = avatarFor(c, i);
    const latest = lastCompleted(c._id);
    // A <div>, not a <button>: it hosts a real <button> (Start Audit) inside
    // it, and nesting interactive controls inside a <button> is invalid HTML
    // — browsers silently break the DOM. Card-body clicks are handled by
    // delegation instead (see wireCustomers' [data-goto] handler).
    return `
      <div class="cust-card" data-goto="${c._id}">
        <span class="avatar" style="background:${av.color}">${av.icon}</span>
        <span class="info">
          <span class="nm">${esc(titleCase(nameOf(c)))}</span>
          <span class="loc">${esc(addressLine(c.adress1, c.state?.name, c.postnr))}</span>
          <span class="last">Last audit: ${esc(fmtRelative(latest ? latest.at : null))}</span>
        </span>
        <span class="side">
          <span class="hscore"><span class="ring ${sl.cls}">${score == null ? "—" : score}</span><span class="lbl ${sl.cls}">${esc(sl.label)}</span></span>
          ${startButtonHTML(c._id)}
          <span class="chev">›</span>
        </span>
      </div>`;
  }

  /* ================================================================= VIEW: needs-attention (drill-down) */

  // The landing page's Needs Attention block is a *summary* — three counts,
  // no names. This is where a rep actually works the list: every flagged
  // customer, the specific reason(s) each was flagged for (not just a
  // category count), and a one-line detail (which product, how many days
  // overdue) so most of these can be triaged without opening the customer.
  let NA_STATE = { filter: "all" };
  const NA_FILTERS = [
    { k: "all", label: "All" },
    { k: "stockout", label: "Stock-out Risk" },
    { k: "expiry", label: "Expiry Risk" },
    { k: "overdue", label: "Overdue Audit" },
    { k: "ordering", label: "Outside Ordering Cycle" },
  ];

  function renderNeedsAttention() {
    if (CURRENT.params.filter) { NA_STATE.filter = CURRENT.params.filter; CURRENT.params = {}; }
    const all = loadCustomers();
    const flagged = all.map((c) => ({ c, reasons: reasonsFor(c._id) })).filter((x) => x.reasons.length);
    const countFor = (k) => (k === "all" ? flagged.length : flagged.filter((x) => x.reasons.some((r) => r.k === k)).length);
    const rows = (NA_STATE.filter === "all" ? flagged : flagged.filter((x) => x.reasons.some((r) => r.k === NA_STATE.filter)))
      .slice()
      // Worst first: most simultaneous reasons, then lowest health score.
      .sort((a, b) => b.reasons.length - a.reasons.length || (customerScoreFor(a.c._id) ?? -1) - (customerScoreFor(b.c._id) ?? -1));

    frame(`
      <div class="sah-page-head">
        <h1>Needs Attention</h1><p>Every flagged customer, and why — worst first.</p>
      </div>
      <div class="chips">
        ${NA_FILTERS.map((f) => `<button class="chip ${NA_STATE.filter === f.k ? "on" : ""}" data-naf="${f.k}">${esc(f.label)} (${countFor(f.k)})</button>`).join("")}
      </div>
      ${rows.length
        ? `<div class="customer-list">${rows.map(({ c, reasons }) => naCardHTML(c, reasons)).join("")}</div>`
        : `<div class="sah-empty"><div class="big">✅</div><p>Nothing needs attention right now.</p></div>`}
    `);

    PAGE.querySelectorAll("[data-naf]").forEach((b) => (b.onclick = () => { NA_STATE.filter = b.dataset.naf; renderNeedsAttention(); }));
    PAGE.querySelectorAll("[data-goto]").forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest("[data-start],[data-resume]")) return;
        go("customer-detail", { customerId: el.dataset.goto });
      };
    });
    wireStartButtons();
  }

  function naCardHTML(c, reasons) {
    const details = reasons.map((r) => reasonDetailText(c._id, r.k)).filter(Boolean);
    return `
      <div class="na-card" data-goto="${c._id}">
        <div class="na-top">
          <span class="na-info">
            <span class="nm">${esc(titleCase(nameOf(c)))}</span>
            <span class="loc">${esc(addressLine(c.adress1, c.state?.name, c.postnr))}</span>
          </span>
          ${startButtonHTML(c._id)}
          <span class="chev">›</span>
        </div>
        <div class="reasons">${reasons.map((r) => `<span class="status-tag ${r.cls}">${esc(r.label)}</span>`).join("")}</div>
        ${details.length ? `<div class="na-detail">${details.map((d) => esc(d)).join(" · ")}</div>` : ""}
      </div>`;
  }

  /* ================================================================= VIEW: audits (secondary) */

  // A field-visit history, not an activity log. Each row answers who was
  // visited, when, what kind of visit, whether anything was wrong, and how
  // healthy they were left — in that order, because that's the order a rep
  // asks the questions in.

  // The eight visit purposes collapse into the four groups anyone actually
  // sorts by. Four tabs a thumb can hit beat eight chips it has to read.
  const AUDIT_TABS = [
    { k: "all", label: "All", purposes: null },
    { k: "routine", label: "Routine", purposes: ["routine"] },
    { k: "followup", label: "Follow-up", purposes: ["followup"] },
    { k: "stock", label: "Stock Check", purposes: ["stockout", "replenishment"] },
    { k: "other", label: "Other", purposes: ["shelf", "expiry", "request", "other"] },
  ];
  const AUD_SORTS = [
    { k: "newest", label: "Newest" },
    { k: "oldest", label: "Oldest" },
    { k: "health", label: "Lowest health" },
  ];
  const DATE_RANGES = [
    { k: "all", label: "Any time", days: null },
    { k: "7", label: "Last 7 days", days: 7 },
    { k: "30", label: "Last 30 days", days: 30 },
    { k: "90", label: "Last 90 days", days: 90 },
  ];
  const AUD_STATUSES = [
    { k: "all", label: "Any status" },
    { k: "completed", label: "Completed" },
    { k: "abandoned", label: "Incomplete" },
  ];

  const AUD_PAGE = 8;
  const AUD_DEFAULTS = { customer: "all", range: "all", purpose: "all", auditor: "all", status: "all", followUpOnly: false };
  let AUD_STATE = Object.assign({ q: "", tab: "all", sort: "newest", shown: AUD_PAGE }, AUD_DEFAULTS);

  function allAuditRows() {
    const custMap = {};
    loadCustomers().forEach((c) => (custMap[c._id] = c));
    const rows = [];
    AuditStore.allCustomerIds().forEach((cid) => {
      AuditStore.list(cid).forEach((a) => rows.push({ audit: a, customerId: cid, customer: custMap[cid] || {} }));
    });
    return rows;
  }

  const activeFilterCount = () =>
    Object.keys(AUD_DEFAULTS).filter((k) => AUD_STATE[k] !== AUD_DEFAULTS[k]).length;

  function auditMatchesFilters(r) {
    const a = r.audit;
    if (AUD_STATE.customer !== "all" && r.customerId !== AUD_STATE.customer) return false;
    if (AUD_STATE.purpose !== "all" && a.purpose !== AUD_STATE.purpose) return false;
    if (AUD_STATE.auditor !== "all" && (a.auditor || AUDITOR.name) !== AUD_STATE.auditor) return false;
    if (AUD_STATE.status !== "all" && a.status !== AUD_STATE.status) return false;
    if (AUD_STATE.followUpOnly && !(a.followUp && a.followUp.required)) return false;
    const range = DATE_RANGES.find((d) => d.k === AUD_STATE.range);
    if (range && range.days && daysBetween(a.at) > range.days) return false;
    return true;
  }

  function renderAudits() {
    const all = allAuditRows();
    const tab = AUDIT_TABS.find((t) => t.k === AUD_STATE.tab) || AUDIT_TABS[0];

    let rows = all.filter(auditMatchesFilters);
    if (tab.purposes) rows = rows.filter((r) => tab.purposes.indexOf(r.audit.purpose) !== -1);
    const q = AUD_STATE.q.trim().toLowerCase();
    if (q) rows = rows.filter((r) =>
      nameOf(r.customer).toLowerCase().includes(q) ||
      (r.audit.notes || "").toLowerCase().includes(q) ||
      (r.audit.finalNote || "").toLowerCase().includes(q));

    rows.sort((x, y) => {
      if (AUD_STATE.sort === "oldest") return new Date(x.audit.at) - new Date(y.audit.at);
      if (AUD_STATE.sort === "health") return auditScoreOf(x.audit) - auditScoreOf(y.audit);
      return new Date(y.audit.at) - new Date(x.audit.at);
    });

    const shown = rows.slice(0, AUD_STATE.shown);
    const filters = activeFilterCount();

    frame(`
      <div class="sah-page-head">
        <div class="row"><div><h1>Audit History</h1><p>Every customer visit, newest first.</p></div></div>
      </div>

      <div class="sah-search-row">
        <div class="sah-search"><input type="search" id="audQ" value="${esc(AUD_STATE.q)}" placeholder="Search customer or note…"></div>
        <button type="button" class="filter-btn ${filters ? "on" : ""}" id="audFilter" aria-label="Filter visits">
          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M2.5 4.5h15L12 11v5.5l-4 2V11L2.5 4.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          ${filters ? `<span class="n">${filters}</span>` : ""}
        </button>
      </div>

      <div class="chips">
        ${AUDIT_TABS.map((t) => {
          const n = t.purposes ? all.filter((r) => t.purposes.indexOf(r.audit.purpose) !== -1).length : all.length;
          return `<button class="chip ${AUD_STATE.tab === t.k ? "on" : ""}" data-at="${t.k}">${esc(t.label)} (${n})</button>`;
        }).join("")}
      </div>

      ${filters ? `<div class="filter-summary"><span>${esc(filterSummaryText())}</span><button type="button" id="audClear">Clear</button></div>` : ""}

      <div class="section-head-row">
        <h2>Recent Audits</h2>
        <label class="sort-field">Sort:
          <select id="audSort">${AUD_SORTS.map((s) => `<option value="${s.k}" ${AUD_STATE.sort === s.k ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select>
        </label>
      </div>

      ${shown.length
        ? `<div class="aud-list">${shown.map(auditRowCardHTML).join("")}</div>`
        : `<div class="sah-empty"><div class="big">🗂️</div><p>${all.length ? "No visits match this view." : "No audits recorded yet."}</p></div>`}

      ${rows.length
        ? `<div class="aud-more">
            <span>Showing ${shown.length} of ${plural(rows.length, "audit")}</span>
            ${rows.length > shown.length ? `<button type="button" id="audMore">Load more ⌄</button>` : ""}
          </div>`
        : ""}
    `);

    wireSearchInput("audQ", (v) => { AUD_STATE.q = v; AUD_STATE.shown = AUD_PAGE; renderAudits(); });
    PAGE.querySelectorAll("[data-at]").forEach((b) => (b.onclick = () => { AUD_STATE.tab = b.dataset.at; AUD_STATE.shown = AUD_PAGE; renderAudits(); }));
    $("#audSort", PAGE).onchange = (e) => { AUD_STATE.sort = e.target.value; renderAudits(); };
    $("#audFilter", PAGE).onclick = () => auditFilterSheet(all);
    const clear = $("#audClear", PAGE);
    if (clear) clear.onclick = () => { Object.assign(AUD_STATE, AUD_DEFAULTS); AUD_STATE.shown = AUD_PAGE; renderAudits(); };
    const more = $("#audMore", PAGE);
    if (more) more.onclick = () => { AUD_STATE.shown += AUD_PAGE; renderAudits(); };
    PAGE.querySelectorAll("[data-open-audit]").forEach((el) => {
      el.onclick = () => go("audit", { customerId: el.dataset.customer, auditId: el.dataset.openAudit });
    });
  }

  // A visit that never completed has no score to sort by. Park it at the
  // bottom of a lowest-health sort rather than letting a missing number read
  // as a perfect one — or as a zero.
  const auditScoreOf = (a) => (a.status === "completed" ? scoreFromAudit(a) : 101);

  function filterSummaryText() {
    const bits = [];
    if (AUD_STATE.customer !== "all") bits.push(titleCase(nameOf(loadCustomer(AUD_STATE.customer) || {})));
    if (AUD_STATE.range !== "all") bits.push((DATE_RANGES.find((d) => d.k === AUD_STATE.range) || {}).label);
    if (AUD_STATE.purpose !== "all") bits.push(purposeMeta(AUD_STATE.purpose).label);
    if (AUD_STATE.auditor !== "all") bits.push(AUD_STATE.auditor);
    if (AUD_STATE.status !== "all") bits.push((AUD_STATUSES.find((s) => s.k === AUD_STATE.status) || {}).label);
    if (AUD_STATE.followUpOnly) bits.push("Follow-up required");
    return bits.join(" · ");
  }

  function auditFilterSheet(all) {
    const customers = [];
    const seenC = {};
    all.forEach((r) => { if (!seenC[r.customerId]) { seenC[r.customerId] = 1; customers.push(r); } });
    customers.sort((x, y) => nameOf(x.customer).localeCompare(nameOf(y.customer)));
    const auditors = [];
    all.forEach((r) => { const n = r.audit.auditor || AUDITOR.name; if (auditors.indexOf(n) === -1) auditors.push(n); });

    const s = sheet({
      eyebrow: "Audit History",
      title: "Filter visits",
      body: `<div class="sheet-form">
        <label>Customer<select id="fCustomer"><option value="all">All customers</option>${customers.map((r) => `<option value="${esc(r.customerId)}" ${AUD_STATE.customer === r.customerId ? "selected" : ""}>${esc(titleCase(nameOf(r.customer)))}</option>`).join("")}</select></label>
        <label>Date range<select id="fRange">${DATE_RANGES.map((d) => `<option value="${d.k}" ${AUD_STATE.range === d.k ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</select></label>
        <label>Audit type<select id="fPurpose"><option value="all">All types</option>${PURPOSES.map((p) => `<option value="${p.k}" ${AUD_STATE.purpose === p.k ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></label>
        <label>Auditor<select id="fAuditor"><option value="all">All auditors</option>${auditors.map((n) => `<option value="${esc(n)}" ${AUD_STATE.auditor === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
        <label>Status<select id="fStatus">${AUD_STATUSES.map((x) => `<option value="${x.k}" ${AUD_STATE.status === x.k ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
        <div class="sheet-toggle"><span>Follow-up required only</span><button type="button" class="switch ${AUD_STATE.followUpOnly ? "on" : ""}" id="fFollow"></button></div>
      </div>`,
      actions: [
        { label: "Apply", cls: "primary", onClick: () => {
          AUD_STATE.customer = s.el.querySelector("#fCustomer").value;
          AUD_STATE.range = s.el.querySelector("#fRange").value;
          AUD_STATE.purpose = s.el.querySelector("#fPurpose").value;
          AUD_STATE.auditor = s.el.querySelector("#fAuditor").value;
          AUD_STATE.status = s.el.querySelector("#fStatus").value;
          AUD_STATE.followUpOnly = s.el.querySelector("#fFollow").classList.contains("on");
          AUD_STATE.shown = AUD_PAGE;
          renderAudits();
        } },
        { label: "Reset", cls: "ghost", onClick: () => { Object.assign(AUD_STATE, AUD_DEFAULTS); AUD_STATE.shown = AUD_PAGE; renderAudits(); } },
      ],
    });
    s.el.querySelector("#fFollow").onclick = (e) => e.currentTarget.classList.toggle("on");
  }

  function auditRowCardHTML({ audit: a, customerId, customer }) {
    const variance = varianceLines(a).length;
    const flagged = flaggedLines(a).length;
    const followUp = !!(a.followUp && a.followUp.required);
    const done = a.status === "completed";
    const score = done ? scoreFromAudit(a) : null;
    const sl = scoreLabel(score);
    // Colour carries status and nothing else: green clean, amber variances,
    // red flagged, blue awaiting a return visit, grey never finished.
    const rail = !done ? "muted" : flagged ? "danger" : variance ? "warn" : followUp ? "info" : "ok";

    return `
      <button type="button" class="aud-card" data-open-audit="${esc(a.id)}" data-customer="${esc(customerId)}">
        <span class="rail"><span class="ic ${rail}">${purposeMeta(a.purpose).icon}</span></span>
        <span class="body">
          <span class="nm">${esc(titleCase(nameOf(customer)))}</span>
          <span class="when">${esc(fmtDate(a.at))} · ${esc(a.auditor || AUDITOR.name)}</span>
          <span class="type">${esc(purposeMeta(a.purpose).label)}</span>
          <span class="signals">
            ${done
              ? variance || flagged
                ? `${variance ? `<span class="status-tag warn">${plural(variance, "variance")}</span>` : ""}
                   ${flagged ? `<span class="status-tag danger">${flagged} flagged</span>` : ""}`
                : `<span class="calm">✓ No issues found — everything matched expected stock.</span>`
              : auditStatusHTML(a)}
            ${followUp ? `<span class="status-tag followup">Follow-up needed</span>` : ""}
          </span>
        </span>
        <span class="right">
          <span class="score ${sl.cls}">${score == null ? "—" : score}</span>
          <span class="lbl">${score == null ? "No score" : "Health"}</span>
        </span>
        <span class="chev">›</span>
      </button>`;
  }

  /* ================================================================= VIEW: customer-detail */

  // A Customer Health & Visit Hub, read top to bottom as:
  //   who → what needs attention → how healthy → what's on the shelf →
  //   when will they order → what the last visit found → which products →
  //   what's happened here over time → who they are.
  //
  // Audits are the source of truth; everything above turns audit and order
  // history into something a rep can act on before they walk in.
  let DETAIL = { locationId: "all" };

  // Every audit belongs to one location. Customer-level intelligence is the
  // aggregate of the location-level history, so "All locations" is the
  // default and picking one narrows the whole page rather than just a list.
  function auditsIn(customerId, locationId) {
    const list = auditsFor(customerId);
    return !locationId || locationId === "all" ? list : list.filter((a) => a.locationId === locationId);
  }
  function completedIn(customerId, locationId) {
    return auditsIn(customerId, locationId).filter((a) => a.status === "completed");
  }

  function isLowStock(l) {
    if (l.status !== "audited") return false;
    const exp = lineExpected(l);
    const good = l.conditionBreakdown.good || 0;
    return exp > 0 && good > 0 && good < exp && !isStockOutRisk(l);
  }

  const SEVERITY = { high: "danger", mid: "warn", info: "info", ok: "ok" };

  // What a rep should act on, worst first, each one a route to the thing it
  // is about rather than a number that leaves them hunting.
  function attentionItemsFor(customerId, locationId) {
    const items = [];
    const last = completedIn(customerId, locationId)[0] || null;

    if (last) {
      const so = stockOutLines(last);
      if (so.length) items.push({ k: "stockout", sev: "high", ic: "⚠️", label: `${plural(so.length, "product")} may stock out`, sub: so.slice(0, 3).map((l) => productName(l.productId)).join(", "), filter: "stockout" });

      const exp = last.lines.filter((l) => (l.conditionBreakdown.expired || 0) + (l.conditionBreakdown.nearExpiry || 0) > 0);
      if (exp.length) items.push({ k: "expiry", sev: "mid", ic: "⏰", label: `${plural(exp.length, "product")} near or past expiry`, sub: exp.slice(0, 3).map((l) => productName(l.productId)).join(", "), filter: "expiry" });

      const dmg = last.lines.filter((l) => (l.conditionBreakdown.damaged || 0) > 0);
      if (dmg.length) items.push({ k: "damaged", sev: "mid", ic: "🧯", label: `${plural(dmg.length, "product")} damaged`, sub: dmg.slice(0, 3).map((l) => productName(l.productId)).join(", "), filter: "damaged" });

      const nf = last.lines.filter((l) => l.status === "not_found");
      if (nf.length) items.push({ k: "notfound", sev: "mid", ic: "❓", label: `${plural(nf.length, "product")} couldn't be verified`, sub: nf.slice(0, 3).map((l) => productName(l.productId)).join(", "), filter: "notfound" });
    }

    const order = orderingStatusFor(customerId);
    if (order.bucket === "overdue") items.push({ k: "ordering", sev: "high", ic: "🛒", label: `Order overdue by ${plural(order.daysOverdue, "day")}`, sub: "Outside their usual cycle", scroll: "secOrdering" });
    else if (order.bucket === "slipping") items.push({ k: "ordering", sev: "mid", ic: "🛒", label: "Order is slipping", sub: `Expected ${plural(order.daysOverdue, "day")} ago`, scroll: "secOrdering" });
    else if (order.bucket === "on_track") items.push({ k: "ordering", sev: "info", ic: "🛒", label: `Order expected ${expectedOrderText(order).toLowerCase()}`, sub: "Ordering on track", scroll: "secOrdering" });

    const vb = visitBucketFor(customerId);
    if (vb === "overdue") items.push({ k: "overdue", sev: "high", ic: "📅", label: last ? "Audit overdue" : "Never audited", sub: last ? "Last visit " + fmtRelative(last.at).toLowerCase() : "No visit on record", action: "start" });
    else if (vb === "due") items.push({ k: "due", sev: "mid", ic: "📅", label: "Due for a visit", sub: last ? "Last visit " + fmtRelative(last.at).toLowerCase() : "", action: "start" });

    const fu = auditsIn(customerId, locationId).filter((a) => a.followUp && a.followUp.required);
    if (fu.length) items.push({ k: "followup", sev: "mid", ic: "🚩", label: `${plural(fu.length, "follow-up")} pending`, sub: fu[0].followUp.note || "Return visit flagged", auditId: fu[0].id });

    const order2 = SEVERITY; // keep the map referenced where severity is read
    return items.sort((a, b) => ["high", "mid", "info", "ok"].indexOf(a.sev) - ["high", "mid", "info", "ok"].indexOf(b.sev)) && items;
  }

  // The next thing to do, stated as the button itself. A visit already
  // underway outranks everything — finishing it is what makes the rest true.
  function primaryActionFor(customerId, items) {
    if (DraftStore.get(customerId)) return { k: "resume", label: "Continue Audit" };
    const so = items.find((i) => i.k === "stockout");
    if (so) return { k: "item", label: "Review Stock Risk", item: so };
    const fu = items.find((i) => i.k === "followup");
    if (fu) return { k: "item", label: "Review Follow-up", item: fu };
    return { k: "start", label: "Start Audit" };
  }

  function renderCustomerDetail(customerId) {
    const customer = loadCustomer(customerId);
    if (!customer) {
      frame(`<div class="sah-empty" style="padding-top:60px"><div class="big">🔍</div><p>Customer not found.</p></div>`);
      return;
    }

    const locs = locationsFor(customer);
    if (DETAIL.locationId !== "all" && !locs.some((l) => l.id === DETAIL.locationId)) DETAIL.locationId = "all";
    const locId = DETAIL.locationId;
    const scopedLoc = locId === "all" ? null : locationFor(customer, locId);

    const audits = auditsIn(customerId, locId);
    const completed = completedIn(customerId, locId);
    const last = completed[0] || null;
    const prev = completed[1] || null;
    const order = orderingStatusFor(customerId);
    const openDraft = DraftStore.get(customerId);
    const items = attentionItemsFor(customerId, locId);
    const primary = primaryActionFor(customerId, items);

    const score = last ? scoreFromAudit(last) : null;
    const sl = scoreLabel(score);
    const prevScore = prev ? scoreFromAudit(prev) : null;

    frame(`
      ${customerHeaderHTML(customer, locs, scopedLoc, score, sl)}
      ${actionRowHTML(primary, openDraft)}
      ${attentionSectionHTML(items)}
      ${last ? healthSectionHTML(last) : ""}
      ${last ? inventorySectionHTML(last) : notAuditedHTML()}
      ${orderingSectionHTML(order)}
      ${last ? latestAuditSectionHTML(last, score, prevScore) : ""}
      ${last ? productIssuesSectionHTML(last) : ""}
      ${audits.length ? auditTimelineSectionHTML(audits) : ""}
      ${activitySectionHTML(customer, audits, order)}
      ${customerInfoSectionHTML(customer, locs)}
    `);

    wireCustomerDetail(customer, locs, items, primary);
  }

  /* -------------------------------------------------------------- header */

  function customerHeaderHTML(customer, locs, scopedLoc, score, sl) {
    const place = scopedLoc ? scopedLoc.name : locs.length > 1 ? `${plural(locs.length, "location")}` : locs[0] && locs[0].name;
    const city = (scopedLoc || locs[0] || {}).line || "";
    const cityShort = city.split(",").slice(-2).join(",").trim();
    return `
      <div class="cd-hero">
        <button type="button" class="back" id="cdBack">← Stock Audit &amp; Health</button>
        <div class="cd-id">
          <span class="cd-avatar">🏬</span>
          <div class="cd-name">
            <h1>${esc(titleCase(nameOf(customer)))}</h1>
            <p>${esc([place, cityShort].filter(Boolean).join(" · "))}</p>
            <span class="cd-score ${sl.cls}">${score == null ? "Not audited" : `${esc(sl.label)} · ${score}/100`}</span>
          </div>
        </div>
        ${locs.length > 1
          ? `<label class="cd-locpick">
              <select id="cdLoc">
                <option value="all" ${DETAIL.locationId === "all" ? "selected" : ""}>All locations (${locs.length})</option>
                ${locs.map((l) => `<option value="${esc(l.id)}" ${DETAIL.locationId === l.id ? "selected" : ""}>${esc(l.name)} — ${esc(locationTypeMeta(l.type).label)}</option>`).join("")}
              </select>
            </label>`
          : ""}
      </div>`;
  }

  function actionRowHTML(primary, openDraft) {
    const showStart = primary.k !== "start";
    return `
      <div class="cd-actions">
        <button type="button" class="btn-wide primary" id="cdPrimary">${esc(primary.label)}</button>
        ${showStart ? `<button type="button" class="btn-wide ghost" id="cdStart">Start Audit</button>` : ""}
      </div>
      ${openDraft && primary.k !== "resume" ? `<div class="resume-card" id="resumeCard">
        <span class="ic">⏸️</span>
        <span class="txt"><b>Visit in progress</b>${draftProgress(openDraft).captured} of ${draftProgress(openDraft).total} products counted</span>
        <span class="go">Resume ›</span>
      </div>` : ""}`;
  }

  /* ----------------------------------------------------------- attention */

  function attentionSectionHTML(items) {
    // "Order expected in ~3 days" is worth knowing but isn't a problem, so it
    // must not be what keeps a healthy customer out of the calm state. Calm
    // means nothing high or mid is outstanding; any purely informational
    // chips still show underneath, as context rather than as a to-do list.
    const actionable = items.filter((i) => i.sev === "high" || i.sev === "mid");
    const info = items.filter((i) => i.sev === "info");
    if (!actionable.length) {
      return `<div class="cd-calm">
          <span class="ic">✅</span>
          <div><b>No attention needed</b><span>Inventory and ordering pattern are both healthy right now.</span></div>
        </div>
        ${info.length ? `<div class="attn-strip ${info.length === 1 ? "single" : ""}">${info.map((it) => attnChipHTML(it, items.indexOf(it))).join("")}</div>` : ""}`;
    }
    return `
      <div class="section-head-row"><h2>Needs Attention</h2></div>
      <div class="attn-strip ${items.length === 1 ? "single" : ""}">
        ${items.map((it, i) => attnChipHTML(it, i)).join("")}
      </div>`;
  }

  function attnChipHTML(it, i) {
    return `
      <button type="button" class="attn-chip ${esc(it.sev)}" data-attn="${i}">
        <span class="ic">${it.ic}</span>
        <span class="lb">${esc(it.label)}</span>
        ${it.sub ? `<span class="sb">${esc(it.sub)}</span>` : ""}
        <span class="chev">›</span>
      </button>`;
  }

  /* -------------------------------------------------------------- health */

  function healthSectionHTML(a) {
    const score = scoreFromAudit(a);
    const sl = scoreLabel(score);
    const hb = healthBreakdown(a);
    // Just the noun. The section is already called Customer Health, so
    // repeating "Health" on all four costs a line wrap at 375px and buys
    // nothing.
    const rows = [
      { k: "stock", label: "Stock" },
      { k: "shelf", label: "Shelf" },
      { k: "ordering", label: "Ordering" },
      { k: "expiry", label: "Expiry" },
    ];
    return `
      <div class="section-head-row"><h2>Customer Health</h2><span class="src">Latest audit · ${esc(fmtRelative(a.at))}</span></div>
      <div class="cd-card health-card">
        <div class="health-ring ${sl.cls}" style="--pct:${score}"><span class="inner"><b>${score}</b><em>${esc(sl.label)}</em></span></div>
        <div class="health-rows">
          ${rows.map((r) => {
            const v = hb[r.k];
            return `<div class="health-row ${axisCls(v)}">
              <span class="lb">${esc(r.label)}</span>
              <span class="bar"><span style="width:${v == null ? 0 : v}%"></span></span>
              <b>${v == null ? "—" : v}</b>
            </div>`;
          }).join("")}
        </div>
      </div>`;
  }

  /* ----------------------------------------------------------- inventory */

  function notAuditedHTML() {
    return `<div class="cd-card cd-blank">
      <span class="big">📋</span>
      <b>No completed audit yet</b>
      <span>Stock, shelf and expiry health are all measured from a visit. Start the first one to fill this page in.</span>
    </div>`;
  }

  function inventorySectionHTML(a) {
    const lines = auditLines(a).filter((l) => l.status === "audited");
    const totals = conditionTotals(a);
    const cov = auditCoverage(a);
    const healthy = lines.filter((l) => dominantCondition(l) === "ok" && !isStockOutRisk(l) && !isLowStock(l)).length;
    const stockout = stockOutLines(a).length;
    const low = lines.filter(isLowStock).length;
    const nearExp = lines.filter((l) => (l.conditionBreakdown.nearExpiry || 0) > 0).length;
    const expired = lines.filter((l) => (l.conditionBreakdown.expired || 0) > 0).length;
    const damaged = lines.filter((l) => (l.conditionBreakdown.damaged || 0) > 0).length;
    const units = lines.reduce((n, l) => n + linePhysical(l), 0);
    const atRisk = totals.nearExpiry + totals.expired + totals.damaged;

    // Counts are products, because a product is the thing a rep acts on. The
    // unit totals go on one line underneath rather than into the tiles, where
    // mixing "8 products" with "684 units" would make neither readable.
    const tiles = [
      { n: cov.audited, l: "Tracked", cls: "" },
      { n: healthy, l: "Healthy", cls: healthy ? "ok" : "" },
      { n: stockout, l: "Stock-out risk", cls: stockout ? "danger" : "", filter: "stockout" },
      { n: low, l: "Low stock", cls: low ? "warn" : "", filter: "low" },
      { n: nearExp, l: "Near expiry", cls: nearExp ? "warn" : "", filter: "expiry" },
      { n: expired, l: "Expired", cls: expired ? "danger" : "", filter: "expiry" },
      { n: damaged, l: "Damaged", cls: damaged ? "danger" : "", filter: "damaged" },
      { n: cov.notFound, l: "Not found", cls: cov.notFound ? "warn" : "", filter: "notfound" },
    ];

    return `
      <div class="section-head-row"><h2>Inventory Snapshot</h2><span class="src">Latest audit · ${esc(fmtRelative(a.at))}</span></div>
      <div class="cd-card">
        <div class="inv-grid">
          ${tiles.map((t) => `<button type="button" class="inv-tile ${t.cls}" ${t.filter && t.n ? `data-inv="${t.filter}"` : "disabled"}><b>${t.n}</b><span>${esc(t.l)}</span></button>`).join("")}
        </div>
        <p class="inv-units">${plural(units, "unit")} counted${atRisk ? ` · ${atRisk} at risk` : ""}${cov.skipped ? ` · ${cov.skipped} not reached` : ""}</p>
        <button type="button" class="cd-cta" id="cdInventory">View Inventory ›</button>
      </div>`;
  }

  /* ------------------------------------------------------------ ordering */

  function orderingSectionHTML(order) {
    if (order.bucket === "unknown") {
      return `
        <div class="section-head-row" id="secOrdering"><h2>Ordering Pattern</h2></div>
        <div class="cd-card cd-blank small"><b>No ordering signal yet</b><span>This customer has no order history on the platform, so their reorder cadence can't be read.</span></div>`;
    }
    const cycleDisagrees = order.observedCycle != null && Math.abs(order.observedCycle - order.avgCycleDays) >= 2;
    return `
      <div class="section-head-row" id="secOrdering"><h2>Ordering Pattern</h2><span class="status-tag ${order.bucket === "on_track" ? "ok" : order.bucket === "slipping" ? "warn" : "danger"}">${esc(order.label)}</span></div>
      <div class="cd-card">
        <div class="ord-row"><span class="ic">🗓️</span><span class="lb">Usually orders every</span><b>${plural(order.avgCycleDays, "day")}</b></div>
        ${cycleDisagrees ? `<div class="ord-note">Recent orders have actually come every ~${plural(order.observedCycle, "day")} — the expected cadence may be out of date.</div>` : ""}
        <div class="ord-row"><span class="ic">🧾</span><span class="lb">Last order</span><b>${esc(money(order.lastOrderValue))}<small>${esc(fmtDateShort(order.lastOrderAt))}</small></b></div>
        <div class="ord-row"><span class="ic">📈</span><span class="lb">Average order</span><b>${esc(money(order.avgValue))}<small>across last ${order.orders.length}</small></b></div>
        <div class="ord-row"><span class="ic">📦</span><span class="lb">Expected next order</span><b class="${order.bucket === "overdue" ? "late" : ""}">${esc(expectedOrderText(order))}</b></div>
      </div>`;
  }

  /* -------------------------------------------------------- latest audit */

  function latestAuditSectionHTML(a, score, prevScore) {
    const cov = auditCoverage(a);
    const delta = prevScore == null ? null : score - prevScore;
    const stats = [
      { n: cov.audited, l: "Products audited", cls: "" },
      { n: varianceLines(a).length, l: "Variances", cls: "warn" },
      { n: stockOutLines(a).length, l: "Stock-out risks", cls: "danger" },
      { n: a.lines.filter((l) => (l.conditionBreakdown.nearExpiry || 0) > 0).length, l: "Near expiry", cls: "warn" },
      { n: a.lines.filter((l) => (l.conditionBreakdown.damaged || 0) > 0).length, l: "Damaged", cls: "danger" },
    ];
    return `
      <div class="section-head-row"><h2>Latest Audit</h2></div>
      <div class="cd-card">
        <div class="la-head">
          <div><b>${esc(fmtDate(a.at))}</b><span>${esc(a.auditor || AUDITOR.name)} · ${esc(purposeMeta(a.purpose).label)}</span></div>
          ${a.outcome ? `<span class="status-tag ${a.outcome === "healthy" ? "ok" : "warn"}">${outcomeMeta(a.outcome).icon} ${esc(outcomeMeta(a.outcome).label)}</span>` : ""}
        </div>
        <div class="la-stats">
          ${stats.map((s) => `<div class="la-stat"><span class="dot ${s.n ? s.cls || "ok" : "none"}"></span><b>${s.n}</b><span>${esc(s.l)}</span></div>`).join("")}
        </div>
        ${a.partial && a.partial.isPartial ? `<p class="la-partial">Partial visit — ${esc((PARTIAL_REASONS.find((r) => r.k === a.partial.reason) || { label: "reason not given" }).label.toLowerCase())}, ${cov.skipped} not reached.</p>` : ""}
        ${delta == null
          ? `<div class="la-delta flat">First measured score · ${score}</div>`
          : `<div class="la-delta ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}">Health score ${prevScore} → ${score} ${delta > 0 ? "↑" : delta < 0 ? "↓" : "—"}</div>`}
        <button type="button" class="cd-cta" data-audit="${esc(a.id)}">View Audit ›</button>
      </div>`;
  }

  /* ------------------------------------------------------ product issues */

  function productIssuesSectionHTML(a) {
    const issues = auditLines(a)
      .map((l) => ({ l, r: issueFor(l) }))
      .filter((x) => x.r)
      .sort((x, y) => x.r.rank - y.r.rank)
      .slice(0, 4);
    if (!issues.length) return "";
    return `
      <div class="section-head-row"><h2>Products Needing Attention</h2></div>
      <div class="cd-card pi-card">
        ${issues.map(({ l, r }) => {
          const p = productById(l.productId) || {};
          return `<button type="button" class="pi-row" data-inv="all">
            <span class="thumb">${thumbHTML(p)}</span>
            <span class="info"><span class="nm">${esc(p.name || l.productId)}</span><span class="sku">SKU ${esc(p.artNo || "—")}</span></span>
            <span class="right">
              <span class="status-tag ${r.cls}">${esc(r.label)}</span>
              <span class="qty">${esc(r.qty)}</span>
            </span>
            <span class="chev">›</span>
          </button>`;
        }).join("")}
        <button type="button" class="cd-cta" data-inv="issues">View All Issues ›</button>
      </div>`;
  }

  // One problem per product, worst first, with the number that shows why.
  function issueFor(l) {
    const p = productById(l.productId) || {};
    const unit = p.unit ? " " + p.unit.toLowerCase() : "";
    const cb = l.conditionBreakdown;
    if (l.status === "not_found") return { rank: 1, cls: "warn", label: "Not found", qty: notFoundMeta(l.notFoundReason).label };
    if (isStockOutRisk(l)) return { rank: 0, cls: "danger", label: "Stock-out risk", qty: `${cb.good || 0} / ${lineExpected(l)}${unit}` };
    if (cb.expired > 0) return { rank: 2, cls: "danger", label: "Expired", qty: `${cb.expired}${unit}` };
    if (cb.damaged > 0) return { rank: 3, cls: "danger", label: "Damaged", qty: `${cb.damaged}${unit}` };
    if (cb.nearExpiry > 0) return { rank: 4, cls: "warn", label: "Near expiry", qty: `${cb.nearExpiry}${unit}` };
    if (isLowStock(l)) return { rank: 5, cls: "warn", label: "Low stock", qty: `${cb.good || 0} / ${lineExpected(l)}${unit}` };
    if (isOverstock(l)) return { rank: 6, cls: "neutral", label: "Overstock", qty: `${linePhysical(l)} / ${lineExpected(l)}${unit}` };
    return null;
  }

  /* ------------------------------------------------------ audit timeline */

  function auditTimelineSectionHTML(audits) {
    const rows = audits.slice(0, 4);
    return `
      <div class="section-head-row"><h2>Audit History</h2></div>
      <div class="cd-card tl-card">
        ${rows.map((a) => {
          const cov = auditCoverage(a);
          const flagged = flaggedLines(a).length;
          const variance = varianceLines(a).length;
          const bits = a.status !== "completed"
            ? [statusMeta(a.status).label]
            : [plural(cov.audited, "product"), variance ? plural(variance, "variance") : null, flagged ? `${flagged} flagged` : null].filter(Boolean);
          return `<button type="button" class="tl-row" data-audit="${esc(a.id)}">
            <span class="tl-dot ${a.status !== "completed" ? "muted" : flagged ? "warn" : "ok"}"></span>
            <span class="tl-body">
              <span class="when">${esc(fmtRelative(a.at))}<em>${esc(fmtDateShort(a.at))}</em></span>
              <span class="what">${esc(bits.join(" · "))}</span>
            </span>
            <span class="chev">›</span>
          </button>`;
        }).join("")}
        <button type="button" class="cd-cta" id="cdAllAudits">View All Audits (${audits.length}) ›</button>
      </div>`;
  }

  /* ---------------------------------------------------- customer activity */

  // One thread of what has happened at this customer, built only from things
  // the platform actually knows: visits, what they concluded, follow-ups
  // raised, and orders placed. Nothing here is invented to fill the gap.
  function activityEventsFor(customer, audits, order) {
    const ev = [];
    audits.forEach((a) => {
      if (a.status === "completed") {
        ev.push({ at: a.at, ic: "📋", cls: "audit", title: `${purposeMeta(a.purpose).label} — ${plural(auditCoverage(a).audited, "product")}`, sub: a.outcome ? outcomeMeta(a.outcome).label : "", auditId: a.id });
      } else {
        ev.push({ at: a.at, ic: "🚫", cls: "muted", title: `Visit ${statusMeta(a.status).label.toLowerCase()}`, sub: a.partial && a.partial.reason ? (ABANDON_REASONS.find((r) => r.k === a.partial.reason) || { label: "" }).label : "", auditId: a.id });
      }
      if (a.followUp && a.followUp.required && a.followUp.at) {
        ev.push({ at: a.followUp.at, ic: "🚩", cls: "flag", title: "Follow-up raised", sub: a.followUp.note || "", auditId: a.id });
      }
    });
    (order.orders || []).forEach((o) => ev.push({ at: o.at, ic: "🧾", cls: "order", title: "Order placed", sub: money(o.value) }));
    if (customer.createdAt) ev.push({ at: customer.createdAt, ic: "🤝", cls: "muted", title: "Customer added", sub: "" });
    return ev.sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  let ACTIVITY_LIMIT = 6;

  function activitySectionHTML(customer, audits, order) {
    const all = activityEventsFor(customer, audits, order);
    if (!all.length) return "";
    const shown = all.slice(0, ACTIVITY_LIMIT);
    return `
      <div class="section-head-row"><h2>Customer Activity</h2></div>
      <div class="cd-card act-card">
        ${shown.map((e) => `
          <div class="act-row ${esc(e.cls)}" ${e.auditId ? `data-audit="${esc(e.auditId)}" role="button"` : ""}>
            <span class="ic">${e.ic}</span>
            <span class="body"><span class="ti">${esc(e.title)}</span>${e.sub ? `<span class="sb">${esc(e.sub)}</span>` : ""}</span>
            <span class="when">${esc(fmtDateShort(e.at))}</span>
          </div>`).join("")}
        ${all.length > shown.length ? `<button type="button" class="cd-cta" id="cdMoreActivity">Show earlier activity (${all.length - shown.length}) ›</button>` : ""}
      </div>`;
  }

  /* -------------------------------------------------- customer information */

  function customerInfoSectionHTML(customer, locs) {
    const rows = [
      ["Customer", titleCase(nameOf(customer))],
      ["Locations", locs.map((l) => `${l.name} (${locationTypeMeta(l.type).label})`).join(", ")],
      ["Address", addressLine(customer.adress1, customer.state?.name, customer.postnr)],
      ["Phone", customer.phone || "—"],
      ["Email", customer.email || "—"],
      ["Customer since", customer.createdAt ? fmtDateShort(customer.createdAt) + " " + new Date(customer.createdAt).getFullYear() : "—"],
      ["Supply chain", titleCase(customer.supplyChainType || "—")],
    ];
    return `
      <div class="section-head-row"><h2>Customer Information</h2></div>
      <div class="cd-card info-card">
        ${rows.map(([k, v]) => `<div class="info-line"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("")}
      </div>`;
  }

  /* --------------------------------------------------------------- wiring */

  function wireCustomerDetail(customer, locs, items, primary) {
    const cid = customer._id;
    const goInv = (filter) => go("inventory", { customerId: cid, filter: filter || "all" });

    $("#cdBack", PAGE).onclick = () => go("customers", {}, true);

    const locSel = $("#cdLoc", PAGE);
    if (locSel) locSel.onchange = (e) => { DETAIL.locationId = e.target.value; renderCustomerDetail(cid); };

    const runItem = (it) => {
      if (it.filter) return goInv(it.filter);
      if (it.auditId) return go("audit", { customerId: cid, auditId: it.auditId });
      if (it.action === "start") return startAuditFor(cid);
      if (it.scroll) {
        const el = PAGE.querySelector("#" + it.scroll);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    $("#cdPrimary", PAGE).onclick = () => {
      if (primary.k === "resume") return resumeDraft(cid);
      if (primary.k === "start") return startAuditFor(cid);
      runItem(primary.item);
    };
    const startBtn = $("#cdStart", PAGE);
    if (startBtn) startBtn.onclick = () => startAuditFor(cid);
    const resumeCard = $("#resumeCard", PAGE);
    if (resumeCard) resumeCard.onclick = () => resumeDraft(cid);

    PAGE.querySelectorAll("[data-attn]").forEach((b) => (b.onclick = () => runItem(items[Number(b.dataset.attn)])));
    PAGE.querySelectorAll("[data-inv]").forEach((b) => (b.onclick = () => goInv(b.dataset.inv)));
    PAGE.querySelectorAll("[data-audit]").forEach((b) => (b.onclick = () => go("audit", { customerId: cid, auditId: b.dataset.audit })));

    const inv = $("#cdInventory", PAGE);
    if (inv) inv.onclick = () => goInv("all");
    const allAudits = $("#cdAllAudits", PAGE);
    if (allAudits) allAudits.onclick = () => go("customer-audits", { customerId: cid });
    const more = $("#cdMoreActivity", PAGE);
    if (more) more.onclick = () => { ACTIVITY_LIMIT += 10; renderCustomerDetail(cid); };
  }

  /* ================================================================= VIEW: inventory */

  // What the shelf looked like at the last visit, product by product. Every
  // count on this page came from an audit — there is no other source of
  // truth for a customer's stock — so it says which one, and when.
  const INV_FILTERS = [
    { k: "all", label: "All" },
    { k: "issues", label: "Issues" },
    { k: "stockout", label: "Stock-out risk" },
    { k: "low", label: "Low stock" },
    { k: "expiry", label: "Expiry" },
    { k: "damaged", label: "Damaged" },
    { k: "notfound", label: "Not found" },
  ];
  let INV_STATE = { q: "", filter: "all", auditId: null };

  function invMatches(l, filter) {
    const cb = l.conditionBreakdown;
    if (filter === "all") return true;
    if (filter === "issues") return !!issueFor(l);
    if (filter === "stockout") return isStockOutRisk(l);
    if (filter === "low") return isLowStock(l);
    if (filter === "expiry") return (cb.nearExpiry || 0) + (cb.expired || 0) > 0;
    if (filter === "damaged") return (cb.damaged || 0) > 0;
    if (filter === "notfound") return l.status === "not_found";
    return true;
  }

  function renderInventory() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer) { go("customers", {}, true); return; }
    if (CURRENT.params.filter) {
      INV_STATE = { q: "", filter: CURRENT.params.filter, auditId: CURRENT.params.auditId || null };
      CURRENT.params = { customerId: customer._id };
    }

    // Pinned to one visit when we arrived from it, otherwise the latest —
    // "Review Issues" on a three-week-old audit has to show what THAT visit
    // found, not what the most recent one did.
    const a = INV_STATE.auditId
      ? auditsFor(customer._id).find((x) => x.id === INV_STATE.auditId)
      : completedIn(customer._id, DETAIL.locationId)[0];
    if (!a) {
      frame(`<div class="sah-page-head"><h1>Inventory</h1><p>${esc(titleCase(nameOf(customer)))}</p></div>
        ${notAuditedHTML()}`);
      return;
    }

    const q = INV_STATE.q.trim().toLowerCase();
    let rows = auditLines(a).filter((l) => invMatches(l, INV_STATE.filter));
    if (q) rows = rows.filter((l) => {
      const p = productById(l.productId) || {};
      return (p.name || "").toLowerCase().includes(q) || String(p.artNo || "").toLowerCase().includes(q);
    });
    // Problems first — the reason anyone opens this screen.
    rows = rows.slice().sort((x, y) => ((issueFor(x) || { rank: 99 }).rank) - ((issueFor(y) || { rank: 99 }).rank));

    frame(`
      <div class="sah-page-head">
        <button type="button" class="back" id="invBack">← ${esc(titleCase(nameOf(customer)))}</button>
        <h1>${INV_STATE.filter === "issues" ? "Issues" : "Inventory"}</h1>
        <p>As counted on ${esc(fmtDate(a.at))} · ${esc(a.auditor || AUDITOR.name)}</p>
      </div>
      <div class="sah-search-row"><div class="sah-search"><input type="search" id="invQ" value="${esc(INV_STATE.q)}" placeholder="Search product or SKU…"></div></div>
      <div class="chips">
        ${INV_FILTERS.map((f) => {
          const n = auditLines(a).filter((l) => invMatches(l, f.k)).length;
          return `<button class="chip ${INV_STATE.filter === f.k ? "on" : ""}" data-if="${f.k}">${esc(f.label)} (${n})</button>`;
        }).join("")}
      </div>
      ${rows.length
        ? `<div class="cd-card pi-card">${rows.map(invRowHTML).join("")}</div>`
        : `<div class="sah-empty"><div class="big">${q ? "🔍" : "✅"}</div><p>${q ? "No product matches that." : "Nothing in this category."}</p></div>`}
    `);

    $("#invBack", PAGE).onclick = back;
    wireSearchInput("invQ", (v) => { INV_STATE.q = v; renderInventory(); });
    PAGE.querySelectorAll("[data-if]").forEach((b) => (b.onclick = () => { INV_STATE.filter = b.dataset.if; renderInventory(); }));
    PAGE.querySelectorAll("[data-line]").forEach((b) => (b.onclick = () => {
      const l = rows.find((x) => x.productId === b.dataset.line);
      if (l) auditLineDetailSheet(customer, a, l);
    }));
  }

  function invRowHTML(l) {
    const p = productById(l.productId) || {};
    const r = issueFor(l);
    const unit = p.unit ? " " + p.unit.toLowerCase() : "";
    return `<button type="button" class="pi-row" data-line="${esc(l.productId)}">
      <span class="thumb">${thumbHTML(p)}</span>
      <span class="info">
        <span class="nm">${esc(p.name || l.productId)}</span>
        <span class="sku">SKU ${esc(p.artNo || "—")} · expected ${lineExpected(l)}${esc(unit)}</span>
      </span>
      <span class="right">
        ${r ? `<span class="status-tag ${r.cls}">${esc(r.label)}</span>` : `<span class="status-tag ok">Healthy</span>`}
        <span class="qty">${esc(r ? r.qty : `${linePhysical(l)}${unit} on hand`)}</span>
      </span>
    </button>`;
  }

  /* ================================================================= VIEW: audit (one visit) */

  // A visit's status in the terms Audit History and Audit Detail actually
  // use: "Partial" is a flag on a completed visit, not a lifecycle state of
  // its own, so it's read off a.partial rather than a.status.
  function auditBadgeMeta(a) {
    if (a.status !== "completed") return statusMeta(a.status);
    if (a.partial && a.partial.isPartial) return { cls: "warn", label: "Partial" };
    return { cls: "ok", label: "Completed" };
  }

  // How much of the assortment this visit actually reached — "not found"
  // (looked, wasn't there) and "not reached" (never got to it) are different
  // facts and stay on separate lines rather than folding into one number.
  function auditCoverageHTML(a) {
    const cov = auditCoverage(a);
    const partial = a.partial && a.partial.isPartial;
    const why = partial
      ? (PARTIAL_REASONS.find((r) => r.k === a.partial.reason) || ABANDON_REASONS.find((r) => r.k === a.partial.reason) || { label: "reason not given" }).label
      : "";
    const bits = [cov.notFound ? plural(cov.notFound, "product") + " not found" : "", cov.skipped ? plural(cov.skipped, "product") + " not reached" : ""].filter(Boolean);
    return `
      <div class="sec-label">Audit Coverage</div>
      <div class="cl-coverage ${partial ? "partial" : ""}">
        <span class="lbl">Products Audited</span>
        <b>${cov.audited} / ${cov.expected} products <span style="font-weight:700;font-size:13px;color:var(--muted)">· ${cov.pct}%</span></b>
        <span class="why">${partial ? "Partial — " + esc(why.toLowerCase()) : "Full coverage"}</span>
        ${bits.length ? `<p class="cov-breakdown">${esc(bits.join(" · "))}</p>` : ""}
      </div>`;
  }

  // The four things a rep would otherwise have to read the whole findings
  // list to notice. Zero across the board reads as calm, not as four empty
  // tiles — a grid of zeros looks like a broken screen, not a healthy one.
  function auditNeedsActionHTML(a) {
    const tiles = [
      { n: stockOutLines(a).length, l: "Low Stock", sub: "Replenish", cls: "danger", filter: "stockout" },
      { n: expiryLines(a).length, l: "Near Expiry", sub: "Rotate / Pull", cls: "warn", filter: "expiry" },
      { n: auditLines(a).filter((l) => (l.conditionBreakdown.damaged || 0) > 0).length, l: "Damaged", sub: "Review", cls: "warn", filter: "damaged" },
      { n: a.followUp && a.followUp.required ? 1 : 0, l: "Follow-up", sub: "Pending", cls: "info", scroll: true },
    ];
    if (!tiles.some((t) => t.n)) {
      return `<div class="cd-calm"><span class="ic">✅</span><div><b>Nothing needs action</b><span>This visit found no exceptions to work.</span></div></div>`;
    }
    return `
      <div class="sec-label">Needs Action</div>
      <div class="cd-card">
        <div class="inv-grid">
          ${tiles.map((t) => `<button type="button" class="inv-tile ${t.n ? t.cls : ""}" ${t.n ? (t.scroll ? `data-scroll-follow="1"` : `data-inv="${t.filter}"`) : "disabled"}>
            <b>${t.n}</b><span>${esc(t.l)}</span><em>${esc(t.sub)}</em>
          </button>`).join("")}
        </div>
      </div>`;
  }

  // A segmented bar reads at a glance; the legend underneath is what makes
  // it actionable — four colours mean nothing without the counts attached.
  function stockConditionSummaryHTML(a) {
    const t = conditionTotals(a);
    const total = t.good + t.nearExpiry + t.expired + t.damaged;
    if (!total) return "";
    const items = [
      { k: "good", label: "Good", n: t.good },
      { k: "nearExpiry", label: "Near Expiry", n: t.nearExpiry },
      { k: "expired", label: "Expired", n: t.expired },
      { k: "damaged", label: "Damaged", n: t.damaged },
    ];
    return `
      <div class="sec-label">Stock Condition Summary</div>
      <div class="cd-card">
        <div class="cond-bar">${items.filter((i) => i.n).map((i) => `<span class="${i.k}" style="width:${Math.round((i.n / total) * 100)}%"></span>`).join("")}</div>
        <div class="cond-legend">${items.map((i) => `<div class="item"><span class="dot ${i.k}"></span>${esc(i.label)}<b>${i.n} <small>(${Math.round((i.n / total) * 100)}%)</small></b></div>`).join("")}</div>
      </div>`;
  }

  // Exception-first: the products with something wrong, worst first, capped
  // to a handful — everything else is one tap away rather than a scroll
  // away, via the same Inventory screen "Review Issues" already used, now
  // pinned to this specific visit instead of the customer's latest one.
  function productFindingsSectionHTML(a) {
    const audited = auditLines(a).filter((l) => l.status === "audited" || l.status === "not_found");
    const withIssue = audited
      .map((l) => ({ l, r: issueFor(l) }))
      .filter((x) => x.r)
      .sort((x, y) => x.r.rank - y.r.rank);
    const shown = withIssue.slice(0, 5);
    return `
      <div class="section-head-row"><h2>Product Findings</h2>${audited.length ? `<span class="src">${plural(audited.length, "product")} captured</span>` : ""}</div>
      <div class="cd-card pi-card">
        ${shown.length
          ? shown.map(({ l, r }) => {
              const p = productById(l.productId) || {};
              const unit = p.unit ? " " + p.unit.toLowerCase() : "";
              return `<button type="button" class="pi-row" data-line="${esc(l.productId)}">
                <span class="thumb">${thumbHTML(p)}</span>
                <span class="info">
                  <span class="nm">${esc(p.name || l.productId)}</span>
                  <span class="sku">Expected ${lineExpected(l)}${esc(unit)} · Found ${l.status === "not_found" ? "—" : linePhysical(l) + unit}</span>
                </span>
                <span class="right">
                  <span class="status-tag ${r.cls}">${esc(r.label)}</span>
                  <span class="qty">${esc(r.qty)}</span>
                </span>
                <span class="chev">›</span>
              </button>`;
            }).join("")
          : audited.length
            ? `<div class="rv-line ok" style="padding:11px 0"><span class="ic">✓</span><span class="txt">Everything counted matched expected stock.</span></div>`
            : `<div class="rv-line muted" style="padding:11px 0"><span class="ic">—</span><span class="txt">No products were counted on this visit.</span></div>`}
        ${a.lines.length ? `<button type="button" class="cd-cta" id="afAllProducts">View All Products (${a.lines.length}) ›</button>` : ""}
      </div>`;
  }

  const EVIDENCE_ICON = { shelf: "🧺", damage: "⚠️", expiry: "⏳", variance: "⚖️", other: "📷" };
  // A real, freely-licensed photo standing in for what the type of capture
  // looks like — this is a mock with no camera behind it, so it can't show
  // the actual shot the rep took, only a representative one.
  const EVIDENCE_IMAGE = {
    shelf: "https://commons.wikimedia.org/wiki/Special:FilePath/Supermarket%20shelves.jpg?width=200",
    damage: "https://commons.wikimedia.org/wiki/Special:FilePath/Damaged%20Ripped%20Wrinkled%20Cardboard%20Paper%20Texture%20Free%20High%20Resolution%20Creative%20Commons%20(8077166499).jpg?width=200",
    expiry: "https://commons.wikimedia.org/wiki/Special:FilePath/Batch%20no%2C%20MFG%20Date%20and%20EXP%20Date.jpg?width=200",
    variance: "https://commons.wikimedia.org/wiki/Special:FilePath/Messy%20storage%20room%20with%20boxes.jpg?width=200",
    other: "https://commons.wikimedia.org/wiki/Special:FilePath/Messy%20storage%20room%20with%20boxes.jpg?width=200",
  };
  function evidenceFor(a) {
    const out = [];
    auditLines(a).forEach((l) => (l.evidence || []).forEach((ev) => out.push({ ev, product: productById(l.productId) || {} })));
    return out.sort((x, y) => new Date(y.ev.capturedAt || 0) - new Date(x.ev.capturedAt || 0));
  }
  // Omitted entirely, not shown empty — a visit with no photos didn't skip
  // a step, it just had nothing that needed proving.
  function evidenceSectionHTML(a) {
    const items = evidenceFor(a);
    if (!items.length) return "";
    return `
      <div class="sec-label">Evidence<span class="count">${plural(items.length, "photo")}</span></div>
      <div class="cd-card">
        <div class="evidence-grid">
          ${items.map(({ ev, product }) => `
            <div class="evidence-tile">
              <span class="ic"><img src="${esc(EVIDENCE_IMAGE[ev.type] || EVIDENCE_IMAGE.other)}" alt="" loading="lazy"></span>
              <span class="lb">${esc(ev.label)}</span>
              <span class="meta">${esc(product.name || "")} · ${esc(fmtDateShort(ev.capturedAt))}</span>
            </div>`).join("")}
        </div>
      </div>`;
  }

  // Replenish / pull hand off to Sales Orders rather than faking an order —
  // but a rep who already asked once shouldn't be invited to ask again, so
  // the request state lives on the audit (a.actionsTaken) once tapped.
  function auditActionsHTML(a) {
    const acts = recommendedActions(a).filter((x) => x.title !== "Follow-up scheduled" && x.title !== "Consider a follow-up visit" && x.title !== "Finish the coverage");
    if (!acts.length) return "";
    return `
      <div class="sec-label">Actions</div>
      <div class="action-list">
        ${acts.map((x) => {
          const key = x.replenish ? "replenish" : x.pull ? "pull" : null;
          const done = key && a.actionsTaken[key];
          return `<div class="action-item sev-${x.sev}">
            <span class="ic">${x.ic}</span>
            <span class="txt"><b>${x.title}</b>${esc(x.text)}</span>
            ${key ? (done ? `<button disabled>✓ Requested</button>` : `<button data-action="${key}">${x.replenish ? "Replenish" : "Request Pull"}</button>`) : ""}
          </div>`;
        }).join("")}
      </div>`;
  }

  // Visit-level notes, kept apart from per-product notes: one is what the
  // rep knew walking in, the other is what they're leaving behind.
  function visitNotesSectionHTML(a) {
    if (!a.notes && !a.finalNote) return "";
    return `
      <div class="sec-label">Visit Notes</div>
      <div class="cd-card">
        ${a.notes ? `<span class="audit-meta">Before the visit</span><p class="final-note">"${esc(a.notes)}"</p>` : ""}
        ${a.finalNote ? `<span class="audit-meta">On closing</span><p class="final-note">"${esc(a.finalNote)}"</p>` : ""}
      </div>`;
  }

  // Enough of the bigger picture to judge this one visit against — was it
  // better or worse than last time, and is the customer even due to order.
  function customerContextSectionHTML(customer, a) {
    const prev = previousCompleted(customer._id, a.id);
    const prevScore = prev ? scoreFromAudit(prev) : null;
    const curScore = a.status === "completed" ? scoreFromAudit(a) : null;
    const order = orderingStatusFor(customer._id);
    return `
      <div class="sec-label">Customer Context</div>
      <div class="cd-card">
        <div class="info-line"><span class="k">Previous audit</span><span class="v">${prev ? esc(fmtDateShort(prev.at)) + (prevScore != null ? ` · ${prevScore}` : "") : "None on record"}</span></div>
        ${curScore != null ? `<div class="info-line"><span class="k">Health score</span><span class="v">${prevScore == null ? `${curScore} <small>(first measured)</small>` : `${prevScore} → ${curScore} ${curScore > prevScore ? "↑" : curScore < prevScore ? "↓" : "—"}`}</span></div>` : ""}
        <div class="info-line"><span class="k">Ordering cycle</span><span class="v">${order.bucket === "unknown" ? "Unknown" : "Every ~" + plural(order.avgCycleDays, "day")}</span></div>
        ${order.bucket !== "unknown" ? `<div class="info-line"><span class="k">Last order</span><span class="v">${esc(money(order.lastOrderValue))} <small>${esc(fmtDateShort(order.lastOrderAt))}</small></span></div>` : ""}
        ${order.bucket !== "unknown" ? `<div class="info-line"><span class="k">Expected next order</span><span class="v ${order.bucket === "overdue" ? "late" : ""}">${esc(expectedOrderText(order))}</span></div>` : ""}
        <button type="button" class="cd-cta" id="acViewCustomer">View Customer ›</button>
      </div>`;
  }

  // A read-only replay of the exact observation captured that day — history,
  // not something to edit after the fact (see renderProduct for the live
  // capture screen this deliberately does not reuse).
  function auditLineDetailSheet(customer, a, l) {
    const p = productById(l.productId) || {};
    const unit = p.unit ? " " + p.unit : "";
    const v = lineVariance(l);
    const audited = l.status === "audited";
    const vCls = !audited ? "" : v === 0 ? "match" : v > 0 ? "up" : "down";
    const vTxt = !audited ? "—" : v === 0 ? "Match" : (v > 0 ? "+" : "") + v;
    const cond = CONDITION_KEYS.filter((c) => (l.conditionBreakdown[c.k] || 0) > 0);
    const storage = STORAGE_KEYS.filter((k) => (l.storageBreakdown[k.k] || 0) > 0);

    sheet({
      eyebrow: `Art No: ${p.artNo || "—"}${p.category ? " · " + p.category : ""}`,
      title: p.name || l.productId,
      body: `
        ${l.status === "not_found" ? `<div class="cd-blank small" style="margin-top:14px"><b>Not found</b><span>${esc(notFoundMeta(l.notFoundReason).label)}${l.notes ? " — " + esc(l.notes) : ""}</span></div>` : ""}
        <div class="info-card" style="margin:16px 0 0">
          <div class="info-line"><span class="k">Expected</span><span class="v">${lineExpected(l)}${esc(unit)}</span></div>
          ${audited ? `<div class="info-line"><span class="k">Physical count</span><span class="v">${linePhysical(l)}${esc(unit)}</span></div>
          <div class="info-line"><span class="k">Variance</span><span class="v ${vCls}">${vTxt}</span></div>` : ""}
          ${l.shelfAvailability ? `<div class="info-line"><span class="k">Shelf availability</span><span class="v">${esc(shelfMeta(l.shelfAvailability).label)}</span></div>` : ""}
          ${l.facings ? `<div class="info-line"><span class="k">Facings</span><span class="v">${l.facings}</span></div>` : ""}
        </div>
        ${cond.length ? `<div class="pd-sub">Condition</div><div class="info-card">${cond.map((c) => `<div class="info-line"><span class="k">${c.icon} ${esc(c.label)}</span><span class="v">${l.conditionBreakdown[c.k]}${esc(unit)}</span></div>`).join("")}</div>` : ""}
        ${storage.length ? `<div class="pd-sub">Where it was found</div><div class="info-card">${storage.map((k) => `<div class="info-line"><span class="k">${k.icon} ${esc(k.label)}</span><span class="v">${l.storageBreakdown[k.k]}${esc(unit)}</span></div>`).join("")}</div>` : ""}
        ${l.expiryDetails.length ? `<div class="pd-sub">Expiry</div>${l.expiryDetails.map((e) => `<p class="final-note">${e.bucket === "expired" ? "Expired" : "Near expiry"}${e.date ? " " + esc(fmtDateShort(e.date)) : ""}${e.batch ? " · batch " + esc(e.batch) : ""}${e.qty ? " · " + e.qty + esc(unit) : ""}</p>`).join("")}` : ""}
        ${l.disposition ? `<div class="pd-sub">Disposition</div><p class="final-note">${esc((DISPOSITIONS.find((d) => d.k === l.disposition) || {}).label || "")}</p>` : ""}
        ${l.damageType ? `<div class="pd-sub">Damage type</div><p class="final-note">${esc((DAMAGE_TYPES.find((d) => d.k === l.damageType) || {}).label || "")}</p>` : ""}
        ${l.evidence.length ? `<div class="pd-sub">Evidence</div><div class="pd-evidence">${l.evidence.map((ev) => `<span class="ev-chip">${EVIDENCE_ICON[ev.type] || "📷"} ${esc(ev.label)}</span>`).join("")}</div>` : ""}
        ${l.notes && l.status !== "not_found" ? `<div class="pd-sub">Note</div><p class="final-note">"${esc(l.notes)}"</p>` : ""}
      `,
      actions: [{ label: "Close", cls: "ghost" }],
    });
  }

  function renderAudit() {
    const customer = loadCustomer(CURRENT.params.customerId);
    const a = auditsFor(CURRENT.params.customerId).find((x) => x.id === CURRENT.params.auditId);
    if (!customer || !a) { go("customers", {}, true); return; }
    const cov = auditCoverage(a);
    const score = a.status === "completed" ? scoreFromAudit(a) : null;
    const sl = scoreLabel(score);
    const badge = auditBadgeMeta(a);
    const hasIssues = auditLines(a).some((l) => !!issueFor(l));

    frame(`
      <div class="sah-page-head">
        <button type="button" class="back" id="auBack">← ${esc(titleCase(nameOf(customer)))}</button>
        <div class="row"><h1>${esc(purposeMeta(a.purpose).label)}</h1><span class="status-tag ${badge.cls}">${esc(badge.label)}</span></div>
        <p>${esc(placeLine(customer, a.locationId))} · ${esc(fmtDate(a.at))}<br>${esc(a.auditor || AUDITOR.name)} · ${esc(AUDITOR.role)}</p>
      </div>

      ${score == null
        ? `<div class="cd-card cd-blank small"><b>${esc(statusMeta(a.status).label)}</b><span>This visit recorded no completed count, so it carries no health score.</span></div>`
        : `<div class="score-card">
            <div class="score-ring ${sl.cls}">${score}</div>
            <div>
              <div class="lbl">Health Score</div>
              <div class="desc">${esc(sl.label)}</div>
              <div class="sub">${cov.audited} of ${cov.expected} products audited · ${cov.pct}% complete</div>
              ${a.outcome ? `<div class="outcome">${outcomeMeta(a.outcome).icon} ${esc(outcomeMeta(a.outcome).label)}</div>` : ""}
            </div>
          </div>`}

      ${score == null ? "" : `<div class="sec-label">Health Breakdown</div>${healthAxesHTML(a)}`}

      ${auditNeedsActionHTML(a)}
      ${auditCoverageHTML(a)}
      ${stockConditionSummaryHTML(a)}
      ${productFindingsSectionHTML(a)}
      ${evidenceSectionHTML(a)}
      ${auditActionsHTML(a)}

      <div class="sec-label">Follow-up</div>
      <div class="cd-card" id="auFollowAnchor">${followUpHTML(a)}</div>

      ${visitNotesSectionHTML(a)}
      ${customerContextSectionHTML(customer, a)}
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="auIssues" ${hasIssues ? "" : "disabled"}>Review Issues</button>
        <button class="btn-wide primary" id="auFollow">${a.followUp && a.followUp.required ? "Clear Follow-up" : "Create Follow-up"}</button>
      </div></div>` });

    $("#auBack", PAGE).onclick = back;
    $("#auIssues", PAGE).onclick = () => go("inventory", { customerId: customer._id, filter: "issues", auditId: a.id });
    $("#afAllProducts", PAGE) && ($("#afAllProducts", PAGE).onclick = () => go("inventory", { customerId: customer._id, filter: "all", auditId: a.id }));
    $("#acViewCustomer", PAGE) && ($("#acViewCustomer", PAGE).onclick = () => go("customer-detail", { customerId: customer._id }));
    $("#auFollow", PAGE).onclick = () => {
      if (a.followUp && a.followUp.required) a.followUp = { required: false, note: "", at: "" };
      else a.followUp = { required: true, note: a.finalNote || "Flagged from the audit summary.", at: new Date().toISOString() };
      AuditStore.save();
      toast(a.followUp.required ? "Follow-up flagged." : "Follow-up cleared.");
      renderAudit();
    };
    PAGE.querySelectorAll("[data-inv]").forEach((b) => (b.onclick = () => go("inventory", { customerId: customer._id, filter: b.dataset.inv, auditId: a.id })));
    PAGE.querySelectorAll("[data-scroll-follow]").forEach((b) => (b.onclick = () => { const el = $("#auFollowAnchor", PAGE); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }));
    PAGE.querySelectorAll("[data-line]").forEach((b) => (b.onclick = () => {
      const l = auditLines(a).find((x) => x.productId === b.dataset.line);
      if (l) auditLineDetailSheet(customer, a, l);
    }));
    // Replenish/pull hand off to Sales Orders — a different module, a
    // different repo — so this records the ask and hands off rather than
    // faking an order.
    PAGE.querySelectorAll("[data-action]").forEach((b) => (b.onclick = () => {
      const key = b.dataset.action;
      a.actionsTaken[key] = true;
      AuditStore.save();
      toast((key === "replenish" ? "Replenishment" : "Pull/rotation") + " request drafted — continue in Sales Orders.", "info");
      renderAudit();
    }));
    wireFollowUp(a, () => renderAudit());
  }

  function wireFollowUp(a, rerender) {
    PAGE.querySelectorAll("[data-fu-save]").forEach((b) => (b.onclick = () => {
      const ta = PAGE.querySelector(`[data-fu-note="${a.id}"]`);
      a.followUp = { required: true, note: ta ? ta.value.trim() : "", at: new Date().toISOString() };
      AuditStore.save();
      toast("Follow-up flagged.");
      rerender();
    }));
    PAGE.querySelectorAll("[data-fu-clear]").forEach((b) => (b.onclick = () => {
      a.followUp = { required: false, note: "", at: "" };
      AuditStore.save();
      toast("Follow-up cleared.");
      rerender();
    }));
  }

  /* ================================================================= VIEW: customer-audits */

  let CAUD_STATE = { q: "", filter: "all" };

  function renderCustomerAudits() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer) { go("customers", {}, true); return; }
    const all = auditsIn(customer._id, DETAIL.locationId);
    const followUps = all.filter((a) => a.followUp && a.followUp.required).length;

    let rows = CAUD_STATE.filter === "followup" ? all.filter((a) => a.followUp && a.followUp.required) : all;
    const q = CAUD_STATE.q.trim().toLowerCase();
    if (q) rows = rows.filter((a) => (a.notes || "").toLowerCase().includes(q) || (a.finalNote || "").toLowerCase().includes(q) || a.lines.some((l) => productName(l.productId).toLowerCase().includes(q)));

    frame(`
      <div class="sah-page-head">
        <button type="button" class="back" id="caBack">← ${esc(titleCase(nameOf(customer)))}</button>
        <h1>Audit History</h1>
        <p>Every visit to this customer, newest first.</p>
      </div>
      <div class="sah-search-row"><div class="sah-search"><input type="search" id="caQ" value="${esc(CAUD_STATE.q)}" placeholder="Search by product or note…"></div></div>
      <div class="chips">
        <button class="chip ${CAUD_STATE.filter === "all" ? "on" : ""}" data-caf="all">All (${all.length})</button>
        <button class="chip ${CAUD_STATE.filter === "followup" ? "on" : ""}" data-caf="followup">Follow-up needed (${followUps})</button>
      </div>
      ${rows.length
        ? rows.map((a) => auditSummaryRowHTML(a, customer)).join("")
        : `<div class="sah-empty"><div class="big">🗂️</div><p>No audits match this view.</p></div>`}
    `);

    $("#caBack", PAGE).onclick = back;
    wireSearchInput("caQ", (v) => { CAUD_STATE.q = v; renderCustomerAudits(); });
    PAGE.querySelectorAll("[data-caf]").forEach((b) => (b.onclick = () => { CAUD_STATE.filter = b.dataset.caf; renderCustomerAudits(); }));
    PAGE.querySelectorAll("[data-audit]").forEach((b) => (b.onclick = () => go("audit", { customerId: customer._id, auditId: b.dataset.audit })));
  }

  function auditSummaryRowHTML(a, customer) {
    const cov = auditCoverage(a);
    const variance = varianceLines(a).length;
    const flagged = flaggedLines(a).length;
    return `
      <button type="button" class="audit-row-card" data-audit="${esc(a.id)}">
        <div class="top">
          <div><div class="nm">${esc(fmtDate(a.at))}</div><div class="when">${esc(a.auditor || AUDITOR.name)} · ${esc(placeLine(customer, a.locationId))}</div></div>
        </div>
        <span class="purpose">${esc(purposeMeta(a.purpose).icon)} ${esc(purposeMeta(a.purpose).label)}</span>
        <div class="stats">
          ${auditStatusHTML(a)}
          ${a.status !== "completed" ? "" : `<span class="status-tag neutral">${plural(cov.audited, "product")}</span>`}
          ${a.status !== "completed" ? "" : variance ? `<span class="status-tag warn">${plural(variance, "variance")}</span>` : `<span class="status-tag ok">All matched</span>`}
          ${flagged ? `<span class="status-tag danger">${flagged} flagged</span>` : ""}
          ${a.followUp && a.followUp.required ? `<span class="status-tag followup">Follow-up needed</span>` : ""}
        </div>
      </button>`;
  }

  function attentionProductsHTML(lines) {
    return `<div class="attn-card">
      ${lines.map((l) => {
        const p = productById(l.productId) || {};
        return `<div class="attn-row">
          <span class="thumb">${thumbHTML(p)}</span>
          <span class="nm">${esc(p.name || l.productId)}<small>Art No: ${esc(p.artNo || "—")}</small></span>
          <span class="badges">${conditionBadgeHTML(dominantCondition(l))}${shelfBadgeHTML(l)}${l.status === "not_found" && l.notFoundReason ? `<span class="shelf-badge">${esc(notFoundMeta(l.notFoundReason).label)}</span>` : ""}</span>
        </div>`;
      }).join("")}
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
    PAGE.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => beginWizard(b.dataset.pick)));
  }

  /* ================================================================= VIEW: create-location (wizard step 2) */

  function renderCreateLocation() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer) { go("create-customer", {}, true); return; }
    if (!DRAFT) DRAFT = newDraft(customer._id);
    const locs = locationsFor(customer);
    if (!DRAFT.locationId && locs.length === 1) DRAFT.locationId = locs[0].id;

    frame(`
      ${wizardStepsHTML(2)}
      <p class="wizard-label">Create Audit · Step 2 of 3 · ${esc(titleCase(nameOf(customer)))}</p>
      <h2 class="wizard-title">Select Location</h2>
      <p class="wizard-sub">Where are you visiting?</p>
      ${locs.map((l) => locationCardHTML(l, DRAFT.locationId === l.id)).join("")}
      <button type="button" class="add-location" id="addLoc">+ Add Location</button>
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="locBack">Back</button>
        <button class="btn-wide primary" id="locNext" ${DRAFT.locationId ? "" : "disabled"}>Continue</button>
      </div></div>` });

    PAGE.querySelectorAll("[data-loc]").forEach((b) => (b.onclick = () => { DRAFT.locationId = b.dataset.loc; renderCreateLocation(); }));
    $("#addLoc", PAGE).onclick = () => addLocationSheet(customer, (loc) => { DRAFT.locationId = loc.id; renderCreateLocation(); });
    $("#locBack", PAGE).onclick = back;
    $("#locNext", PAGE).onclick = () => { if (DRAFT.locationId) go("create-details", { customerId: customer._id }); };
  }

  function locationCardHTML(l, on) {
    const t = locationTypeMeta(l.type);
    return `
      <button type="button" class="location-card ${on ? "on" : ""}" data-loc="${esc(l.id)}">
        <span class="ic">${t.icon}</span>
        <span><div class="nm">${esc(l.name)}</div><div class="type">${esc(t.label)}</div><div class="sub">${esc(l.line)}</div></span>
      </button>`;
  }

  function addLocationSheet(customer, onAdded) {
    const s = sheet({
      eyebrow: titleCase(nameOf(customer)),
      title: "Add Location",
      sub: "For a place this customer trades from that isn't on their record yet.",
      body: `<div class="sheet-form">
        <label>Location name<input type="text" id="newLocName" placeholder="e.g. Baner Store" autocomplete="off"></label>
        <label>Type<select id="newLocType">${Object.keys(LOCATION_TYPES).map((k) => `<option value="${k}">${esc(LOCATION_TYPES[k].label)}</option>`).join("")}</select></label>
        <label>Area / address<input type="text" id="newLocLine" placeholder="e.g. Baner Road, Pune" autocomplete="off"></label>
      </div>`,
      actions: [
        { label: "Cancel", cls: "ghost" },
        {
          label: "Add Location",
          cls: "primary",
          onClick: () => {
            const name = s.el.querySelector("#newLocName").value.trim();
            if (!name) { toast("Give the location a name.", "info"); return false; }
            const loc = LocationStore.add(customer._id, {
              id: "loc-" + Date.now().toString(36),
              name,
              type: s.el.querySelector("#newLocType").value,
              line: s.el.querySelector("#newLocLine").value.trim() || "No address on file",
            });
            toast("Location added.");
            onAdded(loc);
          },
        },
      ],
    });
  }

  /* ================================================================= VIEW: create-details (wizard step 3) */

  function renderCreateDetails() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer || !DRAFT) { go("create-customer", {}, true); return; }
    const locs = locationsFor(customer);
    const manyLocations = locs.length > 1;
    const loc = locationFor(customer, DRAFT.locationId);
    const locMeta = locationTypeMeta(loc && loc.type);

    frame(`
      ${wizardStepsHTML(3)}
      <p class="wizard-label">Create Audit · Step 3 of 3 · ${esc(titleCase(nameOf(customer)))}</p>
      <h2 class="wizard-title">Audit Purpose</h2>
      <p class="wizard-sub">What's the reason for this visit?</p>
      <div class="purpose-grid">${PURPOSES.map((p) => `
        <button type="button" class="purpose-card ${DRAFT.purpose === p.k ? "on" : ""}" data-purpose="${p.k}">
          <span class="ic">${p.icon}</span>
          <span class="txt"><span class="nm">${esc(p.label)}</span>${p.sub ? `<span class="sub">${esc(p.sub)}</span>` : ""}</span>
          <span class="tick">✓</span>
        </button>`).join("")}
      </div>
      <label class="visit-note">Visit note
        <textarea id="draftNote" placeholder="Optional — anything worth knowing before the count">${esc(DRAFT.notes || "")}</textarea>
      </label>
      <div class="info-card">
        <div class="info-row"><span class="ic">${locMeta.icon}</span><span class="lbl">Location</span><span class="val">${esc(loc ? loc.name : "—")}<small>${esc(loc ? locMeta.label : "")}${manyLocations ? "" : " · only location on file"}</small></span>${manyLocations ? `<button type="button" class="row-link" id="changeLoc">Change</button>` : ""}</div>
        <div class="info-row"><span class="ic">📅</span><span class="lbl">Date &amp; Time</span><span class="val"><input type="datetime-local" id="draftAt" value="${esc(DRAFT.at)}" style="border:none;background:none;font:inherit;font-weight:700;text-align:right"></span></div>
        <div class="info-row"><span class="ic">🧑‍💼</span><span class="lbl">Auditor</span><span class="val">${esc(AUDITOR.name)}<small>${esc(AUDITOR.role)} · ${esc(AUDITOR.team)}</small></span></div>
      </div>
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="detBack">Back</button>
        <button class="btn-wide primary" id="detNext" ${DRAFT.purpose ? "" : "disabled"}>Create Audit</button>
      </div></div>` });

    PAGE.querySelectorAll("[data-purpose]").forEach((b) => (b.onclick = () => { DRAFT.purpose = b.dataset.purpose; renderCreateDetails(); }));
    $("#draftAt", PAGE).oninput = (e) => (DRAFT.at = e.target.value);
    $("#draftNote", PAGE).oninput = (e) => (DRAFT.notes = e.target.value);
    const changeLoc = $("#changeLoc", PAGE);
    if (changeLoc) changeLoc.onclick = () => go("create-location", { customerId: customer._id });
    $("#detBack", PAGE).onclick = back;
    $("#detNext", PAGE).onclick = () => { if (DRAFT.purpose) go("brief", { customerId: customer._id }); };
  }

  /* ================================================================= VIEW: brief */

  function renderBrief() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer || !DRAFT) { go("customers", {}, true); return; }
    const audits = auditsFor(customer._id);
    const last = lastCompleted(customer._id);
    const order = orderingStatusFor(customer._id);
    const attention = last ? flaggedLines(last) : [];
    const lastCoverage = last ? auditCoverage(last) : { audited: 0, expected: 0 };
    // Counts, not a list — this is the "what am I walking into" line, and the
    // products themselves are already listed under Today's Focus below.
    const prevFindings = [];
    if (last) {
      const t = conditionTotals(last);
      const oos = stockOutLines(last).length;
      const nf = auditLines(last).filter((l) => l.status === "not_found").length;
      if (oos) prevFindings.push(plural(oos, "product") + " at stock-out risk");
      if (t.nearExpiry) prevFindings.push(plural(t.nearExpiry, "unit") + " near expiry");
      if (t.expired) prevFindings.push(plural(t.expired, "unit") + " expired");
      if (t.damaged) prevFindings.push(plural(t.damaged, "unit") + " damaged");
      if (nf) prevFindings.push(plural(nf, "product") + " couldn't be verified");
      if (last.partial && last.partial.isPartial) prevFindings.push("Only part of the assortment was covered");
    }
    // Only follow-ups nobody has closed out since.
    const issues = audits
      .filter((a) => a.followUp && a.followUp.required && a.followUp.note)
      .slice(0, 3)
      .map((a) => ({ at: a.at, note: a.followUp.note }));

    frame(`
      <div class="sah-hero">
        <p class="eyebrow">Visit Brief</p>
        <h1>${esc(placeLine(customer, DRAFT.locationId))}</h1>
        <p class="sub">${esc(purposeMeta(DRAFT.purpose).icon)} ${esc(purposeMeta(DRAFT.purpose).label)} · ${esc(fmtDate(DRAFT.at))}</p>
      </div>
      <div class="brief-card">
        <div class="brief-row"><span class="lbl">Last Audit</span><span class="val">${last ? esc(fmtDateShort(last.at)) : "Never"}${last ? `<small>${lastCoverage.audited} products · ${esc(purposeMeta(last.purpose).label)}</small>` : ""}</span></div>
        <div class="brief-row"><span class="lbl">Last Order</span><span class="val">${order.lastOrderAt ? esc(fmtDateShort(order.lastOrderAt)) : "Unknown"}${order.lastOrderValue ? `<small>${esc(money(order.lastOrderValue))}</small>` : ""}</span></div>
        <div class="brief-row"><span class="lbl">Typical Order Cycle</span><span class="val">${order.avgCycleDays ? `Every ~${plural(order.avgCycleDays, "day")}` : "Unknown"}</span></div>
        <div class="brief-row"><span class="lbl">Expected Next Order</span><span class="val ${order.bucket === "overdue" ? "late" : ""}">${esc(expectedOrderText(order))}<small>${esc(ORDER_LABEL[order.bucket])}</small></span></div>
      </div>

      ${last ? `<div class="sec-label">Previous Findings</div>
      <div class="rv-card">
        ${prevFindings.length
          ? prevFindings.map((f) => `<div class="rv-line warn"><span class="ic">•</span><span class="txt">${esc(f)}</span></div>`).join("")
          : `<div class="rv-line ok"><span class="ic">✓</span><span class="txt">Nothing was flagged last visit.</span></div>`}
      </div>` : ""}

      ${issues.length ? `<div class="sec-label">Unresolved Follow-ups</div><div class="issue-list">${issues.map((i) => `<div class="issue-item"><span class="ic">🚩</span><span>${esc(fmtDateShort(i.at))} — ${esc(i.note)}</span></div>`).join("")}</div>` : ""}

      <div class="sec-label">Today's Focus</div>
      ${attention.length
        ? `<p class="focus-line">${esc(plural(attention.length, "product"))} need${attention.length === 1 ? "s" : ""} checking first — they're at the top of your list.</p>${attentionProductsHTML(attention)}`
        : `<p class="focus-line">Nothing carried over. Work the list top to bottom.</p>`}
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="briefBack">Back</button>
        <button class="btn-wide primary" id="briefGo">Begin Audit →</button>
      </div></div>` });

    $("#briefBack", PAGE).onclick = back;
    $("#briefGo", PAGE).onclick = () => go("workspace", { customerId: customer._id });
  }

  /* ================================================================= VIEW: workspace (capture) */

  let WS_STATE = { q: "", tab: "all" };

  // The rep is standing in the store. The list has to answer "what should I
  // check?" without making them read a catalogue, so it's ordered by what
  // matters rather than alphabetically: anything flagged on the last visit
  // first — that's the previous-finding → verification → resolution loop —
  // then whatever this location is actually meant to stock, then the rest.
  function productPriority(p, lastAudit) {
    const prev = lastAudit && lastAudit.lines.find((l) => l.productId === p.id);
    if (prev && dominantCondition(prev) !== "ok") return 0;
    if (prev && lineVariance(prev) !== 0) return 1;
    if (p.systemStock > 0) return 2;
    return 3;
  }

  // What the rep still has to verify, and why. Two sources: what the last
  // visit flagged (carried forward so it gets checked again) and what THIS
  // visit has already turned up.
  function wsAttentionFor(p, lastAudit) {
    const line = DRAFT.lines[p.id];
    if (line && lineIsCaptured(line)) {
      if (line.status === "not_found") return { cls: "warn", label: "Not found" };
      const dc = dominantCondition(line);
      if (dc !== "ok") return { cls: dc === "out_of_stock" ? "danger" : "warn", label: condMeta(dc).label };
      // Condition can be perfect and the line still be a problem: two units
      // of an expected thirty is a stock-out coming, and the rep should see
      // that from the list rather than having to do the arithmetic.
      if (isStockOutRisk(line)) return { cls: "danger", label: "Stock-out risk" };
      if (isOverstock(line)) return { cls: "neutral", label: "Overstock" };
      // A plain variance is not an exception — it's already on the row as a
      // signed number. Flagging every one of them would flag nearly
      // everything and make the Attention list worth ignoring.
      return null;
    }
    const prev = lastAudit && lastAudit.lines.find((l) => l.productId === p.id);
    if (prev && dominantCondition(prev) !== "ok") return { cls: "warn", label: "Flagged last visit" };
    if (prev && lineVariance(prev) !== 0) return { cls: "neutral", label: "Variance last visit" };
    return null;
  }

  function wsProgress() {
    const captured = products.filter((p) => DRAFT.lines[p.id] && lineIsCaptured(DRAFT.lines[p.id])).length;
    return { captured, total: products.length, pct: products.length ? Math.round((captured / products.length) * 100) : 0 };
  }

  function renderWorkspace() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer || !DRAFT) { go("customers", {}, true); return; }
    if (!DRAFT.startedAt) DRAFT.startedAt = new Date().toISOString();
    if (DRAFT.status === "draft") DRAFT.status = "in_progress";
    persistDraft();

    const lastAudit = lastCompleted(customer._id);
    const q = WS_STATE.q.trim().toLowerCase();
    const matches = (p) => !q || p.name.toLowerCase().includes(q) || String(p.artNo).toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q);

    const ordered = products
      .slice()
      .sort((a, b) => productPriority(a, lastAudit) - productPriority(b, lastAudit) || a.name.localeCompare(b.name));
    const attention = ordered.filter((p) => wsAttentionFor(p, lastAudit));
    const shown = (WS_STATE.tab === "attention" ? attention : ordered).filter(matches);

    const prog = wsProgress();
    const place = placeLine(customer, DRAFT.locationId);

    frame(`
      <div class="ws-head">
        <button type="button" class="ws-exit" id="wsExit">← Exit Audit</button>
        <div class="ws-where">${esc(place)}</div>
        <div class="ws-progress">
          <span class="n">${prog.captured} / ${prog.total} products</span>
          ${attention.length ? `<span class="attn">${attention.length} need attention</span>` : `<span class="clear">Nothing flagged yet</span>`}
        </div>
        <div class="ws-bar"><span style="width:${prog.pct}%"></span></div>
      </div>

      <div class="sah-search-row">
        <div class="sah-search"><input type="search" id="wsQ" value="${esc(WS_STATE.q)}" placeholder="Search name, SKU or barcode…"></div>
        <button type="button" class="scan-btn" id="wsScan">📷 Scan</button>
      </div>

      ${q ? "" : `<div class="chips">
        <button class="chip ${WS_STATE.tab === "all" ? "on" : ""}" data-wt="all">All Products (${ordered.length})</button>
        <button class="chip ${WS_STATE.tab === "attention" ? "on" : ""}" data-wt="attention">Needs Attention (${attention.length})</button>
      </div>`}

      ${shown.length
        ? `<div class="ws-list">${shown.map((p) => wsRowHTML(p, lastAudit)).join("")}</div>`
        : `<div class="sah-empty"><div class="big">${q ? "🔍" : "✅"}</div><p>${q ? "No product matches that." : "Nothing needs attention here."}</p></div>`}
    `, { foot: `<div class="sah-foot ws-foot"><div class="inner">
        <button type="button" class="foot-stat" data-wt="all"><b>${prog.captured}/${prog.total}</b><span>Products</span></button>
        <button type="button" class="foot-stat ${attention.length ? "flag" : ""}" data-wt="attention"><b>${attention.length}</b><span>Attention</span></button>
        <button type="button" class="btn-wide primary" id="wsReview" ${prog.captured ? "" : "disabled"}>Review</button>
      </div></div>` });

    wireWorkspace(customer, lastAudit);
  }

  function wsRowHTML(p, lastAudit) {
    const line = DRAFT.lines[p.id];
    const done = line && lineIsCaptured(line);
    const attn = wsAttentionFor(p, lastAudit);
    const v = done && line.status === "audited" ? lineVariance(line) : null;
    const vCls = v == null ? "" : v === 0 ? "match" : v > 0 ? "up" : "down";
    const vTxt = v == null ? "" : v === 0 ? "Match" : (v > 0 ? "+" : "") + v;
    // A <div>, not a <button>: it hosts a real <button> and nesting
    // interactive controls inside a <button> is invalid HTML.
    return `
      <div class="ws-row ${done ? "done" : ""}" data-product="${esc(p.id)}">
        <span class="thumb">${thumbHTML(p)}</span>
        <span class="info">
          <span class="nm">${esc(p.name)}</span>
          <span class="meta">SKU ${esc(p.artNo)} · Expected ${p.systemStock} ${esc(p.unit)}</span>
          ${attn ? `<span class="status-tag ${attn.cls}">${esc(attn.label)}</span>` : ""}
        </span>
        <span class="side">
          ${done
            ? `<span class="found">${line.status === "not_found" ? "Not found" : `${linePhysical(line)} found`}</span>
               ${vTxt ? `<span class="var ${vCls}">${vTxt}</span>` : ""}
               <span class="tick">✓</span>`
            : `<button type="button" class="btn-count" data-count="${esc(p.id)}">Count</button>`}
        </span>
      </div>`;
  }

  function wireWorkspace(customer, lastAudit) {
    wireSearchInput("wsQ", (v) => { WS_STATE.q = v; renderWorkspace(); });
    PAGE.querySelectorAll("[data-wt]").forEach((b) => (b.onclick = () => { WS_STATE.tab = b.dataset.wt; WS_STATE.q = ""; renderWorkspace(); }));
    PAGE.querySelectorAll("[data-product]").forEach((el) => (el.onclick = () => go("product", { customerId: customer._id, productId: el.dataset.product })));
    PAGE.querySelectorAll("[data-count]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); go("product", { customerId: customer._id, productId: b.dataset.count }); }));

    // Simulated — there's no camera here. It resolves to the next product
    // the rep still has to check, which is what a real scan would land on
    // most of the time anyway.
    $("#wsScan", PAGE).onclick = () => {
      const next = nextUncaptured(lastAudit);
      if (!next) { toast("Every product has been counted.", "info"); return; }
      toast(`Scanned ${next.name}.`);
      go("product", { customerId: customer._id, productId: next.id });
    };

    $("#wsExit", PAGE).onclick = () => exitAuditSheet(customer);
    $("#wsReview", PAGE).onclick = () => go("review", { customerId: customer._id });
  }

  function nextUncaptured(lastAudit, afterId) {
    const ordered = products
      .slice()
      .sort((a, b) => productPriority(a, lastAudit) - productPriority(b, lastAudit) || a.name.localeCompare(b.name));
    const pending = ordered.filter((p) => !(DRAFT.lines[p.id] && lineIsCaptured(DRAFT.lines[p.id])));
    if (!afterId) return pending[0] || null;
    // Keep walking forwards from where the rep just was, rather than
    // bouncing back to the top of the list after every save.
    const from = ordered.findIndex((p) => p.id === afterId);
    return pending.find((p) => ordered.indexOf(p) > from) || pending[0] || null;
  }

  function exitAuditSheet(customer) {
    const prog = wsProgress();
    sheet({
      eyebrow: placeLine(customer, DRAFT.locationId),
      title: "Leave this audit?",
      sub: `${prog.captured} of ${prog.total} products counted so far.`,
      actions: [
        { label: "Pause — keep my progress", cls: "primary", onClick: () => pauseAudit(customer) },
        { label: "Keep counting", cls: "ghost" },
        { label: "End this visit", cls: "danger", onClick: () => { endVisitSheet(customer); return false; } },
      ],
    });
  }

  function pauseAudit(customer) {
    DRAFT.status = "paused";
    DRAFT.pausedAt = new Date().toISOString();
    persistDraft();
    const prog = wsProgress();
    DRAFT = null;
    toast(`Paused — ${prog.captured} of ${prog.total} products saved.`);
    go("customer-detail", { customerId: customer._id }, true);
  }

  // A visit that couldn't happen is still a fact worth recording. The
  // alternative — deleting it — leaves a customer looking simply un-visited,
  // which hides a store that keeps being inaccessible.
  const ABANDON_REASONS = [
    { k: "warehouse_inaccessible", label: "Warehouse inaccessible" },
    { k: "customer_unavailable", label: "Customer unavailable" },
    { k: "store_closed", label: "Store closed" },
    { k: "permission", label: "Permission issue" },
    { k: "other", label: "Other" },
  ];

  function endVisitSheet(customer) {
    let picked = null;
    const s = sheet({
      eyebrow: placeLine(customer, DRAFT.locationId),
      title: "End this visit?",
      sub: "It gets recorded as an incomplete visit, with no counts. Pick what stopped it.",
      body: `<div class="pd-opts sheet-opts">${ABANDON_REASONS.map((r) => `<button type="button" class="pd-opt" data-ab="${r.k}">${esc(r.label)}</button>`).join("")}</div>`,
      actions: [
        { label: "End visit", cls: "danger", onClick: () => { if (!picked) { toast("Pick what stopped it.", "info"); return false; } abandonAudit(customer, picked); } },
        { label: "Discard it instead", cls: "ghost", onClick: () => { DraftStore.clear(customer._id); DRAFT = null; toast("Audit discarded."); go("customer-detail", { customerId: customer._id }, true); } },
      ],
    });
    s.el.querySelectorAll("[data-ab]").forEach((b) => (b.onclick = () => {
      picked = b.dataset.ab;
      s.el.querySelectorAll("[data-ab]").forEach((x) => x.classList.toggle("on", x === b));
    }));
  }

  function abandonAudit(customer, reason) {
    const stamp = new Date().toISOString();
    const lines = Object.keys(DRAFT.lines).map((id) => DRAFT.lines[id]).filter(lineIsCaptured);
    const audit = normalizeAudit({
      id: "aud-" + customer._id + "-" + Date.now().toString(36),
      at: DRAFT.at ? new Date(DRAFT.at).toISOString() : stamp,
      status: "abandoned",
      createdAt: DRAFT.createdAt || stamp,
      startedAt: DRAFT.startedAt || stamp,
      auditor: AUDITOR.name,
      actors: { createdBy: AUDITOR.name, startedBy: AUDITOR.name, lastEditedBy: AUDITOR.name, completedBy: null },
      purpose: DRAFT.purpose,
      locationId: DRAFT.locationId,
      expectedProducts: products.length,
      notes: (DRAFT.notes || "").trim(),
      partial: { isPartial: true, reason, note: "" },
      lines,
      followUp: { required: false, note: "", at: "" },
    }, customer._id);
    AuditStore.list(customer._id).unshift(audit);
    AuditStore.save();
    DraftStore.clear(customer._id);
    DRAFT = null;
    toast("Visit recorded as incomplete.");
    go("customer-detail", { customerId: customer._id }, true);
  }

  /* ================================================================= VIEW: product (one product's observation) */

  // The most important interaction in the feature. Optimised for
  // count → condition → next, with every other field kept off the screen
  // until something the rep entered makes it relevant. A healthy product is
  // two taps; only an exception costs more than that.
  function renderProduct() {
    const customer = loadCustomer(CURRENT.params.customerId);
    const p = productById(CURRENT.params.productId);
    if (!customer || !DRAFT || !p) { go("customers", {}, true); return; }

    const hasShelf = locationHasShelf(customer, DRAFT.locationId);
    const line = ensureDraftLine(p, hasShelf);
    const cb = line.conditionBreakdown;
    const total = line.physical == null ? "" : line.physical;
    const counted = sumOf(cb);
    const totalNum = total === "" ? 0 : Number(total);
    const diff = totalNum - counted;
    const reconciled = total !== "" && diff === 0;
    const v = total === "" ? null : totalNum - p.systemStock;
    const blockers = saveBlockers(line, hasShelf);

    frame(`
      <div class="pd-head">
        <button type="button" class="ws-exit" id="pdBack">← ${esc(placeLine(customer, DRAFT.locationId))}</button>
        <div class="pd-title"><span class="thumb">${thumbHTML(p)}</span>
          <div><h1>${esc(p.name)}</h1><p>SKU ${esc(p.artNo)} · ${esc(p.category)}</p></div>
        </div>
        <div class="pd-expected">
          <span>Expected stock</span>
          <b>${p.systemStock} ${esc(p.unit)}</b>
          ${v == null ? "" : `<span class="var ${v === 0 ? "match" : v > 0 ? "up" : "down"}">${v === 0 ? "Match" : (v > 0 ? "+" : "") + v}</span>`}
        </div>
      </div>

      <div class="sec-label">Physical stock</div>
      <div class="pd-total">
        <span class="lbl">Total found</span>
        ${stepperHTML("total", total, "big")}
      </div>
      <button type="button" class="pd-notfound" id="pdNotFound">Can't find this product</button>

      <div class="sec-label">Stock condition</div>
      <div class="pd-conditions">
        ${CONDITION_KEYS.map((c) => `
          <div class="pd-cond ${c.k}">
            <span class="lbl">${c.icon} ${esc(c.label)}</span>
            ${stepperHTML(c.k, cb[c.k] || 0)}
          </div>`).join("")}
      </div>

      <div class="pd-reconcile ${total === "" ? "" : reconciled ? "ok" : "bad"}">
        ${total === ""
          ? `<span>Enter the total found, then split it by condition.</span>`
          : reconciled
            ? `<span><b>${counted}</b> accounted for — matches the total. ✓</span>`
            : `<span><b>${counted}</b> of <b>${totalNum}</b> accounted for — ${diff > 0 ? `${diff} still to classify` : `${-diff} more than the total`}.</span>
               <button type="button" id="pdBalance">${diff > 0 ? "Rest is good stock" : "Set total to " + counted}</button>`}
      </div>

      ${total === "" ? "" : exceptionsHTML(line, p, hasShelf)}

      ${blockers.length ? `<div class="pd-blockers">${blockers.map((b) => `<div>${esc(b)}</div>`).join("")}</div>` : ""}
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="pdSkip">Skip</button>
        <button class="btn-wide primary" id="pdSave" ${blockers.length ? "disabled" : ""}>Save</button>
      </div></div>` });

    wireProduct(customer, p, line, hasShelf);
  }

  /* -------- progressive disclosure: only what the count made relevant ----- */

  function exceptionsHTML(line, p, hasShelf) {
    const cb = line.conditionBreakdown;
    const parts = [];

    if (cb.nearExpiry > 0) {
      const e = expiryEntry(line, "nearExpiry");
      parts.push(`<div class="pd-block warn">
        <div class="hd">⏰ Near-expiry details <span>${cb.nearExpiry} ${esc(p.unit)}</span></div>
        <div class="pd-fields">
          <label>Expiry date<input type="date" data-exp="nearExpiry" data-k="date" value="${esc(e.date || "")}"></label>
          <label>Batch <small>optional</small><input type="text" data-exp="nearExpiry" data-k="batch" value="${esc(e.batch || "")}" placeholder="e.g. PG-2609-A"></label>
        </div>
      </div>`);
    }

    if (cb.expired > 0) {
      const e = expiryEntry(line, "expired");
      parts.push(`<div class="pd-block danger">
        <div class="hd">⏳ Expired stock <span>${cb.expired} ${esc(p.unit)}</span></div>
        <div class="pd-fields">
          <label>Expiry date<input type="date" data-exp="expired" data-k="date" value="${esc(e.date || "")}"></label>
          <label>Batch <small>optional</small><input type="text" data-exp="expired" data-k="batch" value="${esc(e.batch || "")}" placeholder="e.g. AT-0814"></label>
        </div>
        <div class="pd-sub">What should happen to it?</div>
        <div class="pd-opts">${DISPOSITIONS.map((d) => `<button type="button" class="pd-opt ${line.disposition === d.k ? "on" : ""}" data-disposition="${d.k}">${esc(d.label)}</button>`).join("")}</div>
      </div>`);
    }

    if (cb.damaged > 0) {
      parts.push(`<div class="pd-block danger">
        <div class="hd">⚠️ Damaged stock <span>${cb.damaged} ${esc(p.unit)}</span></div>
        <div class="pd-sub">What kind of damage?</div>
        <div class="pd-opts">${DAMAGE_TYPES.map((d) => `<button type="button" class="pd-opt ${line.damageType === d.k ? "on" : ""}" data-damage="${d.k}">${esc(d.label)}</button>`).join("")}</div>
      </div>`);
    }

    // Where the stock physically was. One place is the normal case and costs
    // nothing; splitting it is what tells "the shelf is empty" apart from
    // "the shelf is empty but there are twelve in the back".
    const active = STORAGE_KEYS.filter((k) => (line.storageBreakdown[k.k] || 0) > 0);
    const split = active.length > 1;
    parts.push(`<div class="pd-block">
      <div class="hd">Where is this stock?</div>
      <div class="pd-opts">${STORAGE_KEYS.filter((k) => hasShelf || k.k !== "shelf").map((k) => `
        <button type="button" class="pd-opt ${(line.storageBreakdown[k.k] || 0) > 0 ? "on" : ""}" data-storage="${k.k}">${k.icon} ${esc(k.label)}</button>`).join("")}</div>
      ${split ? `<div class="pd-splits">${active.map((k) => `
        <div class="pd-split"><span class="lbl">${esc(k.label)}</span>${stepperHTML("storage:" + k.k, line.storageBreakdown[k.k] || 0)}</div>`).join("")}</div>` : ""}
    </div>`);

    // Shelf questions only where there is a shelf — a warehouse audit must
    // not be asked to rate facings it doesn't have.
    if (hasShelf) {
      parts.push(`<div class="pd-block">
        <div class="hd">Shelf availability</div>
        <div class="pd-opts">${SHELF_AVAILABILITY.map((a) => `<button type="button" class="pd-opt ${line.shelfAvailability === a.k ? "on" : ""}" data-shelf="${a.k}">${esc(a.label)}</button>`).join("")}</div>
        ${line.shelfAvailability && line.shelfAvailability !== "not_on_shelf"
          ? `<div class="pd-split"><span class="lbl">Facings <small>optional</small></span>${stepperHTML("facings", line.facings == null ? 0 : line.facings)}</div>`
          : ""}
      </div>`);
    }

    // Evidence belongs to the observation, not to every SKU. It's offered
    // always and demanded only where the business rule needs the proof.
    const needsProof = cb.damaged > 0 || cb.expired > 0;
    parts.push(`<div class="pd-block">
      <div class="hd">Evidence ${needsProof ? `<span class="req">required</span>` : `<span>optional</span>`}</div>
      ${line.evidence.length ? `<div class="pd-evidence">${line.evidence.map((ev) => `
        <span class="ev-chip">📷 ${esc(ev.label)}<button type="button" data-ev-remove="${esc(ev.id)}">×</button></span>`).join("")}</div>` : ""}
      <button type="button" class="pd-photo" id="pdPhoto">📷 Take Photo</button>
    </div>`);

    const hasNote = (line.notes || "").length > 0;
    parts.push(`<div class="pd-block">
      <div class="hd">Note <span>optional</span></div>
      <textarea id="pdNote" placeholder="e.g. Customer moved 10 units to the back shelf">${esc(line.notes || "")}</textarea>
    </div>`);

    return parts.join("");
  }

  // Everything standing between this line and Save. One list, so the rep is
  // never left guessing why the button is greyed out.
  function saveBlockers(line, hasShelf) {
    const cb = line.conditionBreakdown;
    const out = [];
    if (line.physical == null) { out.push("Enter the total found."); return out; }
    if (sumOf(cb) !== line.physical) out.push("The condition split has to add up to the total found.");
    if (cb.expired > 0 && !line.disposition) out.push("Say what should happen to the expired stock.");
    if (cb.damaged > 0 && !line.damageType) out.push("Pick a damage type.");
    if ((cb.damaged > 0 || cb.expired > 0) && !line.evidence.length) out.push("Add a photo of the damaged or expired stock.");
    if (sumOf(line.storageBreakdown) !== line.physical) out.push("Split the stock across where you found it.");
    if (hasShelf && !line.shelfAvailability) out.push("Rate what's on the shelf.");
    return out;
  }

  function stepperHTML(key, value, cls) {
    return `<span class="pd-stepper ${cls || ""}" data-field="${esc(key)}">
      <button type="button" data-delta="-1">−</button>
      <input type="text" inputmode="numeric" size="3" value="${value === "" || value == null ? "" : value}" placeholder="0">
      <button type="button" data-delta="1">+</button>
    </span>`;
  }

  function expiryEntry(line, bucket) {
    let e = line.expiryDetails.find((x) => x.bucket === bucket);
    if (!e) { e = { bucket, date: "", batch: "", qty: 0 }; line.expiryDetails.push(e); }
    return e;
  }

  function ensureDraftLine(p, hasShelf) {
    if (!DRAFT.lines[p.id]) {
      const line = blankLine(p.id, p.systemStock);
      // Sensible defaults for the ordinary case, so a healthy product needs
      // no answers beyond the count itself.
      if (hasShelf) line.shelfAvailability = "available";
      DRAFT.lines[p.id] = line;
    }
    return DRAFT.lines[p.id];
  }

  function wireProduct(customer, p, line, hasShelf) {
    const cb = line.conditionBreakdown;
    const sb = line.storageBreakdown;
    const num = (v) => Math.max(0, Number(v) || 0);
    const primaryStore = hasShelf ? "shelf" : "warehouse";

    // Re-rendering on every keystroke is what keeps every derived number
    // honest, but it also blows away the caret. Put it back where it was.
    const focusKey = (() => {
      const el = document.activeElement;
      const st = el && el.closest && el.closest(".pd-stepper");
      return st ? st.dataset.field : null;
    })();
    const rerender = () => {
      renderProduct();
      if (!focusKey) return;
      const el = PAGE.querySelector(`.pd-stepper[data-field="${focusKey}"] input`);
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    };

    const others = () => (cb.nearExpiry || 0) + (cb.expired || 0) + (cb.damaged || 0);
    const storeOthers = () => STORAGE_KEYS.reduce((n, k) => n + (k.k === primaryStore ? 0 : sb[k.k] || 0), 0);
    // Good stock, and stock in its usual place, are both remainders that keep
    // themselves right. Count the total, then declare only the exceptions —
    // finding 2 expired out of 12 means 10 are good, not that 2 more
    // appeared. Both stay directly editable for a rep who counted the piles
    // separately; that's the one way the numbers can disagree, and the strip
    // under the conditions says so when they do.
    const rebalance = () => {
      if (line.physical == null) return;
      cb.good = Math.max(0, line.physical - others());
      sb[primaryStore] = Math.max(0, line.physical - storeOthers());
    };

    const readField = (key) => {
      if (key === "total") return line.physical == null ? 0 : line.physical;
      if (key === "facings") return line.facings == null ? 0 : line.facings;
      if (key.indexOf("storage:") === 0) return sb[key.slice(8)] || 0;
      return cb[key] || 0;
    };
    const writeField = (key, val) => {
      if (key === "total") { line.physical = val; rebalance(); }
      else if (key === "facings") line.facings = val;
      else if (key === "good") cb.good = val;
      else if (key.indexOf("storage:") === 0) {
        const k = key.slice(8);
        sb[k] = val;
        if (k !== primaryStore) sb[primaryStore] = Math.max(0, (line.physical || 0) - storeOthers());
      } else { cb[key] = val; rebalance(); }
      rerender();
    };

    PAGE.querySelectorAll(".pd-stepper").forEach((st) => {
      const key = st.dataset.field;
      const input = st.querySelector("input");
      input.oninput = () => writeField(key, num(input.value));
      st.querySelectorAll("[data-delta]").forEach((b) => (b.onclick = () => writeField(key, num(readField(key) + Number(b.dataset.delta)))));
    });

    const balance = $("#pdBalance", PAGE);
    if (balance) balance.onclick = () => {
      const diff = (line.physical || 0) - sumOf(cb);
      if (diff > 0) cb.good = (cb.good || 0) + diff;
      else line.physical = sumOf(cb);
      rebalance();
      rerender();
    };

    PAGE.querySelectorAll("[data-disposition]").forEach((b) => (b.onclick = () => { line.disposition = line.disposition === b.dataset.disposition ? null : b.dataset.disposition; rerender(); }));
    PAGE.querySelectorAll("[data-damage]").forEach((b) => (b.onclick = () => { line.damageType = line.damageType === b.dataset.damage ? null : b.dataset.damage; rerender(); }));
    PAGE.querySelectorAll("[data-shelf]").forEach((b) => (b.onclick = () => { line.shelfAvailability = b.dataset.shelf; rerender(); }));

    PAGE.querySelectorAll("[data-storage]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.storage;
      if ((sb[k] || 0) > 0) {
        // Turning a place off returns its stock to the usual one rather than
        // quietly losing it from the total.
        sb[k] = 0;
        if (k === primaryStore) { const other = STORAGE_KEYS.find((x) => (sb[x.k] || 0) > 0); if (!other) sb[primaryStore] = line.physical || 0; }
      } else if (k === primaryStore) {
        sb[k] = Math.max(0, (line.physical || 0) - storeOthers());
      } else {
        sb[k] = 1;
      }
      sb[primaryStore] = Math.max(0, (line.physical || 0) - storeOthers());
      rerender();
    }));

    // Text fields update the model without re-rendering — a re-render per
    // keystroke would take the caret with it.
    PAGE.querySelectorAll("[data-exp]").forEach((el) => (el.oninput = () => {
      const e = expiryEntry(line, el.dataset.exp);
      e[el.dataset.k] = el.value;
      e.qty = cb[el.dataset.exp] || 0;
    }));
    const note = $("#pdNote", PAGE);
    if (note) note.oninput = () => (line.notes = note.value);

    // Simulated — there's no camera here. What matters for the prototype is
    // that the evidence attaches to THIS observation with a type that says
    // what it was proving.
    const photo = $("#pdPhoto", PAGE);
    if (photo) photo.onclick = () => {
      const type = cb.damaged > 0 ? "damage" : cb.expired > 0 || cb.nearExpiry > 0 ? "expiry" : lineVariance(line) !== 0 ? "variance" : "shelf";
      const label = { damage: "Damaged stock", expiry: "Date code", variance: "Stock on hand", shelf: "Shelf" }[type];
      line.evidence.push({ id: "ev-" + Date.now().toString(36), type, label: label + " — " + p.name, note: "", capturedAt: new Date().toISOString(), capturedBy: AUDITOR.name });
      toast("Photo attached.");
      rerender();
    };
    PAGE.querySelectorAll("[data-ev-remove]").forEach((b) => (b.onclick = () => {
      line.evidence = line.evidence.filter((e) => e.id !== b.dataset.evRemove);
      rerender();
    }));

    $("#pdNotFound", PAGE).onclick = () => notFoundSheet(customer, p, line);
    $("#pdBack", PAGE).onclick = back;
    $("#pdSkip", PAGE).onclick = () => advance(customer, p, true);
    $("#pdSave", PAGE).onclick = () => {
      line.status = "audited";
      line.notFoundReason = null;
      // Drop expiry rows for buckets that ended up empty.
      line.expiryDetails = line.expiryDetails.filter((e) => (cb[e.bucket] || 0) > 0).map((e) => Object.assign(e, { qty: cb[e.bucket] }));
      if (!cb.expired) line.disposition = null;
      if (!cb.damaged) line.damageType = null;
      const parts = CONDITION_KEYS.filter((c) => cb[c.k] > 0).map((c) => `${cb[c.k]} ${c.label.toLowerCase()}`);
      const done = !nextUncaptured(lastCompleted(customer._id));
      toast(`${p.name}: ${line.physical} found${parts.length ? " — " + parts.join(", ") : ""}.${done ? " That's everything — ready to review." : ""}`);
      advance(customer, p, false);
    };
  }

  // "Couldn't find it" is not "there are zero" — one is an unverified line,
  // the other a confirmed stock-out — so it records a reason and no count.
  function notFoundSheet(customer, p, line) {
    let picked = line.notFoundReason || null;
    const s = sheet({
      eyebrow: p.name,
      title: "Can't find this product?",
      sub: "This records that the stock couldn't be verified — not that there is none.",
      body: `<div class="pd-opts sheet-opts">${NOT_FOUND_REASONS.map((r) => `<button type="button" class="pd-opt" data-nf="${r.k}">${esc(r.label)}</button>`).join("")}</div>`,
      actions: [
        { label: "Cancel", cls: "ghost" },
        {
          label: "Mark as not found",
          cls: "primary",
          onClick: () => {
            if (!picked) { toast("Pick a reason first.", "info"); return false; }
            line.status = "not_found";
            line.notFoundReason = picked;
            line.physical = null;
            line.conditionBreakdown = emptyCondition();
            line.storageBreakdown = emptyStorage();
            // Nobody verified this stock, so it says nothing about the shelf
            // either — leaving the default "available" on it would quietly
            // inflate shelf health with an observation never made.
            line.shelfAvailability = null;
            line.facings = null;
            line.expiryDetails = [];
            line.disposition = null;
            line.damageType = null;
            toast(`${p.name} marked as not found.`);
            advance(customer, p, false);
          },
        },
      ],
    });
    s.el.querySelectorAll("[data-nf]").forEach((b) => (b.onclick = () => {
      picked = b.dataset.nf;
      s.el.querySelectorAll("[data-nf]").forEach((x) => x.classList.toggle("on", x === b));
    }));
  }

  // Back to the list after every product, rather than jumping the rep to
  // whatever the system thinks is next. The list is where they can search,
  // scan, and see what's left — deciding for them which product to stand in
  // front of next takes that away.
  //
  // Replaces rather than pushes: product was reached FROM the list, so
  // returning to it should unwind that step, not stack another one.
  function advance(customer, p, skipped) {
    if (skipped) delete DRAFT.lines[p.id];
    persistDraft();
    go("workspace", { customerId: customer._id }, true);
  }

  /* ================================================================= VIEW: review */

  // A snapshot of the draft in the shape everything else already reads, so
  // the review screen and the completed record can't compute the same numbers
  // two different ways. Lines are copied, not aliased — reviewing must not
  // edit what the rep captured.
  function draftAsAudit(customer) {
    return normalizeAudit({
      id: "draft-" + customer._id,
      at: DRAFT.at ? new Date(DRAFT.at).toISOString() : new Date().toISOString(),
      status: "review",
      auditor: DRAFT.auditor || AUDITOR.name,
      purpose: DRAFT.purpose,
      locationId: DRAFT.locationId,
      expectedProducts: products.length,
      notes: DRAFT.notes,
      lines: Object.keys(DRAFT.lines).map((id) => clone(DRAFT.lines[id])).filter(lineIsCaptured),
    }, customer._id);
  }

  // Lines the rep still owes someone an action on after they leave.
  function followUpLines(a) {
    return auditLines(a).filter((l) =>
      l.status === "not_found" ||
      (l.conditionBreakdown.expired || 0) > 0 ||
      (l.conditionBreakdown.damaged || 0) > 0 ||
      isStockOutRisk(l));
  }

  // Why this line needs someone to do something — which is not always its
  // condition. A product in perfect condition with two units left of an
  // expected thirty needs a delivery, and labelling that row "OK" tells the
  // rep nothing about why it's on the list.
  function followUpReason(l) {
    if (l.status === "not_found") return { cls: "warn", label: "Couldn't verify" };
    if ((l.conditionBreakdown.expired || 0) > 0) return { cls: "danger", label: "Pull expired stock" };
    if ((l.conditionBreakdown.damaged || 0) > 0) return { cls: "danger", label: "Damaged stock" };
    if (isStockOutRisk(l)) return { cls: "danger", label: "Replenish" };
    return { cls: "neutral", label: "Check" };
  }

  function renderReview() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer || !DRAFT) { go("customers", {}, true); return; }

    const a = draftAsAudit(customer);
    const cov = auditCoverage(a);
    const audited = auditLines(a).filter((l) => l.status === "audited");
    const matched = audited.filter((l) => lineVariance(l) === 0 && !isStockOutRisk(l) && dominantCondition(l) === "ok").length;
    const variances = varianceLines(a).length;
    const stockouts = stockOutLines(a).length;
    const totals = conditionTotals(a);
    const shelfPct = shelfHealthPct(a);
    const followUps = followUpLines(a);
    const notFound = auditLines(a).filter((l) => l.status === "not_found").length;

    frame(`
      <div class="sah-page-head">
        <h1>Review Audit</h1><p>${esc(placeLine(customer, DRAFT.locationId))} · ${esc(purposeMeta(DRAFT.purpose).label)}</p>
      </div>

      <div class="rv-coverage">
        <div class="row"><b>${cov.audited}</b><span>products audited</span></div>
        ${notFound ? `<div class="row"><b>${notFound}</b><span>marked not found</span></div>` : ""}
        <div class="row ${cov.skipped ? "warn" : ""}"><b>${cov.skipped}</b><span>not reached</span></div>
        <div class="ws-bar"><span style="width:${cov.pct}%"></span></div>
      </div>

      <div class="sec-label">Stock</div>
      <div class="rv-card">
        <div class="rv-line ok"><span class="ic">✓</span><span class="txt">${matched} product${matched === 1 ? "" : "s"} matched</span></div>
        <div class="rv-line ${variances ? "warn" : "muted"}"><span class="ic">⚠</span><span class="txt">${variances} stock variance${variances === 1 ? "" : "s"}</span></div>
        <div class="rv-line ${stockouts ? "danger" : "muted"}"><span class="ic">●</span><span class="txt">${stockouts} stock-out risk${stockouts === 1 ? "" : "s"}</span></div>
      </div>

      <div class="sec-label">Condition</div>
      <div class="rv-card">
        ${CONDITION_KEYS.map((c) => `
          <div class="rv-line ${totals[c.k] ? c.k : "muted"}"><span class="ic">${c.icon}</span><span class="txt">${esc(c.label)}</span><b>${totals[c.k]}</b></div>`).join("")}
      </div>

      ${shelfPct == null ? "" : `<div class="sec-label">Shelf</div>
      <div class="rv-card"><div class="rv-line ${shelfPct >= 90 ? "ok" : shelfPct >= 70 ? "warn" : "danger"}"><span class="ic">🧺</span><span class="txt">${shelfPct}% available</span></div></div>`}

      <div class="sec-label">Follow-up</div>
      <div class="rv-card">
        <div class="rv-line ${followUps.length ? "warn" : "ok"}"><span class="ic">${followUps.length ? "🚩" : "✓"}</span><span class="txt">${followUps.length ? `${followUps.length} product${followUps.length === 1 ? "" : "s"} need action` : "Nothing outstanding"}</span></div>
        ${followUps.length ? `<div class="rv-issues">${followUps.map((l) => `
          <div class="rv-issue"><span class="pn">${esc(productName(l.productId))}</span><span class="status-tag ${followUpReason(l).cls}">${esc(followUpReason(l).label)}</span></div>`).join("")}
          <button type="button" class="rv-link" id="rvIssues">Review these products ›</button>` : ""}
      </div>
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="rvBack">Keep counting</button>
        <button class="btn-wide primary" id="rvComplete" ${cov.audited || notFound ? "" : "disabled"}>Complete Audit</button>
      </div></div>` });

    $("#rvBack", PAGE).onclick = () => go("workspace", { customerId: customer._id }, true);
    const issues = $("#rvIssues", PAGE);
    if (issues) issues.onclick = () => { WS_STATE.tab = "attention"; WS_STATE.q = ""; go("workspace", { customerId: customer._id }, true); };
    $("#rvComplete", PAGE).onclick = () => {
      if (cov.skipped > 0) coverageSheet(customer, cov);
      else finishAudit(customer);
    };
  }

  // Unfinished work is never silently lost. If products weren't reached, the
  // rep says so and says why, and that reason becomes part of the record —
  // "42 of 50, store closing" is a different fact from "42 of 50" and a very
  // different one from "50 of 50".
  function coverageSheet(customer, cov) {
    let picked = null;
    const s = sheet({
      eyebrow: placeLine(customer, DRAFT.locationId),
      title: `${cov.skipped} product${cov.skipped === 1 ? "" : "s"} not audited`,
      sub: "Go back and finish them, or close this as a partial visit and say what stopped it.",
      body: `<div class="pd-opts sheet-opts">${PARTIAL_REASONS.map((r) => `<button type="button" class="pd-opt" data-pr="${r.k}">${esc(r.label)}</button>`).join("")}</div>`,
      actions: [
        { label: "Complete the remaining products", cls: "ghost", onClick: () => go("workspace", { customerId: customer._id }, true) },
        {
          label: "Complete with partial coverage",
          cls: "primary",
          onClick: () => {
            if (!picked) { toast("Pick what stopped the audit.", "info"); return false; }
            DRAFT.partial = { isPartial: true, reason: picked, note: "" };
            finishAudit(customer);
          },
        },
      ],
    });
    s.el.querySelectorAll("[data-pr]").forEach((b) => (b.onclick = () => {
      picked = b.dataset.pr;
      s.el.querySelectorAll("[data-pr]").forEach((x) => x.classList.toggle("on", x === b));
    }));
  }

  function finishAudit(customer) {
    go("closure", { customerId: customer._id });
  }

  /* ================================================================= VIEW: closure */

  // How this visit ended, in the distributor's terms rather than the shelf's.
  const OUTCOMES = [
    { k: "healthy", label: "Healthy", icon: "✅", sub: "Nothing needed here" },
    { k: "replenish", label: "Needs replenishment", icon: "📦", sub: "Stock is running out" },
    { k: "pull", label: "Stock pull required", icon: "🧹", sub: "Expired or damaged stock to remove" },
    { k: "followup", label: "Needs follow-up", icon: "🚩", sub: "Something to come back for" },
    { k: "investigate", label: "Further investigation", icon: "🔍", sub: "The numbers don't add up" },
  ];
  const outcomeMeta = (k) => OUTCOMES.find((o) => o.k === k) || { label: "—", icon: "•", sub: "" };

  // The system does the interpreting; the rep confirms or overrides it. Making
  // someone who has just counted fifty products also classify the visit from
  // a blank slate is work the findings already answered.
  function suggestedOutcome(a) {
    const totals = conditionTotals(a);
    if (stockOutLines(a).length) return "replenish";
    if (totals.expired > 0 || totals.damaged > 0) return "pull";
    if (auditLines(a).some((l) => l.status === "not_found") || followUpLines(a).length) return "followup";
    const audited = auditLines(a).filter((l) => l.status === "audited");
    if (audited.length && varianceLines(a).length > audited.length / 2) return "investigate";
    return "healthy";
  }

  function renderClosure() {
    const customer = loadCustomer(CURRENT.params.customerId);
    if (!customer || !DRAFT) { go("customers", {}, true); return; }

    const a = draftAsAudit(customer);
    const cov = auditCoverage(a);
    const totals = conditionTotals(a);
    const shelfIssues = auditLines(a).filter((l) => l.shelfAvailability && l.shelfAvailability !== "available").length;
    const followUps = followUpLines(a);
    if (!DRAFT.outcome) DRAFT.outcome = suggestedOutcome(a);
    const suggested = suggestedOutcome(a);

    // The plural has to land on the noun, not the end of the phrase — "2 unit
    // expireds" is the kind of thing that makes a prototype look unfinished.
    const findings = [
      { n: varianceLines(a).length, text: (n) => plural(n, "stock variance") },
      { n: stockOutLines(a).length, text: (n) => plural(n, "stock-out risk") },
      { n: totals.nearExpiry, text: (n) => plural(n, "unit") + " near expiry" },
      { n: totals.expired, text: (n) => plural(n, "unit") + " expired" },
      { n: totals.damaged, text: (n) => plural(n, "unit") + " damaged" },
      { n: shelfIssues, text: (n) => plural(n, "shelf issue") },
    ].filter((f) => f.n > 0);

    frame(`
      <div class="sah-page-head">
        <h1>Complete Audit</h1><p>${esc(placeLine(customer, DRAFT.locationId))} · ${esc(purposeMeta(DRAFT.purpose).label)}</p>
      </div>

      <div class="cl-coverage ${DRAFT.partial && DRAFT.partial.isPartial ? "partial" : ""}">
        <span class="lbl">Audit coverage</span>
        <b>${cov.audited} / ${cov.expected} products</b>
        ${DRAFT.partial && DRAFT.partial.isPartial
          ? `<span class="why">Partial — ${esc((PARTIAL_REASONS.find((r) => r.k === DRAFT.partial.reason) || { label: "reason not given" }).label.toLowerCase())}</span>`
          : `<span class="why">Full coverage</span>`}
      </div>

      <div class="sec-label">Findings</div>
      <div class="rv-card">
        ${findings.length
          ? findings.map((f) => `<div class="rv-line warn"><span class="ic">•</span><span class="txt">${esc(f.text(f.n))}</span></div>`).join("")
          : `<div class="rv-line ok"><span class="ic">✓</span><span class="txt">Nothing flagged — the shelf looked healthy.</span></div>`}
      </div>

      ${followUps.length ? `<div class="sec-label">Required actions</div>
      <div class="rv-card">
        <div class="rv-line warn"><span class="ic">🚩</span><span class="txt">${followUps.length} product${followUps.length === 1 ? "" : "s"} require follow-up</span></div>
        <div class="rv-issues">${followUps.map((l) => `
          <div class="rv-issue"><span class="pn">${esc(productName(l.productId))}</span><span class="status-tag ${followUpReason(l).cls}">${esc(followUpReason(l).label)}</span></div>`).join("")}
          <button type="button" class="rv-link" id="clReview">Review these products ›</button>
        </div>
      </div>` : ""}

      <div class="sec-label">Visit outcome</div>
      <div class="purpose-grid">
        ${OUTCOMES.map((o) => `
          <button type="button" class="purpose-card ${DRAFT.outcome === o.k ? "on" : ""}" data-outcome="${o.k}">
            <span class="ic">${o.icon}</span>
            <span class="txt"><span class="nm">${esc(o.label)}${o.k === suggested ? ` <em>suggested</em>` : ""}</span><span class="sub">${esc(o.sub)}</span></span>
            <span class="tick">✓</span>
          </button>`).join("")}
      </div>

      <label class="visit-note">Final note
        <textarea id="clNote" placeholder="Optional — anything the next visit should know">${esc(DRAFT.finalNote || "")}</textarea>
      </label>
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="clBack">Back</button>
        <button class="btn-wide primary" id="clDone">Complete Audit</button>
      </div></div>` });

    PAGE.querySelectorAll("[data-outcome]").forEach((b) => (b.onclick = () => { DRAFT.outcome = b.dataset.outcome; renderClosure(); }));
    const rev = $("#clReview", PAGE);
    if (rev) rev.onclick = () => { WS_STATE.tab = "attention"; WS_STATE.q = ""; go("workspace", { customerId: customer._id }, true); };
    $("#clNote", PAGE).oninput = (e) => (DRAFT.finalNote = e.target.value);
    $("#clBack", PAGE).onclick = back;
    $("#clDone", PAGE).onclick = () => completeAudit(customer);
  }

  /* ------------------------------------------------------- complete audit */

  function completeAudit(customer) {
    // The draft already holds observations — the product screen writes them
    // straight in. Only lines the rep actually reached get recorded; an
    // untouched product is absent from the audit, not a zero count in it.
    const lines = Object.keys(DRAFT.lines)
      .map((id) => DRAFT.lines[id])
      .filter(lineIsCaptured);
    if (!lines.length) return;

    const stamp = new Date().toISOString();
    const audit = normalizeAudit({
      id: "aud-" + customer._id + "-" + Date.now().toString(36),
      at: DRAFT.at ? new Date(DRAFT.at).toISOString() : stamp,
      status: "completed",
      createdAt: DRAFT.createdAt || stamp,
      startedAt: DRAFT.startedAt || stamp,
      completedAt: stamp,
      auditor: DRAFT.auditor || AUDITOR.name,
      actors: { createdBy: AUDITOR.name, startedBy: AUDITOR.name, lastEditedBy: AUDITOR.name, completedBy: AUDITOR.name },
      purpose: DRAFT.purpose,
      locationId: DRAFT.locationId,
      // Snapshot the denominator, so a later catalogue change can't move the
      // coverage of a visit that is already closed.
      expectedProducts: products.length,
      notes: (DRAFT.notes || "").trim(),
      outcome: DRAFT.outcome || null,
      finalNote: (DRAFT.finalNote || "").trim(),
      partial: DRAFT.partial || { isPartial: false, reason: null, note: "" },
      lines,
      followUp: { required: false, note: "", at: "" },
    }, customer._id);
    AuditStore.list(customer._id).unshift(audit);
    AuditStore.save();
    DraftStore.clear(customer._id);
    toast("Audit saved.");
    go("complete", { customerId: customer._id, auditId: audit.id }, true);
  }

  /* ================================================================= VIEW: complete */

  function computeAuditScore(a) {
    const score = scoreFromAudit(a);
    const cls = score >= 80 ? "good" : score >= 55 ? "fair" : "poor";
    const label = score >= 80 ? "Healthy Customer" : score >= 55 ? "Fair — Keep An Eye On It" : "Needs Attention";
    return { score, cls, label };
  }
  const axisCls = (v) => (v == null ? "none" : v >= 85 ? "good" : v >= 65 ? "fair" : "poor");

  // Stock / Shelf / Expiry / Ordering, shown as four bars rather than folded
  // into the one number above them. A rep looking at 72 needs to know whether
  // to bring stock or rotate it.
  function healthAxesHTML(a) {
    const hb = healthBreakdown(a);
    return `<div class="axes">${HEALTH_AXES.map((ax) => {
      const v = hb[ax.k];
      return `<div class="axis ${axisCls(v)}">
        <div class="hd"><span>${esc(ax.label)}</span><b>${v == null ? "—" : v}</b></div>
        <div class="bar"><span style="width:${v == null ? 0 : v}%"></span></div>
        ${v == null ? `<div class="na">Not measured on this visit</div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  function shelfHealthPct(a) {
    const rated = a.lines.filter((l) => l.status === "audited" && l.shelfAvailability);
    // null, not 100: a warehouse visit rates no shelves, and reporting a
    // perfect score for a question nobody asked is worse than saying nothing.
    if (!rated.length) return null;
    const pts = rated.reduce((s, l) => s + (l.shelfAvailability === "available" ? 1 : l.shelfAvailability === "partial" ? 0.5 : 0), 0);
    return Math.round((pts / rated.length) * 100);
  }

  // What to actually do next, in severity order, with the products named.
  // The count is the input; this is the point of having taken it.
  function recommendedActions(a) {
    const acts = [];
    const oos = stockOutLines(a).map((l) => productName(l.productId));
    const expiring = auditLines(a).filter((l) => (l.conditionBreakdown.expired || 0) + (l.conditionBreakdown.nearExpiry || 0) > 0).map((l) => productName(l.productId));
    const damaged = auditLines(a).filter((l) => (l.conditionBreakdown.damaged || 0) > 0).map((l) => productName(l.productId));
    const notFound = auditLines(a).filter((l) => l.status === "not_found").map((l) => productName(l.productId));
    const over = auditLines(a).filter(isOverstock).map((l) => productName(l.productId));

    if (oos.length) acts.push({ sev: "high", ic: "📦", title: "Replenish", text: plural(oos.length, "product") + " below expected stock — " + oos.join(", "), replenish: true });
    if (expiring.length) acts.push({ sev: "mid", ic: "🧹", title: "Pull / rotate", text: plural(expiring.length, "product") + " approaching or past expiry — " + expiring.join(", "), pull: true });
    if (damaged.length) acts.push({ sev: "mid", ic: "⚠️", title: "Raise damage claim", text: damaged.join(", ") });
    if (notFound.length) acts.push({ sev: "mid", ic: "❓", title: "Verify next visit", text: plural(notFound.length, "product") + " couldn't be checked — " + notFound.join(", ") });
    if (over.length) acts.push({ sev: "low", ic: "📉", title: "Slow-moving / overstock", text: over.join(", ") + " — consider a push offer" });

    if (a.followUp && a.followUp.required) acts.push({ sev: "mid", ic: "🚩", title: "Follow-up scheduled", text: a.followUp.note || "Return visit flagged", done: true });
    else if (flaggedLines(a).length) acts.push({ sev: "low", ic: "🚩", title: "Consider a follow-up visit", text: "This audit found flagged items.", flag: a.id });

    if (a.partial && a.partial.isPartial) {
      const why = (PARTIAL_REASONS.find((r) => r.k === a.partial.reason) || { label: "reason not given" }).label;
      acts.push({ sev: "low", ic: "🕓", title: "Finish the coverage", text: `Only part of the assortment was checked — ${why.toLowerCase()}.` });
    }
    if (!acts.length) acts.push({ sev: "none", ic: "✅", title: "All clear", text: "No issues found — the shelf looked healthy." });
    return acts;
  }

  function renderComplete() {
    const customer = loadCustomer(CURRENT.params.customerId);
    const audits = auditsFor(CURRENT.params.customerId);
    const a = audits.find((x) => x.id === CURRENT.params.auditId) || audits[0];
    if (!customer || !a) { go("customers", {}, true); return; }

    const score = computeAuditScore(a);
    const cov = auditCoverage(a);
    const audited = auditLines(a).filter((l) => l.status === "audited");
    const matched = audited.filter((l) => lineVariance(l) === 0 && !isStockOutRisk(l) && dominantCondition(l) === "ok").length;
    const totals = conditionTotals(a);
    const shelfPct = shelfHealthPct(a);
    const acts = recommendedActions(a);
    const out = a.outcome ? outcomeMeta(a.outcome) : null;

    frame(`
      <div class="sah-page-head">
        <h1>Audit Complete ✓</h1>
        <p>${esc(placeLine(customer, a.locationId))} · ${esc(fmtDate(a.at))}<br>${esc(a.auditor || AUDITOR.name)} · ${esc(purposeMeta(a.purpose).label)}</p>
      </div>

      <div class="score-card">
        <div class="score-ring ${score.cls}">${score.score}</div>
        <div>
          <div class="lbl">Customer Health Score</div>
          <div class="desc">${esc(score.label)}</div>
          <div class="sub">${cov.audited} of ${cov.expected} products counted${a.partial && a.partial.isPartial ? " · partial visit" : ""}</div>
          ${out ? `<div class="outcome">${out.icon} ${esc(out.label)}</div>` : ""}
        </div>
      </div>

      <div class="sec-label">Health Breakdown</div>
      ${healthAxesHTML(a)}

      <div class="sec-label">What This Visit Found</div>
      <div class="rv-card">
        <div class="rv-line ${matched ? "ok" : "muted"}"><span class="ic">✓</span><span class="txt">Matched</span><b>${matched}</b></div>
        <div class="rv-line ${varianceLines(a).length ? "warn" : "muted"}"><span class="ic">⚠</span><span class="txt">Variances</span><b>${varianceLines(a).length}</b></div>
        <div class="rv-line ${stockOutLines(a).length ? "danger" : "muted"}"><span class="ic">●</span><span class="txt">Stock-out risks</span><b>${stockOutLines(a).length}</b></div>
        <div class="rv-line ${totals.nearExpiry ? "nearExpiry" : "muted"}"><span class="ic">⏰</span><span class="txt">Units near expiry</span><b>${totals.nearExpiry}</b></div>
        <div class="rv-line ${totals.expired ? "expired" : "muted"}"><span class="ic">⏳</span><span class="txt">Units expired</span><b>${totals.expired}</b></div>
        <div class="rv-line ${totals.damaged ? "damaged" : "muted"}"><span class="ic">⚠️</span><span class="txt">Units damaged</span><b>${totals.damaged}</b></div>
        <div class="rv-line ${shelfPct == null ? "muted" : shelfPct >= 90 ? "ok" : "warn"}"><span class="ic">🧺</span><span class="txt">Shelf availability</span><b>${shelfPct == null ? "—" : shelfPct + "%"}</b></div>
      </div>

      ${a.finalNote ? `<div class="sec-label">Final Note</div><div class="rv-card"><p class="final-note">"${esc(a.finalNote)}"</p></div>` : ""}

      <div class="sec-label">Recommended Actions</div>
      <div class="action-list">
        ${acts.map((x) => `
          <div class="action-item sev-${x.sev}">
            <span class="ic">${x.ic}</span>
            <span class="txt"><b>${x.title}</b>${esc(x.text)}</span>
            ${x.flag ? `<button data-flag="${x.flag}">Flag</button>` : x.done ? `<button disabled>Flagged</button>` : x.replenish ? `<button data-replenish="1">Replenish</button>` : ""}
          </div>`).join("")}
      </div>
    `, { foot: `<div class="sah-foot"><div class="inner">
        <button class="btn-wide ghost" id="doneList">Customer List</button>
        <button class="btn-wide primary" id="doneCust">Customer Health</button>
      </div></div>` });

    $("#doneList", PAGE).onclick = () => go("customers", {}, true);
    $("#doneCust", PAGE).onclick = () => go("customer-detail", { customerId: customer._id }, true);
    PAGE.querySelectorAll("[data-flag]").forEach((b) => (b.onclick = () => {
      a.followUp = { required: true, note: "Flagged from Complete Audit summary.", at: new Date().toISOString() };
      AuditStore.save();
      toast("Follow-up flagged.");
      renderComplete();
    }));
    // Replenishment lives in Sales Orders, which is a different module and a
    // different repo — this hands off rather than pretending to place an order.
    PAGE.querySelectorAll("[data-replenish]").forEach((b) => (b.onclick = () => toast("Replenishment request drafted — continue in Sales Orders.", "info")));
  }

  /* ------------------------------------------------------------------ mount */

  function mount() {
    PAGE = mountShell($("#app"), { screen: "stock-audit", crumb: "Stock Audit & Health", tenant: SEED.tenant });
    LocationStore.load();
    DraftStore.load();
    AuditStore.load();

    const params = new URLSearchParams(location.search);
    const id = params.get("customer");
    if (id) go("customer-detail", { customerId: id }, true);
    else go("customers", {}, true);
  }

  window.SAH = { mount };
})();
