# Tapntrust Storefront Architecture

## Runtime shape

```text
Facebook / Instagram / Google / direct traffic
                ↓
          tapntrust.com
          GitHub Pages
                ↓
      custom storefront JavaScript
          ↙              ↘
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

## High-risk boundaries

A change is cross-cutting if it affects two or more of these boundaries:

1. business selection;
2. cart/line attributes;
3. Shopify checkout;
4. analytics/conversion tracking;
5. fulfilment data shown in Shopify orders.

For such changes, read the relevant docs before editing and run the invariant checker.

## Current implementation notes

- The main UI orchestration still lives largely in `js/app.js`; decomposition is intentionally deferred.
- Cart behaviour is isolated primarily in `js/cart.js` and transport in `js/shopify.js`.
- Fulfilment attribute names/normalisation live in `js/fulfilment.js`.
- Supporting policy/contact pages use `js/page.js`.
- `js/config.js` is browser-visible configuration; do not place private secrets there.

## Change strategy

Prefer minimal patches. Do not rewrite architecture during a presentation-only task. If a future task requires a structural refactor, make it a dedicated change with its own tests and migration plan rather than mixing it with a feature request.
