(() => {
  const STORAGE_KEY = "tapntrust_test_mode";

  function readStoredMode() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setStoredMode(enabled) {
    try {
      if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Test mode remains URL-scoped when browser storage is unavailable.
    }
  }

  let requested = "";
  try {
    requested = new URLSearchParams(window.location.search).get("test") || "";
  } catch {
    // Ignore malformed query state.
  }

  if (requested === "1") setStoredMode(true);
  else if (requested === "0") setStoredMode(false);

  const enabled = requested === "1" || (requested !== "0" && readStoredMode());
  window.TAPNTRUST_TEST_MODE = enabled;

  if (!enabled) return;

  document.documentElement.dataset.tapntrustTestMode = "true";

  // Neutralise any queued browser-side Meta Pixel calls and stop subsequent
  // storefront fbq events on this browser while owner test mode is active.
  try {
    if (typeof window.fbq === "function") {
      window.fbq("consent", "revoke");
      if (Array.isArray(window.fbq.queue)) window.fbq.queue.length = 0;
    }
  } catch {
    // Continue with the local no-op even if the legacy Pixel stub rejects a call.
  }

  document.querySelectorAll('script[src*="connect.facebook.net/"]').forEach((script) => script.remove());

  const noopFbq = function () {};
  noopFbq.loaded = true;
  noopFbq.version = "2.0";
  noopFbq.queue = [];
  window.fbq = noopFbq;
  window._fbq = noopFbq;

  // Queue Clarity opt-out and suppress Tapntrust Clarity funnel events.
  window.clarity = window.clarity || function (...args) {
    (window.clarity.q = window.clarity.q || []).push(args);
  };
  try {
    window.clarity("consent", false);
  } catch {
    // If Clarity is unavailable there is nothing to record.
  }
})();