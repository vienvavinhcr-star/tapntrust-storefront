import config from "./config.js";
import { FULFILMENT_KEYS, ITEM_ROLES } from "./fulfilment.js";
import {
  addCartLines,
  fetchProductByHandle,
  removeCartLines,
  updateCartDiscountCodes
} from "./shopify.js";

const OFFER_CODE_KEY = "_Insights Offer Code";
const OFFER_ID_KEY = "_Insights Offer ID";
const OFFER_KIND_KEY = "_Insights Offer";
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
let productPromise = null;

function formatMinor(value) {
  return money.format(Number(value || 0) / 100).replace("$", "A$");
}

function selected(root, selector) {
  return root?.querySelector(selector) || null;
}

function offerEndpoint() {
  return String(config.INSIGHTS_OFFER_ENDPOINT || "").trim();
}

async function requestOffer(action, details, setupId = "") {
  const endpoint = offerEndpoint();
  if (!endpoint) throw new Error("TapnTrust Insights is not available right now.");
  const response = await fetch(endpoint, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      setupId,
      businessName: String(details.businessName || "").trim(),
      googlePlaceId: String(details.googlePlaceId || "").trim(),
      reviewUrl: String(details.reviewUrl || "").trim()
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "TapnTrust Insights could not prepare this offer.");
  return payload;
}

async function insightsProduct() {
  if (!productPromise) productPromise = fetchProductByHandle(config.INSIGHTS_PRODUCT_HANDLE);
  return productPromise;
}

function monthlyPlan(product) {
  const plans = (product?.sellingPlanGroups?.nodes || []).flatMap((group) => group.sellingPlans?.nodes || []);
  return plans.find((plan) => plan.recurringDeliveries && (plan.options || []).some((option) => /month/i.test(String(option.value || ""))))
    || plans.find((plan) => plan.recurringDeliveries)
    || null;
}

function setupIdForPrimary(primaryLine) {
  return String(primaryLine?.attributes?.[FULFILMENT_KEYS.setupId] || "").trim();
}

function insightsForSetup(cartState, setupId) {
  return (cartState.cart?.lines || []).find((line) => (
    line.kind === "insights"
    && String(line.attributes?.[FULFILMENT_KEYS.setupId] || "").trim() === setupId
  ));
}

function otherInsightsExist(cartState, setupId = "") {
  return (cartState.cart?.lines || []).some((line) => (
    line.kind === "insights"
    && String(line.attributes?.[FULFILMENT_KEYS.setupId] || "").trim() !== setupId
  ));
}

function detailsUsable(details) {
  return Boolean(
    String(details?.businessName || "").trim()
    && /^https:\/\//i.test(String(details?.reviewUrl || "").trim())
  );
}

export function initialiseInsightsOffer({ form, cartActions, toast } = {}) {
  const root = selected(form, "[data-insights-offer]");
  const checkbox = selected(root, "[data-insights-toggle]");
  const price = selected(root, "[data-insights-price]");
  const status = selected(root, "[data-insights-status]");
  const badge = selected(root, ".insights-offer__badge");
  const mascotStage = selected(root, "[data-insights-offer-mascot]");
  const mascotMessage = selected(root, "[data-insights-offer-mascot-message]");
  const mascotAnnouncement = selected(root, "[data-insights-offer-announcement]");
  const manualName = selected(form, "[data-manual-business-name]");
  const manualUrl = selected(form, "[data-manual-review-url]");
  let quoteSequence = 0;
  let mascotTimer = 0;
  let latestDetails = null;
  let editing = false;

  function announceMascot(message) {
    if (mascotMessage) mascotMessage.textContent = message;
    if (mascotAnnouncement) mascotAnnouncement.textContent = message;
  }

  function showMascotGreeting(isSelected) {
    if (!root || !mascotStage) return;
    window.clearTimeout(mascotTimer);
    root.classList.remove("is-mascot-leaving", "is-mascot-goodbye");
    root.classList.add("is-mascot-visible");
    mascotStage.setAttribute("aria-hidden", "false");

    if (isSelected) {
      announceMascot("Hi! I’ll help turn your card activity into useful next steps.");
      return;
    }

    announceMascot("Bye for now — you can add me again anytime.");
    root.classList.add("is-mascot-goodbye");
    mascotTimer = window.setTimeout(() => {
      root.classList.add("is-mascot-leaving");
      mascotTimer = window.setTimeout(() => {
        root.classList.remove("is-mascot-visible", "is-mascot-leaving", "is-mascot-goodbye");
        mascotStage.setAttribute("aria-hidden", "true");
      }, 650);
    }, 650);
  }

  function renderMarketingPrice(priceText, statusText) {
    document.querySelectorAll("[data-insights-marketing-price]").forEach((element) => {
      element.textContent = priceText;
    });
    document.querySelectorAll("[data-insights-marketing-status]").forEach((element) => {
      element.textContent = statusText;
    });
  }

  function renderQuote(payload = null) {
    if (!root || !price || !status) return;
    if (!payload) {
      price.textContent = "A$1.99 for your first month";
      status.textContent = "Then just A$6.99/month.";
      if (badge) badge.textContent = "First month offer";
      root.dataset.offerState = "unknown";
      renderMarketingPrice(
        "A$1.99 for your first month",
        "Then just A$6.99/month · Renews monthly."
      );
      return;
    }
    if (payload.introEligible) {
      price.textContent = `${formatMinor(payload.firstMonthMinor)} for your first month`;
      status.textContent = `Then ${formatMinor(payload.recurringMinor)}/month. Renews monthly.`;
      if (badge) badge.textContent = payload.discountCode ? "Intro ready" : "Intro eligible";
      root.dataset.offerState = "intro";
      renderMarketingPrice(
        `${formatMinor(payload.firstMonthMinor)} for your first month`,
        `Then just ${formatMinor(payload.recurringMinor)}/month · Renews monthly.`
      );
    } else {
      price.textContent = `${formatMinor(payload.recurringMinor)}/month`;
      status.textContent = payload.reason === "intro_already_used"
        ? "This business has already used the first-month intro offer."
        : "Standard monthly pricing applies to this business.";
      if (badge) badge.textContent = "Standard plan";
      root.dataset.offerState = "standard";
      renderMarketingPrice(
        `${formatMinor(payload.recurringMinor)}/month`,
        payload.reason === "intro_already_used"
          ? "The first-month offer has already been used · Renews monthly."
          : "Standard monthly pricing for this business · Renews monthly."
      );
    }
  }

  async function previewEligibility(details = {}) {
    latestDetails = detailsUsable(details) ? details : null;
    if (!latestDetails) {
      renderQuote();
      return null;
    }
    const sequence = ++quoteSequence;
    status.textContent = "Checking first-month offer…";
    try {
      const quote = await requestOffer("quote", latestDetails);
      if (sequence === quoteSequence) renderQuote(quote);
      return quote;
    } catch {
      if (sequence === quoteSequence) {
        renderQuote();
        status.textContent = "We’ll confirm the subscription price before adding it to your cart.";
      }
      return null;
    }
  }

  function manualDetails() {
    const businessName = String(manualName?.value || "").trim();
    const reviewUrl = String(manualUrl?.value || "").trim();
    return { businessName, reviewUrl, googlePlaceId: "" };
  }

  let manualTimer = 0;
  function queueManualQuote() {
    window.clearTimeout(manualTimer);
    manualTimer = window.setTimeout(() => {
      const details = manualDetails();
      if (detailsUsable(details)) void previewEligibility(details);
    }, 450);
  }
  manualName?.addEventListener("input", queueManualQuote);
  manualUrl?.addEventListener("input", queueManualQuote);

  checkbox?.addEventListener("change", () => {
    root?.classList.toggle("is-selected", Boolean(checkbox.checked));
    showMascotGreeting(Boolean(checkbox.checked));
    if (checkbox.checked && latestDetails) void previewEligibility(latestDetails);
  });

  async function prepare(details) {
    if (!checkbox?.checked || editing) return { enabled: false };
    const currentState = cartActions.getState();
    if (otherInsightsExist(currentState)) {
      throw new Error("TapnTrust Insights can currently be added to one business location per checkout. Complete this order first, then subscribe another location separately.");
    }
    const setupId = globalThis.crypto?.randomUUID?.() || `setup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const offer = await requestOffer("issue", details, setupId);
    renderQuote(offer);
    return { enabled: true, setupId, offer };
  }

  async function attach(primaryLine, prepared) {
    if (!prepared?.enabled) return cartActions.getState();
    const setupId = setupIdForPrimary(primaryLine);
    if (!setupId || setupId !== prepared.setupId) {
      throw new Error("TapnTrust Insights could not match this card setup. Please try again.");
    }
    const stateBefore = cartActions.getState();
    if (insightsForSetup(stateBefore, setupId)) return stateBefore;
    const product = await insightsProduct();
    const variant = product?.variants?.nodes?.[0];
    const plan = monthlyPlan(product);
    if (!variant?.id || !variant.availableForSale || !plan?.id) {
      throw new Error("TapnTrust Insights is temporarily unavailable in Shopify.");
    }
    if (prepared.offer.variantId && prepared.offer.variantId !== variant.id) {
      throw new Error("TapnTrust Insights product configuration does not match. Please contact support.");
    }
    if (prepared.offer.sellingPlanId && prepared.offer.sellingPlanId !== plan.id) {
      throw new Error("TapnTrust Insights subscription configuration does not match. Please contact support.");
    }

    const offerCode = String(prepared.offer.discountCode || "").trim();
    const attributes = [
      { key: FULFILMENT_KEYS.setupId, value: setupId },
      { key: FULFILMENT_KEYS.itemRole, value: ITEM_ROLES.insights },
      { key: OFFER_KIND_KEY, value: String(prepared.offer.offerKind || "standard") },
      ...(prepared.offer.offerId ? [{ key: OFFER_ID_KEY, value: String(prepared.offer.offerId) }] : []),
      ...(offerCode ? [{ key: OFFER_CODE_KEY, value: offerCode }] : [])
    ];

    const cartId = stateBefore.cart?.id;
    if (!cartId) throw new Error("Your Shopify cart is not ready. Please try again.");
    await addCartLines(cartId, [{
      merchandiseId: variant.id,
      quantity: 1,
      sellingPlanId: plan.id,
      attributes
    }]);
    await cartActions.initialise();
    let current = cartActions.getState();
    const added = insightsForSetup(current, setupId);
    if (!added) throw new Error("TapnTrust Insights was not returned by Shopify after it was added.");

    if (prepared.offer.offerKind === "intro") {
      if (!offerCode) {
        await cartActions.removeLine(added.id);
        throw new Error("The A$1.99 first-month offer could not be attached. Please try again.");
      }
      const previousCodes = [...(current.cart?.discountCodes || [])];
      const codes = [...new Set([...previousCodes, offerCode])];
      const updated = await updateCartDiscountCodes(current.cart.id, codes);
      const applicableCodes = (updated.discountCodes || [])
        .filter((entry) => entry.applicable)
        .map((entry) => String(entry.code).toLowerCase());
      const applicable = applicableCodes.includes(offerCode.toLowerCase());
      const lostExistingCode = previousCodes.find((code) => !applicableCodes.includes(String(code).toLowerCase()));
      await cartActions.initialise();
      current = cartActions.getState();
      if (!applicable || lostExistingCode) {
        const rollback = insightsForSetup(current, setupId);
        if (rollback?.id) await cartActions.removeLine(rollback.id);
        if (current.cart?.id) await updateCartDiscountCodes(current.cart.id, previousCodes).catch(() => {});
        await cartActions.initialise().catch(() => {});
        if (lostExistingCode) {
          throw new Error("The A$1.99 Insights offer cannot be combined with the discount already in your cart. Your existing discount was kept and Insights was not added.");
        }
        throw new Error("Shopify could not apply the A$1.99 first-month offer. No Insights subscription was added. Please try again.");
      }
    }
    return current;
  }

  function setEditing(value) {
    editing = Boolean(value);
    if (root) root.hidden = editing;
  }

  function associatedInsights(primaryLine) {
    return insightsForSetup(cartActions.getState(), setupIdForPrimary(primaryLine));
  }

  renderQuote();
  return { prepare, attach, previewEligibility, renderQuote, setEditing, associatedInsights };
}
