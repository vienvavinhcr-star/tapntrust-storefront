const CLARITY_EVENT_PREFIX = "tapntrust.clarity.";

function hasTracked(eventName) {
  try {
    return window.sessionStorage.getItem(`${CLARITY_EVENT_PREFIX}${eventName}`) === "1";
  } catch {
    return false;
  }
}

function markTracked(eventName) {
  try {
    window.sessionStorage.setItem(`${CLARITY_EVENT_PREFIX}${eventName}`, "1");
  } catch {
    // Session storage can be unavailable in some privacy modes; tracking can still continue.
  }
}

function trackClarityEventOnce(eventName) {
  if (hasTracked(eventName) || typeof window.clarity !== "function") return false;

  try {
    window.clarity("event", eventName);
    markTracked(eventName);
    return true;
  } catch {
    return false;
  }
}

function initialiseBusinessSearchTracking() {
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
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const checkout = event.target.closest("[data-checkout]");
    if (!checkout || checkout.getAttribute("aria-disabled") === "true") return;

    const href = String(checkout.getAttribute("href") || "").trim();
    if (!href || href === "#") return;

    trackClarityEventOnce("begin_checkout");
  }, { capture: true });
}

initialiseBusinessSearchTracking();
initialiseCheckoutTracking();
