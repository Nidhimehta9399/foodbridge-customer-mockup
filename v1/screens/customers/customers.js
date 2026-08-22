/* ==========================================================================
   DISCOVERY — Foodbridge Module Customer — the two customer screens

   Replicates two live storefront-admin screens:
     /customers        → src/pages/Customers.jsx        (B2B Customers)
     /retail-customers → src/pages/RetailCustomers.jsx  (Retail Customers)

   Both live pages render the *same* src/components/customer/CustomerTable.jsx,
   so this file does too: one table renderer, two configurations (SCREENS).
   Provenance for every region:

     region                    app source
     ------------------------  ----------------------------------------------
     header + description      pages/Customers.jsx · pages/RetailCustomers.jsx
     bulk menu + guard         components/common/BulkActionDropdown.jsx
                               utils/bulkAction.js (runBulkActionWithAutoSelect)
     import / export / sample  components/common/UploadMany.jsx
                               Customers.jsx formatExportData()
     search + debounce         Customers.jsx (useDebounce, 400ms)
     tag chips + tag drawer    features/tags/EntityTagChips.jsx
                               features/tags/useEntityTagManager.js
     table + row actions       components/customer/CustomerTable.jsx
     add/edit drawer (B2B)     components/drawer/CustomerDrawer.jsx
                               hooks/useCustomerSubmit.js
     add/edit drawer (retail)  components/drawer/RetailCustomerDrawer.jsx
     stock audit & health      stock-audit.html/.js — own page, not a drawer;
                               see that file's header for why
     offers drawer             components/drawer/OfferDrawer.jsx
     campaign modals           components/modal/RetailCampaignLinkModal.jsx
                               components/modal/GenerateSmartLinkModal.jsx
     delete modal copy         components/modal/DeleteModal.jsx
                               utils/translation/en.json
     empty state copy          components/table/NotFound.jsx
     pagination (20/page)      components/common/CustomPagination.jsx

   Every action is real against the seed data (persisted to localStorage for the
   session) — nothing here calls an API. Entry point: FB.mount("b2b"|"retail").

   Outgoing transitions (→ proto-FSM for SSOT-1 / SSOT-5) are tabulated in
   ../../index.html; keep the two in step when this file changes.
   ========================================================================== */

(function () {
  "use strict";

  const I = window.FB_ICONS;
  const {
    $, esc, titleCase, debounce,
    toast, closeOverlays, openDrawer, openModal, openMenu, mountShell,
  } = window.FB_SHELL;

  const nameOf = (c) => (typeof c.name === "object" ? c.name?.en : c.name) || "";
  const clone = (v) => JSON.parse(JSON.stringify(v));

  /* ----------------------------------------------------------------- store */

  const KEY = "fb-discovery-customers-v1";

  const Store = {
    state: null,
    load() {
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(KEY) || "null");
      } catch (e) {
        saved = null;
      }
      this.state =
        saved && saved.b2b && saved.retail
          ? saved
          : { b2b: clone(SEED.b2b), retail: clone(SEED.retail) };
      return this.state;
    },
    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.state));
      } catch (e) {
        /* private mode — the prototype still works, it just doesn't persist */
      }
    },
    reset() {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      this.state = { b2b: clone(SEED.b2b), retail: clone(SEED.retail) };
      this.save();
    },
    list(kind) {
      return this.state[kind];
    },
  };

  /* ----------------------------------------------------------- derivations */

  // Catalogue name per customer type — the derivation Customers.jsx does in its
  // `customerTypeCatalogueMap` effect.
  const catalogueMap = (() => {
    const map = {};
    for (const c of SEED.catalogues) {
      if (c.customerTypeReference) map[c.customerTypeReference] = c.catalogue.name;
    }
    return map;
  })();

  // Two hops, scoped to the current location: a customer does not have "a
  // catalogue", they have a catalogue *here*.
  function catalogueOf(customer) {
    const forLocation = (customer.locationCustomerTypeMap || []).filter(
      (m) => m.locationRef === SEED.location,
    );
    return catalogueMap[forLocation[0]?.customerTypeRef] || "";
  }

  // [adress1, state.name, postnr] joined — CustomerTable.jsx renders "-" when
  // every part is empty, which is why most As-is rows show a dash.
  function addressOf(customer) {
    return (
      [customer.adress1, customer.state?.name, customer.postnr]
        .filter(Boolean)
        .join(", ") || "-"
    );
  }

  /* --------------------------------------------------------- screen config */

  // Everything that differs between the two pages lives here; the renderers
  // below are shared, exactly like the two React pages sharing CustomerTable.
  const F = SEED.appProp.customerManagementFeatures;

  const SCREENS = {
    b2b: {
      kind: "b2b",
      crumb: SEED.customersLabel,
      heading: SEED.customersLabel,
      subheading: `${SEED.customersLabel} registered under your organisation.`,
      addLabel: SEED.customersLabel,
      searchPlaceholder: `Search ${SEED.customersLabel.toLowerCase()}...`,
      emptyTitle: `There are no ${SEED.customersLabel.toLowerCase()} right now.`,
      showTags: SEED.appProp.isTagFeatureEnabled,
      showImportExport: F.bulkImportEnabled,
      showSample: F.sampleEnabled,
      showStock: F.stockEnabled,
      showOffer: F.offerEnabled,
      showDelete: F.deleteEnabled,
      showSendCampaign: false,
      drawer: "b2b",
      bulkDeleteTitle: "Selected Customers",
    },
    retail: {
      kind: "retail",
      crumb: "Retail Customers",
      heading: "Retail Customers",
      subheading: "Retail customers registered under your organisation.",
      addLabel: "Add Customer",
      searchPlaceholder: "Search retail customers...",
      emptyTitle: "No retail customers found.",
      showTags: false,
      showImportExport: false,
      showSample: false,
      // RetailCustomers.jsx passes showStock={false} and privateCustomer
      showStock: false,
      showOffer: false,
      showDelete: true,
      showSendCampaign: true,
      drawer: "retail",
      bulkDeleteTitle: "Selected Retail Customers",
    },
  };

  // Live UI state for the mounted screen.
  let S = null;

  /* ------------------------------------------------------------- selectors */

  function visibleRows() {
    const q = S.search.trim().toLowerCase();
    let rows = Store.list(S.cfg.kind);
    if (q) {
      rows = rows.filter((c) =>
        [nameOf(c), c.email, c.phone, c.orgNo].some((v) =>
          String(v || "").toLowerCase().includes(q),
        ),
      );
    }
    if (S.tag) rows = rows.filter((c) => (c.tags || []).includes(S.tag));
    return rows;
  }

  function tagCounts() {
    const counts = {};
    for (const c of Store.list(S.cfg.kind)) {
      for (const t of c.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.keys(counts)
      .sort()
      .map((label) => ({ label, count: counts[label] }));
  }

  /* ----------------------------------------------------------------- views */

  function render() {
    const cfg = S.cfg;
    const rows = visibleRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / SEED.pageSize));
    if (S.page > totalPages) S.page = totalPages;
    const start = (S.page - 1) * SEED.pageSize;
    const pageRows = rows.slice(start, start + SEED.pageSize);
    const allChecked = pageRows.length > 0 && pageRows.every((r) => S.checked.includes(r._id));

    // The header row and the Import/Export toolbar live in ONE Card
    // (`CardBody !p-0 !pt-6 !pb-4`, toolbar `mt-4`), which then has `mb-5`
    // before the search Card — that Card spacing is where most of the page's
    // vertical rhythm comes from.
    $("#page").innerHTML = `
      <div class="head-card">
        ${headerHTML(cfg)}
        ${cfg.showImportExport ? toolbarHTML(cfg) : ""}
      </div>
      ${searchHTML(cfg)}
      ${cfg.showTags ? chipsHTML() : ""}
      ${rows.length ? tableHTML(cfg, pageRows, allChecked, rows.length, totalPages) : emptyHTML(cfg)}
      ${mobileFootHTML(cfg)}`;

    wireScreen(cfg, pageRows);
  }

  function headerHTML(cfg) {
    const bulk = cfg.showDelete || cfg.showTags || cfg.showSendCampaign;
    return `
      <div class="page-head">
        <div>
          <h1>${esc(cfg.heading)}</h1>
          <p>${esc(cfg.subheading)}</p>
        </div>
        <div class="actions">
          ${bulk ? `<button class="btn btn-bulk" id="bulk">${I.FiEdit}<span>Bulk Action</span>${I.FiChevronDown}</button>` : ""}
          <button class="btn btn-primary" id="add">${I.FiPlus} ${esc(cfg.addLabel)}</button>
        </div>
      </div>`;
  }

  function toolbarHTML(cfg) {
    return `
      <div class="toolbar">
        <button class="btn btn-outline" id="import">${I.FiUpload} Import</button>
        <button class="btn btn-outline" id="export">${I.FiDownload} Export</button>
        ${cfg.showSample ? `<button class="btn btn-outline" id="sample">${I.FileSpreadsheet} Download Sample</button>` : ""}
      </div>`;
  }

  function searchHTML(cfg) {
    return `
      <div class="searchbar">
        <div class="field">
          ${I.Search}
          <input type="search" id="search" value="${esc(S.search)}" placeholder="${esc(cfg.searchPlaceholder)}" />
        </div>
      </div>`;
  }

  function chipsHTML() {
    const tags = tagCounts();
    if (!tags.length && !S.tag) return "";
    return `
      <div class="chips">
        <button class="chip ${S.tag ? "" : "active"}" data-tag="">All</button>
        ${tags
          .map(
            (t) =>
              `<button class="chip ${S.tag === t.label ? "active" : ""}" data-tag="${esc(t.label)}">
                 ${I.Tag}<span>${esc(t.label)}</span><span class="count">${t.count}</span>
               </button>`,
          )
          .join("")}
      </div>`;
  }

  function rowActionsHTML(cfg, c) {
    return `
      <div class="row-actions">
        ${cfg.showStock ? `<a class="icon-btn stock" href="stock-audit.html?customer=${encodeURIComponent(c._id)}" data-tip="Stock Audit &amp; Health">${I.BarChart2}</a>` : ""}
        ${cfg.showOffer ? `<button class="icon-btn offer" data-act="offer" data-id="${c._id}" data-tip="Offers">${I.FiGift}</button>` : ""}
        ${cfg.showSendCampaign ? `<button class="icon-btn send" data-act="campaign" data-id="${c._id}" data-tip="Send Campaign Link">${I.FiSend}</button>` : ""}
        <button class="icon-btn edit" data-act="edit" data-id="${c._id}" data-tip="Edit">${I.FiEdit}</button>
        ${cfg.showDelete ? `<button class="icon-btn del" data-act="delete" data-id="${c._id}" data-tip="Delete">${I.FiTrash2}</button>` : ""}
      </div>`;
  }

  function catalogueCellHTML(c) {
    const name = catalogueOf(c);
    return name
      ? `<span class="pill">${esc(titleCase(name))}</span>`
      : `<span class="pill none">-</span>`;
  }

  function tableHTML(cfg, rows, allChecked, total, totalPages) {
    const canSelect = cfg.showDelete || cfg.showTags || cfg.showSendCampaign;
    const body = rows
      .map((c) => {
        const addr = addressOf(c);
        const picked = S.checked.includes(c._id);
        return `
        <tr data-id="${c._id}" class="${picked ? "selected" : ""}">
          ${canSelect ? `<td><input type="checkbox" class="cb row-cb" data-id="${c._id}" ${picked ? "checked" : ""}></td>` : ""}
          <td class="name">${esc(titleCase(nameOf(c)))}</td>
          <td>${c.email ? esc(c.email) : ""}</td>
          <td class="phone">${esc(c.phone)}</td>
          <td class="address"><span class="${addr === "-" ? "muted" : ""}">${esc(addr)}</span></td>
          <td>${catalogueCellHTML(c)}</td>
          <td>${rowActionsHTML(cfg, c)}</td>
        </tr>`;
      })
      .join("");

    // NOTE — the live Customers/RetailCustomers pages do NOT switch to cards on
    // mobile the way the Products module does: the same <TableContainer> renders
    // at every width and scrolls horizontally, with only the sticky bottom bar
    // added. Reproduced as-is; flagged as an open question in design-principles.
    return `
      <div class="table-wrap">
        <div class="table-scroll">
          <table class="grid">
            <thead>
              <tr>
                ${canSelect ? `<th style="width:44px"><input type="checkbox" class="cb" id="checkAll" ${allChecked ? "checked" : ""}></th>` : ""}
                <th>Name</th><th>Email</th><th style="min-width:11rem">Phone</th>
                <th>Address</th><th>Catalog</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        ${pagerHTML(total, totalPages)}
      </div>`;
  }

  // CustomPagination.jsx — "SHOWING {start}–{end} OF {total}" (en dash, uppercase)
  // on the left; ‹ page numbers › on the right, active page filled green-500.
  // Six or fewer pages render in full; beyond that it ellipsises.
  function pagerHTML(total, totalPages) {
    const from = total === 0 ? 0 : (S.page - 1) * SEED.pageSize + 1;
    const to = Math.min(S.page * SEED.pageSize, total);

    const pages = [];
    if (totalPages <= 6) {
      for (let p = 1; p <= totalPages; p++) pages.push(p);
    } else if (S.page <= 3) {
      pages.push(1, 2, 3, 4, "…", totalPages);
    } else if (S.page >= totalPages - 2) {
      pages.push(1, "…", totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, "…", S.page - 1, S.page, S.page + 1, "…", totalPages);
    }

    const buttons = pages
      .map((p) =>
        p === "…"
          ? `<span style="padding:0 .25rem;color:var(--gray-500);font-weight:500">…</span>`
          : `<button data-page="${p}" class="${p === S.page ? "active" : ""}">${p}</button>`,
      )
      .join("");

    return `
      <div class="pager">
        <span class="info">SHOWING ${from}–${to} OF ${total}</span>
        <div class="pages">
          <button class="step" data-page="${S.page - 1}" ${S.page === 1 ? "disabled" : ""}>‹</button>
          ${buttons}
          <button class="step" data-page="${S.page + 1}" ${S.page === totalPages ? "disabled" : ""}>›</button>
        </div>
      </div>`;
  }

  function emptyHTML(cfg) {
    return `
      <div class="empty">
        <div class="art">${I.Users}</div>
        <h2>We're sorry, ${esc(cfg.emptyTitle)}</h2>
        <p>${S.search || S.tag ? "Try clearing the search or tag filter." : "Add your first customer to get started."}</p>
      </div>`;
  }

  function mobileFootHTML(cfg) {
    const bulk = cfg.showDelete || cfg.showTags || cfg.showSendCampaign;
    return `
      <div class="mobile-foot">
        ${cfg.showImportExport ? `<button id="m-import">${I.FiUpload}<span>Import</span></button>` : ""}
        ${cfg.showImportExport && cfg.showSample ? `<button id="m-sample">${I.FiDownload}<span>Sample</span></button>` : ""}
        ${cfg.showImportExport ? `<div class="div"></div>` : ""}
        <button class="add" id="m-add"><i>${I.FiPlus}</i><span>Add Customer</span></button>
        ${bulk ? `<div class="div"></div><button id="m-bulk">${I.FiTrash2}<span>Bulk</span></button>` : ""}
      </div>`;
  }

  /* ---------------------------------------------------------------- wiring */

  function wireScreen(cfg, pageRows) {
    const page = $("#page");

    const search = $("#search", page);
    if (search) {
      search.oninput = debounce(() => {
        S.search = search.value;
        S.page = 1;
        S.checked = [];
        render();
        const box = $("#search");
        if (box) {
          box.focus();
          box.setSelectionRange(box.value.length, box.value.length);
        }
      }, 250);
    }

    page.querySelectorAll(".chip").forEach((chip) => {
      chip.onclick = () => {
        S.tag = chip.dataset.tag === S.tag ? "" : chip.dataset.tag;
        S.page = 1;
        S.checked = [];
        render();
      };
    });

    page.querySelectorAll("[data-page]").forEach((b) => {
      b.onclick = () => {
        S.page = +b.dataset.page;
        // Selection is scoped to the page you made it on: leaving the page
        // drops it, so a bulk action can never silently act on rows that are
        // no longer in front of you.
        S.checked = [];
        render();
      };
    });

    // Select-all covers THIS page only — `isCheckAll` in the live pages is
    // derived against the current page of results, never the whole result set.
    const checkAll = $("#checkAll", page);
    if (checkAll) {
      checkAll.onchange = () => {
        S.checked = checkAll.checked ? pageRows.map((r) => r._id) : [];
        render();
      };
    }

    page.querySelectorAll(".row-cb").forEach((cb) => {
      cb.onchange = () => {
        S.checked = cb.checked
          ? S.checked.concat(cb.dataset.id)
          : S.checked.filter((id) => id !== cb.dataset.id);
        render();
      };
    });

    page.querySelectorAll("[data-act]").forEach((b) => {
      b.onclick = () => {
        const c = Store.list(cfg.kind).find((x) => x._id === b.dataset.id);
        if (!c) return;
        ({
          offer: openOfferDrawer,
          campaign: openCampaignModal,
          edit: (cust) => openCustomerDrawer(cfg, cust),
          delete: (cust) => openDeleteModal(cfg, [cust._id], nameOf(cust)),
        })[b.dataset.act](c);
      };
    });

    const onAdd = () => openCustomerDrawer(cfg, null);
    if ($("#add", page)) $("#add", page).onclick = onAdd;
    if ($("#m-add", page)) $("#m-add", page).onclick = onAdd;

    const onBulk = (anchor) => openBulkMenu(cfg, anchor);
    if ($("#bulk", page)) $("#bulk", page).onclick = (e) => onBulk(e.currentTarget);
    if ($("#m-bulk", page)) $("#m-bulk", page).onclick = (e) => onBulk(e.currentTarget);

    const onImport = () => openImportModal(cfg);
    if ($("#import", page)) $("#import", page).onclick = onImport;
    if ($("#m-import", page)) $("#m-import", page).onclick = onImport;

    if ($("#export", page)) $("#export", page).onclick = () => exportCsv(cfg);

    const onSample = () => downloadSample();
    if ($("#sample", page)) $("#sample", page).onclick = onSample;
    if ($("#m-sample", page)) $("#m-sample", page).onclick = onSample;
  }

  /* ---------------------------------------------------------- bulk actions */

  function openBulkMenu(cfg, anchor) {
    const targets = S.checked.length ? S.checked.slice() : [];
    // The B2B page raises an error toast on an empty selection; the Retail page
    // silently selects everything instead (F10 — inconsistency, reproduced).
    const guard = (fn) => () => {
      if (!targets.length) {
        toast("Select customers first, then choose a bulk action.", "error");
        return;
      }
      fn(targets);
    };

    const items = [];
    if (cfg.showTags) {
      items.push({
        label: "Assign tags",
        icon: I.Tag,
        onClick: guard((ids) => openTagDrawer(cfg, ids)),
      });
    }
    if (cfg.showSendCampaign) {
      items.push({
        label: "Send Campaign",
        icon: I.FiSend,
        onClick: guard((ids) => openBulkCampaignModal(cfg, ids)),
      });
    }
    if (cfg.showDelete) {
      items.push({
        label: "Delete",
        icon: I.FiTrash2,
        danger: true,
        onClick: guard((ids) => openDeleteModal(cfg, ids, cfg.bulkDeleteTitle)),
      });
    }
    openMenu(anchor, items);
  }

  /* ---------------------------------------------------------- delete modal */

  function openDeleteModal(cfg, ids, title) {
    const bulk = ids.length > 1;
    const wrap = openModal(`
      <div class="mbody">
        <div class="ico">${I.FiTrash2}</div>
        <h2>Delete <span class="target">${esc(titleCase(title))}</span>?</h2>
        <p>${
          bulk
            ? "This action can't be undone. These records will be permanently removed from your list."
            : "This action can't be undone. It will be permanently removed from your list."
        }</p>
      </div>
      <div class="modal-foot">
        <button class="btn-modal" data-x>Cancel</button>
        <button class="btn-modal danger" data-go>Delete</button>
      </div>`);

    $("[data-x]", wrap).onclick = closeOverlays;
    $("[data-go]", wrap).onclick = () => {
      const list = Store.list(cfg.kind);
      for (const id of ids) {
        const i = list.findIndex((c) => c._id === id);
        if (i > -1) list.splice(i, 1);
      }
      Store.save();
      S.checked = S.checked.filter((id) => !ids.includes(id));
      closeOverlays();
      render();
      toast(bulk ? `${ids.length} customers deleted.` : "Customer deleted.");
    };
  }

  /* -------------------------------------------------------- customer drawer */

  const stateOptions = (selected) =>
    `<option value="">Select state</option>` +
    SEED.states
      .map(
        (s) =>
          `<option value="${s.code}" ${selected === s.code ? "selected" : ""}>${esc(s.name)}</option>`,
      )
      .join("");

  function field({ label, name, value, type, placeholder, required, hint }) {
    return `
      <div class="frow" data-field="${name}">
        <label class="lab" for="f-${name}">${esc(label)}${required ? '<span class="req">*</span>' : ""}</label>
        <div>
          ${hint ? `<p class="hint">${esc(hint)}</p>` : ""}
          <input class="input" id="f-${name}" name="${name}" type="${type || "text"}"
                 value="${esc(value == null ? "" : value)}" placeholder="${esc(placeholder || label)}" />
          <div class="err-msg"></div>
        </div>
      </div>`;
  }

  function openCustomerDrawer(cfg, customer) {
    const isEdit = !!customer;
    const c = customer || {};
    const isB2B = cfg.drawer === "b2b";
    // useCustomerSubmit.js defaults gstType to "regular" on ADD; only edit reads the stored value.
    const gstType = isEdit ? (c.gstType || "") : "regular";

    // GST Type switches which identifier is shown — but both write `gstNumber`
    // (F7). Reproduced as-is.
    const gstBlock = !isB2B
      ? ""
      : `
      <div class="frow">
        <label class="lab">GST Type</label>
        <div class="choice-row">
          ${["regular", "exempt"]
            .map(
              (t) => `
            <label class="choice">
              <input type="radio" name="gstType" value="${t}" ${gstType === t ? "checked" : ""}>
              <span class="box"></span>
              <span>${titleCase(t)}</span>
            </label>`,
            )
            .join("")}
        </div>
      </div>

      <div class="frow ${gstType === "regular" ? "" : "hidden"}" data-when="regular">
        <label class="lab" for="f-gstNumber">GST Number</label>
        <div>
          <div class="inline">
            <input class="input" id="f-gstNumber" name="gstNumber" type="text"
                   value="${esc(gstType === "regular" ? c.gstNumber || "" : "")}" placeholder="GST Number" />
            <button type="button" class="btn btn-primary" data-verify>Verify</button>
          </div>
          <div class="err-msg"></div>
        </div>
      </div>

      <div class="frow ${gstType === "exempt" ? "" : "hidden"}" data-when="exempt">
        <label class="lab" for="f-udin">UDIN Number</label>
        <div>
          <div class="inline">
            <input class="input" id="f-udin" name="udin" type="text"
                   value="${esc(gstType === "exempt" ? c.gstNumber || "" : "")}" placeholder="UDIN Number" />
            <button type="button" class="btn btn-primary" data-verify>Verify</button>
          </div>
          <div class="err-msg"></div>
        </div>
      </div>`;

    // Opening balance is add-only in CustomerDrawer.jsx (`{!id && …}`) — F6.
    const openingBalance =
      isB2B && !isEdit
        ? `
      <div class="frow">
        <label class="lab">Opening Balance</label>
        <div>
          <p class="hint">Bring in any existing balance with this customer from before they were added here.</p>
          <div class="radio-list">
            <label class="radio">
              <input type="radio" name="openingBalanceType" value="OPENING_RECEIVABLE">
              <span class="dot"></span><span class="txt">This customer owes me</span>
            </label>
            <label class="radio">
              <input type="radio" name="openingBalanceType" value="OPENING_ADVANCE">
              <span class="dot"></span><span class="txt">This customer has already paid me in advance</span>
            </label>
            <button type="button" class="btn-link hidden" data-clear-ob>Clear — no opening balance</button>
          </div>
          <div class="hidden" data-ob-amount style="margin-top:12px">
            <input class="input" name="openingBalanceAmount" type="number" placeholder="e.g. 1000" />
          </div>
        </div>
      </div>`
        : "";

    const sameAsBilling =
      !c.adress2 ||
      (c.adress2 === c.adress1 &&
        (c.shippingPostnumber || "") === (c.postnr || "") &&
        (c.shippingState?.code || "") === (c.state?.code || ""));

    const notify =
      isB2B && !isEdit && SEED.appProp.notification.isEnabled
        ? `
      <div class="frow">
        <label class="lab">Notify User</label>
        <div><label class="choice"><input type="checkbox" name="notifyUser"><span class="box"></span><span>Send notification to user</span></label></div>
      </div>`
        : "";

    const body = `
      <div class="drawer-body"><form id="cform" novalidate>
        ${gstBlock}
        ${field({ label: "Customer Code", name: "orgNo", value: c.orgNo })}
        ${field({ label: "Name", name: "name", value: nameOf(c) })}
        ${field({ label: "Email", name: "email", value: c.email, type: "email" })}
        ${field({ label: "Phone", name: "phone", value: c.phone, required: true })}
        ${openingBalance}
        ${field({ label: "Billing Address", name: "address", value: c.adress1 })}
        <div class="frow">
          <label class="lab" for="f-state">State (Billing)</label>
          <div><select class="input" id="f-state" name="state">${stateOptions(c.state?.code)}</select></div>
        </div>
        ${field({ label: "PIN Code (Billing)", name: "postnr", value: c.postnr })}

        <div class="frow">
          <label class="lab">Use billing address as shipping address</label>
          <div><label class="choice">
            <input type="checkbox" name="sameAsBilling" ${sameAsBilling ? "checked" : ""}>
            <span class="box"></span>
          </label></div>
        </div>

        <div data-shipping class="${sameAsBilling ? "hidden" : ""}">
          ${field({ label: "Shipping Address", name: "shipping_address", value: c.adress2 })}
          <div class="frow">
            <label class="lab" for="f-shippingState">State (Shipping)</label>
            <div><select class="input" id="f-shippingState" name="shippingState">${stateOptions(c.shippingState?.code)}</select></div>
          </div>
          ${field({ label: "PIN Code (Shipping)", name: "shippingPostnumber", value: c.shippingPostnumber })}
        </div>
        ${notify}
      </form></div>`;

    // The live B2B drawer titles itself with the tenant's menu label
    // (`${t("Add")} ${customersLabel}`), which is why this reads "Add B2B Customers".
    const label = isB2B ? cfg.addLabel : "Customer";
    const drawer = openDrawer({
      title: `${isEdit ? "Update" : "Add"} ${esc(label)}`,
      // CustomerDrawer: `Update your ${customersLabel} necessary information
      // from here` — the label keeps its casing, it is not lowercased.
      description: `${isEdit ? "Update your" : "Add your"} ${esc(label)} necessary information from here`,
      body,
      // DrawerButton: submit FIRST (green h-12), then Cancel (white, red text)
      footer: `
        <button class="btn btn-submit" data-save>${isEdit ? "Update" : "Add"} ${esc(label)}</button>
        <button class="btn btn-cancel" data-cancel>Cancel</button>`,
    });

    drawer.querySelectorAll('input[name="gstType"]').forEach((r) => {
      r.onchange = () => {
        drawer.querySelector('[data-when="regular"]').classList.toggle("hidden", r.value !== "regular");
        drawer.querySelector('[data-when="exempt"]').classList.toggle("hidden", r.value !== "exempt");
      };
    });
    drawer.querySelectorAll("[data-verify]").forEach((b) => {
      b.onclick = () => {
        const input = b.previousElementSibling;
        if (!input.value.trim()) {
          toast("Enter a number to verify.", "error");
          return;
        }
        b.disabled = true;
        b.textContent = "Verifying…";
        setTimeout(() => {
          b.disabled = false;
          b.textContent = "Verify";
          toast("Details verified. (Discovery stub — no lookup performed.)", "info");
        }, 700);
      };
    });

    const same = drawer.querySelector('[name="sameAsBilling"]');
    if (same) {
      same.onchange = () =>
        drawer.querySelector("[data-shipping]").classList.toggle("hidden", same.checked);
    }

    drawer.querySelectorAll('input[name="openingBalanceType"]').forEach((r) => {
      r.onchange = () => {
        drawer.querySelector("[data-ob-amount]").classList.remove("hidden");
        drawer.querySelector("[data-clear-ob]").classList.remove("hidden");
      };
    });
    const clearOb = drawer.querySelector("[data-clear-ob]");
    if (clearOb) {
      clearOb.onclick = () => {
        drawer.querySelectorAll('input[name="openingBalanceType"]').forEach((r) => (r.checked = false));
        drawer.querySelector('[name="openingBalanceAmount"]').value = "";
        drawer.querySelector("[data-ob-amount]").classList.add("hidden");
        clearOb.classList.add("hidden");
      };
    }

    $("[data-cancel]", drawer).onclick = closeOverlays;
    $("[data-save]", drawer).onclick = () => saveCustomer(cfg, drawer, customer);
  }

  function saveCustomer(cfg, drawer, existing) {
    const form = $("#cform", drawer);
    const get = (n) => (form.elements[n] ? String(form.elements[n].value || "").trim() : "");
    const checked = (n) => !!(form.elements[n] && form.elements[n].checked);

    // Phone is the only required field in both drawers (F8).
    const phone = get("phone");
    const row = form.querySelector('[data-field="phone"]');
    row.classList.remove("invalid");
    if (!phone || !/^\+?\d{7,15}$/.test(phone)) {
      row.classList.add("invalid");
      $(".err-msg", row).textContent = phone
        ? "Enter a valid phone number (7-15 digits)."
        : "Phone is required.";
      toast("Please fix the highlighted field.", "error");
      return;
    }

    const email = get("email");
    const emailRow = form.querySelector('[data-field="email"]');
    emailRow.classList.remove("invalid");
    if (email && !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,3}$/.test(email)) {
      emailRow.classList.add("invalid");
      $(".err-msg", emailRow).textContent = "Enter a valid email address.";
      toast("Please fix the highlighted field.", "error");
      return;
    }

    const findState = (code) => SEED.states.find((s) => s.code === code) || {};
    const gstType = form.elements["gstType"]
      ? Array.from(form.elements["gstType"]).find((r) => r.checked)?.value || ""
      : "";
    const gstNumber = gstType === "regular" ? get("gstNumber") : gstType === "exempt" ? get("udin") : "";

    const same = checked("sameAsBilling");
    const billingState = findState(get("state"));
    const shipState = same ? billingState : findState(get("shippingState"));

    const payload = {
      orgNo: get("orgNo"),
      name: { en: get("name") },
      email,
      phone,
      adress1: get("address"),
      state: billingState,
      postnr: get("postnr"),
      adress2: same ? get("address") : get("shipping_address"),
      shippingState: shipState,
      shippingPostnumber: same ? get("postnr") : get("shippingPostnumber"),
      gstType,
      gstNumber,
      supplyChainType: cfg.kind === "retail" ? "PRIVATE" : "PUBLIC",
    };

    const list = Store.list(cfg.kind);
    if (existing) {
      Object.assign(existing, payload);
      toast(
        cfg.kind === "retail"
          ? "Retail customer updated successfully."
          : "Customer updated successfully.",
      );
    } else {
      list.unshift(
        Object.assign(
          {
            _id: "new_" + Date.now().toString(36),
            locationCustomerTypeMap: [],
            tags: [],
            createdAt: new Date().toISOString().slice(0, 10),
          },
          payload,
        ),
      );
      S.page = 1;
      toast(
        cfg.kind === "retail"
          ? "Retail customer added successfully."
          : "Customer added successfully.",
      );
      if (checked("notifyUser")) toast("Notification queued for the new customer.", "info");
    }
    Store.save();
    closeOverlays();
    render();
  }

  /* ------------------------------------------------------------ tag drawer */

  // EntityTagDrawer → DirectoryDrawer + MultiTagInput ("Create customer tag").
  // Structure, top to bottom: header (pr-20 to clear the close X) · a bordered
  // search field · MultiTagInput (one bordered box: chip tray with a
  // placeholder when empty, then input+Add Tag, then the "n/10 · Enter or
  // comma" hint) · a 1-col (xl:2-col) grid of plain list rows — thumb, name,
  // subtitle, a checkbox square, NO tags shown on the card · a footer with
  // "N selected" on its own line, then Cancel/Save stacked below 640px and
  // side-by-side at sm+. Width is 70% (DirectoryDrawer's own default, not the
  // 82% MainDrawer default the other drawers use).
  function openTagDrawer(cfg, ids) {
    const all = Store.list(cfg.kind);
    const label = cfg.kind === "retail" ? "retail customer" : "customer";
    let picked = ids.slice();
    let tags = [];
    let query = "";

    const drawer = openDrawer({
      narrow: true,
      title: "Create customer tag",
      description: `Name the tag, search ${label}s and select the ${label}s that belong to it.`,
      body: `
        <div class="dd-top">
          <label class="dd-search">
            ${I.Search}
            <input type="text" id="tag-q" placeholder="Search…">
          </label>
          <div class="mti-box">
            <div class="mti-chips" data-chips><span class="mti-placeholder">Add one or more tags</span></div>
            <div class="mti-row">
              <input type="text" id="tag-new" placeholder="e.g. Seasonal, High margin">
              <button class="mti-add" data-add-tag disabled>${I.FiPlus} Add Tag</button>
            </div>
            <p class="mti-hint"><span data-count>0</span>/10 tags · Enter or comma to add</p>
          </div>
        </div>
        <div class="dd-list" data-grid></div>`,
      footer: `
        <div class="dd-foot">
          <p class="dd-selected" data-selected>0 selected</p>
          <div class="dd-foot-btns">
            <button class="btn-dd-cancel" data-cancel>Cancel</button>
            <button class="btn-dd-save" data-save disabled>Save</button>
          </div>
        </div>`,
    });

    const grid = $("[data-grid]", drawer);
    const input = $("#tag-new", drawer);
    const addBtn = $("[data-add-tag]", drawer);

    const syncFooter = () => {
      $("[data-selected]", drawer).textContent = `${picked.length} selected`;
      $("[data-save]", drawer).disabled = picked.length === 0 || tags.length === 0;
      $("[data-count]", drawer).textContent = String(tags.length);
      addBtn.disabled = !input.value.trim() || tags.length >= 10;
    };

    const paintChips = () => {
      $("[data-chips]", drawer).innerHTML = tags.length
        ? tags
            .map(
              (t) =>
                `<span class="mti-chip">${esc(t)}<button data-rm="${esc(t)}" aria-label="Remove ${esc(t)}">${I.FiX}</button></span>`,
            )
            .join("")
        : `<span class="mti-placeholder">Add one or more tags</span>`;
      drawer.querySelectorAll("[data-rm]").forEach((b) => {
        b.onclick = () => {
          tags = tags.filter((x) => x !== b.dataset.rm);
          paintChips();
          syncFooter();
        };
      });
    };

    const paintGrid = () => {
      const q = query.trim().toLowerCase();
      const list = q
        ? all.filter((c) =>
            [nameOf(c), c.email, c.phone].some((v) => String(v || "").toLowerCase().includes(q)),
          )
        : all;
      grid.innerHTML = list.length
        ? list
            .map((c) => {
              const on = picked.includes(c._id);
              return `
          <button type="button" class="dd-row ${on ? "on" : ""}" data-id="${c._id}">
            <span class="dd-thumb"></span>
            <span class="dd-body">
              <span class="dd-name">${esc(titleCase(nameOf(c)))}</span>
              <span class="dd-sub">${esc([c.email, c.phone].filter(Boolean).join(" · "))}</span>
            </span>
            <span class="dd-box">${on ? I.CheckMark : ""}</span>
          </button>`;
            })
            .join("")
        : `<p class="dd-empty">No matches found.</p>`;

      grid.querySelectorAll(".dd-row").forEach((row) => {
        row.onclick = () => {
          const id = row.dataset.id;
          picked = picked.includes(id) ? picked.filter((x) => x !== id) : picked.concat(id);
          paintGrid();
          syncFooter();
        };
      });
    };

    const addTag = (name) => {
      const t = String(name || "").trim();
      if (!t || tags.length >= 10) return;
      if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
      input.value = "";
      paintChips();
      syncFooter();
    };

    addBtn.onclick = () => addTag(input.value);
    input.oninput = syncFooter;
    input.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        addTag(input.value);
      }
    };
    const qbox = $("#tag-q", drawer);
    qbox.oninput = debounce(() => {
      query = qbox.value;
      paintGrid();
      const b = $("#tag-q", drawer);
      b.focus();
      b.setSelectionRange(b.value.length, b.value.length);
    }, 200);

    $("[data-cancel]", drawer).onclick = closeOverlays;
    $("[data-save]", drawer).onclick = () => {
      const targets = all.filter((c) => picked.includes(c._id));
      for (const c of targets) c.tags = Array.from(new Set((c.tags || []).concat(tags)));
      Store.save();
      S.checked = [];
      closeOverlays();
      render();
      toast(`Tags updated for ${targets.length} customer${targets.length === 1 ? "" : "s"}.`);
    };

    paintGrid();
    syncFooter();
  }

  /* ---------------------------------------------------------- offers drawer */

  // OfferListView: header, an action bar with the green "Create Offer" button,
  // then a bordered table (Offer Name · Benefit · Actions).
  function openOfferDrawer(c) {
    const list = SEED.offers[c._id] || [];
    const drawer = openDrawer({
      large: true,
      title: "Customer Offers",
      description: "Manage promotions and offers for this customer",
      body: `
        <div class="offer-bar">
          <button class="btn btn-submit" style="height:2.5rem;flex:0 0 auto;padding:0 1rem" data-create>${I.FiPlus} Create Offer</button>
        </div>
        <div class="drawer-body" style="padding:0">
          <div class="offer-body">
            <div class="table-wrap" style="margin-bottom:2rem">
              <table class="offers">
                <thead><tr><th>Offer Name</th><th>Benefit</th><th class="c">Actions</th></tr></thead>
                <tbody>
                  ${
                    list.length
                      ? list
                          .map(
                            (o) => `<tr>
                              <td class="oname">${esc(o.title)}</td>
                              <td class="obenefit">Free Item</td>
                              <td class="c">
                                <button class="icon-btn edit" data-tip="Edit">${I.FiEdit}</button>
                                <button class="icon-btn del" data-tip="Delete">${I.FiTrash2}</button>
                              </td>
                            </tr>`,
                          )
                          .join("")
                      : `<tr><td colspan="3" style="padding:2rem;text-align:center;color:var(--gray-400)">No offers mapped to this customer yet.</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>`,
      footer: null,
    });
    $("[data-create]", drawer).onclick = () =>
      toast("Create Offer is outside this discovery iteration.", "info");
    drawer.querySelectorAll(".offers .icon-btn").forEach((b) => {
      b.onclick = () => toast("Offer editing is outside this discovery iteration.", "info");
    });
  }

  /* -------------------------------------------------------- campaign modals */

  // RetailCampaignLinkModal.jsx — "Send Ordering Link". A small, ALWAYS-centered
  // modal (own hand-rolled backdrop, not myTheme's — no mobile bottom-sheet
  // behaviour here): compact header with an inline X, a gray-50 box with a
  // person row (name) and a phone row, a description paragraph, Cancel + a
  // green "Send via WhatsApp" button.
  function openCampaignModal(c) {
    const name = titleCase(nameOf(c));
    const wrap = openModal(
      `<div class="rcl-head">
         <h2>Send Ordering Link</h2>
         <button class="rcl-x" data-x aria-label="Close">${I.FiX}</button>
       </div>
       <div class="rcl-body">
         <div class="rcl-info">
           ${name ? `<div class="rcl-row">${I.FiUser}<span class="strong">${esc(name)}</span></div>` : ""}
           ${c.phone ? `<div class="rcl-row">${I.FiSmartphone}<span>${esc(c.phone)}</span></div>` : ""}
         </div>
         <p class="rcl-desc">This will send a WhatsApp message with a secure ordering link. The customer can view products, create orders, and submit them directly.</p>
       </div>
       <div class="rcl-foot">
         <button class="btn-text" data-x>Cancel</button>
         <button class="btn-whatsapp" data-send>${I.Whatsapp} Send via WhatsApp</button>
       </div>`,
      { small: true, alwaysCenter: true },
    );
    wrap.querySelectorAll("[data-x]").forEach((b) => (b.onclick = closeOverlays));
    $("[data-send]", wrap).onclick = () => {
      closeOverlays();
      toast(`Ordering link sent to ${name || c.phone}!`);
    };
  }

  // GenerateSmartLinkModal.jsx — "Create Campaign Links". A large (56rem,
  // 92vh-tall) two-step modal: a selection step (search, "click to remove"
  // warning, Select All + live counter, a 2-col grid of pre-selected cards)
  // that generates into a lightweight results step (Ready/Failed per row,
  // Done). All customers passed in start selected — the caller already
  // filtered to the bulk-action's chosen ids.
  function openBulkCampaignModal(cfg, ids) {
    const all = Store.list(cfg.kind).filter((c) => ids.includes(c._id));
    let picked = ids.slice();
    let query = "";
    let step = "select";
    let results = [];

    const wrap = openModal("", { tall: true, alwaysCenter: true, blurDark: true });
    wrap.querySelector(".modal").classList.add("gsl");

    const paintSelect = () => {
      const q = query.trim().toLowerCase();
      const list = q
        ? all.filter((c) => [nameOf(c), c.phone, c.email].some((v) => String(v || "").toLowerCase().includes(q)))
        : all;
      const allSelected = picked.length === all.length && all.length > 0;

      wrap.querySelector(".modal").innerHTML = `
        <div class="gsl-head">
          <div class="gsl-head-row">
            <span class="gsl-icon">${I.FiSend}</span>
            <div class="gsl-titles">
              <h2>Create Campaign Links</h2>
              <p>Retail Customers</p>
            </div>
            <button class="rcl-x" data-x aria-label="Close">${I.FiX}</button>
          </div>
          <div class="gsl-banner info">
            ${I.Info} Create personalized campaign links for customers to place orders directly from your retail customers.
          </div>
        </div>
        <div class="gsl-body">
          <input class="input" id="gsl-search" placeholder="Search by name, phone, or email..." value="${esc(query)}">
          <div class="gsl-banner warn">${I.Info} Click on a customer to remove them from the campaign.</div>
          <label class="gsl-selectall">
            <input type="checkbox" class="cb" id="gsl-all" ${allSelected ? "checked" : ""}>
            <span>Select All</span>
            <span class="gsl-count">${picked.length} / ${all.length} selected</span>
          </label>
          <div class="gsl-grid">
            ${
              list.length
                ? list
                    .map((c) => {
                      const on = picked.includes(c._id);
                      return `
                <label class="gsl-card ${on ? "on" : ""}" data-id="${c._id}">
                  <input type="checkbox" class="cb" ${on ? "checked" : ""}>
                  <span class="gsl-card-body">
                    <span class="gsl-name">${esc(titleCase(nameOf(c)) || "Unnamed Customer")}</span>
                    ${c.phone ? `<span class="gsl-phone">${esc(c.phone)}</span>` : ""}
                  </span>
                </label>`;
                    })
                    .join("")
                : `<p class="gsl-empty">No customers found</p>`
            }
          </div>
        </div>
        <div class="gsl-foot">
          <span class="gsl-selected">${picked.length} selected${picked.length === 0 ? ` <span class="warn-inline">${I.Info} Select at least one</span>` : ""}</span>
          <button class="btn btn-submit gsl-create" data-create ${picked.length === 0 ? "disabled" : ""}>${I.FiSend} Create Links</button>
        </div>`;

      $("[data-x]", wrap).onclick = closeOverlays;
      const search = $("#gsl-search", wrap);
      search.oninput = debounce(() => {
        query = search.value;
        paintSelect();
        const box = $("#gsl-search", wrap);
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      }, 200);
      $("#gsl-all", wrap).onchange = (e) => {
        picked = e.target.checked ? all.map((c) => c._id) : [];
        paintSelect();
      };
      // Bind to the checkbox's own `change`, not a click on the wrapping
      // <label> — a label forwards a synthetic click to its control, which
      // then bubbles back through the label itself, so a click handler on
      // the label fires twice per real click and the toggle cancels out.
      wrap.querySelectorAll(".gsl-card").forEach((card) => {
        $("input", card).onchange = () => {
          const id = card.dataset.id;
          picked = picked.includes(id) ? picked.filter((x) => x !== id) : picked.concat(id);
          paintSelect();
        };
      });
      const createBtn = $("[data-create]", wrap);
      if (createBtn) {
        createBtn.onclick = () => {
          results = all.filter((c) => picked.includes(c._id));
          step = "results";
          paintResults();
        };
      }
    };

    const paintResults = () => {
      wrap.querySelector(".modal").innerHTML = `
        <div class="gsl-results-head">
          ${I.Check} <b>${results.length} of ${results.length} ready</b>
          <span class="muted">Links generated for the selected customers</span>
        </div>
        <div class="gsl-body" style="padding-top:0">
          <table class="offers" style="min-width:0">
            <thead><tr><th>Customer</th><th>Phone</th><th>Status</th></tr></thead>
            <tbody>
              ${results
                .map(
                  (c) => `<tr>
                    <td class="oname">${esc(titleCase(nameOf(c)))}</td>
                    <td>${esc(c.phone || "-")}</td>
                    <td class="gsl-ready">${I.Check} Ready</td>
                  </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <div class="gsl-foot">
          <button class="btn-text" data-back>← Create More</button>
          <button class="btn btn-submit" style="height:2.5rem;padding:0 1.25rem" data-done>Done</button>
        </div>`;
      $("[data-back]", wrap).onclick = () => {
        step = "select";
        paintSelect();
      };
      $("[data-done]", wrap).onclick = () => {
        closeOverlays();
        toast(`${results.length} campaign link${results.length === 1 ? "" : "s"} created successfully!`);
      };
    };

    paintSelect();
  }

  /* ------------------------------------------------------- import / export */

  const IMPORT_COLUMNS = ["name", "email", "phone", "address", "state", "postnr"];

  const SAMPLE_ROWS = [
    ["Sample Kirana Store", "sample.store@example.com", "9800011122", "12 Main Bazaar Road", "MH", "411001"],
    ["Demo Provision Mart", "demo.mart@example.com", "9800011133", "Shop 4, Market Lane", "GJ", "380001"],
  ];

  const toCsv = (rows) =>
    rows
      .map((r) => r.map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Mirrors formatExportData() in Customers.jsx, including its
  // "Not provided" fallbacks.
  function exportCsv(cfg) {
    const rows = [["id", "name", "email", "phone", "address", "shipping_address"]].concat(
      Store.list(cfg.kind).map((c) => [
        c._id,
        nameOf(c),
        c.email || "",
        c.phone,
        c.adress1 || "Not provided",
        c.adress2 || "Not provided",
      ]),
    );
    download(`${cfg.kind}-customers.csv`, toCsv(rows));
    toast("Export downloaded.");
  }

  function downloadSample() {
    download("customer-sample.csv", toCsv([IMPORT_COLUMNS].concat(SAMPLE_ROWS)));
    toast("Sample template downloaded.");
  }

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const head = lines
      .shift()
      .split(",")
      .map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
    return lines.filter(Boolean).map((line) => {
      const cells = line.match(/("([^"]|"")*"|[^,]*)/g).filter((_, i) => i % 2 === 0);
      const o = {};
      head.forEach((h, i) => (o[h] = String(cells[i] || "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()));
      return o;
    });
  }

  function openImportModal(cfg) {
    const wrap = openModal(
      `<div class="mbody">
       <h2>Import ${esc(cfg.heading)}</h2>
       <p style="margin-bottom:14px">Pick a CSV with the columns <code>${IMPORT_COLUMNS.join(", ")}</code>, or load the built-in sample to preview the flow.</p>
       <div class="toolbar" style="padding:0 0 14px">
         <label class="btn btn-outline">${I.FiUpload} Browse file<input type="file" accept=".csv" hidden data-file></label>
         <button class="btn btn-outline" data-load-sample>${I.FileSpreadsheet} Load sample rows</button>
       </div>
       <div data-preview></div>
       </div>
       <div class="modal-foot">
         <button class="btn-modal" data-x>Cancel</button>
         <button class="btn btn-submit" style="height:2.5rem;padding:0 1.25rem" data-go disabled>Import</button>
       </div>`,
      { wide: true },
    );

    let parsed = [];
    const preview = $("[data-preview]", wrap);
    const go = $("[data-go]", wrap);

    const paint = () => {
      go.disabled = parsed.length === 0;
      preview.innerHTML = parsed.length
        ? `<div class="table-scroll" style="border:1px solid var(--line);border-radius:8px;max-height:240px;overflow:auto">
             <table class="grid" style="min-width:0">
               <thead><tr>${IMPORT_COLUMNS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
               <tbody>${parsed
                 .map((r) => `<tr>${IMPORT_COLUMNS.map((h) => `<td>${esc(r[h] || "")}</td>`).join("")}</tr>`)
                 .join("")}</tbody>
             </table>
           </div>
           <p class="hint" style="margin-top:10px">${parsed.length} row${parsed.length === 1 ? "" : "s"} ready to import.</p>`
        : `<p class="muted" style="padding:18px;text-align:center;border:1px dashed var(--line);border-radius:8px">No rows loaded yet.</p>`;
    };
    paint();

    $("[data-load-sample]", wrap).onclick = () => {
      parsed = SAMPLE_ROWS.map((r) => {
        const o = {};
        IMPORT_COLUMNS.forEach((h, i) => (o[h] = r[i]));
        return o;
      });
      paint();
    };
    $("[data-file]", wrap).onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          parsed = parseCsv(String(reader.result));
          paint();
        } catch (err) {
          toast("Could not parse that CSV.", "error");
        }
      };
      reader.readAsText(file);
    };
    $("[data-x]", wrap).onclick = closeOverlays;
    go.onclick = () => {
      const list = Store.list(cfg.kind);
      let added = 0;
      for (const r of parsed) {
        if (!r.phone) continue;
        const state = SEED.states.find((s) => s.code === (r.state || "").toUpperCase()) || {};
        list.unshift({
          _id: "imp_" + Date.now().toString(36) + "_" + added,
          orgNo: "",
          name: { en: r.name || "" },
          email: r.email || "",
          phone: r.phone,
          adress1: r.address || "",
          state,
          postnr: r.postnr || "",
          adress2: r.address || "",
          shippingState: state,
          shippingPostnumber: r.postnr || "",
          gstType: "",
          gstNumber: "",
          supplyChainType: cfg.kind === "retail" ? "PRIVATE" : "PUBLIC",
          locationCustomerTypeMap: [],
          tags: [],
          createdAt: new Date().toISOString().slice(0, 10),
        });
        added++;
      }
      Store.save();
      closeOverlays();
      S.page = 1;
      render();
      toast(
        added ? `${added} customers imported.` : "Nothing imported — every row needs a phone.",
        added ? "" : "error",
      );
    };
  }

  /* ----------------------------------------------------------------- mount */

  function mount(screen) {
    const cfg = SCREENS[screen];
    if (!cfg) throw new Error("Unknown screen: " + screen);

    Store.load();
    S = { cfg, search: "", tag: "", page: 1, checked: [] };

    mountShell($("#app"), { screen, crumb: cfg.crumb, tenant: SEED.tenant });
    render();
  }

  window.FB = {
    mount,
    reset() {
      Store.reset();
      if (S) render();
      toast("Seed data reset.");
    },
  };
})();
