# Tapntrust Analytics

## Canonical IDs

- Meta Pixel / Dataset ID: `2121538478429149`
- Google Analytics measurement ID: `G-0MT4JK9R04`
- Microsoft Clarity project ID: `y8s90ee1s7`

The Meta Pixel ID above is the canonical storefront value. Any remaining legacy inline Pixel markup must match it exactly.

## Meta Pixel ownership

Current storefront pages still contain legacy inline Meta Pixel bootstrap markup. `js/analytics/meta.js` contains the guarded browser fallback initializer used by the main storefront. It runs only if `config.META_PIXEL_ID` is numeric **and** `window.fbq` does not already exist.

Rules:
- Do not add another Pixel bootstrap snippet.
- Do not add another automatic `PageView` source to a page that already initializes Pixel.
- Do not initialize a different Pixel ID on supporting pages.
- Do not fire `Purchase` from GitHub Pages.
- Purchase completion is authoritative on Shopify / Meta's Shopify integration side.

## Browser commerce events

`js/analytics/meta.js` owns the reusable `trackMetaEvent(...)`, package/upsell parameters, `ViewContent` initialization and Pixel fallback. Callers such as `js/app.js` and `js/ui/cart-drawer.js` only request the pre-purchase events they need.

These calls assume Pixel has already been initialized. Keep event emission separate from Shopify purchase completion.

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

### Owner test mode

Tapntrust has a browser-local owner test mode for development/testing sessions:

- Open `https://tapntrust.com/?test=1` once in the browser you use for testing.
- The mode is persisted in localStorage on that browser, so later visits to the storefront remain in test mode even without the query parameter.
- While test mode is enabled, `js/clarity-events.js` sends Clarity's opt-out call and does not emit Tapntrust Clarity funnel events.
- Meta Pixel remains enabled so Meta Events Manager can still be tested.
- To return that browser to normal analytics behaviour, open `https://tapntrust.com/?test=0` once.

Do not change the meaning of `?test=1` or make it suppress Meta Pixel unless the owner explicitly asks.

## Google Analytics

GA is bootstrapped in HTML using measurement ID `G-0MT4JK9R04`. Do not add a second GA bootstrap without an explicit analytics migration plan.

## Known issue corrected in maintenance layer

`terms.html` previously initialized Meta Pixel `2121538478429149` in JavaScript but used a different ID in its `<noscript>` fallback. The maintenance layer standardized the fallback to the canonical ID.

## Source-of-truth rule

Do not duplicate Meta helper implementations back into `js/app.js` or `js/app.min.js`. Meta browser logic belongs in `js/analytics/meta.js`; `js/app.min.js` is only a compatibility entry to canonical `js/app.js`.
