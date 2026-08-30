# Tapntrust Fulfilment Metadata

## Purpose

Every NFC card order must contain enough information to identify the selected business and program the card to the correct review destination without manually searching again.

The source of truth for fulfilment attribute names and transformations is `js/fulfilment.js`.

## Primary card line

A primary NFC card line must carry the business/review setup created when the customer selects a business or supplies a manual review destination.

The fulfilment model includes, as applicable:
- business name;
- business address;
- Google Place ID;
- review URL / review link;
- Google Maps URL;
- review-link status;
- review-link source;
- setup ID;
- item role.

Do not remove or rename these fields casually. They are operational data needed after checkout.

## Setup ID

A setup ID groups the primary package and related Extra NFC Cards that belong to the same selected business/review destination.

When a customer edits the business on a primary line, related Extra NFC Cards with the same setup ID must be updated as part of the same business setup.

## Extra NFC Card

Extra NFC Card must inherit the selected business/review data from a primary package.

Rules:
- no primary package -> no Extra Card add-on through the custom storefront;
- Extra Card must not be created with empty review metadata;
- changing the primary business must update related Extra Card metadata;
- removing/changing cart items must not create a checkout path where an Extra Card survives without the setup it depends on.

## Counter Stand

Counter Stand is not programmed and does not need business/review data. It may carry only the item-role metadata needed to classify it.

## Google business selection

`js/business-finder.js` handles business selection. Review destination helpers are in `js/google-review.js`.

The customer flow is intended to be:

```text
Choose package
  -> select exact business/location
  -> capture review destination + business identity
  -> build fulfilment attributes
  -> add Shopify cart line
  -> Shopify checkout
  -> Shopify order contains programming data
```

The storefront must not bypass business selection for a product that requires programming.

## Manual fallback

If the customer cannot find the business through Google Places, the manual path may be used. Manual data must still be validated and stored using the same fulfilment structure so the Shopify order remains actionable.

## Safe edit guidance

For any change touching business selection, line attributes or Extra Card inheritance:

1. read `js/fulfilment.js`;
2. inspect the affected functions in `js/cart.js`;
3. do not alter unrelated analytics/UI;
4. run `node scripts/check-invariants.mjs`;
5. manually verify a primary package plus Extra Card still carries the same business setup before checkout.
