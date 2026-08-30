# Tapntrust Commerce and Checkout

## Product handles — protected

- Main NFC card: `tapntrust-nfc-review-card`
- Counter Stand: `tapntrust-counter-stand`
- Extra NFC Card: `tapntrust-extra-nfc-card`

Do not rename these handles unless the owner explicitly requests a migration.

## Main package variants

The storefront expects 1, 2, 3 and 5 card package variants on the main Shopify product. `js/cart.js` validates that all four counts are available from Shopify.

## Cart ownership

`js/cart.js` owns storefront cart state and delegates Shopify mutations to `js/shopify.js`.

Persistent browser keys currently include:
- Shopify cart ID;
- preview cart state;
- pending discount code;
- active business setup ID.

Do not clear or rename these keys casually because doing so can abandon a customer's in-progress cart/configuration.

## Checkout boundary

The storefront obtains `cart.checkoutUrl` from Shopify and links the checkout CTA to that URL.

Rules:
- GitHub frontend may track the intent to begin checkout.
- GitHub frontend must never treat a checkout click as a completed purchase.
- GitHub frontend must never fire Meta `Purchase`.
- Payment and successful order completion remain authoritative in Shopify.

## Upsells

### Extra NFC Card
Extra Card is an add-on, not a standalone product path in the custom storefront.

When added through the website it inherits the active primary package's business/review fulfilment data. If no primary package exists, `addUpsell("extra")` must fail rather than creating a metadata-free Extra Card.

A future cart hardening task should preserve the rule that deleting the primary package cannot leave a usable metadata-free Extra Card checkout path.

### Counter Stand
Counter Stand is a physical accessory. It does not require business/review metadata.

## Changing packages

Changing the main package variant must preserve its existing Shopify line attributes. Current code intentionally omits attributes during the merchandise/quantity update so Shopify retains the current metadata.

## Discounts

The public config contains a welcome discount code used by the storefront. Shopify is authoritative for whether a discount is valid/applicable.

Do not simulate an accepted Shopify discount in production if Shopify rejected it.

## Safe edit guidance

For copy/layout work inside the cart drawer, do not change cart mutation logic.
For cart logic changes, inspect `js/cart.js`, `js/shopify.js`, and `docs/FULFILMENT.md`, then run `node scripts/check-invariants.mjs`.
