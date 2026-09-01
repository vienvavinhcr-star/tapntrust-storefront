import { setBodyLock, trapFocus } from "../ui/common.js";
import { updateCartDiscountCodes } from "../shopify.js";

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

function getLocal(key) { try { return localStorage.getItem(key) || ""; } catch { return ""; } }
function setLocal(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* optional */ } }
function removeLocal(key) { try { localStorage.removeItem(key); } catch { /* optional */ } }
function getSession(key) { try { return sessionStorage.getItem(key) || ""; } catch { return ""; } }
function setSession(key, value) { try { sessionStorage.setItem(key, String(value)); } catch { /* optional */ } }
function nowIso() { return new Date().toISOString(); }
function createVisitorId() { return globalThis.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function cleanEmail(value) { return String(value || "").trim().toLowerCase(); }
function primaryQuantity(state) {
  return (state?.cart?.lines || []).filter((line) => line.kind === "primary").reduce((sum, line) => sum + Number(line.quantity || 0), 0);
}
function hasPrimary(state) { return primaryQuantity(state) > 0; }
function endpointFromConfig(config) {
  const value = String(config?.LEAD_CAPTURE_ENDPOINT || "").trim();
  return /^https:\/\//i.test(value) ? value : "";
}
function visitorId() {
  const current = getLocal(STORAGE.visitorId);
  if (current) return current;
  const created = createVisitorId();
  setLocal(STORAGE.visitorId, created);
  return created;
}
function payloadBase(email) {
  return {
    email: cleanEmail(email),
    visitorId: visitorId(),
    page: location.href,
    referrer: document.referrer || "",
    addToCartAt: getLocal(STORAGE.addToCartAt),
    checkoutAt: getLocal(STORAGE.checkoutAt)
  };
}
async function postEvent(endpoint, payload, { beacon = false } = {}) {
  if (!endpoint) return false;
  const body = JSON.stringify(payload);
  if (beacon && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return true;
    } catch { /* fetch fallback */ }
  }
  try {
    await fetch(endpoint, { method: "POST", mode: "no-cors", cache: "no-store", keepalive: true, headers: { "Content-Type": "text/plain;charset=UTF-8" }, body });
    return true;
  } catch { return false; }
}
function ensureStyles() {
  if (document.querySelector('link[data-welcome-offer-styles]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/welcome-offer.css?v=20260901-1";
  link.dataset.welcomeOfferStyles = "";
  document.head.append(link);
}
function buildPopup(discountCode, discountPercent) {
  const root = document.createElement("div");
  root.className = "welcome-offer";
  root.hidden = true;
  root.innerHTML = `
    <div class="welcome-offer__backdrop" data-welcome-backdrop></div>
    <section class="welcome-offer__dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-offer-title" tabindex="-1" data-welcome-dialog>
      <button class="welcome-offer__close" type="button" aria-label="Close welcome offer" data-welcome-close>×</button>
      <div class="welcome-offer__visual" aria-hidden="true"><span class="welcome-offer__eyebrow">WELCOME TO TAPNTRUST</span><strong>${discountPercent}% OFF</strong><span>your first order</span><div class="welcome-offer__tap-mark"><i></i><i></i><i></i></div></div>
      <div class="welcome-offer__content">
        <div data-welcome-form-panel>
          <p class="welcome-offer__kicker">A little welcome gift</p>
          <h2 id="welcome-offer-title">Get ${discountPercent}% off your first Tapntrust order</h2>
          <p>Enter your email and unlock your welcome discount instantly.</p>
          <form class="welcome-offer__form" data-welcome-form novalidate>
            <label for="welcome-offer-email">Email address</label>
            <div class="welcome-offer__field-row"><input id="welcome-offer-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required data-welcome-email><button type="submit">Unlock my ${discountPercent}% off</button></div>
            <div class="welcome-offer__honeypot" aria-hidden="true"><label>Company<input name="company" type="text" tabindex="-1" autocomplete="off"></label></div>
            <p class="welcome-offer__status" role="status" aria-live="polite" data-welcome-status></p>
          </form>
          <p class="welcome-offer__privacy">By signing up, you agree to receive Tapntrust offers by email. Unsubscribe anytime. <a href="privacy.html">Privacy Policy</a>.</p>
        </div>
        <div class="welcome-offer__success" data-welcome-success hidden>
          <span class="welcome-offer__success-mark" aria-hidden="true">✓</span><p class="welcome-offer__kicker">${discountPercent}% OFF UNLOCKED</p><h2>Your discount is ready</h2>
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
function buildCartOffer(discountCode, discountPercent) {
  const root = document.createElement("section");
  root.className = "welcome-cart-offer";
  root.dataset.welcomeCartOffer = "";
  root.hidden = true;
  root.innerHTML = `
    <div data-welcome-cart-unclaimed><span class="welcome-cart-offer__badge">FIRST ORDER OFFER</span><strong>Get ${discountPercent}% off your order</strong><p>Enter your email to unlock your welcome discount.</p><button type="button" data-welcome-cart-unlock>Unlock ${discountPercent}% off</button></div>
    <div data-welcome-cart-claimed hidden><span class="welcome-cart-offer__badge welcome-cart-offer__badge--success">✓ ${discountPercent}% OFF UNLOCKED</span><strong>${discountCode}</strong><p data-welcome-cart-status>Your welcome code is ready for checkout.</p><button type="button" data-welcome-cart-copy>Copy code</button></div>`;
  document.querySelector("[data-cart-footer]")?.prepend(root);
  return root;
}

export function initialiseWelcomeOffer(config = {}) {
  if (!document.querySelector("[data-product-form]") || document.querySelector("[data-welcome-dialog]")) return;
  const endpoint = endpointFromConfig(config);
  if (!endpoint) return;
  const discountCode = String(config.WELCOME_DISCOUNT_CODE || "WELCOMETNT").trim().toUpperCase();
  const discountPercent = Number(config.WELCOME_DISCOUNT_PERCENT || 10);
  const cooldownMs = Math.max(1, Number(config.WELCOME_POPUP_COOLDOWN_DAYS || 14)) * 86400000;
  ensureStyles();
  const root = buildPopup(discountCode, discountPercent);
  const cartOffer = buildCartOffer(discountCode, discountPercent);
  const dialog = root.querySelector("[data-welcome-dialog]");
  const form = root.querySelector("[data-welcome-form]");
  const emailInput = root.querySelector("[data-welcome-email]");
  const formPanel = root.querySelector("[data-welcome-form-panel]");
  const successPanel = root.querySelector("[data-welcome-success]");
  const formStatus = root.querySelector("[data-welcome-status]");
  const successCopy = root.querySelector("[data-welcome-success-copy]");
  const copyStatus = root.querySelector("[data-welcome-copy-status]");
  let latestCartState = null;
  let pendingPrimaryAdd = null;
  let appliedToCurrentCart = false;
  let lastFocused = null;

  function claimed() {
    const at = Number(getLocal(STORAGE.claimedAt) || 0);
    return Boolean(getLocal(STORAGE.email) && at && Date.now() - at < cooldownMs);
  }
  function beginLeadCycle(addToCartAt) {
    setLocal(STORAGE.visitorId, createVisitorId());
    setLocal(STORAGE.addToCartAt, addToCartAt);
    removeLocal(STORAGE.email); removeLocal(STORAGE.signupAt); removeLocal(STORAGE.claimedAt); removeLocal(STORAGE.checkoutAt);
    appliedToCurrentCart = false;
  }
  function cartDiscountApplied() {
    return appliedToCurrentCart || Boolean(latestCartState?.cart?.discountCodes?.includes(discountCode));
  }
  function renderCartOffer() {
    const visible = hasPrimary(latestCartState);
    cartOffer.hidden = !visible;
    if (!visible) return;
    const isClaimed = claimed();
    cartOffer.querySelector("[data-welcome-cart-unclaimed]").hidden = isClaimed;
    cartOffer.querySelector("[data-welcome-cart-claimed]").hidden = !isClaimed;
    if (isClaimed) {
      cartOffer.querySelector("[data-welcome-cart-status]").textContent = cartDiscountApplied()
        ? `${discountCode} is applied to this cart.`
        : `Use ${discountCode} at checkout if it is not applied automatically.`;
    }
  }
  function open() {
    if (!root.hidden) return;
    const isClaimed = claimed();
    formPanel.hidden = isClaimed;
    successPanel.hidden = !isClaimed;
    if (isClaimed) successCopy.textContent = cartDiscountApplied() ? `Your ${discountPercent}% welcome discount is applied to this cart.` : "Your welcome code is ready to use at checkout.";
    lastFocused = document.activeElement;
    root.hidden = false;
    requestAnimationFrame(() => {
      root.classList.add("is-open");
      setBodyLock();
      (isClaimed ? root.querySelector("[data-welcome-copy]") : emailInput)?.focus();
    });
  }
  function close() {
    root.classList.remove("is-open");
    window.setTimeout(() => { root.hidden = true; setBodyLock(); lastFocused?.focus?.(); }, 220);
  }
  async function copyCode(target) {
    try { await navigator.clipboard.writeText(discountCode); target.textContent = `${discountCode} copied.`; }
    catch { target.textContent = `Your discount code is ${discountCode}.`; }
  }
  function renderShopifyDiscount(rawCart) {
    const subtotal = Number(rawCart?.cost?.subtotalAmount?.amount || 0);
    const total = Number(rawCart?.cost?.totalAmount?.amount || subtotal);
    const amount = Math.max(0, subtotal - total);
    const currency = rawCart?.cost?.totalAmount?.currencyCode || "AUD";
    const money = new Intl.NumberFormat("en-AU", { style: "currency", currency });
    const discountRow = document.querySelector("[data-cart-discount-row]");
    const discountValue = document.querySelector("[data-cart-discount]");
    const subtotalValue = document.querySelector("[data-cart-subtotal]");
    if (discountRow) discountRow.hidden = !(amount > 0);
    if (discountValue) discountValue.textContent = amount > 0 ? `−${money.format(amount).replace("$", "A$")}` : "";
    if (subtotalValue) subtotalValue.textContent = money.format(total).replace("$", "A$");
  }
  async function applyDiscount() {
    const cart = latestCartState?.cart;
    if (latestCartState?.mode !== "shopify" || !cart?.id) {
      successCopy.textContent = `Copy ${discountCode} and enter it at checkout for ${discountPercent}% off.`;
      return;
    }
    try {
      const codes = [...new Set([...(cart.discountCodes || []), discountCode])];
      const rawCart = await updateCartDiscountCodes(cart.id, codes);
      const applicable = (rawCart.discountCodes || []).some((item) => item.applicable && item.code === discountCode);
      if (!applicable) throw new Error("Discount not applicable");
      appliedToCurrentCart = true;
      renderShopifyDiscount(rawCart);
      successCopy.textContent = `Your ${discountPercent}% welcome discount is applied to the cart.`;
      copyStatus.textContent = "Discount applied automatically — no need to paste the code.";
    } catch {
      successCopy.textContent = `Copy ${discountCode} and enter it at checkout for ${discountPercent}% off.`;
      copyStatus.textContent = "Automatic apply was unavailable, but your code is ready.";
    }
    renderCartOffer();
  }

  document.querySelector("[data-product-form]")?.addEventListener("submit", () => {
    const editing = document.querySelector("[data-add-to-cart]")?.dataset.editingBusiness === "true";
    if (editing) return;
    pendingPrimaryAdd = { before: primaryQuantity(latestCartState) };
  }, { capture: true });

  document.addEventListener("tapntrust:cart-change", (event) => {
    latestCartState = event.detail;
    renderCartOffer();
    if (!pendingPrimaryAdd || primaryQuantity(latestCartState) <= pendingPrimaryAdd.before) return;
    pendingPrimaryAdd = null;
    if (claimed()) return;
    beginLeadCycle(nowIso());
    renderCartOffer();
    if (!getSession(AUTO_PROMPT_KEY)) {
      setSession(AUTO_PROMPT_KEY, "1");
      open();
    }
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (String(new FormData(form).get("company") || "").trim()) return;
    const email = cleanEmail(emailInput?.value);
    if (!EMAIL_PATTERN.test(email)) {
      formStatus.textContent = "Enter a valid email address.";
      emailInput?.setAttribute("aria-invalid", "true");
      emailInput?.focus();
      return;
    }
    emailInput?.removeAttribute("aria-invalid");
    const signupAt = nowIso();
    setLocal(STORAGE.email, email); setLocal(STORAGE.signupAt, signupAt); setLocal(STORAGE.claimedAt, Date.now()); removeLocal(STORAGE.checkoutAt);
    formStatus.textContent = "";
    formPanel.hidden = true; successPanel.hidden = false;
    root.querySelector("[data-welcome-copy]")?.focus();
    renderCartOffer();
    void postEvent(endpoint, { ...payloadBase(email), checkoutAt: "", event: "signup", occurredAt: signupAt, discountCode, discountPercent });
    void applyDiscount();
  });

  root.querySelectorAll("[data-welcome-close], [data-welcome-backdrop], [data-welcome-shop]").forEach((element) => element.addEventListener("click", close));
  root.querySelector("[data-welcome-copy]")?.addEventListener("click", () => copyCode(copyStatus));
  dialog?.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } else trapFocus(event, dialog); });
  cartOffer.querySelector("[data-welcome-cart-unlock]")?.addEventListener("click", open);
  cartOffer.querySelector("[data-welcome-cart-copy]")?.addEventListener("click", () => copyCode(cartOffer.querySelector("[data-welcome-cart-status]")));

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const checkout = event.target.closest("[data-checkout]");
    if (!checkout || checkout.getAttribute("aria-disabled") === "true" || !getLocal(STORAGE.email) || getLocal(STORAGE.checkoutAt)) return;
    const occurredAt = nowIso();
    setLocal(STORAGE.checkoutAt, occurredAt);
    void postEvent(endpoint, { ...payloadBase(getLocal(STORAGE.email)), event: "checkout", occurredAt }, { beacon: true });
  }, { capture: true });
}
