#!/usr/bin/env node

import assert from "node:assert/strict";
import { FULFILMENT_KEYS } from "../js/fulfilment.js";
import { orphanExtraIds, relatedExtraIds } from "../js/cart-integrity.js";

function attrs({ setupId = "", businessName = "Cafe One", reviewUrl = "https://search.google.com/local/writereview?placeid=abc" } = {}) {
  return {
    [FULFILMENT_KEYS.setupId]: setupId,
    [FULFILMENT_KEYS.businessName]: businessName,
    [FULFILMENT_KEYS.reviewLink]: reviewUrl
  };
}

const primaryA = { id: "primary-a", kind: "primary", attributes: attrs({ setupId: "setup-a" }) };
const extraA = { id: "extra-a", kind: "extra", attributes: attrs({ setupId: "setup-a" }) };
const extraOrphan = { id: "extra-orphan", kind: "extra", attributes: attrs({ setupId: "missing-parent" }) };
const stand = { id: "stand", kind: "stand", attributes: {} };

assert.deepEqual(
  relatedExtraIds(primaryA, [primaryA, extraA, extraOrphan, stand]),
  ["extra-a"],
  "removing a primary package must identify only its dependent Extra Cards"
);

assert.deepEqual(
  orphanExtraIds([primaryA, extraA, extraOrphan, stand]),
  ["extra-orphan"],
  "an Extra Card whose setup ID has no primary parent must be considered orphaned"
);

assert.deepEqual(
  orphanExtraIds([extraA]),
  ["extra-a"],
  "an old cart containing only an Extra Card must be cleaned"
);

const legacyPrimary = { id: "legacy-primary", kind: "primary", attributes: attrs({ setupId: "", businessName: "Legacy Cafe" }) };
const legacyExtra = { id: "legacy-extra", kind: "extra", attributes: attrs({ setupId: "", businessName: "Legacy Cafe" }) };
const legacyWrongExtra = { id: "legacy-wrong", kind: "extra", attributes: attrs({ setupId: "", businessName: "Different Cafe" }) };

assert.deepEqual(
  relatedExtraIds(legacyPrimary, [legacyPrimary, legacyExtra, legacyWrongExtra]),
  ["legacy-extra"],
  "legacy carts without setup IDs must fall back to matching business + review URL"
);

assert.deepEqual(
  orphanExtraIds([legacyPrimary, legacyExtra, legacyWrongExtra]),
  ["legacy-wrong"],
  "legacy orphan Extra Cards must also be detected"
);

console.log("✓ Extra Card cart integrity rules passed.");
