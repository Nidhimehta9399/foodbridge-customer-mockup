/* ==========================================================================
   DISCOVERY — Foodbridge Module Customer — icons

   The REAL glyphs the live app renders, inlined as SVG with the same viewBox
   and path data the packages ship. Two families, used in different places:

     lucide-react   — sidebar icons, resolved by NAME from the backend menu
                      config (globalSetting.storefrontMenus) via
                      src/config/sidebarIcons.js; plus BarChart2 (stock),
                      Search, Tag, ChevronUp/Down, Minus, TriangleAlert,
                      ClipboardList, History, FileSpreadsheet.
     react-icons/fi — (Feather) header + all action buttons: FiMenu, FiUser,
                      FiChevronDown, FiPlus, FiEdit, FiTrash2, FiGift, FiSend,
                      FiUpload, FiDownload.

   Because the sidebar icon NAMES come from backend config, the specific lucide
   names below are read off the As-is capture — see addendum-002 for the list to
   confirm. Two are certain because they are hard-coded in SidebarContent.jsx:
   MapPinned (Route Delivery) and QrCode (Store QR Code).

   Loaded before shell.js / customers.js. Exposes window.FB_ICONS.
   ========================================================================== */

(function () {
  // lucide-react: 24×24, stroke 2, round caps/joins, fill none.
  const lu = (d, size) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  // react-icons/fi (Feather): identical geometry conventions, different paths.
  const fi = lu;

  window.FB_ICONS = {
    /* ---- lucide — sidebar (names from the backend menu config) ---------- */
    LayoutGrid: lu('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'),
    Package: lu('<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
    Users: lu('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    ShoppingCart: lu('<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>'),
    LineChart: lu('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>'),
    // Hard-coded in SidebarContent.jsx — certain.
    MapPinned: lu('<path d="M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 0 1-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0 1 12 0"/><circle cx="12" cy="8" r="2"/><path d="M8.714 14h-3.71a1 1 0 0 0-.948.683l-2.004 6A1 1 0 0 0 3 22h18a1 1 0 0 0 .948-1.316l-2-6a1 1 0 0 0-.949-.684h-3.712"/>'),
    QrCode: lu('<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>'),

    /* ---- lucide — submenu chrome (SidebarSubMenu.jsx) ------------------- */
    ChevronUp: lu('<path d="m18 15-6-6-6 6"/>', 16),
    ChevronDownLu: lu('<path d="m6 9 6 6 6-6"/>', 16),
    Minus: lu('<path d="M5 12h14"/>', 12),
    // StockCountView: CheckCircle2 on Save, FiMinus/FiPlus in the stepper
    Check: lu('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', 16),
    // EntityTagDrawer selection tick (lucide Check, no circle)
    CheckMark: lu('<path d="M20 6 9 17l-5-5"/>', 14),

    /* ---- lucide — page chrome ------------------------------------------ */
    Search: lu('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', 16),
    Tag: lu('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>', 14),
    // CustomerTable.jsx row action: <BarChart2 /> from lucide.
    BarChart2: lu('<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>'),
    TriangleAlert: lu('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    ClipboardList: lu('<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>', 16),
    History: lu('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>', 16),
    FileSpreadsheet: lu('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>', 16),

    /* ---- react-icons/fi (Feather) — header + actions -------------------- */
    FiMenu: fi('<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>'),
    FiUser: fi('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    FiChevronDown: fi('<polyline points="6 9 12 15 18 9"/>', 16),
    FiPlus: fi('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', 16),
    FiEdit: fi('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
    FiTrash2: fi('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
    FiGift: fi('<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>'),
    FiSend: fi('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
    // RetailCampaignLinkModal: FiSmartphone
    FiSmartphone: fi('<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>'),
    // GenerateSmartLinkModal: lucide Info
    Info: lu('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>', 16),
    FiUpload: fi('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
    FiDownload: fi('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    FiX: fi('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),

    // RetailCampaignLinkModal: RiWhatsappLine (remixicon) — filled, not stroked.
    Whatsapp:
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm5.8 14.1c-.24.68-1.4 1.3-1.93 1.34-.5.05-1.02.24-3.42-.71-2.9-1.15-4.76-4.1-4.9-4.29-.14-.19-1.17-1.55-1.17-2.96s.73-2.1 1-2.39c.24-.26.53-.32.71-.32.18 0 .35 0 .5.01.17.01.39-.06.6.46.24.58.81 2 .88 2.14.07.14.12.31.02.5-.1.19-.15.31-.29.48-.14.17-.3.37-.43.5-.14.14-.29.29-.13.57.17.29.75 1.24 1.62 2.01 1.11.99 2.04 1.3 2.33 1.44.29.14.46.12.63-.07.17-.19.72-.84.92-1.13.19-.29.38-.24.63-.14.26.1 1.65.78 1.93.92.29.14.48.21.55.33.07.12.07.68-.17 1.36Z"/></svg>',

    /* ---- brand ---------------------------------------------------------
       src/assets/img/icons/bag.svg — a filled emerald shopping bag, NOT a
       stroked lucide glyph. Reproduced verbatim (mask flattened away). */
    bag:
      '<svg width="28" height="28" viewBox="0 0 16 19" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12.5714 5.71429V4.57143C12.5714 2.05071 10.5207 0 8 0C5.47929 0 3.42857 2.05071 3.42857 4.57143V5.71429H0V15.4286C0 17.0065 1.27918 18.2857 2.85714 18.2857H13.1429C14.7208 18.2857 16 17.0065 16 15.4286V5.71429H12.5714ZM5.71429 4.57143C5.71429 3.31107 6.73964 2.28571 8 2.28571C9.26036 2.28571 10.2857 3.31107 10.2857 4.57143V5.71429H5.71429V4.57143ZM11.4286 8.85714C10.9552 8.85714 10.5714 8.47339 10.5714 8C10.5714 7.52661 10.9552 7.14286 11.4286 7.14286C11.902 7.14286 12.2857 7.52661 12.2857 8C12.2857 8.47339 11.902 8.85714 11.4286 8.85714ZM4.57143 8.85714C4.09804 8.85714 3.71429 8.47339 3.71429 8C3.71429 7.52661 4.09804 7.14286 4.57143 7.14286C5.04482 7.14286 5.42857 7.52661 5.42857 8C5.42857 8.47339 5.04482 8.85714 4.57143 8.85714Z" fill="#10B981"/>' +
      "</svg>",
  };
})();
