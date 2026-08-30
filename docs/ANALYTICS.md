# Tapntrust Analytics

## Canonical IDs

- Meta Pixel / Dataset ID: `2121538478429149`
- Google Analytics measurement ID: `G-0MT4JK9R04`
- Microsoft Clarity project ID: `y8s90ee1s7`

The Meta Pixel ID above is the canonical storefront value. Any remaining legacy inline Pixel markup must match it exactly.

## Meta Pixel ownership

Current storefront pages still contain legacy inline Meta Pixel bootstrap markup. `js/app.js` also contains a guarded fallback initializer that only runs if `config.META_PIXEL_ID` is numeric **and** `window.fbq` does not already exist.

Rules:
- Do not add another Pixel bootstrap snippet.
- Do not add another automatic `PageView` source to a page that already initializes Pixel.
- Do not initialize a different Pixel ID on supporting pages.
- Do not fire `Purchase` from GitHub Pages.
- Purchase completion is authoritative on Shopify / Meta's Shopify integration side.

## Browser commerce events

`js/app.js` uses `trackMetaEvent(...)` for pre-purchase commerce signals such as `ViewContent` and `AddToCart`.

These calls assume Pixel has already been initialized. Keep event emission separate from Pixel bootstrap logic.

If adding `InitiateCheckout`, it must fire only on a real, enabled Shopify checkout CTA and must not be mislabeled as `Purchase`.

## Shopify-side tracking

Shopify's Facebook & Instagram data-sharing integration may send checkout/purchase data to Meta independently of GitHub Pages. Do not duplicate a successful `Purchase` event in storefront JavaScript merely to mirror Shopify.

When changing Shopify/Meta integrations, verify in Meta Test Events rather than guessing from frontend code.

## Microsoft Clarity

`js/clarity-events.js` currently tracks:
- `business_search_started`;
- `business_selected`;
- `begin_checkout`.

The module uses sessionStorage guards to avoid repeatedly firing the same Clarity funnel event in one session.

## Google Analytics

GA is bootstrapped in HTML using measurement ID `G-0MT4JK9R04`. Do not add a second GA bootstrap without an explicit analytics migration plan.

## Known issue corrected in maintenance layer

`terms.html` previously initialized Meta Pixel `2121538478429149` in JavaScript but used a different ID in its `<noscript>` fallback. The maintenance layer standardizes the fallback to the canonical ID.

## Future refactor, intentionally deferred

A later dedicated refactor may centralize analytics bootstrap into a shared module/template. Do not perform that refactor as part of an unrelated UI/content task.
