import { setBodyLock, trapFocus } from "../ui/common.js";

const STORAGE = Object.freeze({
  visitorId: "tapntrust_welcome_visitor_id",
  shownAt: "tapntrust_welcome_shown_at",
  email: "tapntrust_welcome_email",
  signupAt: "tapntrust_welcome_signup_at",
  addToCartAt: "tapntrust_welcome_add_to_cart_at",
  checkoutAt: "tapntrust_welcome_checkout_at"
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function storageGet(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Optional browser storage. */ }
}

function nowIso() {
  return new Date().toISOString();
}

function visitorId() {
  const existing = storageGet(STORAGE.visitorId);
  if (existing) return existing;
  const created = globalThis.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  storageSet(STORAGE.visitorId, created);
  return created;
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function endpointFromConfig(config = {}) {
  const value = String(config.LEAD_CAPTURE_ENDPOINT || config.NEWSLETTER_ENDPOINT || "").trim();
  return /^https:\/\//i.test(value) ? value : "";
}

function payloadBase(email) {
  return {
    email: cleanEmail(email),
    visitorId: visitorId(),
    page: location.href,
    referrer: document.referrer || "",
    addToCartAt: storageGet(STORAGE.addToCartAt),
    checkoutAt: storageGet(STORAGE.checkoutAt)
  };
}

async function postEvent(endpoint, payload, { beacon = false } = {}) {
  if (!endpoint) return false;
  const body = JSON.stringify(payload);

  if (beacon && navigator.sendBeacon) {
    try {
      const accepted = navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      if (accepted) return true;
    } catch { /* Fall through to fetch. */ }
  }

  try {
    await fetch(endpoint, {
      method: "POST",
      mode: "no-cors",
      cache: "no-store",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body
    });
    return true;
  } catch {
    return false;
  }
}

function ensureStyles() {
  if (document.querySelector('link[data-welcome-offer-styles]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/welcome-offer.css?v=20260831-2";
  link.dataset.welcomeOfferStyles = "";
  document.head.append(link);
}

function markup(discountCode, discountPercent) {
  const wrapper = document.createElement("div");
  wrapper.className = "welcome-offer";
  wrapper.hidden = true;
  wrapper.innerHTML = `
    <div class="welcome-offer__backdrop" data-welcome-backdrop></div>
    <section class="welcome-offer__dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-offer-title" tabindex="-1" data-welcome-dialog>
      <button class="welcome-offer__close" type="button" aria-label="Close welcome offer" data-welcome-close>×</button>
      <div class="welcome-offer__visual" aria-hidden="true">
        <span class="welcome-offer__eyebrow">WELCOME TO TAPNTRUST</span>
        <strong>${discountPercent}% OFF</strong>
        <span>your first order</span>
        <div class="welcome-offer__tap-mark"><i></i><i></i><i></i></div>
      </div>
      <div class="welcome-offer__content">
        <div data-welcome-form-panel>
          <p class="welcome-offer__kicker">A little welcome gift</p>
          <h2 id="welcome-offer-title">Get ${discountPercent}% off your first Tapntrust order</h2>
          <p>Enter your email and we’ll reveal your welcome code instantly.</p>
          <form class="welcome-offer__form" data-welcome-form novalidate>
            <label for="welcome-offer-email">Email address</label>
            <div class="welcome-offer__field-row">
              <input id="welcome-offer-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required data-welcome-email>
              <button type="submit">Unlock my ${discountPercent}% off</button>
            </div>
            <div class="welcome-offer__honeypot" aria-hidden="true"><label>Company<input name="company" type="text" tabindex="-1" autocomplete="off"></label></div>
            <p class="welcome-offer__status" role="status" aria-live="polite" data-welcome-status></p>
          </form>
          <p class="welcome-offer__privacy">By signing up, you agree to receive Tapntrust offers by email. Unsubscribe anytime. <a href="privacy.html">Privacy Policy</a>.</p>
        </div>
        <div class="welcome-offer__success" data-welcome-success hidden>
          <span class="welcome-offer__success-mark" aria-hidden="true">✓</span>
          <p class="welcome-offer__kicker">10% OFF UNLOCKED</p>
          <h2>Your welcome code is ready</h2>
          <p>Copy your code now and use it at Shopify Checkout.</p>
          <div class="welcome-offer__code-row">
            <strong data-welcome-code>${discountCode}</strong>
            <button type="button" data-welcome-copy>Copy code</button>
          </div>
          <p class="welcome-offer__checkout-note"><strong>At checkout:</strong> paste <strong>${discountCode}</strong> into the “Discount code” box. Shopify will apply ${discountPercent}% off when the code is accepted.</p>
          <p class="welcome-offer__copy-status" role="status" aria-live="polite" data-welcome-copy-status></p>
          <button class="welcome-offer__shop" type="button" data-welcome-shop>Shop with ${discountPercent}% off</button>
        </div>
      </div>
    </section>`;
  document.body.append(wrapper);
  return wrapper;
}

export function initialiseWelcomeOffer(config = {}) {
  if (!document.querySelector("[data-product-form]") || document.querySelector("[data-welcome-dialog]")) return;

  const endpoint = endpointFromConfig(config);
  if (!endpoint) return;
  const discountCode = String(config.WELCOME_DISCOUNT_CODE || "WELCOMETNT").trim().toUpperCase();
  const discountPercent = Number(config.WELCOME_DISCOUNT_PERCENT || 10);
  const delayMs = Math.max(0, Number(config.WELCOME_POPUP_DELAY_MS || 10000));
  const cooldownDays = Math.max(1, Number(config.WELCOME_POPUP_COOLDOWN_DAYS || 14));
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;

  ensureStyles();
  const root = markup(discountCode, discountPercent);
  const dialog = root.querySelector("[data-welcome-dialog]");
  const form = root.querySelector("[data-welcome-form]");
  const emailInput = root.querySelector("[data-welcome-email]");
  const status = root.querySelector("[data-welcome-status]");
  const formPanel = root.querySelector("[data-welcome-form-panel]");
  const successPanel = root.querySelector("[data-welcome-success]");
  const copyStatus = root.querySelector("[data-welcome-copy-status]");
  let lastFocused = null;
  let lastCartQuantity = 0;
  let hasCartBaseline = false;

  function close() {
    root.classList.remove("is-open");
    window.setTimeout(() => {
      root.hidden = true;
      setBodyLock();
      lastFocused?.focus?.();
    }, 220);
  }

  function open() {
    if (!root.hidden) return;
    storageSet(STORAGE.shownAt, Date.now());
    lastFocused = document.activeElement;
    root.hidden = false;
    requestAnimationFrame(() => {
      root.classList.add("is-open");
      setBodyLock();
      emailInput?.focus();
    });
  }

  function eligibleToShow() {
    const shownAt = Number(storageGet(STORAGE.shownAt) || 0);
    return !shownAt || Date.now() - shownAt >= cooldownMs;
  }

  function storefrontModalIsOpen() {
    return Boolean(document.querySelector(".cart-drawer.is-open, .guide-modal.is-open"));
  }

  function attemptOpen() {
    if (!eligibleToShow()) return;
    if (document.visibilityState !== "visible" || storefrontModalIsOpen()) {
      window.setTimeout(attemptOpen, 1000);
      return;
    }
    open();
  }

  function scheduleOpen() {
    if (!eligibleToShow()) return;
    window.setTimeout(attemptOpen, delayMs);
  }

  async function recordAction(eventName, occurredAt, options = {}) {
    const email = storageGet(STORAGE.email);
    if (!email) return false;
    return postEvent(endpoint, {
      ...payloadBase(email),
      event: eventName,
      occurredAt
    }, options);
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const honeypot = String(new FormData(form).get("company") || "").trim();
    if (honeypot) return;

    const email = cleanEmail(emailInput?.value);
    if (!EMAIL_PATTERN.test(email)) {
      status.textContent = "Enter a valid email address.";
      emailInput?.setAttribute("aria-invalid", "true");
      emailInput?.focus();
      return;
    }

    emailInput?.removeAttribute("aria-invalid");
    status.textContent = "Saving your welcome offer…";
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    const signupAt = nowIso();
    const sent = await postEvent(endpoint, {
      ...payloadBase(email),
      event: "signup",
      occurredAt: signupAt,
      discountCode,
      discountPercent
    });

    if (!sent) {
      status.textContent = "We couldn’t save your email. Please try again.";
      if (submit) submit.disabled = false;
      return;
    }

    storageSet(STORAGE.email, email);
    storageSet(STORAGE.signupAt, signupAt);
    status.textContent = "";
    formPanel.hidden = true;
    successPanel.hidden = false;
    root.querySelector("[data-welcome-copy]")?.focus();
  });

  root.querySelectorAll("[data-welcome-close], [data-welcome-backdrop]").forEach((element) => element.addEventListener("click", close));
  dialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(event, dialog);
  });

  root.querySelector("[data-welcome-copy]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(discountCode);
      copyStatus.textContent = `${discountCode} copied — paste it into the Discount code box at checkout.`;
    } catch {
      copyStatus.textContent = `Copy this code for checkout: ${discountCode}`;
    }
  });

  root.querySelector("[data-welcome-shop]")?.addEventListener("click", () => {
    close();
    window.setTimeout(() => document.querySelector("#shop")?.scrollIntoView({ behavior: "smooth", block: "start" }), 240);
  });

  document.addEventListener("tapntrust:cart-change", (event) => {
    const quantity = Number(event.detail?.cart?.totalQuantity || 0);
    if (!hasCartBaseline) {
      hasCartBaseline = true;
      lastCartQuantity = quantity;
      return;
    }

    if (quantity > lastCartQuantity && !storageGet(STORAGE.addToCartAt)) {
      const occurredAt = nowIso();
      storageSet(STORAGE.addToCartAt, occurredAt);
      recordAction("add_to_cart", occurredAt);
    }
    lastCartQuantity = quantity;
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const checkout = event.target.closest("[data-checkout]");
    if (!checkout || checkout.getAttribute("aria-disabled") === "true") return;
    if (storageGet(STORAGE.checkoutAt)) return;
    const occurredAt = nowIso();
    storageSet(STORAGE.checkoutAt, occurredAt);
    recordAction("checkout", occurredAt, { beacon: true });
  }, { capture: true });

  scheduleOpen();
}