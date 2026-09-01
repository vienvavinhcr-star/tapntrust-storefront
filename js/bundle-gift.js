import { FULFILMENT_KEYS, ITEM_ROLES, buildFulfilmentAttributes } from "./fulfilment.js";

export const FIVE_CARD_PACKAGE_COUNT = 5;
export const BUNDLE_GIFT_KEYS = Object.freeze({
  type: "_Bundle Gift",
  parentSetupId: "_Bundle Parent Setup ID"
});
export const FIVE_CARD_STAND_GIFT = "5 Card Package Counter Stand";

function clean(value) {
  return String(value || "").trim();
}

export function packageCountForPrimaryLine(line, catalog) {
  if (line?.kind !== "primary") return null;
  return catalog?.main?.variants?.find((variant) => variant.id === line.variantId)?.count
    || Number(String(line.variantTitle || "").match(/\b(1|2|3|5)\b/)?.[1] || 0)
    || null;
}

export function isFiveCardPrimary(line, catalog) {
  return packageCountForPrimaryLine(line, catalog) === FIVE_CARD_PACKAGE_COUNT;
}

export function primarySetupId(line) {
  return clean(line?.attributes?.[FULFILMENT_KEYS.setupId]);
}

export function bundleGiftStandAttributes(parentSetupId) {
  return {
    ...buildFulfilmentAttributes({}, { itemRole: ITEM_ROLES.stand }),
    [BUNDLE_GIFT_KEYS.type]: FIVE_CARD_STAND_GIFT,
    [BUNDLE_GIFT_KEYS.parentSetupId]: clean(parentSetupId)
  };
}

export function isBundleGiftStand(line) {
  return Boolean(
    line?.kind === "stand"
    && clean(line.attributes?.[BUNDLE_GIFT_KEYS.type]) === FIVE_CARD_STAND_GIFT
  );
}

export function bundleGiftParentSetupId(line) {
  return isBundleGiftStand(line) ? clean(line.attributes?.[BUNDLE_GIFT_KEYS.parentSetupId]) : "";
}

export function isFreeBundleGiftLine(line) {
  return isBundleGiftStand(line) && Number(line.lineTotal || 0) <= 0.005;
}

export function bundleGiftPlan(lines = [], catalog = {}) {
  const requiredSetupIds = lines
    .filter((line) => isFiveCardPrimary(line, catalog))
    .map(primarySetupId)
    .filter(Boolean);
  const required = new Set(requiredSetupIds);
  const seen = new Set();
  const removeIds = [];
  const paidGiftIds = [];

  lines.filter(isBundleGiftStand).forEach((gift) => {
    const parentSetupId = bundleGiftParentSetupId(gift);
    if (!parentSetupId || !required.has(parentSetupId) || seen.has(parentSetupId)) {
      if (gift.id) removeIds.push(gift.id);
      return;
    }
    seen.add(parentSetupId);
    if (!isFreeBundleGiftLine(gift) && gift.id) paidGiftIds.push(gift.id);
  });

  return {
    requiredSetupIds,
    missingSetupIds: requiredSetupIds.filter((setupId) => !seen.has(setupId)),
    removeIds,
    paidGiftIds
  };
}
