#!/usr/bin/env node

import assert from "node:assert/strict";
import { FULFILMENT_KEYS } from "../js/fulfilment.js";
import { orphanExtraIds, relatedBundleGiftIds, relatedExtraIds } from "../js/cart-integrity.js";
import {
  BUNDLE_GIFT_KEYS,
  FIVE_CARD_STAND_GIFT,
  bundleGiftPlan
} from "../js/bundle-gift.js";

function attrs({ setupId = "", businessName = "Cafe One", reviewUrl = "https://search.google.com/local/writereview?placeid=abc" } = {}) {
  return {
    [FULFILMENT_KEYS.setupId]: setupId,
    [FULFILMENT_KEYS.businessName]: businessName,
    [FULFILMENT_KEYS.reviewLink]: reviewUrl
  };
}

const catalog = {
  main: {
    variants: [
      { id: "variant-2", count: 2 },
      { id: "variant-5", count: 5 }
    ]
  }
};
const primaryA = { id: "primary-a", kind: "primary", variantId: "variant-2", attributes: attrs({ setupId: "setup-a" }) };
const primaryFive = { id: "primary-five", kind: "primary", variantId: "variant-5", attributes: attrs({ setupId: "setup-five" }) };
const extraA = { id: "extra-a", kind: "extra", attributes: attrs({ setupId: "setup-a" }) };
const extraOrphan = { id: "extra-orphan", kind: "extra", attributes: attrs({ setupId: "missing-parent" }) };
const stand = { id: "stand", kind: "stand", attributes: {} };
const freeGift = {
  id: "gift-five",
  kind: "stand",
  lineTotal: 0,
  attributes: {
    [BUNDLE_GIFT_KEYS.type]: FIVE_CARD_STAND_GIFT,
    [BUNDLE_GIFT_KEYS.parentSetupId]: "setup-five"
  }
};
const paidGift = { ...freeGift, id: "gift-paid", lineTotal: 14.49 };

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

assert.deepEqual(
  bundleGiftPlan([primaryFive], catalog).missingSetupIds,
  ["setup-five"],
  "a 5-card package must require one Counter Stand gift line"
);

assert.deepEqual(
  bundleGiftPlan([primaryFive, freeGift], catalog),
  { requiredSetupIds: ["setup-five"], missingSetupIds: [], removeIds: [], paidGiftIds: [] },
  "a correctly linked A$0 gift stand satisfies the 5-card bundle"
);

assert.deepEqual(
  bundleGiftPlan([primaryFive, paidGift], catalog).paidGiftIds,
  ["gift-paid"],
  "a bundle gift must never be allowed through as a chargeable stand"
);

assert.deepEqual(
  relatedBundleGiftIds(primaryFive, [primaryFive, freeGift]),
  ["gift-five"],
  "removing the 5-card package must identify its linked gift stand"
);

assert.deepEqual(
  bundleGiftPlan([primaryA, freeGift], catalog).removeIds,
  ["gift-five"],
  "changing away from 5 cards must remove the linked bundle gift"
);

console.log("✓ Extra Card and 5-card bundle gift integrity rules passed.");
