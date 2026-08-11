/* ==========================================================================
   DISCOVERY — Foodbridge Module Customer — inline seed

   MIRROR OF ../../seed-data/seed.json — edit both together.
   The prototype runs from file:// and cannot fetch local JSON, so the seed is
   duplicated here as a plain script. seed-data/seed.json stays the canonical,
   human-readable copy; this file is what the screens actually load.

   Shapes mirror the live API responses consumed by
   storefront-frontend/src/pages/Customers.jsx and RetailCustomers.jsx:

     GET /customer            -> { data: { orgs: [...], totalOrgsCount } }
     GET /customer/retail     -> { data: { orgs: [...], totalOrgsCount } }
     GET /catalogue           -> { data: [ { customerTypeReference, catalogue } ] }

   Field names deliberately keep the API's spelling quirks (`adress1`,
   `adress2`, `postnr`) so the prototype exercises the same mapping the React
   pages do.
   ========================================================================== */

(function () {
  // Single active location — the live app scopes catalogue + credit assignment
  // per location via getCurrentLocationId().
  const LOCATION = "loc_qa_store_01";

  // Customer types are the join between a customer and a catalogue.
  const TYPE = {
    default: "ctype_default",
    cat1: "ctype_catalogue_1",
    cat2: "ctype_catalogue_2",
  };

  const catalogues = [
    { _id: "cat_00", customerTypeReference: TYPE.default, catalogue: { name: "Default" } },
    { _id: "cat_01", customerTypeReference: TYPE.cat1, catalogue: { name: "Catalogue 1" } },
    { _id: "cat_02", customerTypeReference: TYPE.cat2, catalogue: { name: "Catalogue 2" } },
  ];

  const states = [
    { code: "MH", name: "Maharashtra" },
    { code: "GJ", name: "Gujarat" },
    { code: "KA", name: "Karnataka" },
    { code: "DL", name: "Delhi" },
    { code: "RJ", name: "Rajasthan" },
    { code: "TN", name: "Tamil Nadu" },
    { code: "UP", name: "Uttar Pradesh" },
    { code: "MP", name: "Madhya Pradesh" },
  ];

  const st = (code) => states.find((s) => s.code === code) || {};

  /** Build a customer in the exact shape the list screens read. */
  function customer(o) {
    return {
      _id: o.id,
      orgNo: o.orgNo || "",
      name: { en: o.name },
      email: o.email || "",
      phone: o.phone,
      // billing
      adress1: o.address || "",
      state: o.state ? st(o.state) : {},
      postnr: o.pin || "",
      // shipping
      adress2: o.shipAddress || o.address || "",
      shippingState: o.shipState ? st(o.shipState) : o.state ? st(o.state) : {},
      shippingPostnumber: o.shipPin || o.pin || "",
      // tax
      gstType: o.gstType || "",
      gstNumber: o.gstNumber || "",
      supplyChainType: o.supplyChainType || "PUBLIC",
      // catalogue assignment, per location
      locationCustomerTypeMap: o.type
        ? [{ locationRef: LOCATION, customerTypeRef: o.type }]
        : [],
      tags: o.tags || [],
      createdAt: o.createdAt,
    };
  }

  /* ---- B2B customers (route /customers) --------------------------------
     First ten rows reproduce the As-is screenshot verbatim (names, phone
     numbers, catalogue chips, and the empty ADDRESS column that renders "-").
     Rows 11+ add the variety the screenshot doesn't cover: filled addresses,
     GST-registered vs exempt, a customer code, and a second page of results. */

  const b2b = [
    { id: "c01", name: "Raman", email: "raman@gmail.com", phone: "985673456", type: TYPE.default, tags: ["normal"], createdAt: "2026-01-14" },
    { id: "c02", name: "A New Customer", phone: "9384594893", type: TYPE.default, createdAt: "2026-01-22" },
    { id: "c03", name: "Aai Mata General Store", phone: "82736450195", type: TYPE.default, tags: ["regular"], createdAt: "2026-02-02" },
    { id: "c04", name: "Ganraj Kirana Mart", phone: "41589627074", type: TYPE.cat2, createdAt: "2026-02-11" },
    { id: "c05", name: "Shree Ram Super Market", phone: "56820973184", type: TYPE.cat2, tags: ["regular"], createdAt: "2026-02-19" },
    { id: "c06", name: "New Bharat General Store", phone: "64082719536", type: TYPE.cat2, createdAt: "2026-03-04" },
    { id: "c07", name: "Laxmi Provision Store", phone: "97315042861", type: TYPE.default, tags: ["normal"], createdAt: "2026-03-12" },
    { id: "c08", name: "Raj Traders", phone: "53197286440", type: TYPE.cat1, createdAt: "2026-03-25" },
    { id: "c09", name: "Shivam Grocery Store", phone: "28946175318", type: TYPE.default, createdAt: "2026-04-02" },
    { id: "c10", name: "Shree Datta Super Store", phone: "70631984512", type: TYPE.default, createdAt: "2026-04-15" },

    {
      id: "c11", name: "Sai Enterprises", orgNo: "CUST-0011",
      email: "accounts@saient.in", phone: "9822014455",
      address: "Shop 14, Market Yard", state: "MH", pin: "411037",
      gstType: "regular", gstNumber: "27AAECS1234F1Z5",
      type: TYPE.cat1, createdAt: "2026-04-28",
    },
    {
      id: "c12", name: "Annapurna Wholesale", orgNo: "CUST-0012",
      email: "orders@annapurna.co.in", phone: "9930778812",
      address: "Plot 22, MIDC Phase II", state: "MH", pin: "400705",
      shipAddress: "Warehouse 4, Kalamboli Godown Cluster", shipState: "MH", shipPin: "410218",
      gstType: "regular", gstNumber: "27AABCA9876K1ZP",
      type: TYPE.cat2, createdAt: "2026-05-06",
    },
    {
      id: "c13", name: "Gokul Dairy & General", orgNo: "CUST-0013",
      email: "gokul.dairy@gmail.com", phone: "9426100077",
      address: "Near Bus Stand, Anand", state: "GJ", pin: "388001",
      gstType: "exempt", gstNumber: "UDIN-2026-004518",
      type: TYPE.default, createdAt: "2026-05-19",
    },
    {
      id: "c14", name: "Balaji Super Bazaar", orgNo: "CUST-0014",
      email: "balaji.bazaar@outlook.com", phone: "9845220311",
      address: "3rd Cross, Jayanagar 4th Block", state: "KA", pin: "560011",
      gstType: "regular", gstNumber: "29AACCB4321M1Z8",
      type: TYPE.cat1, createdAt: "2026-06-01",
    },
    {
      id: "c15", name: "Hind Provision Stores", orgNo: "CUST-0015",
      phone: "9312044566",
      address: "Khari Baoli, Chandni Chowk", state: "DL", pin: "110006",
      type: TYPE.default, createdAt: "2026-06-10",
    },
    {
      id: "c16", name: "Marwar Trading Co.", orgNo: "CUST-0016",
      email: "marwar.trading@gmail.com", phone: "9414088990",
      address: "Johari Bazaar Road", state: "RJ", pin: "302003",
      gstType: "regular", gstNumber: "08AAFCM5566Q1ZR",
      type: TYPE.cat2, createdAt: "2026-06-24",
    },
    {
      id: "c17", name: "Kaveri Stores", orgNo: "CUST-0017",
      email: "kaveristores@yahoo.in", phone: "9840566123",
      address: "12 Anna Salai", state: "TN", pin: "600002",
      type: TYPE.default, createdAt: "2026-07-03",
    },
    {
      id: "c18", name: "Ganga Kirana Bhandar", orgNo: "CUST-0018",
      phone: "9335001278",
      address: "Aminabad Main Road", state: "UP", pin: "226018",
      gstType: "exempt", gstNumber: "UDIN-2026-009902",
      type: TYPE.default, createdAt: "2026-07-16",
    },
    {
      id: "c19", name: "Narmada Distributors", orgNo: "CUST-0019",
      email: "sales@narmadadist.in", phone: "9827311456",
      address: "Zone-II, Maharana Pratap Nagar", state: "MP", pin: "462011",
      gstType: "regular", gstNumber: "23AAGCN7788L1ZW",
      type: TYPE.cat1, createdAt: "2026-07-28",
    },
    {
      id: "c20", name: "Konkan Fresh Mart", orgNo: "CUST-0020",
      email: "konkanfresh@gmail.com", phone: "9022778899",
      address: "Station Road, Ratnagiri", state: "MH", pin: "415612",
      type: TYPE.cat2, createdAt: "2026-08-04",
    },
    {
      id: "c21", name: "Vishal Wholesale Depot", orgNo: "CUST-0021",
      email: "vishal.depot@gmail.com", phone: "9998112233",
      address: "Ring Road, Surat", state: "GJ", pin: "395002",
      gstType: "regular", gstNumber: "24AADCV2211H1ZK",
      type: TYPE.cat2, createdAt: "2026-08-07",
    },
    {
      id: "c22", name: "Sharda Retail Chain", orgNo: "CUST-0022",
      phone: "9765004411",
      address: "FC Road", state: "MH", pin: "411005",
      type: TYPE.default, createdAt: "2026-08-09",
    },
  ].map(customer);

  /* ---- Retail customers (route /retail-customers) -----------------------
     supplyChainType is always PRIVATE; no GST fields, no catalogue chips in
     practice — the app auto-assigns every new customer, retail or B2B, to
     the tenant's Default catalogue at the current location — and the row
     actions swap the Stock button for Send Ordering Link. */

  const retail = [
    { id: "r01", name: "Priya Deshmukh", email: "priya.d@gmail.com", phone: "9822711045", address: "Flat 302, Sunrise Residency, Baner", state: "MH", pin: "411045", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-03-08" },
    { id: "r02", name: "Anil Kumar", phone: "9812004477", address: "House 21, Sector 15", state: "DL", pin: "110085", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-03-21" },
    { id: "r03", name: "Meera Iyer", email: "meera.iyer@outlook.com", phone: "9840112233", address: "4/7 Besant Nagar", state: "TN", pin: "600090", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-04-05" },
    { id: "r04", name: "Rakesh Jain", phone: "9414556677", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-04-18" },
    { id: "r05", name: "Sunita Patil", email: "sunita.patil91@gmail.com", phone: "9004556621", address: "B-12, Shanti Nagar, Andheri East", state: "MH", pin: "400069", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-05-02" },
    { id: "r06", name: "Imran Shaikh", phone: "9739004512", address: "18, Cox Town", state: "KA", pin: "560005", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-05-17" },
    { id: "r07", name: "Kavita Sharma", email: "kavita.sharma@gmail.com", phone: "9827004488", address: "Arera Colony, E-3", state: "MP", pin: "462016", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-06-03" },
    { id: "r08", name: "Devendra Rathod", phone: "9925117744", address: "Navrangpura", state: "GJ", pin: "380009", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-06-20" },
    { id: "r09", name: "Farida Ansari", email: "farida.ansari@yahoo.com", phone: "9335447788", address: "Gomti Nagar, Vibhuti Khand", state: "UP", pin: "226010", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-07-09" },
    { id: "r10", name: "Suresh Nair", phone: "9820331155", address: "Ganesh Peth", state: "MH", pin: "411002", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-07-25" },
    { id: "r11", name: "Neha Agarwal", email: "neha.ag@gmail.com", phone: "9414990022", address: "Vaishali Nagar", state: "RJ", pin: "302021", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-08-02" },
    { id: "r12", name: "Ravi Verma", phone: "9312778866", supplyChainType: "PRIVATE", type: TYPE.default, createdAt: "2026-08-08" },
  ].map(customer);

  /* ---- Per-customer stock counts, backing the Stock drawer -------------- */
  const stockCounts = {
    c01: [
      { product: "Amul Taaza 500ml", unit: "Crate", counted: 12, countedAt: "2026-08-09" },
      { product: "Britannia Bread 400g", unit: "Packet", counted: 30, countedAt: "2026-08-09" },
    ],
    c05: [{ product: "Tata Salt 1kg", unit: "Box", counted: 8, countedAt: "2026-08-06" }],
    c11: [
      { product: "Parle-G 800g", unit: "Box", counted: 15, countedAt: "2026-08-07" },
      { product: "Bisleri 1L", unit: "Crate", counted: 40, countedAt: "2026-08-07" },
    ],
  };

  /* ---- Stock counting SESSIONS, backing the Stock History view ----------
     One record per count; each expands to its per-product lines. */
  const stockSessions = {
    c01: [
      {
        at: "10 Aug 2026, 15:41",
        comment: "",
        lines: [{ artNo: "34567", product: "250ML PET", system: 2, counted: 2 }],
      },
    ],
    c02: [
      {
        at: "10 Aug 2026, 15:41",
        comment: "",
        lines: [{ artNo: "a102", product: "Mini Bread 100gm", system: 2, counted: 1 }],
      },
    ],
    c05: [
      {
        at: "06 Aug 2026, 11:02",
        comment: "Monthly audit — aisle 3 & 4",
        lines: [
          { artNo: "g301", product: "Tata Salt 1kg", system: 8, counted: 8 },
          { artNo: "b401", product: "Parle-G 800g", system: 15, counted: 13 },
        ],
      },
    ],
    c11: [
      {
        at: "07 Aug 2026, 09:20",
        comment: "Opening count",
        lines: [
          { artNo: "b401", product: "Parle-G 800g", system: 15, counted: 15 },
          { artNo: "34567", product: "250ML PET", system: 2, counted: 4 },
        ],
      },
    ],
  };

  /* ---- Per-customer offers, backing the Offers drawer -------------------
     OfferListView shows two columns only: Offer Name and Benefit. */
  const offers = {
    c01: [{ title: "Buy 10 Get 1 Free", benefit: "Free Item" }],
    c04: [{ title: "5% off on Catalogue 2 staples", benefit: "Percentage Discount" }],
    c05: [
      { title: "Buy 10 crates, get 1 free", benefit: "Free Item" },
      { title: "Flat ₹500 off above ₹10,000", benefit: "Flat Discount" },
    ],
    c11: [{ title: "Monsoon combo pack", benefit: "Bundle Price" }],
  };

  /* ---- Catalogue products, backing the Stock Count view -----------------
     StockCountView lists every product in the catalogue with its system stock
     so the admin can enter a physical count and see the difference. Shapes
     follow the product list the live view consumes (name, article number,
     category, per-unit system stock). */
  const products = [
    { id: "p01", name: "250ML PET", artNo: "34567", category: "SQUARE BOTTLE", unit: "Bottle", systemStock: 2, emoji: "🧴" },
    { id: "p02", name: "500ML PET", artNo: "89744", category: "SQUARE BOTTLE", unit: "Bottle", systemStock: 1, emoji: "🧴" },
    { id: "p03", name: "1LTR BOTTLE", artNo: "42534", category: "SQUARE BOTTLE", unit: "Bottle", systemStock: 1, emoji: "🍶" },
    { id: "p04", name: "NATURAL WATER", artNo: "4534", category: "ROUND BOTTLE", unit: "Bottle", systemStock: 0, emoji: "💧" },
    { id: "p05", name: "SODA 650ML", artNo: "435345", category: "ROUND BOTTLE", unit: "Bottle", systemStock: 0, emoji: "🥤" },
    { id: "p06", name: "Mini Bread 100gm", artNo: "a102", category: "BREAD", unit: "Pc", systemStock: 2, emoji: "🥖" },
    { id: "p07", name: "Milk Bread 200gm", artNo: "a103", category: "BREAD", unit: "Pc", systemStock: 1, emoji: "🍞" },
    { id: "p08", name: "Milk Bread 350gm", artNo: "a104", category: "BREAD", unit: "Pc", systemStock: 3, emoji: "🍞" },
    { id: "p09", name: "Amul Taaza 500ml", artNo: "d201", category: "DAIRY", unit: "Crate", systemStock: 12, emoji: "🥛" },
    { id: "p10", name: "Britannia Bread 400g", artNo: "a105", category: "BREAD", unit: "Packet", systemStock: 30, emoji: "🍞" },
    { id: "p11", name: "Tata Salt 1kg", artNo: "g301", category: "GROCERY", unit: "Box", systemStock: 8, emoji: "🧂" },
    { id: "p12", name: "Parle-G 800g", artNo: "b401", category: "BISCUITS", unit: "Box", systemStock: 15, emoji: "🍪" },
  ];

  /* ---- Tenant feature flags (localStorage `appProp` in the live app) ----
     These gate whole regions of the B2B screen. Toggle them here to role-play
     a different tenant configuration. bulkImportEnabled (and therefore
     sampleEnabled, which is nested under it) is OFF here to match the "QA
     store" As-is capture, which never shows Import / Export / Download Sample. */
  const appProp = {
    isTagFeatureEnabled: true,
    customerManagementFeatures: {
      bulkImportEnabled: false,
      deleteEnabled: true,
      stockEnabled: true,
      offerEnabled: true,
      sampleEnabled: false,
      catalogMappingEnabled: false,
      creditWalletMappingEnabled: false,
    },
    notification: { isEnabled: true },
  };

  window.SEED = {
    // Tenant + operator shown in the shell, read off the As-is capture.
    tenant: { name: "QA store", user: { name: "Mahesh", role: "Admin" } },
    location: LOCATION,
    // menu label — the live sidebar renames "Customers" per tenant via
    // useMenuLabel("customers"); this tenant calls them "B2B Customers".
    customersLabel: "B2B Customers",
    orgGstNumber: "27AAACQ1234A1Z9",
    pageSize: 20,
    catalogues,
    states,
    b2b,
    retail,
    stockCounts,
    stockSessions,
    offers,
    products,
    appProp,
  };
})();
