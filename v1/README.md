# Discovery snapshot — v1 (accepted)

> Accepted discovery iteration, snapshotted per SPEC §3.1. **Frozen** — do not edit; the
> live prototype continues under `discovery/`. Ratified by
> [addendum-003](../../instructions/addendum-003-ratify-discovery-v1.md).

| Field | Value |
| ----- | ----- |
| **Version** | v1 |
| **Accepted** | 2026-08-11 |
| **Canonical direction** | Pixel-parity recreation of the live admin Customer Management group — `b2bgreens.com/platform/customers` and `/retail-customers`, tenant **QA store**, user **Mahesh · Admin** |
| **Method** | Built from the real source of `exagon-ai/storefront-frontend` (its literal Tailwind class strings via `myTheme.js`, real lucide/react-icons/RemixIcon glyphs, the font stack the deployed app renders), not from screenshots alone — [addendum-002](../../instructions/addendum-002-customer-management-html-replica.md) |
| **Canonical files** | `screens/customers/{b2b-customers,retail-customers}.html` + `{icons,shell,customers,seed.inline}.js` + `styles.css` |
| **Worked example / seed** | 22 B2B customers + 12 retail customers, every one auto-assigned the tenant's Default catalogue — `seed-data/seed.json` |
| **Locked decisions** | Findings F1–F16 and the decisions table in `../../design-principles.md` §5 |

## Contents

- `index.html` — wiring hub + transition map (the proto-FSM feeding SSOT-1 / SSOT-5)
- `screens/customers/index.html` — module hub: what each screen answers, what's reproduced as-is
- `screens/customers/b2b-customers.html` · `retail-customers.html` — the two screens
- `seed-data/seed.json` — fake-but-representative seed, mirrored inline in
  `screens/customers/seed.inline.js` because `file://` blocks fetching local JSON

The live tree's `screens/customers/_smoke/` (jsdom boot check) is **not** part of this
snapshot — it is a dev tool, not prototype content, matching the reference repo's convention.

## What this snapshot authorizes

Acceptance promotes these from "candidate" to binding SSOT inputs:

| # | Decision | Feeds |
| - | -------- | ----- |
| D1 | Customer = `{orgNo, name, email, phone, billing, shipping, tax:{type,id}, kind}`, `kind ∈ {B2B, RETAIL}` — one entity with a discriminator | SSOT-2, SSOT-4 |
| D2 | Phone is the only required identity field | SSOT-2, SSOT-5 |
| D3 | Tax identity is `{type: REGULAR\|EXEMPT, id}`, not a bare `gstNumber` | SSOT-2 |
| D4 | Address is a composite; the `-` fallback is a presentation rule, not stored data | SSOT-2, SSOT-3 |
| D5 | Catalogue assignment is `(customer, location) → customerType → catalogue`, and every customer — B2B or retail — defaults to the tenant's **Default** catalogue | SSOT-2, SSOT-4 |
| D6 | Feature availability (import, delete, stock, offers, tags, sample) is tenant state, not a build-time constant | SSOT-1, SSOT-5 |
| D7 | Only the customer list is a page; every other surface is a drawer or modal over it | SSOT-1, SSOT-5 |
| D8 | Delete always requires an explicit named confirmation | SSOT-1 |
| D9 | Opening Balance is capturable only at creation, never corrected later from this module | SSOT-2, SSOT-5 |
| D10 | SSOT-3 (component library) is derived from the app's `myTheme.js` override, not from `@windmill/react-ui`'s own defaults | SSOT-3 |

**Unresolved — carried forward, not promoted:** mobile table clipping vs. scrolling (F5/F11) and
the empty-selection bulk-action guard inconsistency between the two screens (F10). Picking either
silently would misrepresent the As-is app; both need a human decision before SSOT-3/SSOT-5 can
close on them.
