#!/usr/bin/env node
import fs from "node:fs";

const config = fs.readFileSync("js/config.js", "utf8");
const offer = fs.readFileSync("js/marketing/welcome-offer.js", "utf8");
const sheet = fs.readFileSync("integrations/google-apps-script/lead-capture.gs", "utf8");
const failures = [];
const assert = (ok, message) => { if (!ok) failures.push(message); };

assert(/WELCOME_DISCOUNT_CODE:\s*["']WELCOMETNT["']/.test(config), "WELCOMETNT must remain the welcome code.");
assert(/WELCOME_DISCOUNT_PERCENT:\s*10\b/.test(config), "Welcome discount must remain 10%.");
assert(/WELCOME_POPUP_COOLDOWN_DAYS:\s*14\b/.test(config), "Claim cooldown must remain 14 days.");
assert(/LEAD_CAPTURE_ENDPOINT:\s*["']https:\/\//.test(config), "Lead capture endpoint must remain configured.");
assert(/claimedAt/.test(offer) && !/shownAt/.test(offer), "Cooldown must be based on claiming the offer, not merely seeing it.");
assert(/data-welcome-cart-unlock/.test(offer), "Dismissed visitors must have a cart recovery CTA.");
assert(/updateCartDiscountCodes/.test(offer), "Welcome code must use Shopify cart discount-code mutation for auto-apply.");
assert(/addToCartAt/.test(offer) && /primaryQuantity/.test(offer), "Add-to-cart timestamp must come from a successful primary cart change.");
assert(/event:\s*["']signup["']/.test(offer), "Signup event must be forwarded to the lead sheet.");
assert(/event:\s*["']checkout["']/.test(offer), "Checkout event must only be forwarded from checkout interaction.");
assert(/\['signup', 'add_to_cart', 'checkout'\]/.test(sheet), "Apps Script must accept the funnel event set.");
assert(/addToCartAt \? 'YES'/.test(sheet), "Apps Script must derive Add to Cart from its timestamp.");
assert(/checkoutAt \? 'YES'/.test(sheet), "Apps Script must derive Checkout from its timestamp.");

if (failures.length) {
  console.error("Welcome offer regression check failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("Welcome offer regression checks passed.");
