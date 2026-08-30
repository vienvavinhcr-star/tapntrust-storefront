#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CANONICAL_META_PIXEL_ID = "2121538478429149";
const EXPECTED_HANDLES = {
  MAIN_PRODUCT_HANDLE: "tapntrust-nfc-review-card",
  STAND_PRODUCT_HANDLE: "tapntrust-counter-stand",
  EXTRA_CARD_PRODUCT_HANDLE: "tapntrust-extra-nfc-card"
};

const failures = [];
const passes = [];

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    failures.push(`Missing required file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
}

function assert(condition, ok, bad) {
  if (condition) pass(ok);
  else fail(bad);
}

function walk(dir, collected = []) {
  if (!fs.existsSync(dir)) return collected;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, collected);
    else collected.push(full);
  }
  return collected;
}

const config = read("js/config.js");
const app = read("js/app.js");
const cart = read("js/cart.js");
const shopify = read("js/shopify.js");
const fulfilment = read("js/fulfilment.js");

// 1. Product handles are stable.
for (const [key, expected] of Object.entries(EXPECTED_HANDLES)) {
  const pattern = new RegExp(`${key}\\s*:\\s*["']${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
  assert(
    pattern.test(config),
    `${key} remains ${expected}`,
    `${key} changed or is missing; expected ${expected}`
  );
}

// 2. Canonical Meta Pixel value in public config.
assert(
  new RegExp(`META_PIXEL_ID\\s*:\\s*["']${CANONICAL_META_PIXEL_ID}["']`).test(config),
  `config META_PIXEL_ID matches canonical ${CANONICAL_META_PIXEL_ID}`,
  `config META_PIXEL_ID must be canonical ${CANONICAL_META_PIXEL_ID}`
);

// 3. Every hard-coded Meta Pixel ID in HTML must be canonical.
const htmlFiles = walk(root).filter((file) => file.endsWith(".html"));
const metaIds = new Map();
for (const file of htmlFiles) {
  const text = fs.readFileSync(file, "utf8");
  const ids = new Set();
  for (const match of text.matchAll(/fbq\(\s*["']init["']\s*,\s*["'](\d+)["']/g)) ids.add(match[1]);
  for (const match of text.matchAll(/facebook\.com\/tr\?id=(\d+)/g)) ids.add(match[1]);
  if (ids.size) metaIds.set(path.relative(root, file), [...ids]);
}
const wrongMetaIds = [...metaIds.entries()].flatMap(([file, ids]) => ids.filter((id) => id !== CANONICAL_META_PIXEL_ID).map((id) => `${file}: ${id}`));
assert(
  wrongMetaIds.length === 0,
  "all HTML Meta Pixel IDs match the canonical Pixel",
  `conflicting Meta Pixel IDs found: ${wrongMetaIds.join(", ")}`
);

// 4. A page must not initialize the Pixel or PageView more than once.
const duplicateBootstrap = [];
for (const file of htmlFiles) {
  const text = fs.readFileSync(file, "utf8");
  const initCount = [...text.matchAll(/fbq\(\s*["']init["']/g)].length;
  const pageViewCount = [...text.matchAll(/fbq\(\s*["']track["']\s*,\s*["']PageView["']/g)].length;
  if (initCount > 1 || pageViewCount > 1) duplicateBootstrap.push(`${path.relative(root, file)} (init=${initCount}, PageView=${pageViewCount})`);
}
assert(
  duplicateBootstrap.length === 0,
  "no HTML page has duplicate Pixel bootstrap/PageView calls",
  `duplicate Meta Pixel bootstrap found: ${duplicateBootstrap.join(", ")}`
);

// 5. GitHub storefront must never claim a completed Meta Purchase.
const jsFiles = walk(path.join(root, "js")).filter((file) => file.endsWith(".js"));
const purchaseEmitters = [];
for (const file of jsFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (/fbq\([^\n]*["']Purchase["']|trackMetaEvent\(\s*["']Purchase["']/.test(text)) {
    purchaseEmitters.push(path.relative(root, file));
  }
}
assert(
  purchaseEmitters.length === 0,
  "frontend JavaScript does not fire Meta Purchase",
  `frontend Meta Purchase emitter found in: ${purchaseEmitters.join(", ")}`
);

// 6. Pixel fallback in app.js remains guarded against a duplicate bootstrap.
assert(
  /typeof window\.fbq !== ["']function["']/.test(app),
  "app.js Pixel fallback is guarded by existing window.fbq",
  "app.js Pixel initialization lost its duplicate-bootstrap guard"
);

// 7. Shopify checkout remains sourced from Shopify cart.checkoutUrl.
assert(
  /checkoutUrl\s*:\s*cart\.checkoutUrl/.test(cart) && /checkout\.href\s*=\s*cart\.checkoutUrl/.test(app),
  "checkout CTA remains sourced from Shopify cart.checkoutUrl",
  "Shopify checkoutUrl wiring changed or cannot be verified"
);

// 8. Extra Card inheritance remains protected.
assert(
  /function inheritedDetails\s*\(/.test(cart)
    && /Choose a card package before adding extras/.test(cart)
    && /kind === ["']extra["']\s*\?\s*inheritedDetails\(\)/.test(cart),
  "Extra NFC Card still requires and inherits a primary business setup",
  "Extra NFC Card inheritance/primary-package guard changed or cannot be verified"
);

// 9. Primary and extra roles are still represented in fulfilment/cart logic.
assert(
  /ITEM_ROLES\.primary/.test(cart) && /ITEM_ROLES\.extra/.test(cart) && /FULFILMENT_KEYS/.test(fulfilment),
  "primary/extra fulfilment roles remain wired",
  "primary/extra fulfilment role wiring changed or cannot be verified"
);

// 10. Shopify transport remains Storefront cart based; no Admin secret marker should appear in public JS.
const publicJs = jsFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
assert(
  !/(shpat_|shopify[_-]?admin[_-]?token|admin[_-]?api[_-]?access[_-]?token)/i.test(publicJs),
  "no obvious Shopify Admin/private token marker is present in public JavaScript",
  "possible Shopify Admin/private token marker found in public JavaScript"
);
assert(
  /cartCreate|cartLinesAdd|cartLinesUpdate|cartLinesRemove/.test(shopify),
  "Shopify Storefront cart operations remain present",
  "expected Shopify Storefront cart operations cannot be verified"
);

console.log("Tapntrust invariant check\n");
for (const message of passes) console.log(`✓ ${message}`);

if (failures.length) {
  console.error("\nFailures:");
  for (const message of failures) console.error(`✗ ${message}`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${passes.length} invariant checks passed.`);
}
