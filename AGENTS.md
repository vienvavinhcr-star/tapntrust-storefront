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
- Extra Card parent/child cleanup, 5-card gift stand, or checkout integrity: inspect `js/cart-integrity.js`, `js/bundle-gift.js`, and `docs/COMMERCE.md`; inspect `js/cart.js` only if underlying cart state/mutations must change.
- Welcome offer / Google Sheet lead funnel: inspect `js/marketing/welcome-offer.js`, `css/welcome-offer.css`, `js/config.js`, `integrations/google-apps-script/lead-capture.gs`, and `scripts/check-welcome-offer.mjs`. Only inspect Shopify discount transport when auto-apply behavior changes.
- Review-link guide dialog: inspect `js/ui/guide.js` and `js/ui/common.js` only.
- Consultation form: inspect `js/forms/consultation.js`.
- Business search / Google review destination: read `docs/FULFILMENT.md`, then `js/business-finder.js`, `js/google-review.js`, and only related callers.
- Cart, packages, extras, discounts: read `docs/COMMERCE.md`, then `js/cart.js` and `js/shopify.js`.
- Meta Pixel / Clarity / analytics / test mode: read `docs/ANALYTICS.md`, then `js/test-mode.js`, `js/analytics/meta.js`, `js/clarity-events.js`, and only relevant callers.
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
16. The welcome offer is **WELCOMETNT for 10% off**. It may auto-open once after a successful primary Add to Cart, but dismissing it must not remove the offer from the cart. The 14-day suppression starts only after the customer successfully submits an email/claims the offer.
17. The cart must keep a recoverable welcome-offer CTA while a primary package exists and the offer is unclaimed. After claim, show the unlocked code/status instead of asking for email again during the active 14-day period.
18. Welcome signup may auto-apply `WELCOMETNT` using Shopify Storefront `cartDiscountCodesUpdate`; if auto-apply fails, the code must remain visible/copyable for manual checkout entry. Never hack the Shopify checkout URL for this discount.
19. Welcome lead tracking may record email, signup time, successful primary Add to Cart time and real checkout-click time. A new lead cycle must not inherit a checkout timestamp from an earlier lead. Do not mark checkout until the customer actually clicks an enabled checkout CTA.
20. The Google Apps Script lead endpoint is public-by-design, but no private Google credential may be embedded in browser code. Payment credentials must never be sent to the lead sheet.
21. Tapntrust owner test mode must suppress both Microsoft Clarity and browser-side Meta Pixel/events on the owner's browser. `?test=1` enables the persistent browser flag and `?test=0` disables it. Do not weaken this suppression without explicit owner approval.
22. A 5-card package includes one physical Counter Stand and that gift must be a **real Shopify line item**, not UI-only text. The storefront adds the normal Counter Stand as the Y item, while Shopify's active automatic Buy X get Y discount must make that linked gift line A$0. The gift must be linked to its parent package, removed when the parent is removed/changed away from 5 cards, and must never reach checkout with a non-zero line total. Do not create a separate A$0 bundle variant while this automatic discount flow is active.

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
- email collection / marketing consent / external lead endpoints

For sensitive changes, explicitly confirm in the final work summary that the protected invariants remain intact.

## Current source map

- `index.html` — main storefront markup and current production analytics bootstrap.
- `css/styles.css`, `css/styles.min.css` — storefront styling.
- `css/welcome-offer.css` — welcome popup and cart recovery offer presentation.
- `js/app.js` — small storefront entry/orchestrator and product configurator wiring.
- `js/app.min.js` — compatibility shim that imports `js/app.js`; do not add feature logic here.
- `js/ui/common.js` — shared toast, text, focus-trap and body-lock helpers.
- `js/ui/site.js` — independent site UI: navigation, product viewer, mobile bar, walkthrough, animations/carousels.
- `js/cart-drawer.js` — cart drawer rendering and user interactions; delegates state mutations to `js/cart.js`.
- `js/cart-integrity.js` — Extra Card parent/child enforcement, 5-card gift-stand synchronization, orphan cleanup and checkout guard.
- `js/bundle-gift.js` — 5-card package / automatic free Counter Stand linkage and A$0 gift validation helpers.
- `js/ui/guide.js` — review-link guide dialog.
- `js/forms/consultation.js` — consultation/contact form behaviour.
- `js/test-mode.js` — persistent owner analytics test mode shared by Meta and Clarity.
- `js/analytics/meta.js` — Meta Pixel fallback and browser-side pre-purchase commerce events.
- `js/marketing/welcome-offer.js` — welcome popup, cart recovery CTA, claim state, Shopify discount auto-apply and lead funnel forwarding.
- `js/metadata.js` — runtime canonical/OG/structured metadata.
- `js/cart.js` — cart state, Shopify line attributes, packages, upsells, discounts.
- `js/shopify.js` — Storefront API transport and GraphQL operations, including cart discount-code updates.
- `js/business-finder.js` — Google Places business selection.
- `js/google-review.js` — Google review URL helpers.
- `js/fulfilment.js` — fulfilment attribute keys and transformations.
- `js/clarity-events.js` — Microsoft Clarity funnel events plus persistent owner test-mode opt-out.
- `js/config.js` — public browser configuration, including the public lead endpoint and welcome offer settings.
- `js/page.js` — shared behaviour on supporting pages.
- `integrations/google-apps-script/lead-capture.gs` — Apps Script Web App source for the Tapntrust Leads Google Sheet.
- `scripts/check-invariants.mjs` — repository guardrails + JavaScript syntax checks.
- `scripts/check-cart-integrity.mjs` — regression tests for Extra Card dependency and 5-card gift rules.
- `scripts/check-welcome-offer.mjs` — regression checks for welcome offer claim, recovery, discount and funnel rules.

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
