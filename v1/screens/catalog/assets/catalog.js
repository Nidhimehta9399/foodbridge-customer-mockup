/* ==========================================================================
   Catalog — HTML replica of the live b2bgreens Catalog module.
   Vanilla JS, no build step. FB.mountCatalog().
   Screens:
     • Catalog list (table + mobile cards, Bulk Action, Create Catalog).
     • Create / Update Catalog drawer — four tabs:
         Basic Info · Select Customers · Select Products · Set Pricing.
     • Select Catalog Pricing modal (units + conversion + GST + prices).
     • Create Campaign Links flow (pick customers → generate → ready list).
   Reuses the Products design system (assets/styles.css) + assets/catalog.css.
   Seed data: assets/data.js (products/categories) + assets/catalog-data.js.
   ========================================================================== */
(function () {
  try { if (window.self !== window.top) document.documentElement.classList.add("fb-embedded"); } catch (e) { document.documentElement.classList.add("fb-embedded"); }
  const EMBEDDED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  let _overlayCount = 0;
  function setOverlay(on) {
    _overlayCount = Math.max(0, _overlayCount + (on ? 1 : -1));
    if (!EMBEDDED) return;
    try { window.parent.postMessage({ source: "fb-module", type: "overlay", active: _overlayCount > 0 }, "*"); } catch (e) {}
  }

  const SEED = window.SEED || { products: [], categories: [], customers: [], catalogs: [] };
  const PAGE_SIZE = 10;
  const UNITS = ["Bottle", "Box", "Pc", "KG", "gm", "L", "ml", "Dozen", "Pack", "Roll"];

  // ── Icons ─────────────────────────────────────────────────────────────────
  const I = {
    dash: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
    box: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8V16a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>',
    users: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    cart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
    truck: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
    pin: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    ret: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
    inv: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V7l9-4 9 4v14"/><path d="M3 21h18M9 21v-6h6v6"/></svg>',
    user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    bag: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" opacity=".18"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    plus: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>',
    trashBig: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    chevR: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    bulk: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    tag: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 2.6a2 2 0 0 0-1.4-.6H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.4 8.4a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    sendBig: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    checkCircle: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4 12 14.01l-3-3"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    bell: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    pkg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8V16a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z"/><path d="m3.3 7 8.7 5 8.7-5"/></svg>',
    pkgBig: '<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8V16a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>',
    qr: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M21 21v-3M17 21h.01"/></svg>',
    upload: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></svg>',
    download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>',
    sheet: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0f9d58" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18M4 9h16M4 15h16M14 3v18"/></svg>',
    file: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    empty: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  };

  const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const taxLabel = (r) => (r > 0 ? r + "% excl. tax" : "0% tax");
  const inclTax = (p, r) => Math.round(p * (1 + (r || 0) / 100) * 100) / 100;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const attr = (s) => esc(s).replace(/'/g, "&#39;");
  const isMobile = () => (window.matchMedia ? window.matchMedia("(max-width: 768px)").matches : window.innerWidth <= 768);
  const byId = (arr, id) => arr.find((x) => x.id === id);
  const productById = (id) => byId(SEED.products, id);
  const customerById = (id) => byId(SEED.customers, id);
  function toast(msg, tone) { const t = document.getElementById("toast"); if (!t) return; t.className = "toast show" + (tone ? " " + tone : ""); t.textContent = msg; clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = "toast"), 2600); }

  // ── File / CSV helpers ────────────────────────────────────────────────────
  function download(filename, text, mime) { const blob = new Blob([text], { type: mime || "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
  function toCSV(headers, rows) { const q = (v) => { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; return [headers.map(q).join(","), ...rows.map((r) => r.map(q).join(","))].join("\r\n"); }
  function toXLS(headers, rows) { const cell = (v) => `<td>${esc(v)}</td>`; return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("")}</tbody></table></body></html>`; }
  function parseCSV(text) {
    const rows = []; let i = 0, field = "", row = [], inQ = false;
    while (i < text.length) { const c = text[i];
      if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
      else { if (c === '"') inQ = true; else if (c === ",") { row.push(field); field = ""; } else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; } else if (c !== "\r") field += c; }
      i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
  }
  // A catalog's pricing rows for export / import preview.
  const PRICE_HEADERS = ["Article No", "Product", "Base Price", "Unit", "Catalog Price"];
  function catalogPriceRows(catalog) {
    return (catalog.products || []).map((id) => { const p = productById(id); if (!p) return null; const cp = catalog.pricing && catalog.pricing[id] != null ? catalog.pricing[id] : p.price; return { id, articleNo: p.articleNo, name: p.name, base: p.price, unit: p.unit, catalog: cp }; }).filter(Boolean);
  }
  function exportCatalog(catalog, kind) {
    const rows = catalogPriceRows(catalog).map((r) => [r.articleNo, r.name, r.base.toFixed(2), r.unit, Number(r.catalog).toFixed(2)]);
    const base = catalog.name.toLowerCase().replace(/\s+/g, "-") + "-pricing";
    if (kind === "excel") { download(base + ".xls", toXLS(PRICE_HEADERS, rows), "application/vnd.ms-excel"); toast(`Exported "${catalog.name}" to Excel`, "ok"); }
    else { download(base + ".csv", toCSV(PRICE_HEADERS, rows), "text/csv"); toast(`Exported "${catalog.name}" to CSV`, "ok"); }
  }
  function exportMenu(anchor, catalog) {
    popover(anchor, [
      { icon: I.sheet, title: "Download Excel", onClick: () => exportCatalog(catalog, "excel") },
      { icon: I.file, title: "Download CSV", onClick: () => exportCatalog(catalog, "csv") },
    ], { title: "Export Catalog" });
  }

  // ── General modal (reuses .modal-scrim / .modal-panel from styles.css) ─────
  function modal({ title, subtitle, headExtra, body, footer, wide, panelClass }) {
    const scrim = document.createElement("div"); scrim.className = "modal-scrim";
    scrim.innerHTML = `<div class="modal-panel ${wide ? "wide" : ""} ${panelClass || ""}" role="dialog" aria-modal="true">
      <div class="mp-head"><div class="mp-title"><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>${headExtra || ""}<button class="x" data-close>${I.x}</button></div>
      <div class="mp-body">${body}</div>${footer ? `<div class="mp-foot">${footer}</div>` : ""}</div>`;
    document.body.appendChild(scrim); setOverlay(true);
    requestAnimationFrame(() => scrim.classList.add("show"));
    let done = false;
    const close = () => { if (done) return; done = true; setOverlay(false); scrim.classList.remove("show"); setTimeout(() => scrim.remove(), 200); };
    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
    scrim.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    return { scrim, panel: scrim.querySelector(".modal-panel"), close };
  }

  function confirmDelete({ name, bulk, count, entity, onConfirm }) {
    const scrim = document.createElement("div"); scrim.className = "modal-scrim";
    const msg = bulk
      ? `You are about to permanently remove <b>${count}</b> selected ${entity}${count === 1 ? "" : "s"}. This can't be undone.`
      : `Deleting it will remove it from all listings and you won't be able to recover it later.`;
    scrim.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><div class="modal-ic">${I.trashBig}</div>
      <h2>Delete${bulk ? "" : ` <span class="em">${esc(name)}</span>`}?</h2><p>${msg}</p>
      <div class="modal-foot"><button class="btn" data-keep style="border-color:var(--line)">Cancel</button><button class="btn btn-danger" data-del>Delete</button></div></div>`;
    document.body.appendChild(scrim); setOverlay(true);
    requestAnimationFrame(() => scrim.classList.add("show"));
    let done = false;
    const close = () => { if (done) return; done = true; setOverlay(false); scrim.classList.remove("show"); setTimeout(() => scrim.remove(), 200); };
    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
    scrim.querySelector("[data-keep]").addEventListener("click", close);
    scrim.querySelector("[data-del]").addEventListener("click", () => { onConfirm(); close(); });
  }

  // ── Mobile bottom sheet (for row action menu) ──────────────────────────────
  function sheet(title, items) {
    const scrim = document.createElement("div"); scrim.className = "sheet-scrim";
    scrim.innerHTML = `<div class="sheet"><div class="grip"></div><div class="sheet-head"><span style="width:34px"></span><h3>${esc(title)}</h3><button class="s-x">${I.x}</button></div><div class="sheet-body"></div></div>`;
    document.body.appendChild(scrim);
    const close = () => { scrim.classList.remove("show"); setTimeout(() => scrim.remove(), 280); };
    scrim.querySelector(".s-x").addEventListener("click", close);
    const body = scrim.querySelector(".sheet-body");
    items.forEach((it) => {
      if (it.sep) return;
      const b = document.createElement("button"); b.className = "sheet-item" + (it.danger ? " danger" : "");
      b.innerHTML = `<span class="si-ic">${it.icon || ""}</span><span class="si-txt"><b>${esc(it.title)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span>`;
      b.addEventListener("click", () => { close(); it.onClick && it.onClick(); });
      body.appendChild(b);
    });
    requestAnimationFrame(() => scrim.classList.add("show"));
    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  }
  // Desktop popover / mobile sheet for Bulk Action.
  let openPop = null;
  function closePop() { if (openPop) { openPop.remove(); openPop = null; document.removeEventListener("click", onDoc, true); } }
  function onDoc(e) { if (openPop && !openPop.contains(e.target)) closePop(); }
  function popover(anchor, items, opts) {
    if (isMobile()) { sheet((opts && opts.title) || "Actions", items); return; }
    closePop();
    const el = document.createElement("div"); el.className = "popover";
    items.forEach((it) => {
      if (it.sep) { const s = document.createElement("div"); s.className = "m-sep"; el.appendChild(s); return; }
      const b = document.createElement("button"); b.type = "button"; b.className = "m-item" + (it.danger ? " danger" : "");
      b.innerHTML = `${it.icon || ""}<span>${esc(it.title)}</span>`;
      b.addEventListener("click", (ev) => { ev.stopPropagation(); closePop(); it.onClick && it.onClick(); });
      el.appendChild(b);
    });
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect(), pw = el.offsetWidth, ph = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)) + "px";
    el.style.top = (r.bottom + ph + 8 <= window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - ph - 6)) + "px";
    openPop = el; setTimeout(() => document.addEventListener("click", onDoc, true), 0);
  }

  function footer(buttons) {
    let f = document.getElementById("mfooter");
    if (!f) { f = document.createElement("div"); f.className = "mobile-footer"; f.id = "mfooter"; document.querySelector(".main").appendChild(f); }
    f.innerHTML = buttons.map((b, i) => `<button class="mf-btn ${b.cls || ""}" data-i="${i}"><span class="mf-ic">${b.icon}</span>${esc(b.label)}</button>`).join("");
    f.querySelectorAll(".mf-btn").forEach((el) => el.addEventListener("click", () => buttons[+el.dataset.i].onClick(el)));
  }

  // ── Shell / sidebar (same chrome as the products module) ───────────────────
  const SIDEBAR = [
    { label: "Dashboard", icon: I.dash },
    { label: "Product Master", icon: I.box, group: true, children: [{ label: "Finished Goods", href: "all-products.html" }, { label: "Product Categories", href: "categories.html" }, { label: "Raw Materials", href: "raw-materials.html" }, { label: "Image Gallery", href: "image-directory.html" }] },
    { label: "Customer Management", icon: I.users, group: true, children: [{ label: "B2B Customers" }, { label: "Retail Customers" }, { label: "Catalog", key: "catalog", href: "catalog.html" }] },
    { label: "Sales Orders", icon: I.cart },
    { label: "Distribution & Logistics", icon: I.truck, group: true, children: [{ label: "Route Planning" }, { label: "Delivery Management" }, { label: "Logistic Returns" }] },
    { label: "Production", icon: I.inv, group: true, children: [{ label: "Batch Management" }, { label: "Semifinished Products" }, { label: "Configure Recipe" }] },
    { label: "Route Delivery", icon: I.pin },
    { label: "Store QR Code", icon: I.qr },
  ];
  function shell(active, title) {
    const nav = SIDEBAR.map((item) => {
      if (!item.group) return `<div class="nav-row" data-demo="${attr(item.label)}"><span class="ic">${item.icon}</span>${esc(item.label)}</div>`;
      const hasActive = (item.children || []).some((c) => c.key === active);
      const subs = (item.children || []).map((c) => c.key ? `<a class="sub ${c.key === active ? "active" : ""}" href="${c.href}"><span class="dash">–</span>${esc(c.label)}</a>` : (c.href ? `<a class="sub" href="${c.href}"><span class="dash">–</span>${esc(c.label)}</a>` : `<div class="sub" data-demo="${attr(c.label)}"><span class="dash">–</span>${esc(c.label)}</div>`)).join("");
      return `<div class="nav-row group open ${hasActive ? "active-parent" : ""}" data-toggle><span class="ic">${item.icon}</span>${esc(item.label)}<span class="chev">${I.chev}</span></div><div class="nav-sub">${subs}</div>`;
    }).join("");
    return `<div class="scrim" id="scrim"></div>
      <aside class="sidebar" id="sidebar"><div class="brand"><span class="logo">${I.bag}</span><span class="name">Murli</span></div><nav class="nav">${nav}</nav></aside>
      <div class="main"><div class="topbar"><button class="hamburger" id="hamburger" title="Collapse sidebar">${I.menu}</button><span class="topbar-brand">${I.bag}</span><div class="page-title">${esc(title)}</div><div class="spacer"></div><div class="user"><div class="who"><b>Mahesh</b><br><small>Admin</small></div><div class="av">${I.user}</div></div></div><div class="content" id="content"></div></div>
      <div class="toast" id="toast"></div>`;
  }
  function wireShell() {
    const sb = document.getElementById("sidebar"), scrim = document.getElementById("scrim");
    document.getElementById("hamburger")?.addEventListener("click", () => {
      // Embedded in the platform, the module's own sidebar is clipped away, so the
      // hamburger drives the PLATFORM's sidebar collapse (postMessage). Standalone,
      // it opens this module's own off-canvas sidebar.
      if (EMBEDDED) { try { window.parent.postMessage({ source: "fb-module", type: "toggle-sidebar" }, "*"); } catch (e) {} }
      else { sb.classList.add("open"); scrim.classList.add("show"); }
    });
    scrim?.addEventListener("click", () => { sb.classList.remove("open"); scrim.classList.remove("show"); });
    sb.querySelectorAll("[data-toggle]").forEach((row) => row.addEventListener("click", () => { const sub = row.nextElementSibling; if (!sub || !sub.classList.contains("nav-sub")) return; const open = row.classList.toggle("open"); sub.style.display = open ? "" : "none"; }));
    sb.querySelectorAll("[data-demo]").forEach((el) => el.addEventListener("click", () => toast(`${el.dataset.demo} lives in another module — this prototype covers Catalog`)));
  }
  const pageHead = (t) => `<div class="page-head"><span class="ph-ic">${I.tag}</span><h1>${esc(t)}</h1></div>`;

  function pager(total, page, onGo) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1, to = Math.min(total, page * PAGE_SIZE);
    let btns = ""; for (let i = 1; i <= pages; i++) btns += `<button class="pg ${i === page ? "active" : ""}" data-pg="${i}">${i}</button>`;
    const el = document.createElement("div"); el.className = "pager";
    el.innerHTML = `<span class="info">Showing ${from}-${to} of ${total}</span><div class="pages"><button class="pg" data-pg="${page - 1}" ${page === 1 ? "disabled" : ""}>‹</button>${btns}<button class="pg" data-pg="${page + 1}" ${page >= pages ? "disabled" : ""}>›</button></div>`;
    el.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => { const p = +b.dataset.pg; if (p >= 1 && p <= pages && p !== page) onGo(p); }));
    return el;
  }

  /* =========================================================================
     Catalog list
     ========================================================================= */
  function screenCatalog() {
    const state = { search: "", page: 1, selected: new Set() };
    const content = document.getElementById("content");
    content.innerHTML = `
      ${pageHead("Catalog")}
      <div class="toolbar"><button class="btn" id="bulk">${I.bulk} Bulk Action <span class="caret">${I.chev}</span></button><div class="grow"></div><button class="btn btn-primary" id="create">${I.plus} Create Catalog</button></div>
      <div class="filters"><div class="search">${I.search}<input id="q" type="search" placeholder="Search by Catalog name"></div></div>
      <div id="list"></div>`;
    function filtered() { const q = state.search.trim().toLowerCase(); return SEED.catalogs.filter((c) => !q || c.name.toLowerCase().includes(q)); }
    function render() {
      const rows = filtered(); const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); if (state.page > pages) state.page = pages;
      const slice = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
      const list = document.getElementById("list");
      if (rows.length === 0) { list.innerHTML = `<div class="table-wrap"><div class="empty"><div class="ic">${I.empty}</div><h2>No catalogs found</h2><p>Try another search, or create a new catalog.</p></div></div>`; footerBar(); return; }
      const allChecked = slice.length && slice.every((c) => state.selected.has(c.id));
      const tbody = slice.map((c) => `<tr>
        <td><input class="checkbox row-check" type="checkbox" data-id="${c.id}" ${state.selected.has(c.id) ? "checked" : ""}></td>
        <td><div class="cat-name">${I.tag}<b>${esc(c.name)}</b></div></td>
        <td>${c.description ? esc(c.description) : "-"}</td>
        <td><span class="count-cell">${I.users} ${c.customerCount}</span></td>
        <td><span class="count-cell">${I.pkg} ${c.productCount}</span></td>
        <td>${esc(c.lastModified)}</td>
        <td><div class="row-actions"><button class="icon-btn" data-act="edit" data-id="${c.id}" title="Edit">${I.edit}</button><button class="icon-btn danger" data-act="del" data-id="${c.id}" title="Delete">${I.trash}</button><button class="icon-btn send" data-act="send" data-id="${c.id}" title="Send Campaign Links">${I.send}</button></div></td>
        <td><div class="row-actions ie"><button class="icon-btn" data-act="import" data-id="${c.id}" title="Import CSV / Excel">${I.upload}</button><button class="icon-btn" data-act="export" data-id="${c.id}" title="Export">${I.download}</button></div></td>
      </tr>`).join("");
      const cards = slice.map((c) => `<div class="clcard" data-id="${c.id}">
        <div class="cl-top"><span class="icheckwrap"><input class="checkbox row-check" type="checkbox" data-id="${c.id}" ${state.selected.has(c.id) ? "checked" : ""}></span>
          <div class="cl-main"><div class="cl-name">${I.tag}<b>${esc(c.name)}</b></div><div class="cl-mod">Modified ${esc(c.lastModified)}</div></div></div>
        <div class="cl-stats"><div class="st">${I.users}<b>${c.customerCount}</b><span>Customers</span></div><div class="st">${I.pkg}<b>${c.productCount}</b><span>Products</span></div></div>
        <div class="cl-actbar"><button class="icon-btn" data-act="edit" data-id="${c.id}" title="Edit">${I.edit}</button><button class="icon-btn danger" data-act="del" data-id="${c.id}" title="Delete">${I.trash}</button><button class="icon-btn send" data-act="send" data-id="${c.id}" title="Send Campaign Links">${I.send}</button><button class="icon-btn" data-act="import" data-id="${c.id}" title="Import">${I.upload}</button><button class="icon-btn" data-act="export" data-id="${c.id}" title="Export">${I.download}</button></div>
      </div>`).join("");
      list.innerHTML = `<div class="table-wrap desktop-only"><div class="table-scroll"><table class="grid catalog-grid"><thead><tr><th><input class="checkbox" id="selall" type="checkbox" ${allChecked ? "checked" : ""}></th><th>Name</th><th>Description</th><th>Customers</th><th>Products</th><th>Last Modified</th><th style="text-align:right">Actions</th><th style="text-align:center">Import/Export</th></tr></thead><tbody>${tbody}</tbody></table><div class="pagerslot"></div></div></div><div class="cards">${cards}</div>`;
      const s = list.querySelector(".pagerslot"); if (s) s.replaceWith(pager(rows.length, state.page, (p) => { state.page = p; render(); }));
      list.querySelectorAll(".row-check").forEach((cb) => cb.addEventListener("change", () => { cb.checked ? state.selected.add(cb.dataset.id) : state.selected.delete(cb.dataset.id); render(); }));
      document.getElementById("selall")?.addEventListener("change", (e) => { slice.forEach((c) => (e.target.checked ? state.selected.add(c.id) : state.selected.delete(c.id))); render(); });
      list.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
        const c = byId(SEED.catalogs, b.dataset.id), act = b.dataset.act;
        if (act === "edit") openCatalogDrawer(c, render);
        else if (act === "send") openCampaignLinks(c);
        else if (act === "import") openImportPreview(c, render);
        else if (act === "export") exportMenu(b, c);
        else confirmDelete({ name: c.name, entity: "catalog", onConfirm: () => { SEED.catalogs = SEED.catalogs.filter((x) => x.id !== c.id); window.SEED.catalogs = SEED.catalogs; state.selected.delete(c.id); render(); toast(`"${c.name}" deleted`, "ok"); } });
      }));
      footerBar();
    }
    function bulkMenu(anchor) {
      const ids = [...state.selected]; const need = () => { if (!ids.length) { toast("Select catalogs first.", "err"); return false; } return true; };
      popover(anchor, [
        { icon: I.trash, title: "Delete", sub: "Permanently remove the selected catalogs", danger: true, onClick: () => { if (!need()) return; confirmDelete({ bulk: true, count: ids.length, entity: "catalog", onConfirm: () => { SEED.catalogs = SEED.catalogs.filter((c) => !state.selected.has(c.id)); window.SEED.catalogs = SEED.catalogs; state.selected.clear(); render(); toast(`${ids.length} catalogs deleted`, "ok"); } }); } },
      ], { title: "Catalog Actions" });
    }
    function footerBar() {
      footer([
        { icon: I.bulk, label: "Bulk Action", onClick: (el) => bulkMenu(el) },
        { icon: I.plus, label: "Create", cls: "primary", onClick: () => openCatalogDrawer(null, render) },
      ]);
    }
    let deb;
    document.getElementById("q").addEventListener("input", (e) => { clearTimeout(deb); deb = setTimeout(() => { state.search = e.target.value; state.page = 1; render(); }, 200); });
    document.getElementById("create").addEventListener("click", () => openCatalogDrawer(null, render));
    document.getElementById("bulk").addEventListener("click", (e) => bulkMenu(e.currentTarget));
    render();
  }

  /* =========================================================================
     Create / Update Catalog drawer  (4 tabs)
     ========================================================================= */
  const CAT_ORDER = ["Water", "Soda", "Bread", "Sandwitch", "Donut", "Toast", "Cream Roll", "Cookies", "Cake", "Milk Products", "Fruite", "Fruits", "Parent", "Raw Material"];
  const orderedCategories = () => SEED.categories.slice().sort((a, b) => { const ia = CAT_ORDER.indexOf(a.name), ib = CAT_ORDER.indexOf(b.name); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  const productsInCategory = (catName) => SEED.products.filter((p) => p.categoryTop === catName);
  const productsInSub = (subName) => SEED.products.filter((p) => p.category === subName);

  function openCatalogDrawer(catalog, onDone) {
    const editing = !!catalog;
    const st = {
      tab: "basic",
      name: catalog ? catalog.name : "",
      description: catalog ? catalog.description : "",
      customers: new Set(catalog ? catalog.customers : []),
      products: new Set(catalog ? catalog.products : []),
      pricing: Object.assign({}, catalog ? catalog.pricing : {}),
      mode: "category",
      expanded: new Set(),
    };
    const TABS = [
      { key: "basic", label: "Basic Info" },
      { key: "customers", label: "Select Customers" },
      { key: "products", label: "Select Products" },
      { key: "pricing", label: "Set Pricing" },
    ];
    const scrim = document.createElement("div"); scrim.className = "cat-drawer-scrim";
    const panel = document.createElement("div"); panel.className = "cat-drawer";
    panel.innerHTML = `
      <div class="cd-head"><div class="cd-title"><h3>${editing ? "Update Catalog" : "Add Catalog"}</h3><p>${editing ? "Update Catalog info, combinations and extras." : "Add your Catalog and necessary information from here"}</p></div><button class="cd-x">${I.x}</button></div>
      <div class="cd-tabs">${TABS.map((t) => `<button class="cd-tab" data-tab="${t.key}">${esc(t.label)}</button>`).join("")}</div>
      <div class="cd-body" id="cdBody"></div>
      <div class="cd-foot" id="cdFoot"></div>`;
    document.body.appendChild(scrim); document.body.appendChild(panel); setOverlay(true);
    // Trigger the slide-in. rAF for a smooth first frame, plus a timeout fallback
    // because rAF can be throttled inside a backgrounded/embedded iframe.
    const openNow = () => { scrim.classList.add("show"); panel.classList.add("open"); };
    requestAnimationFrame(openNow); setTimeout(openNow, 30);
    let done = false;
    const close = () => { if (done) return; done = true; setOverlay(false); scrim.classList.remove("show"); panel.classList.remove("open"); setTimeout(() => { scrim.remove(); panel.remove(); }, 260); };
    panel.querySelector(".cd-x").addEventListener("click", close);
    scrim.addEventListener("click", close);
    const body = panel.querySelector("#cdBody"), foot = panel.querySelector("#cdFoot");

    function setTab(key) { st.tab = key; renderTabs(); renderBody(); renderFoot(); body.scrollTop = 0; }
    function renderTabs() {
      panel.querySelectorAll(".cd-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === st.tab));
    }
    panel.querySelectorAll(".cd-tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

    // ---- Footer per tab ----
    function renderFoot() {
      const idx = TABS.findIndex((t) => t.key === st.tab);
      const back = idx > 0 ? `<button class="btn cd-back" data-back>${st.tab === "pricing" ? "Back to Products" : "Back"}</button>` : "";
      let primary;
      if (st.tab === "basic") primary = `<button class="btn btn-primary cd-next" data-next>Next: Select Customers</button>`;
      else if (st.tab === "customers") primary = `<button class="btn btn-primary cd-next" data-next>Next: Select Products</button>`;
      else if (st.tab === "products") primary = `<button class="btn btn-primary cd-next" data-next>Continue to Pricing (${st.products.size} Products)</button>`;
      else primary = `<button class="btn btn-primary cd-save" data-save>${editing ? "Update Catalog" : "Create Catalog"}</button>`;
      foot.innerHTML = `<button class="btn cd-cancel" data-cancel>Cancel</button>${back}${primary}`;
      foot.querySelector("[data-cancel]").addEventListener("click", close);
      foot.querySelector("[data-back]")?.addEventListener("click", () => setTab(TABS[Math.max(0, idx - 1)].key));
      foot.querySelector("[data-next]")?.addEventListener("click", () => {
        if (st.tab === "basic" && !st.name.trim()) { toast("Catalog name is required.", "err"); return; }
        setTab(TABS[Math.min(TABS.length - 1, idx + 1)].key);
      });
      foot.querySelector("[data-save]")?.addEventListener("click", save);
    }
    function save() {
      if (!st.name.trim()) { toast("Catalog name is required.", "err"); setTab("basic"); return; }
      const payload = {
        name: st.name.trim(), description: st.description.trim(),
        customers: [...st.customers], products: [...st.products], pricing: Object.assign({}, st.pricing),
        customerCount: st.customers.size, productCount: st.products.size,
        lastModified: new Date().toLocaleDateString("en-GB"),
      };
      if (editing) { Object.assign(catalog, payload); toast(`"${payload.name}" updated`, "ok"); }
      else { SEED.catalogs.unshift(Object.assign({ id: "cat-" + Date.now() }, payload)); window.SEED.catalogs = SEED.catalogs; toast(`"${payload.name}" created`, "ok"); }
      close(); onDone && onDone();
    }

    // ---- Tab bodies ----
    function renderBody() {
      if (st.tab === "basic") return renderBasic();
      if (st.tab === "customers") return renderCustomers();
      if (st.tab === "products") return renderProducts();
      return renderPricing();
    }

    function renderBasic() {
      body.innerHTML = `<div class="cd-form">
        <div class="cd-row"><label>Catalog Name <span class="req">*</span></label><div class="ctrl"><input id="cName" placeholder="Name" value="${attr(st.name)}"></div></div>
        <div class="cd-row"><label>Description</label><div class="ctrl"><textarea id="cDesc" placeholder="Description">${esc(st.description)}</textarea></div></div>
      </div>`;
      body.querySelector("#cName").addEventListener("input", (e) => (st.name = e.target.value));
      body.querySelector("#cDesc").addEventListener("input", (e) => (st.description = e.target.value));
    }

    // ── Select Customers tab ──
    function renderCustomers() {
      let q = "";
      body.innerHTML = `<div class="cd-pane">
        <div class="pane-topbar"><span class="sel-badge">${st.customers.size} customers selected</span><div class="pane-actions"><button class="linklike" id="selAll">Select All</button><button class="linklike" id="clrAll">Clear All</button></div></div>
        <div class="search cd-search">${I.search}<input id="custSearch" type="search" placeholder="Search by name, phone, or email..."></div>
        <div class="cust-grid" id="custGrid"></div>
      </div>`;
      const grid = body.querySelector("#custGrid");
      const drawGrid = () => {
        const list = SEED.customers.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || String(c.phone).includes(q));
        grid.innerHTML = list.map((c) => `<div class="cust-card ${st.customers.has(c.id) ? "sel" : ""}" data-id="${c.id}"><span class="cc-box"><input type="checkbox" ${st.customers.has(c.id) ? "checked" : ""}></span><div class="cc-main"><div class="cc-name">${esc(c.name)}</div><div class="cc-phone">${esc(c.phone)}</div></div></div>`).join("") || `<div class="pane-empty">No customers match "${esc(q)}".</div>`;
        grid.querySelectorAll(".cust-card").forEach((el) => el.addEventListener("click", () => { const id = el.dataset.id; st.customers.has(id) ? st.customers.delete(id) : st.customers.add(id); syncCust(); }));
      };
      const syncCust = () => { body.querySelector(".sel-badge").textContent = `${st.customers.size} customers selected`; drawGrid(); };
      body.querySelector("#custSearch").addEventListener("input", (e) => { q = e.target.value; drawGrid(); });
      body.querySelector("#selAll").addEventListener("click", () => { SEED.customers.forEach((c) => st.customers.add(c.id)); syncCust(); });
      body.querySelector("#clrAll").addEventListener("click", () => { st.customers.clear(); syncCust(); });
      drawGrid();
    }

    // ── Select Products tab (By Category / Individual) ──
    function renderProducts() {
      body.innerHTML = `<div class="cd-pane">
        <div class="pane-topbar">
          <span class="sel-badge blue">${st.products.size} Products Selected</span>
          <div class="mode-wrap">Selection Mode: <select id="pmode"><option value="category" ${st.mode === "category" ? "selected" : ""}>By Category</option><option value="individual" ${st.mode === "individual" ? "selected" : ""}>Individual</option></select></div>
          <div class="pane-actions right"><button class="linklike" id="pSelAll">Select All</button><button class="linklike" id="pClrAll">Clear All</button></div>
        </div>
        <div id="pmodeBody"></div>
      </div>`;
      body.querySelector("#pmode").addEventListener("change", (e) => { st.mode = e.target.value; drawMode(); });
      body.querySelector("#pSelAll").addEventListener("click", () => { SEED.products.forEach((p) => st.products.add(p.id)); syncProd(); });
      body.querySelector("#pClrAll").addEventListener("click", () => { st.products.clear(); syncProd(); });
      const syncProd = () => { body.querySelector(".sel-badge").textContent = `${st.products.size} Products Selected`; drawMode(); renderFoot(); };
      function drawMode() { st.mode === "category" ? drawByCategory(syncProd) : drawIndividual(syncProd); }
      drawMode();
    }

    function drawByCategory(sync) {
      const holder = body.querySelector("#pmodeBody");
      const cats = orderedCategories();
      const catBody = cats.map((c) => {
        const prods = productsInCategory(c.name);
        const allSel = prods.length && prods.every((p) => st.products.has(p.id));
        const open = st.expanded.has(c.id);
        const subs = (c.children || []);
        return `<div class="catsel ${open ? "open" : ""}" data-cid="${c.id}">
          <div class="catsel-head"><button class="catsel-caret" data-toggle="${c.id}">${I.chevR}</button>
            <div class="catsel-info"><div class="cs-name">${esc(c.name)}</div><div class="cs-count">${c.productCount} Products</div></div>
            <button class="btn tiny ${allSel ? "on" : ""}" data-cat="${c.id}">${allSel ? "Deselect All" : "Select All"}</button></div>
          ${open ? `<div class="catsel-subs">${subs.length ? subs.map((s) => { const sp = productsInSub(s.name); const sAll = sp.length && sp.every((p) => st.products.has(p.id)); return `<div class="subsel"><div class="ss-info"><div class="ss-name">${esc(s.name)}</div><div class="ss-count">${s.productCount} products</div></div><button class="btn tiny ${sAll ? "on" : ""}" data-sub="${attr(s.name)}">${sAll ? "Deselect" : "Select"}</button></div>`; }).join("") : `<div class="subsel-empty">${prods.length} product${prods.length === 1 ? "" : "s"} in this category</div>`}</div>` : ""}
        </div>`;
      }).join("");
      holder.innerHTML = `<div class="prod-split">
        <div class="prod-left"><div class="pl-head"><h4>Categories &amp; Subcategories</h4><button class="btn btn-primary tiny" id="addProd">${I.plus} Add Product</button></div><div class="catsel-list">${catBody}</div></div>
        <div class="prod-right"><h4>Selected Products Preview</h4><div id="selPreview"></div></div>
      </div>`;
      drawPreview(sync);
      holder.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => { const id = b.dataset.toggle; st.expanded.has(id) ? st.expanded.delete(id) : st.expanded.add(id); drawByCategory(sync); }));
      holder.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => { const c = byId(SEED.categories, b.dataset.cat); const prods = productsInCategory(c.name); const allSel = prods.length && prods.every((p) => st.products.has(p.id)); prods.forEach((p) => allSel ? st.products.delete(p.id) : st.products.add(p.id)); sync(); }));
      holder.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => { const sp = productsInSub(b.dataset.sub); const sAll = sp.length && sp.every((p) => st.products.has(p.id)); sp.forEach((p) => sAll ? st.products.delete(p.id) : st.products.add(p.id)); sync(); }));
      holder.querySelector("#addProd").addEventListener("click", () => openAddProduct(sync));
    }
    function drawPreview(sync) {
      const el = body.querySelector("#selPreview"); if (!el) return;
      const ids = [...st.products];
      if (!ids.length) { el.innerHTML = `<div class="preview-empty">${I.pkgBig}<div class="pe-t">No products selected</div><div class="pe-s">Select categories or subcategories to add products</div></div>`; return; }
      el.innerHTML = `<div class="preview-list">${ids.map((id) => { const p = productById(id); if (!p) return ""; return `<div class="prev-card"><div class="pv-main"><div class="pv-name">${esc(p.name)}</div><div class="pv-price">${money(catPrice(p))}/${esc(p.unit)}</div><div class="pv-tax">${taxLabel(p.taxRate)}</div></div><button class="pv-x" data-rm="${id}">${I.x}</button></div>`; }).join("")}</div>`;
      el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { st.products.delete(b.dataset.rm); sync(); }));
    }

    function drawIndividual(sync) {
      const holder = body.querySelector("#pmodeBody");
      let q = "", cat = "", price = "";
      const cats = orderedCategories();
      holder.innerHTML = `<div class="ind-toolbar">
        <div class="search ind-search">${I.search}<input id="iq" type="search" placeholder="Search products..."></div>
        <button class="btn btn-primary tiny" id="addProd">${I.plus} Add Product</button>
        <select class="filter" id="icat"><option value="">All Categories</option>${cats.map((c) => `<option>${esc(c.name)}</option>`).join("")}</select>
        <select class="filter" id="iprice"><option value="">All Prices</option><option value="lo">Under ₹50</option><option value="mid">₹50 – ₹200</option><option value="hi">Over ₹200</option></select>
      </div>
      <div class="ind-table-wrap"><table class="grid ind-table"><thead><tr><th style="width:44px"></th><th>Product</th><th>Category</th><th>Price</th><th>Stock</th></tr></thead><tbody id="iBody"></tbody></table></div>`;
      const draw = () => {
        const list = SEED.products.filter((p) => {
          if (q && !(p.name.toLowerCase().includes(q.toLowerCase()) || String(p.articleNo).toLowerCase().includes(q.toLowerCase()))) return false;
          if (cat && p.categoryTop !== cat) return false;
          if (price === "lo" && !(p.price < 50)) return false;
          if (price === "mid" && !(p.price >= 50 && p.price <= 200)) return false;
          if (price === "hi" && !(p.price > 200)) return false;
          return true;
        });
        holder.querySelector("#iBody").innerHTML = list.map((p) => `<tr data-id="${p.id}"><td><input class="checkbox ip" type="checkbox" data-id="${p.id}" ${st.products.has(p.id) ? "checked" : ""}></td><td class="ip-name">${esc(p.name)}</td><td><span class="chip-cat2">${esc(p.categoryTop)}</span></td><td><div class="price-main">${money(p.price)}/${esc(p.unit)}</div><div class="price-tax">${taxLabel(p.taxRate)}</div></td><td>${p.stockTotal}</td></tr>`).join("") || `<tr><td colspan="5" class="pane-empty">No products match.</td></tr>`;
        holder.querySelectorAll(".ip").forEach((cb) => cb.addEventListener("change", () => { cb.checked ? st.products.add(cb.dataset.id) : st.products.delete(cb.dataset.id); body.querySelector(".sel-badge").textContent = `${st.products.size} Products Selected`; renderFoot(); }));
      };
      holder.querySelector("#iq").addEventListener("input", (e) => { q = e.target.value; draw(); });
      holder.querySelector("#icat").addEventListener("change", (e) => { cat = e.target.value; draw(); });
      holder.querySelector("#iprice").addEventListener("change", (e) => { price = e.target.value; draw(); });
      holder.querySelector("#addProd").addEventListener("click", () => openAddProduct(sync));
      draw();
    }

    // ── Set Pricing tab ──
    function catPrice(p) { return st.pricing[p.id] != null ? st.pricing[p.id] : p.price; }
    function renderPricing() {
      const ids = [...st.products];
      if (!ids.length) { body.innerHTML = `<div class="cd-pane"><div class="pane-empty tall">${I.pkgBig}<div class="pe-t">No products to price</div><div class="pe-s">Go back and select products first.</div></div></div>`; return; }
      const rows = ids.map((id) => { const p = productById(id); if (!p) return ""; const cp = catPrice(p); const margin = p.price ? Math.round(((cp - p.price) / p.price) * 10000) / 100 : 0;
        return `<tr data-id="${id}"><td class="ip-name">${esc(p.name)}</td><td><div class="price-main">${money(p.price)}/${esc(p.unit)}</div><div class="price-tax">${taxLabel(p.taxRate)}</div></td><td><b>${esc(p.unit)}</b></td>
          <td><div class="cprice-cell"><input class="cprice" type="number" min="0" step="0.01" data-id="${id}" value="${cp}"><button class="cprice-edit" data-edit="${id}">${I.edit}</button></div></td>
          <td class="margin ${margin > 0 ? "pos" : margin < 0 ? "neg" : ""}">${margin.toFixed(2)}%</td></tr>`; }).join("");
      body.innerHTML = `<div class="cd-pane"><div class="pane-topbar"><span class="pane-lead">Set custom pricing for selected products</span><span class="sel-badge grey">${ids.length} Products to Price</span></div>
        <div class="price-table-wrap"><table class="grid price-table"><thead><tr><th>Product</th><th>Base Price</th><th>Unit</th><th>Catalog Price</th><th style="text-align:right">Margin</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
      body.querySelectorAll(".cprice").forEach((inp) => inp.addEventListener("input", () => { const id = inp.dataset.id; st.pricing[id] = +inp.value || 0; updateMargin(id); }));
      body.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openPricingModal(productById(b.dataset.edit), (val) => { st.pricing[b.dataset.edit] = val; renderPricing(); })));
    }
    function updateMargin(id) {
      const p = productById(id); const cp = catPrice(p); const margin = p.price ? Math.round(((cp - p.price) / p.price) * 10000) / 100 : 0;
      const tr = body.querySelector(`tr[data-id="${id}"] .margin`); if (tr) { tr.textContent = margin.toFixed(2) + "%"; tr.className = "margin " + (margin > 0 ? "pos" : margin < 0 ? "neg" : ""); }
    }

    renderTabs(); setTab("basic");
  }

  // ── Add Product mini-modal (create a product from inside the catalog) ──────
  function openAddProduct(onAdded) {
    const cats = SEED.categories.map((c) => c.name);
    const m = modal({ title: "Add Product", subtitle: "Add a finished good, then it appears in the selection list.",
      body: `<div class="ap-form">
        <div class="ap-row"><label>Title/Name <span class="req">*</span></label><input id="apName" placeholder="Title/Name"></div>
        <div class="ap-row"><label>Category <span class="req">*</span></label><select id="apCat">${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
        <div class="ap-row two"><div><label>Unit</label><select id="apUnit">${UNITS.map((u) => `<option ${u === "Pc" ? "selected" : ""}>${u}</option>`).join("")}</select></div><div><label>Price <span class="req">*</span></label><input id="apPrice" type="number" min="0" step="0.01" placeholder="0.00"></div></div>
        <div class="ap-row two"><div><label>GST %</label><select id="apGst">${[0, 5, 12, 18, 28].map((r) => `<option>${r}</option>`).join("")}</select></div><div><label>Opening Stock</label><input id="apStock" type="number" min="0" placeholder="0"></div></div>
      </div>`,
      footer: `<button class="btn" data-close style="border-color:var(--line);color:var(--rose-500)">Cancel</button><button class="btn btn-primary" id="apDo">Add &amp; Select</button>` });
    m.panel.querySelector("#apDo").addEventListener("click", () => {
      const name = m.panel.querySelector("#apName").value.trim(); const price = +m.panel.querySelector("#apPrice").value;
      if (!name || !price) { toast("Name and price are required.", "err"); return; }
      const cat = m.panel.querySelector("#apCat").value, unit = m.panel.querySelector("#apUnit").value, gst = +m.panel.querySelector("#apGst").value, stock = +m.panel.querySelector("#apStock").value || 0;
      const id = "p-" + Date.now();
      SEED.products.unshift({ id, name, articleNo: "NEW" + Math.floor(Math.random() * 9000 + 1000), category: cat, categoryTop: cat, price, taxRate: gst, unit, baseUnit: unit, conversionQty: 1, stockTotal: stock, canSell: stock, inOrders: 0, brand: "Murli", active: true, img: "product", packaging: [{ unit, tag: "Smallest Unit", conv: "1 " + unit, price: inclTax(price, gst) }] });
      window.SEED.products = SEED.products;
      m.close(); toast(`"${name}" added`, "ok"); onAdded && onAdded(id);
    });
  }

  /* =========================================================================
     Select Catalog Pricing modal (units + conversion + GST + prices)
     ========================================================================= */
  function openPricingModal(product, onSave) {
    if (!product) return;
    const cur = { smallest: product.unit || "Bottle", base: product.baseUnit && product.baseUnit !== product.unit ? product.baseUnit : "Box", conv: product.conversionQty || 5, gst: product.taxRate || 0, taxType: "Included in Price", price: product.price || 0 };
    const dl = `<datalist id="cpUnitDL">${UNITS.map((u) => `<option>${u}</option>`).join("")}</datalist>`;
    const m = modal({ title: "Select Catalog Pricing", subtitle: "Configure selling units, conversion quantities, GST treatment, and prices.", panelClass: "upm-modal",
      body: `${dl}
        <div class="upm-units">
          <div class="upm-field"><div class="upm-lbl">Smallest Unit <span class="req">*</span></div><div class="upm-hint">e.g. Bottle, Piece, KG</div><input id="cpSmall" list="cpUnitDL" value="${attr(cur.smallest)}"></div>
          <div class="upm-field"><div class="upm-lbl">Base Unit <span class="req">*</span></div><div class="upm-hint">e.g. Box, Carton, Dozen</div><input id="cpBase" list="cpUnitDL" value="${attr(cur.base)}"></div>
        </div>
        <div id="cpExpand"></div>` });
    const expand = m.panel.querySelector("#cpExpand");
    const renderExpand = () => {
      const small = m.panel.querySelector("#cpSmall").value.trim(), base = m.panel.querySelector("#cpBase").value.trim();
      if (!small || !base) { expand.innerHTML = `<button class="upm-save" disabled>SAVE</button>`; return; }
      const SM = small.toUpperCase(), BS = base.toUpperCase();
      expand.innerHTML = `
        <div class="upm-conv-q">How many ${esc(SM)} per ${esc(BS)} ? <span class="req" style="color:var(--rose-500)">*</span></div>
        <div class="upm-conv">1 ${esc(BS)} = <input id="cpConv" type="number" min="1" value="${cur.conv}"> ${esc(SM)}</div>
        <div class="upm-tax"><h4>Tax Settings</h4><div class="sub">Set the GST details for pricing.</div>
          <div class="upm-tax-grid">
            <div><div class="upm-lbl" style="color:#374151">GST Rate (%) <span class="req">*</span></div><select id="cpGst" style="width:100%;height:44px;border:1px solid var(--line);border-radius:8px;padding:0 12px;margin-top:6px;outline:none">${[0, 5, 12, 18, 28].map((r) => `<option value="${r}" ${String(r) === String(cur.gst) ? "selected" : ""}>${r}%</option>`).join("")}</select></div>
            <div><div class="upm-lbl" style="color:#374151">GST Treatment <span class="req">*</span></div><div class="gst-treat" style="margin-top:6px">
              <div class="gst-card ${cur.taxType === "Included in Price" ? "on" : ""}" data-tt="Included in Price"><span class="rb"></span><span><b>Included in Price</b><small>Price already includes GST.</small></span></div>
              <div class="gst-card ${cur.taxType === "Added Separately" ? "on" : ""}" data-tt="Added Separately"><span class="rb"></span><span><b>Added Separately</b><small>GST will be added on top.</small></span></div>
            </div></div>
          </div></div>
        <div class="upm-price"><span class="lbl">Selling Price Per ${esc(SM)}</span><div class="box"><span class="cur">₹</span><input id="cpPrice" type="number" min="0" step="0.01" placeholder="0.00" value="${attr(cur.price)}"></div></div>
        <div class="upm-price"><span class="lbl">Selling Price Per ${esc(BS)}</span><div class="box"><span class="cur">₹</span><input id="cpPriceBase" type="number" min="0" step="0.01" placeholder="0.00"></div></div>
        <button class="upm-save" id="cpSave">SAVE</button>`;
      const conv = () => +m.panel.querySelector("#cpConv").value || 1;
      const syncBase = () => { const p = +m.panel.querySelector("#cpPrice").value || 0; m.panel.querySelector("#cpPriceBase").value = p ? (p * conv()).toFixed(2) : ""; };
      m.panel.querySelector("#cpPrice").addEventListener("input", syncBase);
      m.panel.querySelector("#cpConv").addEventListener("input", syncBase); syncBase();
      m.panel.querySelectorAll(".gst-card").forEach((c) => c.addEventListener("click", () => { cur.taxType = c.dataset.tt; m.panel.querySelectorAll(".gst-card").forEach((x) => x.classList.toggle("on", x.dataset.tt === cur.taxType)); }));
      m.panel.querySelector("#cpSave").addEventListener("click", () => {
        const price = +m.panel.querySelector("#cpPrice").value || 0; if (!price) { toast("Enter a selling price.", "err"); return; }
        m.close(); onSave(price); toast("Catalog pricing set", "ok");
      });
    };
    m.panel.querySelector("#cpSmall").addEventListener("input", renderExpand);
    m.panel.querySelector("#cpBase").addEventListener("input", renderExpand);
    renderExpand();
  }

  /* =========================================================================
     Create Campaign Links flow
     ========================================================================= */
  function openCampaignLinks(catalog) {
    const picked = new Set(catalog.customers && catalog.customers.length ? catalog.customers : SEED.customers.map((c) => c.id));
    let q = "", stage = "select", created = [];
    const m = modal({ title: "Create Campaign Links", panelClass: "camp-modal", wide: true,
      body: `<div id="campBody"></div>`,
      footer: `<div id="campFoot"></div>` });
    // Custom head: replace default title block with icon + name + tooltip style.
    const titleBlock = m.panel.querySelector(".mp-title");
    titleBlock.innerHTML = `<div class="camp-head"><span class="camp-ic">${I.sendBig}</span><div><h3>Create Campaign Links ${I.info}</h3><p>${esc(catalog.name).toUpperCase()}</p></div></div>`;
    const body = m.panel.querySelector("#campBody"), foot = m.panel.querySelector(".mp-foot");

    function renderSelect() {
      const list = SEED.customers.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || String(c.phone).includes(q));
      const allChecked = SEED.customers.length && SEED.customers.every((c) => picked.has(c.id));
      body.innerHTML = `
        <div class="camp-banner">${I.info}<span>Create personalized campaign links for customers to place orders directly from your Catalog. <a>More info</a></span></div>
        <div class="search camp-search">${I.search}<input id="campSearch" type="search" placeholder="Search by name, phone, or email..."></div>
        <div class="camp-hint">${I.info} Click on a customer to remove them from the campaign.</div>
        <div class="camp-selrow"><label class="camp-selall"><input type="checkbox" id="campSelAll" ${allChecked ? "checked" : ""}> Select All</label><span class="camp-count">${picked.size} / ${SEED.customers.length} selected ${I.info}</span></div>
        <div class="cust-grid camp-grid" id="campGrid"></div>`;
      const grid = body.querySelector("#campGrid");
      const draw = () => {
        const l = SEED.customers.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || String(c.phone).includes(q));
        grid.innerHTML = l.map((c) => `<div class="cust-card ${picked.has(c.id) ? "sel" : ""}" data-id="${c.id}"><span class="cc-box"><input type="checkbox" ${picked.has(c.id) ? "checked" : ""}></span><div class="cc-main"><div class="cc-name">${esc(c.name)}</div><div class="cc-phone">${esc(c.phone)}</div></div></div>`).join("") || `<div class="pane-empty">No customers match "${esc(q)}".</div>`;
        grid.querySelectorAll(".cust-card").forEach((el) => el.addEventListener("click", () => { const id = el.dataset.id; picked.has(id) ? picked.delete(id) : picked.add(id); sync(); }));
      };
      const sync = () => { body.querySelector(".camp-count").innerHTML = `${picked.size} / ${SEED.customers.length} selected ${I.info}`; body.querySelector("#campSelAll").checked = SEED.customers.every((c) => picked.has(c.id)); draw(); };
      body.querySelector("#campSearch").addEventListener("input", (e) => { q = e.target.value; draw(); });
      body.querySelector("#campSelAll").addEventListener("change", (e) => { if (e.target.checked) SEED.customers.forEach((c) => picked.add(c.id)); else picked.clear(); sync(); });
      draw();
      foot.innerHTML = `<span class="camp-footcount">${picked.size} selected</span><div class="grow"></div><button class="btn btn-primary" id="campCreate">${I.sendBig} Create Links</button>`;
      foot.querySelector("#campCreate").addEventListener("click", () => {
        if (!picked.size) { toast("Select at least one customer.", "err"); return; }
        created = [...picked].map((id) => customerById(id)).filter(Boolean);
        stage = "ready"; renderReady();
      });
      // keep footer count synced
      const obs = () => { const el = foot.querySelector(".camp-footcount"); if (el) el.textContent = `${picked.size} selected`; };
      grid.addEventListener("click", () => setTimeout(obs, 0));
      body.querySelector("#campSelAll").addEventListener("change", () => setTimeout(obs, 0));
    }
    function renderReady() {
      toast(`${created.length} campaign link${created.length === 1 ? "" : "s"} created successfully!`, "ok");
      let q2 = "";
      body.innerHTML = `
        <div class="camp-ready"><span class="cr-ic">${I.checkCircle}</span><div><div class="cr-t">${created.length} of ${created.length} ready</div><div class="cr-s">Click rows to preview • Copy to share ${I.info}</div></div></div>
        <div class="search camp-search">${I.search}<input id="campSearch2" type="search" placeholder="Search by name, phone, or email..."></div>
        <div class="ready-table-wrap"><table class="grid ready-table"><thead><tr><th>Customer</th><th>Phone</th><th>Link Status</th><th style="text-align:right">Action</th></tr></thead><tbody id="readyBody"></tbody></table></div>`;
      const draw = () => {
        const l = created.filter((c) => !q2 || c.name.toLowerCase().includes(q2.toLowerCase()) || String(c.phone).includes(q2));
        body.querySelector("#readyBody").innerHTML = l.map((c) => `<tr><td class="ip-name">${esc(c.name)}</td><td>${esc(c.phone)}</td><td><span class="ready-pill">${I.checkCircle} Ready</span></td><td style="text-align:right"><button class="icon-btn bellbtn" title="Notify">${I.bell}</button></td></tr>`).join("");
      };
      body.querySelector("#campSearch2").addEventListener("input", (e) => { q2 = e.target.value; draw(); });
      draw();
      foot.innerHTML = `<button class="btn cd-back" id="campMore">← Create More</button><div class="grow"></div><button class="btn btn-primary" id="campDone">Done</button>`;
      foot.querySelector("#campMore").addEventListener("click", () => { stage = "select"; renderSelect(); });
      foot.querySelector("#campDone").addEventListener("click", m.close);
    }
    renderSelect();
  }

  /* =========================================================================
     Import — "Preview Catalogue Pricing CSV" with an inline-editable Catalog
     Price column (Edit ↔ Cancel Edit; Import applies the previewed prices).
     ========================================================================= */
  // Read an uploaded CSV or (HTML-based) Excel export into rows of cells.
  function parseHTMLTable(text) {
    try { const doc = new DOMParser().parseFromString(text, "text/html"); return [].slice.call(doc.querySelectorAll("tr")).map((tr) => [].slice.call(tr.querySelectorAll("td,th")).map((td) => td.textContent.trim())); } catch (e) { return []; }
  }
  function readImportFile(file, cb) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      let table = /<table[\s>]/i.test(text) ? parseHTMLTable(text) : parseCSV(text);
      table = (table || []).filter((r) => r.some((x) => String(x).trim() !== ""));
      if (!table.length) { toast("Couldn't read that file — upload a CSV or the exported Excel.", "err"); return; }
      const first = table[0].map((x) => String(x).toLowerCase());
      const hasHeader = first.includes("product") || first.includes("article no") || first.includes("catalog price") || first.includes("base price");
      const data = hasHeader ? table.slice(1) : table;
      const rows = data.map((r) => { const art = String(r[0] || "").trim(); const p = SEED.products.find((x) => String(x.articleNo) === art) || null; return { id: p ? p.id : null, articleNo: art, name: r[1] || (p ? p.name : art), base: r[2] !== undefined && String(r[2]).trim() !== "" ? (+r[2] || 0) : (p ? p.price : 0), unit: r[3] || (p ? p.unit : ""), catalog: +r[4] || (+r[2] || 0) }; });
      cb(rows, file.name);
    };
    reader.readAsText(file);
  }
  // Row "Import" → pick a CSV/Excel file first, then preview it (editable).
  function openImportPreview(catalog, onDone) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => { const f = input.files[0]; input.remove(); if (!f) return; readImportFile(f, (rows) => showImportPreview(catalog, rows, onDone)); });
    input.click();
  }
  function showImportPreview(catalog, initialRows, onDone) {
    let rows = initialRows;
    let editing = false;
    const m = modal({ title: "Preview Catalogue Pricing CSV", panelClass: "import-modal", wide: true,
      headExtra: `<button class="import-edit" id="impEdit">${I.edit} <span>Edit</span></button>`,
      body: `<div id="impTable"></div>`,
      footer: `<button class="btn" data-close style="border-color:var(--line)">Cancel</button><button class="btn import-primary" id="impPrimary">Import</button>` });
    const editBtn = m.panel.querySelector("#impEdit"), primary = m.panel.querySelector("#impPrimary"), tableEl = m.panel.querySelector("#impTable");
    const draw = () => {
      const head = `<tr><th style="width:52px">#</th><th>Article No</th><th>Product</th><th>Base Price</th><th>Unit</th><th class="cp-col">Catalog Price${editing ? " (editable)" : ""}</th></tr>`;
      tableEl.innerHTML = `<div class="import-scroll"><table class="grid import-table"><thead>${head}</thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.articleNo)}</td><td class="ip-name">${esc(r.name)}</td><td>${r.base != null ? Number(r.base).toFixed(2) : "—"}</td><td>${esc(r.unit)}</td><td class="cp-col">${editing ? `<input class="imp-cp" type="number" min="0" step="0.01" data-i="${i}" value="${r.catalog}">` : (r.catalog != null ? Number(r.catalog).toFixed(2) : "—")}</td></tr>`).join("")}</tbody></table></div>`;
      if (editing) tableEl.querySelectorAll(".imp-cp").forEach((inp) => inp.addEventListener("input", () => { rows[+inp.dataset.i].catalog = +inp.value || 0; }));
    };
    const setEditing = (on) => {
      editing = on;
      editBtn.innerHTML = on ? `${I.x} <span>Cancel Edit</span>` : `${I.edit} <span>Edit</span>`;
      editBtn.classList.toggle("editing", on);
      primary.textContent = on ? "Save" : "Import";
      primary.classList.toggle("save", on);
      draw();
    };
    editBtn.addEventListener("click", () => setEditing(!editing));
    primary.addEventListener("click", () => {
      if (editing) { setEditing(false); toast("Pricing changes saved to preview", "ok"); return; }
      catalog.pricing = catalog.pricing || {};
      rows.forEach((r) => { if (r.id) catalog.pricing[r.id] = r.catalog; });
      catalog.lastModified = new Date().toLocaleDateString("en-GB");
      m.close(); onDone && onDone(); toast(`Imported pricing for "${catalog.name}"`, "ok");
    });
    draw();
  }

  // ── Mount ─────────────────────────────────────────────────────────────────
  window.FB = window.FB || {};
  window.FB.mountCatalog = function () {
    document.getElementById("app").innerHTML = shell("catalog", "Catalog");
    wireShell();
    screenCatalog();
  };
})();
