# Tapntrust Analytics

## Canonical IDs

- Meta Pixel / Dataset ID: `2121538478429149`
- Google Analytics measurement ID: `G-0MT4JK9R04`
- Microsoft Clarity project ID: `y8s90ee1s7`

The Meta Pixel ID above is the canonical storefront value. Any remaining legacy inline Pixel markup must match it exactly.

## Meta Pixel ownership

Current storefront pages still contain legacy inline Meta Pixel bootstrap markup. `js/analytics/meta.js` contains the guarded browser fallback initializer used by the main storefront. It runs only if `config.META_PIXEL_ID` is numeric, owner test mode is not active, and `window.fbq` does not already exist.

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

`js/clarity-events.js` owns the Clarity API events. All callers import the same module URL; do not add a second versioned import or SDK loader.

| Event | Recorded when |
| --- | --- |
| `business_search_started` | A visitor types at least three characters in business search. |
| `business_selected` | A recent business-search selection is confirmed. |
| `add_to_cart` | A primary package is successfully added, including completion of required bundle-gift checks. |
| `add_to_cart_1_card` | The successfully added package contains 1 card. |
| `add_to_cart_2_cards` | The successfully added package contains 2 cards. |
| `add_to_cart_3_cards` | The successfully added package contains 3 cards. |
| `add_to_cart_5_cards` | The successfully added package contains 5 cards. |
| `welcome_offer_claimed` | The welcome form accepts a valid email and reveals the code. No email or other personal data is sent to Clarity. |
| `extra_card_added` | The visitor's manual Extra Card add-on action succeeds. |
| `counter_stand_added` | The visitor's manual Counter Stand add-on action succeeds. The automatic free stand in a 5-card bundle never triggers this event. |
| `begin_checkout` | A visitor clicks an enabled checkout link with a non-empty destination. This is intent, not proof that Shopify loaded or a purchase completed. |

Package, claim and add-on events exclude preview carts. Failed additions, changing the selected package before submission, editing business details, restored carts and automatic gifts do not count as successful Add to Cart actions. Package events describe the package at the time of addition, not a later variant change or the final purchased package. Add-on events measure manual additions, not purchases or whether the item remains in the cart.

Each event is emitted once per browser-tab sessionStorage lifetime, with an in-memory fallback when storage is unavailable. This is not an exact Clarity session identifier or a unique-customer count. A session can contain more than one package event; do not sum package session counts as unique customers. Early actions use the existing Clarity command queue until its delayed loader starts. Tracking failures never block shopping.

In Clarity, use API events in Smart Events / Funnels after new visitor activity reaches the project:
- Main funnel: `add_to_cart` → `begin_checkout`.
- Per-package funnel: `add_to_cart_2_cards` (or another package) → `begin_checkout`.
- Optional claim branch: `add_to_cart` → `welcome_offer_claimed` → `begin_checkout`.
- Optional upsell branches: `add_to_cart` → `extra_card_added` or `counter_stand_added` → `begin_checkout`.

Do not require both add-ons or a claim in the main funnel: they are optional and can happen in different orders. The storefront cannot observe email entry or other actions inside Shopify Checkout. These events do not backfill historical sessions and remain suppressed in owner test mode. Reference: [Clarity client API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-api).

### Owner test mode

Tapntrust has a browser-local owner test mode for development/testing sessions:

- Open `https://tapntrust.com/?test=1` once in the browser you use for testing.
- The mode is persisted in localStorage on that browser, so later visits remain in test mode even without the query parameter.
- While active, the early homepage gate prevents Google Analytics and the inline Meta Pixel bootstrap from loading, `js/test-mode.js` hard-blocks Clarity, and `js/analytics/meta.js` refuses to initialize or emit Meta events.
- `js/clarity-events.js` also refuses to emit Tapntrust Clarity funnel events.
- Shopify behavior and the Google Sheet welcome-lead funnel intentionally remain active so the owner can test commerce and lead capture.
- To return that browser to normal analytics behaviour, open `https://tapntrust.com/?test=0` once.

The storefront still contains legacy inline Meta bootstrap markup, so test-mode code must remain early in the JavaScript dependency chain. A future analytics-centralisation refactor should move all browser Pixel bootstrap ownership into the analytics module so suppression can happen before any inline Pixel code.

## Google Analytics

GA uses measurement ID `G-0MT4JK9R04`. The homepage analytics bootstrap runs only when owner test mode is inactive; while `?test=1` is active, the GA script is not loaded and the `ga-disable-G-0MT4JK9R04` flag is set as a second guard. Do not add a second GA bootstrap without an explicit analytics migration plan.

## Known issue corrected in maintenance layer

`terms.html` previously initialized Meta Pixel `2121538478429149` in JavaScript but used a different ID in its `<noscript>` fallback. The maintenance layer standardized the fallback to the canonical ID.

## Source-of-truth rule

Do not duplicate Meta helper implementations back into `js/app.js` or `js/app.min.js`. Meta browser logic belongs in `js/analytics/meta.js`; shared owner test-mode logic belongs in `js/test-mode.js`; `js/app.min.js` is only a compatibility entry to canonical `js/app.js`.
