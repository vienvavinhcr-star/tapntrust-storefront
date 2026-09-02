# Tapntrust Commerce and Checkout

## Product handles — protected

- Main NFC card: `tapntrust-nfc-review-card`
- Counter Stand: `tapntrust-counter-stand`
- Extra NFC Card: `tapntrust-extra-nfc-card`

Do not rename these handles unless the owner explicitly requests a migration.

## Main package variants

The storefront expects 1, 2, 3 and 5 card package variants on the main Shopify product. `js/cart.js` validates that all four counts are available from Shopify.

### 5-card bundle gift

The 5-card package includes one physical Counter Stand. This must be represented as a real Shopify cart line so it appears in Shopify Checkout, the final Shopify order, and fulfilment.

Shopify owns the free price through the active automatic **Buy X get Y** discount for the 5-card package + Counter Stand. Shopify does not automatically add the Y item, so the storefront adds the normal paid Counter Stand variant to the cart with private `_Bundle Gift` / `_Bundle Parent Setup ID` attributes. Shopify must then return that gift line with a zero line total.

Rules:
- only a 5-card primary package requires a gift stand;
- the storefront adds one linked Counter Stand line for each qualifying 5-card primary package;
- Shopify's automatic Buy X get Y discount must make that linked stand line A$0.00;
- if Shopify returns the supposed gift with a non-zero line total, the storefront removes it and does not allow the bundle state to proceed as valid;
- removing the parent package or changing away from 5 cards removes the linked gift stand;
- the normal Counter Stand product/variant remains the optional paid stand when added manually outside the bundle flow;
- do not create a separate A$0 product/variant for the bundle while this automatic discount flow is active.

The automatic bundle discount must be configured so it qualifies exactly the intended 5-card purchase and gives one Counter Stand free. Discount-combination settings in Shopify are authoritative for whether this automatic offer can stack with `WELCOMETNT`.

## Cart ownership

`js/cart.js` owns storefront cart state and delegates Shopify mutations to `js/shopify.js`. `js/cart-integrity.js` enforces parent/child integrity for Extra NFC Cards and the 5-card Counter Stand gift without changing Shopify payment behaviour.

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
- Before checkout, any orphan Extra NFC Card must be removed from the Shopify cart.
- A 5-card package must have its linked Counter Stand gift line and Shopify must return that line at A$0 before checkout.

## Upsells

### Extra NFC Card
Extra Card is an add-on, not a standalone product path in the custom storefront.

When added through the website it inherits the active primary package's business/review fulfilment data. If no primary package exists, `addUpsell("extra")` must fail rather than creating a metadata-free Extra Card.

Dependency enforcement:
- removing a primary package also removes Extra Cards linked to its business setup;
- dependent Extra Cards are removed before the parent package, so a partial network failure cannot create a new orphan;
- old/restored carts are scanned after initialization and orphan Extra Cards are removed automatically;
- checkout has a final integrity guard that cleans an orphan Extra Card before navigation to Shopify Checkout;
- legacy carts without setup IDs fall back to matching business name + review URL.

### Counter Stand
Counter Stand is a physical accessory. It does not require business/review metadata. A normal manually added stand is independent and is not removed when a card package is removed. A stand tagged as the 5-card bundle gift is different: it is linked to its parent through private bundle attributes and must be removed with that parent.

## Changing packages

Changing the main package variant must preserve its existing Shopify line attributes. Current code intentionally omits attributes during the merchandise/quantity update so Shopify retains the current metadata.

Changing a package to 5 cards must add the linked gift stand and confirm Shopify discounted it to A$0. Changing away from 5 cards must remove that linked gift stand.

## Discounts

The public config contains a welcome discount code used by the storefront. Shopify is authoritative for whether a discount is valid/applicable.

The 5-card Counter Stand gift uses Shopify's automatic Buy X get Y discount. The storefront only supplies the required Y line; it never fakes or overrides Shopify pricing.

`WELCOMETNT` and the automatic bundle offer can both apply only if Shopify's discount-combination settings permit them to combine. Do not simulate stacking in frontend code if Shopify rejects the combination.

Do not simulate an accepted Shopify discount in production if Shopify rejected it.

## Safe edit guidance

For copy/layout work inside the cart drawer, do not change cart mutation logic.
For Extra Card dependency/cleanup or 5-card gift work, inspect `js/cart-integrity.js`, `js/bundle-gift.js`, `js/cart.js`, and `docs/FULFILMENT.md`, then run `npm run check`.
