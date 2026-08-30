#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const config = fs.readFileSync(new URL("../js/config.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const offer = fs.readFileSync(new URL("../js/marketing/welcome-offer.js", import.meta.url), "utf8");

assert.match(config, /WELCOME_DISCOUNT_CODE:\s*"WELCOMETNT"/, "welcome code must remain WELCOMETNT");
assert.match(config, /WELCOME_DISCOUNT_PERCENT:\s*10/, "welcome discount must remain 10%");
assert.doesNotMatch(config, /WELCOME_POPUP_DELAY_MS/, "welcome popup must not use a page timer");
assert.match(config, /WELCOME_POPUP_COOLDOWN_DAYS:\s*14/, "popup cooldown must remain 14 days");
assert.match(app, /initialiseWelcomeOffer\(config\)/, "app must initialise the welcome offer module");
assert.match(app, /tapntrust:welcome-offer-eligible/, "successful primary Add to Cart must emit the welcome-offer trigger");
assert.match(app, /await cartActions\.addMainPackage[\s\S]*tapntrust:welcome-offer-eligible/, "welcome trigger must follow a successful primary cart add");
assert.match(offer, /if \(!endpoint\) return;/, "popup must stay disabled until a lead endpoint exists");
assert.match(offer, /tapntrust:welcome-offer-eligible/, "welcome offer must only open from the post-add trigger");
assert.match(offer, /startLeadCycle\(addToCartAt\)/, "a new post-add lead cycle must be created before showing the popup");
assert.match(offer, /storageRemove\(STORAGE\.checkoutAt\)/, "new lead cycles must clear stale checkout timestamps");
assert.match(offer, /checkoutAt:\s*""/, "signup payload must never inherit an old checkout timestamp");
assert.doesNotMatch(offer, /tapntrust:cart-change/, "welcome lead tracking must not infer Add to Cart from generic cart-change events");
assert.match(offer, /data-checkout/, "welcome funnel must observe checkout intent");
assert.match(offer, /tapntrust_welcome_shown_at/, "14-day display suppression must use persistent browser storage");

console.log("✓ Welcome offer post-add trigger and lead funnel rules passed.");
