import config from "./config.js";
import { applyDiscount } from "./cart.js";

const OFFER_SEEN_KEY = "tapntrust_welcome_offer_seen_at";
const OFFER_DELAY_MS = 7000;
const OFFER_REPEAT_MS = 30 * 24 * 60 * 60 * 1000;

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getStoredTime() {
  try { return Number(localStorage.getItem(OFFER_SEEN_KEY) || 0); } catch { return 0; }
}

function markOfferSeen() {
  try { localStorage.setItem(OFFER_SEEN_KEY, String(Date.now())); } catch { /* Optional preference. */ }
}

async function subscribe(email) {
  const endpoint = String(config.NEWSLETTER_ENDPOINT || "").trim();
  if (!endpoint) return { configured: false };

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: "tapntrust-storefront" })
    });
  } catch {
    throw new Error("We couldn't connect to the email service. Please try again.");
  }

  if (!response.ok) throw new Error("We couldn't add your email right now. Please try again.");
  return { configured: true };
}

function setFormLoading(form, loading) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
  button.disabled = loading;
  button.textContent = loading ? "Please wait…" : button.dataset.originalLabel;
}

function revealSuccess(form) {
  const success = form.querySelector("[data-newsletter-success]");
  if (success) success.hidden = false;
}

export function initialiseNewsletter({ toast } = {}) {
  const forms = document.querySelectorAll("[data-newsletter-form]");
  const welcome = document.querySelector("[data-welcome-offer]");
  const closeButton = document.querySelector("[data-welcome-close]");

  forms.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const emailInput = form.querySelector('input[type="email"]');
      const status = form.querySelector("[data-newsletter-status]");
      const email = emailInput?.value.trim() || "";

      if (!validEmail(email)) {
        if (status) status.textContent = "Enter a valid email address.";
        emailInput?.setAttribute("aria-invalid", "true");
        emailInput?.focus();
        return;
      }

      emailInput.removeAttribute("aria-invalid");
      if (status) status.textContent = "";
      setFormLoading(form, true);
      try {
        const result = await subscribe(email);
        revealSuccess(form);
        if (status) {
          status.textContent = result.configured
            ? "You're in. Your welcome code is ready."
            : "Your code is ready. Email capture must be connected before the site goes live.";
        }
        markOfferSeen();
      } catch (error) {
        if (status) status.textContent = error.message;
      } finally {
        setFormLoading(form, false);
      }
    });
  });

  document.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy-code]");
    if (copyButton) {
      try {
        await navigator.clipboard.writeText(config.WELCOME_DISCOUNT_CODE);
        copyButton.textContent = "Copied";
        toast?.("Discount code copied.");
      } catch {
        toast?.(`Copy this code: ${config.WELCOME_DISCOUNT_CODE}`);
      }
    }

    const applyButton = event.target.closest("[data-apply-discount]");
    if (applyButton) {
      applyButton.disabled = true;
      try {
        const result = await applyDiscount(config.WELCOME_DISCOUNT_CODE);
        applyButton.textContent = result.pending ? "Saved for cart" : "Applied";
        toast?.(result.pending ? "The code will be applied when you add a product." : "Discount applied to your cart.");
      } catch (error) {
        applyButton.disabled = false;
        toast?.(error.message, "error");
      }
    }
  });

  if (welcome && Date.now() - getStoredTime() > OFFER_REPEAT_MS) {
    window.setTimeout(() => {
      if (!document.body.classList.contains("is-locked")) welcome.hidden = false;
    }, OFFER_DELAY_MS);
  }

  closeButton?.addEventListener("click", () => {
    welcome.hidden = true;
    markOfferSeen();
  });
}

export default initialiseNewsletter;
