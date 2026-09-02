(() => {
  const STORAGE_KEY = "tapntrust_test_mode";
  const CLARITY_SCRIPT_PATTERN = /(?:^|\/)clarity\.ms\/tag\//i;

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

  function isClarityScript(node) {
    return Boolean(
      node
      && node.nodeType === 1
      && String(node.tagName || "").toUpperCase() === "SCRIPT"
      && CLARITY_SCRIPT_PATTERN.test(String(node.src || node.getAttribute?.("src") || ""))
    );
  }

  function blockDeferredClarityLoader() {
    // The homepage owns a delayed Clarity loader that appends its script after
    // window.load. In owner test mode we block that append entirely so Clarity
    // never starts and cannot create even a limited/no-consent session.
    const body = document.body;
    if (!body || body.dataset.tapntrustClarityBlocked === "true") return;
    body.dataset.tapntrustClarityBlocked = "true";

    const nativeAppend = body.append;
    if (typeof nativeAppend === "function") {
      body.append = function (...nodes) {
        const allowed = nodes.filter((node) => !isClarityScript(node));
        if (!allowed.length) return undefined;
        return nativeAppend.apply(this, allowed);
      };
    }

    const nativeAppendChild = body.appendChild;
    if (typeof nativeAppendChild === "function") {
      body.appendChild = function (node) {
        if (isClarityScript(node)) return node;
        return nativeAppendChild.call(this, node);
      };
    }

    document.querySelectorAll('script[src*="clarity.ms/tag/"]').forEach((script) => script.remove());
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
  blockDeferredClarityLoader();

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

  // Queue Clarity opt-out as a second safety layer and suppress Tapntrust
  // Clarity funnel events. The primary protection is that the script is never loaded.
  window.clarity = window.clarity || function (...args) {
    (window.clarity.q = window.clarity.q || []).push(args);
  };
  try {
    window.clarity("consent", false);
  } catch {
    // If Clarity is unavailable there is nothing to record.
  }
})();