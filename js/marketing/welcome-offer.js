import { setBodyLock, trapFocus } from "../ui/common.js";

const STORAGE = Object.freeze({
  visitorId: "tapntrust_welcome_visitor_id",
  email: "tapntrust_welcome_email",
  signupAt: "tapntrust_welcome_signup_at",
  claimedAt: "tapntrust_welcome_claimed_at",
  addToCartAt: "tapntrust_welcome_add_to_cart_at",
  checkoutAt: "tapntrust_welcome_checkout_at"
});
const AUTO_PROMPT_KEY = "tapntrust_welcome_auto_prompted";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function storageGet(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Browser storage is optional. */ }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* Browser storage is optional. */ }
}
function sessionGet(key) {
  try { return sessionStorage.getItem(key) || ""; } catch { return ""; }
}
function sessionSet(key, value) {
  try { sessionStorage.setItem(key, String(value)); } catch { /* Browser storage is optional. */ }
}
function nowIso() { return new Date().toISOString(); }
function createVisitorId() {
  return globalThis.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function cleanEmail(value) { return String(value || "").trim().toLowerCase(); }
function endpointFromConfig(config = {}) {
  const value = String(config.LEAD_CAPTURE_ENDPOINT || "").trim();
  return /^https:\/\//i.test(value) ? value : "";
}
function visitorId() {
  const existing = storageGet(STORAGE.visitorId);
  if (existing) return existing;
  const created = createVisitorId();
  storageSet(STORAGE.visitorId, created);
  return created;
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
  link.href = "css/welcome-offer.css?v=20260901-1";
  link.dataset.welcomeOfferStyles = "";
  document.head.append(link);
}
function popupMarkup(discountCode, discountPercent) {
  const root = document.createElement("div");
  root.className = "welcome-offer";
  root.hidden = true;
  root.innerHTML = `
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
          <p>Enter your email and unlock your welcome discount instantly.</p>
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
          <p class="welcome-offer__kicker">${discountPercent}% OFF UNLOCKED</p>
          <h2>Your discount is ready</h2>
          <p data-welcome-success-copy>We’re applying your welcome code to the cart now.</p>
          <div class="welcome-offer__code-row"><strong>${discountCode}</strong><button type="button" data-welcome-copy>Copy code</button></div>
          <p class="welcome-offer__copy-status" role="status" aria-live="polite" data-welcome-copy-status></p>
          <button class="welcome-offer__shop" type="button" data-welcome-shop>Continue to cart</button>
        </div>
      </div>
    </section>`;
  document.body.append(root);
  return root;
}
function createCartOffer(discountCode, discountPercent) {
  let root = document.querySelector("[data-welcome-cart-offer]");
  if (root) return root;
  root = document.createElement("section");
  root.className = "welcome-cart-offer";
  root.dataset.welcomeCartOffer = "";
  root.hidden = true;
  root.innerHTML = `
    <div data-welcome-cart-unclaimed>
      <span class="welcome-cart-offer__badge">FIRST ORDER OFFER</span>
      <strong>Get ${discountPercent}% off your order</strong>
      <p>Enter your email to unlock your welcome discount.</p>
      <button type="button" data-welcome-cart-unlock>Unlock ${discountPercent}% off</button>
    </div>
    <div data-welcome-cart-claimed hidden>
      <span class="welcome-cart-offer__badge welcome-cart-offer__badge--success">✓ ${discountPercent}% OFF UNLOCKED</span>
      <strong>${discountCode}</strong>
      <p data-welcome-cart-status>Your welcome code is ready for checkout.</p>
      <button type="button" data-welcome-cart-copy>Copy code</button>
    </div>`;
  const footer = document.querySelector("[data-cart-footer]");
  if (footer) footer.prepend(root);
  return root;
}

export function initialiseWelcomeOffer({ config = {}, cartActions, openCart } = {}) {
  if (!document.querySelector("[data-product-form]") || document.querySelector("[data-welcome-dialog]")) return null;
  const endpoint = endpointFromConfig(config);
  if (!endpoint || !cartActions) return null;
  const discountCode = String(config.WELCOME_DISCOUNT_CODE || "WELCOMETNT").trim().toUpperCase();
  const discountPercent = Number(config.WELCOME_DISCOUNT_PERCENT || 10);
  const cooldownDays = Math.max(1, Number(config.WELCOME_POPUP_COOLDOWN_DAYS || 14));
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;

  ensureStyles();
  const root = popupMarkup(discountCode, discountPercent);
  const cartOffer = createCartOffer(discountCode, discountPercent);
  const dialog = root.querySelector("[data-welcome-dialog]");
  const form = root.querySelector("[data-welcome-form]");
  const emailInput = root.querySelector("[data-welcome-email]");
  const status = root.querySelector("[data-welcome-status]");
  const formPanel = root.querySelector("[data-welcome-form-panel]");
  const successPanel = root.querySelector("[data-welcome-success]");
  const copyStatus = root.querySelector("[data-welcome-copy-status]");
  const successCopy = root.querySelector("[data-welcome-success-copy]");
  let lastFocused = null;

  function isClaimed() {
    const claimedAt = Number(storageGet(STORAGE.claimedAt) || 0);
    return Boolean(storageGet(STORAGE.email) && claimedAt && Date.now() - claimedAt < cooldownMs);
  }
  function ensureLeadCycle(addToCartAt) {
    if (!storageGet(STORAGE.visitorId) || !storageGet(STORAGE.addToCartAt) || isClaimed()) {
      storageSet(STORAGE.visitorId, createVisitorId());
      storageSet(STORAGE.addToCartAt, addToCartAt || nowIso());
      storageRemove(STORAGE.email);
      storageRemove(STORAGE.signupAt);
      storageRemove(STORAGE.claimedAt);
      storageRemove(STORAGE.checkoutAt);
    }
  }
  function renderCartOffer() {
    const hasPrimary = Boolean(cartActions.getState().cart?.lines?.some((line) => line.kind === "primary"));
    cartOffer.hidden = !hasPrimary;
    if (!hasPrimary) return;
    const claimed = isClaimed();
    cartOffer.querySelector("[data-welcome-cart-unclaimed]").hidden = claimed;
    cartOffer.querySelector("[data-welcome-cart-claimed]").hidden = !claimed;
    if (claimed) {
      const applied = cartActions.getState().cart?.discountCodes?.includes(discountCode);
      const cartStatus = cartOffer.querySelector("[data-welcome-cart-status]");
      if (cartStatus) cartStatus.textContent = applied
        ? `${discountCode} is applied to this cart.`
        : `Use ${discountCode} at checkout if it is not applied automatically.`;
    }
  }
  function resetPopupPanels() {
    const claimed = isClaimed();
    formPanel.hidden = claimed;
    successPanel.hidden = !claimed;
    if (claimed) {
      successCopy.textContent = cartActions.getState().cart?.discountCodes?.includes(discountCode)
        ? "Your 10% welcome discount is applied to this cart."
        : "Your welcome code is ready to use at checkout.";
    }
  }
  function open() {
    if (!root.hidden) return;
    resetPopupPanels();
    lastFocused = document.activeElement;
    root.hidden = false;
    requestAnimationFrame(() => {
      root.classList.add("is-open");
      setBodyLock();
      (isClaimed() ? root.querySelector("[data-welcome-copy]") : emailInput)?.focus();
    });
  }
  function close({ goToCart = false } = {}) {
    root.classList.remove("is-open");
    window.setTimeout(() => {
      root.hidden = true;
      setBodyLock();
      if (goToCart) openCart?.();
      else lastFocused?.focus?.();
    }, 220);
  }
  async function copyCode(targetStatus = copyStatus) {
    try {
      await navigator.clipboard.writeText(discountCode);
      targetStatus.textContent = `${discountCode} copied.`;
    } catch {
      targetStatus.textContent = `Your discount code is ${discountCode}.`;
    }
  }
  async function applyWelcomeDiscount() {
    try {
      await cartActions.applyDiscountCode(discountCode);
      successCopy.textContent = `Your ${discountPercent}% welcome discount is applied to the cart.`;
      copyStatus.textContent = "Discount applied automatically — no need to paste the code.";
    } catch {
      successCopy.textContent = `Copy ${discountCode} and enter it at checkout for ${discountPercent}% off.`;
      copyStatus.textContent = "Automatic apply was unavailable, but your code is ready.";
    }
    renderCartOffer();
  }
  async function recordAction(eventName, occurredAt, options = {}) {
    const email = storageGet(STORAGE.email);
    if (!email) return false;
    return postEvent(endpoint, { ...payloadBase(email), event: eventName, occurredAt }, options);
  }

  document.addEventListener("tapntrust:welcome-offer-eligible", (event) => {
    if (isClaimed()) {
      renderCartOffer();
      return;
    }
    ensureLeadCycle(String(event.detail?.occurredAt || nowIso()));
    renderCartOffer();
    if (sessionGet(AUTO_PROMPT_KEY)) return;
    sessionSet(AUTO_PROMPT_KEY, "1");
    event.preventDefault();
    open();
  });

  form?.addEventListener("submit", (event) => {
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
    const signupAt = nowIso();
    storageSet(STORAGE.email, email);
    storageSet(STORAGE.signupAt, signupAt);
    storageSet(STORAGE.claimedAt, Date.now());
    storageRemove(STORAGE.checkoutAt);
    status.textContent = "";
    formPanel.hidden = true;
    successPanel.hidden = false;
    root.querySelector("[data-welcome-copy]")?.focus();
    renderCartOffer();

    void postEvent(endpoint, {
      ...payloadBase(email),
      checkoutAt: "",
      event: "signup",
      occurredAt: signupAt,
      discountCode,
      discountPercent
    });
    void applyWelcomeDiscount();
  });

  root.querySelector("[data-welcome-close]")?.addEventListener("click", () => close({ goToCart: true }));
  root.querySelector("[data-welcome-backdrop]")?.addEventListener("click", () => close({ goToCart: true }));
  root.querySelector("[data-welcome-shop]")?.addEventListener("click", () => close({ goToCart: true }));
  root.querySelector("[data-welcome-copy]")?.addEventListener("click", () => copyCode(copyStatus));
  dialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ goToCart: true });
      return;
    }
    trapFocus(event, dialog);
  });

  cartOffer.querySelector("[data-welcome-cart-unlock]")?.addEventListener("click", open);
  cartOffer.querySelector("[data-welcome-cart-copy]")?.addEventListener("click", () => {
    const target = cartOffer.querySelector("[data-welcome-cart-status]");
    copyCode(target);
  });

  document.addEventListener("tapntrust:cart-change", renderCartOffer);
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const checkout = event.target.closest("[data-checkout]");
    if (!checkout || checkout.getAttribute("aria-disabled") === "true") return;
    if (!storageGet(STORAGE.email) || storageGet(STORAGE.checkoutAt)) return;
    const occurredAt = nowIso();
    storageSet(STORAGE.checkoutAt, occurredAt);
    void recordAction("checkout", occurredAt, { beacon: true });
  }, { capture: true });

  renderCartOffer();
  return { open, close, renderCartOffer };
}
