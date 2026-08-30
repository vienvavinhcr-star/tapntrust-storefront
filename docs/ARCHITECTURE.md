# Tapntrust Storefront Architecture

## Runtime shape

```text
Facebook / Instagram / Google / direct traffic
                ↓
          tapntrust.com
          GitHub Pages
                ↓
           js/app.js
      small entry/orchestrator
       ↙       ↓        ↘
 UI modules  product   service modules
             setup
       ↘       ↓        ↙
 Google Places       Shopify Storefront API
 business lookup     products / cart / discounts
          ↘              ↙
       selected business + fulfilment attributes
                ↓
          Shopify Checkout
                ↓
        Shopify order/payment
```

## Ownership boundaries

### GitHub Pages storefront
Owns:
- presentation and content;
- package selection UI;
- Google business selection UI;
- cart UI;
- attaching fulfilment metadata to Shopify cart lines;
- browser-side analytics events that are appropriate before purchase.

Does not own:
- payment processing;
- authoritative purchase completion;
- order settlement;
- Shopify Admin operations.

### Shopify
Owns:
- product/variant catalogue exposed through Storefront API;
- cart and checkout URLs;
- discounts accepted by checkout;
- customer checkout/payment;
- final orders and payment state.

### Google Places
Owns discovery of the selected business/location and links returned by Google. The storefront captures the business identity and review destination required for fulfilment.

## Module boundaries

`js/app.js` is intentionally an entry/orchestration file rather than a catch-all implementation file.

- `js/ui/site.js` — independent visual/site interactions.
- `js/ui/cart-drawer.js` — cart rendering + cart-drawer event wiring only; state mutations stay in `js/cart.js`.
- `js/ui/guide.js` — review-link guide dialog.
- `js/ui/common.js` — shared UI helpers.
- `js/forms/consultation.js` — consultation form behaviour.
- `js/analytics/meta.js` — Meta Pixel fallback and browser-side pre-purchase Meta events.
- `js/metadata.js` — runtime canonical/OG/structured metadata.
- `js/cart.js` — cart state/business rules.
- `js/shopify.js` — Shopify Storefront API transport.
- `js/business-finder.js` / `js/google-review.js` — Google business/review destination logic.
- `js/fulfilment.js` — fulfilment attribute schema and transformations.

`js/app.min.js` is not a separate compiled implementation. It is a small compatibility entry that imports canonical `js/app.js`, preventing source/minified drift.

## High-risk boundaries

A change is cross-cutting if it affects two or more of these boundaries:

1. business selection;
2. cart/line attributes;
3. Shopify checkout;
4. analytics/conversion tracking;
5. fulfilment data shown in Shopify orders.

For such changes, read the relevant docs before editing and run `npm run check`.

## Change strategy

Prefer minimal patches and edit the smallest responsible module. Do not move unrelated logic back into `js/app.js` during a presentation-only task. Structural refactors should remain dedicated changes with invariant checks rather than being mixed into feature work.
