import { FULFILMENT_KEYS, businessDetailsFromAttributes } from "./fulfilment.js";
import {
  bundleGiftPlan,
  bundleGiftStandAttributes,
  bundleGiftParentSetupId,
  findPaidCounterStandVariant,
  isBundleGiftStand,
  packageCountForPrimaryLine,
  primarySetupId
} from "./bundle-gift.js";

function setupId(line) {
  return String(line?.attributes?.[FULFILMENT_KEYS.setupId] || "").trim();
}

function sameBusinessSetup(left, right) {
  const leftDetails = businessDetailsFromAttributes(left?.attributes || {});
  const rightDetails = businessDetailsFromAttributes(right?.attributes || {});
  return Boolean(
    leftDetails.businessName
    && leftDetails.reviewUrl
    && leftDetails.businessName === rightDetails.businessName
    && leftDetails.reviewUrl === rightDetails.reviewUrl
  );
}

export function relatedExtraIds(primaryLine, lines = []) {
  if (!primaryLine || primaryLine.kind !== "primary") return [];
  const primarySetupId = setupId(primaryLine);

  return lines
    .filter((line) => {
      if (line.kind !== "extra") return false;
      if (primarySetupId) return setupId(line) === primarySetupId;
      return !setupId(line) && sameBusinessSetup(primaryLine, line);
    })
    .map((line) => line.id)
    .filter(Boolean);
}

export function relatedBundleGiftIds(primaryLine, lines = []) {
  if (!primaryLine || primaryLine.kind !== "primary") return [];
  const parentSetupId = primarySetupId(primaryLine);
  if (!parentSetupId) return [];
  return lines
    .filter((line) => isBundleGiftStand(line) && bundleGiftParentSetupId(line) === parentSetupId)
    .map((line) => line.id)
    .filter(Boolean);
}

export function orphanExtraIds(lines = []) {
  const primaries = lines.filter((line) => line.kind === "primary");

  return lines
    .filter((line) => line.kind === "extra")
    .filter((extra) => {
      const extraSetupId = setupId(extra);
      if (extraSetupId) {
        return !primaries.some((primary) => setupId(primary) === extraSetupId);
      }
      return !primaries.some((primary) => !setupId(primary) && sameBusinessSetup(primary, extra));
    })
    .map((line) => line.id)
    .filter(Boolean);
}

export function createIntegrityCartActions(baseCartActions) {
  let cleanupPromise = null;
  let bundleSyncPromise = null;

  async function cleanupOrphanExtras() {
    if (cleanupPromise) return cleanupPromise;

    cleanupPromise = (async () => {
      let currentState = baseCartActions.getState();
      const orphanIds = orphanExtraIds(currentState.cart?.lines || []);

      for (const orphanId of orphanIds) {
        await baseCartActions.removeLine(orphanId);
        currentState = baseCartActions.getState();
      }

      return currentState;
    })().finally(() => {
      cleanupPromise = null;
    });

    return cleanupPromise;
  }

  async function refreshShopifyCart() {
    await baseCartActions.initialise();
    return baseCartActions.getState();
  }

  async function addBundleGiftStand(parentSetupId) {
    const { ShopifyError, addCartLines } = await import("./shopify.js");
    const currentState = baseCartActions.getState();
    const standVariant = findPaidCounterStandVariant(currentState.catalog);
    if (!standVariant?.available) {
      throw new ShopifyError("The free Counter Stand is currently unavailable.");
    }
    if (!currentState.cart?.id) throw new ShopifyError("The Shopify cart is not ready for the free Counter Stand.");

    await addCartLines(currentState.cart.id, [{
      merchandiseId: standVariant.id,
      quantity: 1,
      attributes: Object.entries(bundleGiftStandAttributes(parentSetupId)).map(([key, value]) => ({ key, value: String(value) }))
    }]);
    return refreshShopifyCart();
  }

  async function syncBundleGiftStands() {
    if (bundleSyncPromise) return bundleSyncPromise;

    bundleSyncPromise = (async () => {
      let currentState = baseCartActions.getState();
      if (!currentState.cart?.lines?.length || currentState.mode !== "shopify") return currentState;

      let plan = bundleGiftPlan(currentState.cart.lines, currentState.catalog);
      for (const lineId of [...plan.removeIds, ...plan.paidGiftIds]) {
        await baseCartActions.removeLine(lineId);
        currentState = baseCartActions.getState();
      }

      plan = bundleGiftPlan(currentState.cart?.lines || [], currentState.catalog);
      for (const parentSetupId of plan.missingSetupIds) {
        currentState = await addBundleGiftStand(parentSetupId);
        const gift = currentState.cart?.lines?.find((line) => (
          isBundleGiftStand(line)
          && bundleGiftParentSetupId(line) === parentSetupId
        ));
        if (!gift || Number(gift.lineTotal || 0) > 0.005) {
          if (gift?.id) await baseCartActions.removeLine(gift.id);
          throw new Error(
            "The 5-card bundle Counter Stand was not discounted to A$0.00 by Shopify. Check the active automatic Buy X get Y discount."
          );
        }
      }

      return baseCartActions.getState();
    })().finally(() => {
      bundleSyncPromise = null;
    });

    return bundleSyncPromise;
  }

  async function initialise() {
    await baseCartActions.initialise();
    await cleanupOrphanExtras();
    return syncBundleGiftStands();
  }

  async function addMainPackage(input) {
    const beforeIds = new Set((baseCartActions.getState().cart?.lines || []).map((line) => line.id));
    await baseCartActions.addMainPackage(input);
    if (Number(input?.packageCount) !== 5) return baseCartActions.getState();

    try {
      return await syncBundleGiftStands();
    } catch (error) {
      const addedPrimary = (baseCartActions.getState().cart?.lines || []).find((line) => line.kind === "primary" && !beforeIds.has(line.id));
      if (addedPrimary?.id) await baseCartActions.removeLine(addedPrimary.id);
      throw error;
    }
  }

  async function changePrimaryPackage(lineId, packageCount) {
    const beforeState = baseCartActions.getState();
    const beforeLine = beforeState.cart?.lines?.find((line) => line.id === lineId && line.kind === "primary");
    const previousCount = packageCountForPrimaryLine(beforeLine, beforeState.catalog);
    await baseCartActions.changePrimaryPackage(lineId, packageCount);

    try {
      return await syncBundleGiftStands();
    } catch (error) {
      if (previousCount && previousCount !== Number(packageCount)) {
        await baseCartActions.changePrimaryPackage(lineId, previousCount);
        await syncBundleGiftStands().catch(() => {});
      }
      throw error;
    }
  }

  async function removeLine(lineId) {
    let currentState = baseCartActions.getState();
    const target = currentState.cart?.lines?.find((line) => line.id === lineId);

    if (target?.kind === "primary") {
      const dependentExtraIds = relatedExtraIds(target, currentState.cart?.lines || []);
      const dependentGiftIds = relatedBundleGiftIds(target, currentState.cart?.lines || []);
      for (const dependentId of [...dependentExtraIds, ...dependentGiftIds]) {
        await baseCartActions.removeLine(dependentId);
      }
    }

    await baseCartActions.removeLine(lineId);
    currentState = await cleanupOrphanExtras();
    return syncBundleGiftStands(currentState);
  }

  async function prepareForCheckout() {
    await cleanupOrphanExtras();
    return syncBundleGiftStands();
  }

  return {
    ...baseCartActions,
    initialise,
    addMainPackage,
    changePrimaryPackage,
    removeLine,
    cleanupOrphanExtras,
    syncBundleGiftStands,
    prepareForCheckout
  };
}

export function bundleIntegrityNeeded(cartState) {
  if (cartState?.mode !== "shopify") return false;
  const lines = cartState?.cart?.lines || [];
  const catalog = cartState?.catalog || {};
  const plan = bundleGiftPlan(lines, catalog);
  return Boolean(plan.missingSetupIds.length || plan.removeIds.length || plan.paidGiftIds.length);
}

export function initialiseCheckoutIntegrityGuard(cartActions) {
  document.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;
    const checkout = event.target.closest("[data-checkout]");
    if (!checkout || checkout.getAttribute("aria-disabled") === "true") return;

    const currentState = cartActions.getState();
    const needsRepair = orphanExtraIds(currentState.cart?.lines || []).length || bundleIntegrityNeeded(currentState);
    if (!needsRepair) return;

    event.preventDefault();
    checkout.setAttribute("aria-disabled", "true");

    try {
      const cleanState = await cartActions.prepareForCheckout();
      const checkoutUrl = String(cleanState.cart?.checkoutUrl || "").trim();
      const unresolvedBundle = bundleIntegrityNeeded(cleanState);
      if (checkoutUrl && cleanState.cart?.lines?.length && !unresolvedBundle) {
        window.location.assign(checkoutUrl);
      }
    } finally {
      if (document.contains(checkout)) {
        checkout.setAttribute("aria-disabled", String(!cartActions.getState().cart?.checkoutUrl));
      }
    }
  }, { capture: true });
}
