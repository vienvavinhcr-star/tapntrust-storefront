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

The existing Counter Stand Shopify product must include a dedicated variant with these exact properties:
- variant title: `5 Card Bundle Gift`;
- price: `A$0.00`;
- recommended compare-at price: `A$14.49`;
- available inventory / available for sale.

The existing paid Counter Stand variant must remain the normal paid option and should stay first in the Shopify variant order so the optional paid stand upsell continues to use it.

The storefront adds the zero-price gift variant only for a 5-card primary package and attaches private `_Bundle Gift` / `_Bundle Parent Setup ID` attributes. It removes the gift when the parent package is removed or changed away from 5 cards. Checkout integrity must reject/remove any supposed bundle gift that Shopify returns with a non-zero line total. Never fake a free stand only in UI.

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
- A 5-card package must have its linked A$0 Counter Stand gift line before checkout.

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
Counter Stand is a physical accessory. It does not require business/review metadata. A normal paid stand is independent and is not removed when a card package is removed. The dedicated `5 Card Bundle Gift` variant is different: it is linked to its 5-card parent through private bundle attributes and must be removed with that parent.

## Changing packages

Changing the main package variant must preserve its existing Shopify line attributes. Current code intentionally omits attributes during the merchandise/quantity update so Shopify retains the current metadata.

Changing a package to 5 cards must add the A$0 gift stand. Changing away from 5 cards must remove that linked gift stand.

## Discounts

The public config contains a welcome discount code used by the storefront. Shopify is authoritative for whether a discount is valid/applicable.

The 5-card Counter Stand gift is not a discount-code simulation: it uses a dedicated A$0 Shopify variant so the physical item is a real order line.

Do not simulate an accepted Shopify discount in production if Shopify rejected it.

## Safe edit guidance

For copy/layout work inside the cart drawer, do not change cart mutation logic.
For Extra Card dependency/cleanup or 5-card gift work, inspect `js/cart-integrity.js`, `js/bundle-gift.js`, `js/cart.js`, and `docs/FULFILMENT.md`, then run `npm run check`.
