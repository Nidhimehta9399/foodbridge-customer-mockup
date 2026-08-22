/* ==========================================================================
   DISCOVERY — Foodbridge Module Customer — app shell + shared UI primitives

   Everything that is *not* customer-specific: the sidebar/topbar chrome, the
   drawer / modal / anchored-menu / toast primitives, and the small helpers the
   screens share. Provenance:

     region        app source
     ------------  --------------------------------------------------------
     page shell    src/layout/Layout.jsx · src/layout/Main.jsx
     sidebar       src/components/sidebar/DesktopSidebar.jsx
                   src/components/sidebar/SidebarContent.jsx
                   src/components/sidebar/SidebarSubMenu.jsx
                   src/components/sidebar/StoreSelector.jsx (brand)
     header        src/components/header/Header.jsx
     drawer        src/components/drawer/MainDrawer.jsx
     modal         src/components/modal/DeleteModal.jsx (windmill Modal base)
     menu          src/components/common/BulkActionDropdown.jsx (portal + anchor)
     toast         src/utils/toast.js (notifySuccess / notifyError)

   Loaded after icons.js, before customers.js. Exposes window.FB_SHELL.
   ========================================================================== */

(function () {
  "use strict";

  const I = window.FB_ICONS;

  /* ---------------------------------------------------------------- helpers */

  const $ = (sel, root) => (root || document).querySelector(sel);

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );

  // Mirrors useUtilsFunction().toTitleCaseFun — the live table title-cases the
  // customer name and the catalogue chip.
  const titleCase = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase());

  const debounce = (fn, ms) => {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  };

  /* ---------------------------------------------------------------- toasts */

  // react-toastify shape: round status icon, message, close ×, draining bar.
  function toast(message, tone) {
    let host = $(".toasts");
    if (!host) {
      host = document.createElement("div");
      host.className = "toasts";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "toast" + (tone ? " " + tone : "");
    const glyph = tone === "error" ? "!" : tone === "info" ? "i" : "✓";
    el.innerHTML =
      `<span class="ticon">${glyph}</span><span class="tmsg"></span>` +
      `<button class="tclose" aria-label="Close">✕</button>`;
    $(".tmsg", el).textContent = message;
    $(".tclose", el).onclick = () => el.remove();
    host.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* ------------------------------------------------------- overlay surfaces */

  function closeOverlays() {
    document.querySelectorAll(".scrim, .drawer, .modal-wrap, .menu").forEach((n) => n.remove());
  }

  // `large` is MainDrawer's default 82% width (every Add/Edit/Stock/Offers
  // drawer). `narrow` is DirectoryDrawer's own drawerWidth="70%" — used only by
  // the tag-selection drawer, which is a different component entirely.
  function openDrawer({ title, description, body, footer, large, narrow }) {
    closeOverlays();
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    const drawer = document.createElement("aside");
    drawer.className = "drawer" + (large ? " large" : "") + (narrow ? " narrow" : "");
    // MainDrawer renders its own floating close button, outside the header.
    drawer.innerHTML = `
      <button class="drawer-x" aria-label="Close drawer">${I.FiX}</button>
      <div class="drawer-head">
        <h3>${title}</h3>
        ${description ? `<p>${description}</p>` : ""}
      </div>
      ${body}
      ${footer ? `<div class="drawer-foot">${footer}</div>` : ""}`;
    document.body.append(scrim, drawer);
    $(".drawer-x", drawer).onclick = closeOverlays;
    requestAnimationFrame(() => {
      scrim.classList.add("show");
      drawer.classList.add("show");
    });
    scrim.onclick = closeOverlays;
    return drawer;
  }

  // `wide`/`small`/`tall` size the modal (DeleteModal's default vs
  // GenerateSmartLinkModal's `max-w-4xl h-[92vh]`). `alwaysCenter` is for
  // modals with their own hand-rolled backdrop (RetailCampaignLinkModal) that
  // never adopt myTheme's mobile bottom-sheet behaviour.
  function openModal(html, opts) {
    closeOverlays();
    const o = opts || {};
    const scrim = document.createElement("div");
    // GenerateSmartLinkModal ships its own `bg-black/60 backdrop-blur-sm`
    // scrim (darker + blurred), distinct from myTheme's plain black/50.
    scrim.className = "scrim show" + (o.blurDark ? " blur-dark" : "");
    const wrap = document.createElement("div");
    const cls = ["modal-wrap"];
    if (o.alwaysCenter) cls.push("always-center");
    wrap.className = cls.join(" ");
    const modalCls = ["modal"];
    if (o.wide) modalCls.push("wide");
    if (o.small) modalCls.push("small");
    if (o.tall) modalCls.push("tall");
    wrap.innerHTML = `<div class="${modalCls.join(" ")}">${html}</div>`;
    document.body.append(scrim, wrap);
    scrim.onclick = closeOverlays;
    return wrap;
  }

  // Anchored dropdown — the live BulkActionDropdown portals its menu to <body>
  // and positions it off the button's bounding rect, which is why this does too.
  function openMenu(anchor, items) {
    document.querySelectorAll(".menu").forEach((n) => n.remove());
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "menu";
    // Single-line items — the live menu has no descriptions.
    menu.innerHTML = items
      .map(
        (it, i) =>
          `<button data-i="${i}" class="${it.danger ? "danger" : ""}">${it.icon || ""}<span>${it.label}</span></button>`,
      )
      .join("");
    document.body.appendChild(menu);
    const w = menu.offsetWidth;
    menu.style.top = Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8) + "px";
    menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + "px";
    menu.onclick = (e) => {
      const btn = e.target.closest("button[data-i]");
      if (!btn) return;
      menu.remove();
      items[+btn.dataset.i].onClick();
    };
    setTimeout(() => {
      document.addEventListener("click", function off(ev) {
        if (!menu.contains(ev.target)) {
          menu.remove();
          document.removeEventListener("click", off);
        }
      });
    }, 0);
  }

  /* ------------------------------------------------------------- app shell */

  // Sidebar entries come from the backend menu config
  // (globalSetting.storefrontMenus) in the live app — names, order, grouping and
  // lucide icon NAMES are all tenant data, not code. This list is read off the
  // As-is capture of the "QA store" tenant. Only the Customer Management group
  // is prototyped; everything else raises a notice.
  //
  // Route Delivery and Store QR Code are NOT part of that config — they are
  // hard-coded in SidebarContent.jsx, Route Delivery below a `border-t` divider
  // and Store QR Code in its own bottom section with a green icon. Hence the
  // `foot` / `qr` slots below rather than another NAV entry.
  const NAV = [
    { label: "Dashboard", icon: I.LayoutGrid },
    {
      label: "Product Master", icon: I.Package, group: true, open: true,
      children: [
        { label: "Finished Goods" }, { label: "Product Categories" },
        { label: "Raw Materials" }, { label: "Image Gallery" },
      ],
    },
    {
      label: "Customer Management", icon: I.Users, group: true, open: true,
      children: [
        { label: "B2B Customers", screen: "b2b", href: "b2b-customers.html" },
        { label: "Retail Customers", screen: "retail", href: "retail-customers.html" },
        { label: "Stock Audit & Health", screen: "stock-audit", href: "stock-audit.html" },
      ],
    },
    { label: "Sales Orders", icon: I.ShoppingCart },
    {
      label: "Distribution & Logistics", icon: I.Users, group: true, open: true,
      children: [
        { label: "Route Planning" }, { label: "Delivery Management" }, { label: "Logistic Returns" },
      ],
    },
    {
      label: "Production", icon: I.LineChart, group: true, open: true,
      children: [
        { label: "Batch Management" }, { label: "Semifinished Products" }, { label: "Configure Recipe" },
      ],
    },
  ];

  function shellHTML(screen, crumb, tenant) {
    const nav = NAV.map((item) => {
      if (!item.group) {
        return `<li><button class="nav-item" data-stub="${esc(item.label)}">
                  <span class="ic">${item.icon}</span><span>${esc(item.label)}</span>
                </button></li>`;
      }
      const kids = (item.children || [])
        .map((k) => {
          const active = k.screen === screen;
          const attrs = k.href ? `href="${k.href}"` : `data-stub="${esc(k.label)}"`;
          return `<li><a ${attrs} class="${active ? "active" : ""}">
                    <span class="dash">${I.Minus}</span>${esc(k.label)}
                  </a></li>`;
        })
        .join("");
      // A group renders green (bg-green-50) only when one of ITS children is the
      // active route — `isChildActive` in SidebarSubMenu.jsx.
      const childActive = (item.children || []).some((k) => k.screen === screen);
      return `
        <li class="nav-group open ${childActive ? "child-active" : ""}">
          <button>
            <span class="lbl"><span class="ic">${item.icon}</span><span class="txt">${esc(item.label)}</span></span>
            <span class="chev">${I.ChevronUp}</span>
          </button>
          <ul class="nav-sub">${kids}</ul>
        </li>`;
    }).join("");

    const user = tenant.user;
    return `
      <aside class="sidebar">
        <div class="sidebar-inner">
          <div class="brand">
            <span class="mark">${I.bag}</span>
            <span class="name">${esc(tenant.name)}</span>
          </div>
          <div class="nav-scroll">
            <ul class="nav">${nav}</ul>
          </div>
          <div class="nav-foot">
            <button class="nav-item" data-stub="Route Delivery">
              <span class="ic">${I.MapPinned}</span><span>Route Delivery</span>
            </button>
          </div>
          <div class="nav-qr">
            <button class="nav-item" data-stub="Store QR Code">
              <span class="ic green">${I.QrCode}</span><span>Store QR Code</span>
            </button>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <button class="hamburger" aria-label="Toggle sidebar">${I.FiMenu}</button>
            <h1 class="crumb">${esc(crumb)}</h1>
          </div>
          <div class="who">
            <span class="avatar">${I.FiUser}<i class="dot"></i></span>
            <span class="meta"><b>${esc(user.name)}</b><span>${esc(user.role)}</span></span>
            <span class="caret">${I.FiChevronDown}</span>
          </div>
        </header>
        <main class="page" id="page"></main>
      </div>`;
  }

  /** Render the shell into `root` and wire its chrome. Returns the page host. */
  function mountShell(root, { screen, crumb, tenant }) {
    root.innerHTML = shellHTML(screen, crumb, tenant);

    root.querySelectorAll(".nav-group > button").forEach((b) => {
      b.onclick = () => {
        const li = b.parentElement;
        li.classList.toggle("open");
        // SidebarSubMenu swaps ChevronUp ⇄ ChevronDown rather than rotating one.
        $(".chev", li).innerHTML = li.classList.contains("open") ? I.ChevronUp : I.ChevronDownLu;
      };
    });
    root.querySelectorAll("[data-stub]").forEach((n) => {
      n.onclick = (e) => {
        e.preventDefault();
        toast(`"${n.dataset.stub}" is outside this discovery iteration.`, "info");
      };
    });
    $(".hamburger", root).onclick = () => $(".sidebar", root).classList.toggle("open");

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeOverlays();
    });

    return $("#page", root);
  }

  window.FB_SHELL = {
    $, esc, titleCase, debounce,
    toast, closeOverlays, openDrawer, openModal, openMenu,
    mountShell, NAV,
  };
})();
