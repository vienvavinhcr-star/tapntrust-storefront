const CLARITY_EVENT_PREFIX = "tapntrust.clarity.";
const TEST_MODE_STORAGE_KEY = "tapntrust_test_mode";
const trackedThisPage = new Set();
const PACKAGE_EVENTS = Object.freeze({
  1: "add_to_cart_1_card",
  2: "add_to_cart_2_cards",
  3: "add_to_cart_3_cards",
  5: "add_to_cart_5_cards"
});

function storageGet(key) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Test mode is best-effort when localStorage is unavailable.
  }
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Test mode is best-effort when localStorage is unavailable.
  }
}

function resolveTestMode() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("test");

  if (requested === "1") storageSet(TEST_MODE_STORAGE_KEY, "1");
  else if (requested === "0") storageRemove(TEST_MODE_STORAGE_KEY);

  return requested === "1" || (requested !== "0" && storageGet(TEST_MODE_STORAGE_KEY) === "1");
}

const clarityTestMode = resolveTestMode();

function disableClarityForTestMode() {
  if (!clarityTestMode) return false;

  // Queue the opt-out before Clarity finishes loading. Microsoft Clarity's
  // consent(false) call clears Clarity cookies and prevents further tracking
  // until consent is granted again.
  window.clarity = window.clarity || function (...args) {
    (window.clarity.q = window.clarity.q || []).push(args);
  };

  try {
    window.clarity("consent", false);
  } catch {
    // If Clarity is unavailable, there is nothing to record.
  }

  document.documentElement.dataset.tapntrustTestMode = "true";
  return true;
}

disableClarityForTestMode();

function hasTracked(eventName) {
  if (trackedThisPage.has(eventName)) return true;
  try {
    return window.sessionStorage.getItem(`${CLARITY_EVENT_PREFIX}${eventName}`) === "1";
  } catch {
    return false;
  }
}

function markTracked(eventName) {
  trackedThisPage.add(eventName);
  try {
    window.sessionStorage.setItem(`${CLARITY_EVENT_PREFIX}${eventName}`, "1");
  } catch {
    // Session storage can be unavailable in some privacy modes; tracking can still continue.
  }
}

function trackClarityEventOnce(eventName) {
  if (clarityTestMode || window.TAPNTRUST_TEST_MODE === true || hasTracked(eventName)) return false;

  try {
    // Preserve early actions until the existing delayed Clarity loader starts.
    // This is only its standard command queue, not a second SDK loader.
    window.clarity = window.clarity || function (...args) {
      (window.clarity.q = window.clarity.q || []).push(args);
    };
    window.clarity("event", eventName);
    markTracked(eventName);
    return true;
  } catch {
    return false;
  }
}

export function trackClarityPackageAdded(packageCount, cartState) {
  const eventName = PACKAGE_EVENTS[Number(packageCount)];
  if (!eventName || cartState?.mode !== "shopify") return;
  trackClarityEventOnce("add_to_cart");
  trackClarityEventOnce(eventName);
}

// Call only after a successful manual upsell action. Automatic bundle gifts
// never pass through this hook, even though they use the same stand variant.
export function trackClarityUpsellAdded(kind, cartState) {
  if (cartState?.mode !== "shopify") return;
  if (kind === "extra") trackClarityEventOnce("extra_card_added");
  else if (kind === "stand") trackClarityEventOnce("counter_stand_added");
}

export function trackClarityWelcomeClaimed(cartState) {
  if (cartState?.mode !== "shopify") return;
  trackClarityEventOnce("welcome_offer_claimed");
}

function initialiseBusinessSearchTracking() {
  if (clarityTestMode) return;

  const searchInput = document.querySelector("[data-business-search]");
  const selectedCard = document.querySelector("[data-selected-business]");
  const businessName = document.querySelector('[name="businessName"]');
  const googlePlaceId = document.querySelector('[name="googlePlaceId"]');
  if (!searchInput) return;

  searchInput.addEventListener("input", () => {
    if (searchInput.value.trim().length >= 3) {
      trackClarityEventOnce("business_search_started");
    }
  });

  let selectionAttemptAt = 0;
  const markSelectionAttempt = () => {
    selectionAttemptAt = Date.now();
  };

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".business-result")) markSelectionAttempt();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && searchInput.hasAttribute("aria-activedescendant")) {
      markSelectionAttempt();
    }
  });

  if (!selectedCard || !("MutationObserver" in window)) return;

  const maybeTrackSelectedBusiness = () => {
    const selectionIsRecent = selectionAttemptAt > 0 && Date.now() - selectionAttemptAt < 15000;
    const confirmedBusiness = !selectedCard.hidden
      && Boolean(businessName?.value.trim())
      && Boolean(googlePlaceId?.value.trim());

    if (!selectionIsRecent || !confirmedBusiness) return;

    trackClarityEventOnce("business_selected");
    selectionAttemptAt = 0;
  };

  new MutationObserver(maybeTrackSelectedBusiness).observe(selectedCard, {
    attributes: true,
    attributeFilter: ["hidden"]
  });
}

function initialiseCheckoutTracking() {
  if (clarityTestMode) return;

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const checkout = event.target.closest("[data-checkout]");
    if (!checkout || checkout.disabled || checkout.getAttribute("aria-disabled") === "true") return;

    const href = String(checkout.getAttribute("href") || "").trim();
    if (!href || href === "#") return;

    trackClarityEventOnce("begin_checkout");
  }, { capture: true });
}

initialiseBusinessSearchTracking();
initialiseCheckoutTracking();
