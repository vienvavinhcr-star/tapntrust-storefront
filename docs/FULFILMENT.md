# Tapntrust Fulfilment Metadata

## Purpose

Every NFC card order must contain enough information to identify the selected business and provision the card against the correct review destination without manually searching again.

The Google review URL in Shopify is fulfilment input. Every physical Tapntrust NFC card is programmed with its immutable Tapntrust redirect URL:

```text
https://go.tapntrust.com/t/{publicToken}
```

There is no separate direct-Google physical-card architecture. The Worker stores the approved Google destination, records a privacy-minimised tap and redirects. Card operation and tap recording do not depend on Tapntrust Insights access.

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

Counter Stand does not create a D1 card record or public token. A 5-card package with its free Counter Stand still produces exactly five NFC card tokens.

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
  -> staff provisions one immutable token per physical NFC card
  -> staff writes go.tapntrust.com/t/{publicToken} to each card
```

The storefront must not bypass business selection for a product that requires programming.

## Manual fallback

If the customer cannot find the business through Google Places, the manual path may be used. Manual data must still be validated and stored using the same fulfilment structure so the Shopify order remains actionable.

Before provisioning, staff must confirm that the supplied destination passes the Worker's Google destination allowlist. A general HTTPS URL accepted as storefront fallback data must not be provisioned if the redirect Worker would reject it.

## Phase 2B provisioning boundary

The browser-generated setup ID groups related Shopify lines but is not a trusted D1 business or location identifier. In the protected owner workflow, staff explicitly creates or selects the D1 business/location and confirms the total physical NFC card quantity, including Extra NFC Cards and excluding Counter Stands.

Provisioning is required for card orders whether Insights is purchased or not. Non-Insights provisioning does not create a customer login or store purchaser email in D1. Later Insights activation reuses the existing business, location, cards, tokens and tap history without NFC reprogramming.

## Safe edit guidance

For any change touching business selection, line attributes or Extra Card inheritance:

1. read `js/fulfilment.js`;
2. inspect the affected functions in `js/cart.js`;
3. do not alter unrelated analytics/UI;
4. run `node scripts/check-invariants.mjs`;
5. manually verify a primary package plus Extra Card still carries the same business setup before checkout.
