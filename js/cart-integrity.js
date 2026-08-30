import { FULFILMENT_KEYS, businessDetailsFromAttributes } from "./fulfilment.js";

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

  async function initialise() {
    await baseCartActions.initialise();
    return cleanupOrphanExtras();
  }

  async function removeLine(lineId) {
    const currentState = baseCartActions.getState();
    const target = currentState.cart?.lines?.find((line) => line.id === lineId);

    // Remove dependent Extra Cards first. If the package removal later fails,
    // the remaining cart is still valid rather than leaving an orphan Extra Card.
    if (target?.kind === "primary") {
      const dependentExtraIds = relatedExtraIds(target, currentState.cart?.lines || []);
      for (const extraId of dependentExtraIds) {
        await baseCartActions.removeLine(extraId);
      }
    }

    await baseCartActions.removeLine(lineId);
    return cleanupOrphanExtras();
  }

  return {
    ...baseCartActions,
    initialise,
    removeLine,
    cleanupOrphanExtras,
    prepareForCheckout: cleanupOrphanExtras
  };
}

export function initialiseCheckoutIntegrityGuard(cartActions) {
  document.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;
    const checkout = event.target.closest("[data-checkout]");
    if (!checkout || checkout.getAttribute("aria-disabled") === "true") return;

    const currentState = cartActions.getState();
    if (!orphanExtraIds(currentState.cart?.lines || []).length) return;

    event.preventDefault();
    checkout.setAttribute("aria-disabled", "true");

    try {
      const cleanState = await cartActions.prepareForCheckout();
      const checkoutUrl = String(cleanState.cart?.checkoutUrl || "").trim();
      if (checkoutUrl && cleanState.cart?.lines?.length) {
        window.location.assign(checkoutUrl);
      }
    } finally {
      if (document.contains(checkout)) {
        checkout.setAttribute("aria-disabled", String(!cartActions.getState().cart?.checkoutUrl));
      }
    }
  }, { capture: true });
}
