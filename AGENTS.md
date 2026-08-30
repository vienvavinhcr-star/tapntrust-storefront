# Tapntrust Storefront — Codex Operating Guide

Read this file before making any change in this repository. For normal tasks, this file is the first source of truth. Only open the linked docs that are relevant to the requested change.

## Project identity

- Brand spelling: **Tapntrust**.
- Production storefront: `https://tapntrust.com`.
- Frontend hosting: GitHub Pages.
- Commerce backend: Shopify Storefront API + Shopify Checkout.
- Business lookup: Google Places / Google Maps links.
- Payments: Shopify handles payment. The GitHub frontend must never collect or store card numbers/CVV.

## Fast task routing

Use the smallest relevant surface area.

- Copy, spacing, colours, layout, images: inspect only the relevant HTML/CSS. Do **not** audit cart, Shopify, fulfilment, Pixel or checkout unless the requested change touches them.
- Navigation, product viewer, mobile buy bar, placement carousel, step demo, reveal effects: inspect `js/ui/site.js` plus the relevant HTML/CSS only.
- Cart drawer presentation/interactions: inspect `js/ui/cart-drawer.js`; inspect `js/cart.js` only if cart state/mutations must change.
- Extra Card parent/child cleanup or checkout integrity: inspect `js/cart-integrity.js`; inspect `js/cart.js` only if the underlying Shopify cart mutation behaviour must change.
- Review-link guide dialog: inspect `js/ui/guide.js` and `js/ui/common.js` only.
- Consultation form: inspect `js/forms/consultation.js`.
- Business search / Google review destination: read `docs/FULFILMENT.md`, then `js/business-finder.js`, `js/google-review.js`, and only related callers.
- Cart, packages, extras, discounts: read `docs/COMMERCE.md`, then `js/cart.js` and `js/shopify.js`.
- Meta Pixel / Meta commerce events: read `docs/ANALYTICS.md`, then `js/analytics/meta.js` and only its relevant callers.
- SEO/runtime structured metadata: inspect `js/metadata.js`.
- Cross-cutting architectural changes: read `docs/ARCHITECTURE.md`.

## Non-negotiable invariants

1. **Shopify Checkout is the payment boundary.** Never implement custom payment-card handling in the GitHub storefront.
2. **Never fire Meta `Purchase` from the GitHub frontend.** A successful purchase is authoritative on the Shopify side.
3. **Never create a second Meta Pixel initialization or a second `PageView` source on the same page.**
4. The canonical Meta Pixel/Dataset ID for this storefront is documented in `docs/ANALYTICS.md` and must remain consistent wherever legacy inline markup still exists.
5. Do not change Shopify product handles unless the user explicitly asks. Current handles are documented in `docs/COMMERCE.md`.
6. A primary NFC card line must retain fulfilment metadata needed to program the card.
7. An Extra NFC Card is an add-on. It must inherit the selected business/review destination from its primary package, must be removed with that package, and orphan Extra Cards must be cleaned before checkout.
8. Counter Stand does not require business/review metadata.
9. Editing a primary package quantity/variant must preserve its business setup metadata.
10. Do not silently remove, rename, or repurpose fulfilment attribute keys.
11. Do not change checkout URLs or bypass the website business-selection flow unless explicitly requested.
12. Do not expose Shopify Admin/private tokens. Storefront browser tokens are public-by-design; Admin/private credentials are not.
13. Google browser API keys must remain HTTP-referrer/API restricted. Never replace them with unrestricted secret credentials in client code.
14. `js/app.js` is the canonical storefront entry source. `js/app.min.js` is only a tiny compatibility shim and must not become a second implementation.
15. Keep concerns in their existing module when possible; do not move unrelated logic back into `js/app.js`.

## Small-change policy — important for token efficiency

For presentation-only or narrowly scoped tasks:

- Make the smallest possible patch.
- Do not refactor unrelated code.
- Do not re-audit the entire repository.
- Do not inspect analytics/commerce merely because they exist.
- Do not rewrite working modules for style.
- Prefer one or two relevant files over broad repository reads.
- Run `npm run check` after the change when Node is available.
- If the invariant checker passes and the changed surface is isolated, stop; do not continue searching for hypothetical unrelated problems.

## Sensitive-change policy

If a task touches any of these areas, inspect the corresponding doc and run the invariant checker:

- Meta Pixel / analytics / conversion events
- cart or checkout
- Shopify API operations
- product handles / variants
- business selection / Google review links
- line-item attributes / fulfilment metadata
- discounts that alter checkout behaviour

For sensitive changes, explicitly confirm in the final work summary that the protected invariants remain intact.

## Current source map

- `index.html` — main storefront markup and current production analytics bootstrap.
- `css/styles.css`, `css/styles.min.css` — storefront styling.
- `js/app.js` — small storefront entry/orchestrator and product configurator wiring.
- `js/app.min.js` — compatibility shim that imports `js/app.js`; do not add feature logic here.
- `js/ui/common.js` — shared toast, text, focus-trap and body-lock helpers.
- `js/ui/site.js` — independent site UI: navigation, product viewer, mobile bar, walkthrough, animations/carousels.
- `js/ui/cart-drawer.js` — cart drawer rendering and user interactions; delegates state mutations to `js/cart.js`.
- `js/cart-integrity.js` — Extra Card parent/child enforcement, orphan cleanup and checkout guard.
- `js/ui/guide.js` — review-link guide dialog.
- `js/forms/consultation.js` — consultation/contact form behaviour.
- `js/analytics/meta.js` — Meta Pixel fallback and browser-side pre-purchase commerce events.
- `js/metadata.js` — runtime canonical/OG/structured metadata.
- `js/cart.js` — cart state, Shopify line attributes, packages, upsells, discounts.
- `js/shopify.js` — Storefront API transport and GraphQL operations.
- `js/business-finder.js` — Google Places business selection.
- `js/google-review.js` — Google review URL helpers.
- `js/fulfilment.js` — fulfilment attribute keys and transformations.
- `js/clarity-events.js` — Microsoft Clarity funnel events.
- `js/config.js` — public browser configuration.
- `js/page.js` — shared behaviour on supporting pages.
- `scripts/check-invariants.mjs` — repository guardrails + JavaScript syntax checks.
- `scripts/check-cart-integrity.mjs` — regression tests for Extra Card dependency rules.

## Documentation map

- Architecture: `docs/ARCHITECTURE.md`
- Commerce/cart/checkout: `docs/COMMERCE.md`
- Analytics/Pixel/Clarity: `docs/ANALYTICS.md`
- Business/review fulfilment data: `docs/FULFILMENT.md`

## Adding future notes

When the owner says **“add this note to AGENTS.md”**, add the new rule here in the most relevant section, keep it concise, and avoid duplicating an existing rule. If the note needs detail, put the detail in the relevant `docs/*.md` file and leave only a short routing/rule entry here.

## Definition of done

A change is done when:

- the requested behaviour is implemented;
- unrelated behaviour was not changed;
- relevant invariants are preserved;
- `npm run check` passes when available;
- only relevant files were touched; and
- the summary names exactly what changed and any intentional limitations.
