#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const config = fs.readFileSync(new URL("../js/config.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const offer = fs.readFileSync(new URL("../js/marketing/welcome-offer.js", import.meta.url), "utf8");

assert.match(config, /WELCOME_DISCOUNT_CODE:\s*"WELCOMETNT"/, "welcome code must remain WELCOMETNT");
assert.match(config, /WELCOME_DISCOUNT_PERCENT:\s*10/, "welcome discount must remain 10%");
assert.match(config, /WELCOME_POPUP_DELAY_MS:\s*10000/, "popup delay must remain 10 seconds");
assert.match(config, /WELCOME_POPUP_COOLDOWN_DAYS:\s*14/, "popup cooldown must remain 14 days");
assert.match(app, /initialiseWelcomeOffer\(config\)/, "app must initialise the welcome offer module");
assert.match(offer, /if \(!endpoint\) return;/, "popup must stay disabled until a lead endpoint exists");
assert.match(offer, /tapntrust:cart-change/, "welcome funnel must observe cart changes");
assert.match(offer, /data-checkout/, "welcome funnel must observe checkout intent");
assert.match(offer, /tapntrust_welcome_shown_at/, "14-day display suppression must use persistent browser storage");

console.log("✓ Welcome offer configuration and funnel rules passed.");
