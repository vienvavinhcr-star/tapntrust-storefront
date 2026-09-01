function ownerTestModeActive() {
  return window.TAPNTRUST_TEST_MODE === true;
}

export function initialiseMetaPixel(config) {
  if (ownerTestModeActive()) return;
  if (!/^\d+$/.test(String(config.META_PIXEL_ID || "")) || typeof window.fbq === "function") return;

  const fbq = function (...args) { fbq.callMethod ? fbq.callMethod(...args) : fbq.queue.push(args); };
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  window.fbq = window.fbq || fbq;
  const pixelScript = document.createElement("script");
  pixelScript.async = true;
  pixelScript.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.append(pixelScript);
  window.fbq("init", config.META_PIXEL_ID);
  window.fbq("track", "PageView");
}

export function trackMetaEvent(eventName, parameters = {}) {
  if (ownerTestModeActive() || typeof window.fbq !== "function") return false;
  try {
    window.fbq("track", eventName, parameters);
    return true;
  } catch {
    return false;
  }
}

export function packageMetaParameters(packageCount) {
  const count = Number(packageCount);
  const option = document.querySelector(`[data-package="${count}"]`);
  const value = Number(option?.dataset.price || 0);
  const currency = option?.dataset.currency || "AUD";
  return {
    content_name: "Tapntrust NFC Review Card",
    content_category: `${count}-card package`,
    content_type: "product",
    currency,
    value,
    num_items: 1
  };
}

export function upsellMetaParameters(cartActions, kind) {
  const product = cartActions.getState().catalog?.[kind];
  const variant = product?.variants?.[0];
  return {
    content_name: product?.title || (kind === "stand" ? "Tapntrust Counter Stand" : "Tapntrust Extra NFC Card"),
    content_category: kind === "stand" ? "Counter stand" : "Extra NFC card",
    content_type: "product",
    currency: variant?.currency || "AUD",
    value: Number(variant?.price || 0),
    num_items: 1
  };
}

export function initialiseMetaCommerceEvents() {
  if (ownerTestModeActive()) return;
  const oneCard = document.querySelector('[data-package="1"]');
  trackMetaEvent("ViewContent", {
    content_name: "Tapntrust NFC Review Card",
    content_category: "NFC Review Card",
    content_type: "product",
    currency: oneCard?.dataset.currency || "AUD",
    value: Number(oneCard?.dataset.price || 39.95)
  });
}
