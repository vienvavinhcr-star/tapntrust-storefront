import { trapFocus } from "./common.js";

const INSIGHTS_PROMO_DELAY_MS = 9000;
const INSIGHTS_PROMO_SESSION_KEY = "tapntrust.insightsPromoSeen.v1";

function animateOpportunityCount(element, reducedMotion) {
  if (!element || element.dataset.counted === "true") return;
  const finalTarget = Number(element.dataset.countTo || 139);
  const fastTarget = Math.max(0, finalTarget - 5);
  const preview = element.closest("[data-insights-preview]");
  const momentum = preview?.querySelector("[data-insights-momentum]");
  if (!Number.isFinite(finalTarget) || finalTarget < 0) return;
  element.dataset.counted = "true";
  if (reducedMotion) {
    element.textContent = finalTarget.toLocaleString("en-AU");
    if (momentum) momentum.textContent = "+28%";
    preview?.style.setProperty("--insights-progress", "100%");
    preview?.style.setProperty("--insights-card-progress", "57%");
    preview?.style.setProperty("--insights-stage", "1");
    preview?.classList.add("is-card-ready", "is-time-ready", "is-ready");
    return;
  }

  const runCycle = () => {
    if (!element.isConnected) return;
    const duration = 1550;
    const startedAt = performance.now();
    element.textContent = "0";
    if (momentum) momentum.textContent = "+22%";
    preview?.style.setProperty("--insights-progress", "0%");
    preview?.style.setProperty("--insights-card-progress", "0%");
    preview?.style.setProperty("--insights-stage", "0");
    preview?.classList.remove("is-card-ready", "is-time-ready", "is-ready");

    const renderFastCount = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = Math.round(fastTarget * eased).toLocaleString("en-AU");
      if (momentum) momentum.textContent = `+${22 + Math.round(eased * 6)}%`;
      preview?.style.setProperty("--insights-progress", `${Math.round(eased * 100)}%`);
      preview?.style.setProperty("--insights-card-progress", `${Math.round(eased * 57)}%`);
      preview?.style.setProperty("--insights-stage", eased.toFixed(3));
      if (progress < 1) {
        requestAnimationFrame(renderFastCount);
        return;
      }

      let current = fastTarget;
      const renderSlowCount = () => {
        current += 1;
        element.textContent = current.toLocaleString("en-AU");
        if (current >= fastTarget + 2) preview?.classList.add("is-card-ready");
        if (current >= fastTarget + 4) preview?.classList.add("is-time-ready");
        if (current < finalTarget) {
          window.setTimeout(renderSlowCount, 760);
          return;
        }
        preview?.classList.add("is-ready");
        window.setTimeout(runCycle, 10000);
      };
      window.setTimeout(renderSlowCount, 760);
    };

    requestAnimationFrame(renderFastCount);
  };

  runCycle();
}

function emphasiseOffer() {
  const offer = document.querySelector("[data-insights-offer]");
  if (!offer) return;
  window.setTimeout(() => {
    offer.classList.remove("is-emphasised");
    requestAnimationFrame(() => offer.classList.add("is-emphasised"));
    window.setTimeout(() => offer.classList.remove("is-emphasised"), 1200);
  }, 420);
}

function buildInsightsPromo() {
  const root = document.createElement("div");
  root.className = "insights-promo";
  root.dataset.insightsPromo = "";
  root.hidden = true;
  root.innerHTML = `
    <div class="insights-promo__backdrop" data-insights-promo-close></div>
    <section class="insights-promo__dialog" role="dialog" aria-modal="true" aria-labelledby="insights-promo-title" tabindex="-1" data-insights-promo-dialog>
      <button class="insights-promo__close" type="button" aria-label="Close Tapntrust Insights offer" data-insights-promo-close>×</button>
      <div class="insights-promo__visual" aria-hidden="true">
        <p class="insights-promo__brand insights-promo__brand--mobile"><span class="insights-promo__brand-mark"><i></i><i></i><i></i></span>Tapntrust Insights</p>
        <div class="insights-promo__mascot"><img src="assets/marketing/tapntrust-insights-popup-mascot.png" alt="" width="1222" height="1287" loading="eager" decoding="async"></div>
      </div>
      <div class="insights-promo__content">
        <p class="insights-promo__brand insights-promo__brand--desktop"><span class="insights-promo__brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>Tapntrust Insights</p>
        <h2 id="insights-promo-title">Try Tapntrust <span>Insights</span></h2>
        <div class="insights-promo__price"><small><span class="insights-promo__desktop-only">First month offer</span><span class="insights-promo__mobile-only">Only</span></small><strong>A$1.99</strong><span>for your first month</span></div>
        <p class="insights-promo__copy"><span class="insights-promo__desktop-only">See which cards perform best, when customers engage, and where your review opportunities come from.</span><span class="insights-promo__mobile-only">Track taps, top locations, and smart insights.</span></p>
        <button class="insights-promo__cta" type="button" data-insights-promo-cta><span class="insights-promo__desktop-only">See the A$1.99 offer</span><span class="insights-promo__mobile-only">Try it now</span> <span aria-hidden="true">→</span></button>
        <p class="insights-promo__fineprint">Then A$6.99/month · <strong>Cancel anytime</strong></p>
      </div>
    </section>`;
  document.body.append(root);
  return root;
}

function initialiseInsightsPromo() {
  if (document.querySelector("[data-insights-promo]")) return;
  const root = buildInsightsPromo();
  const dialog = root.querySelector("[data-insights-promo-dialog]");
  const offer = document.querySelector("[data-insights-offer]");
  const toggle = offer?.querySelector("[data-insights-toggle]");
  let timer = 0;
  let lastFocused = null;
  let seenThisPage = false;

  const wasSeen = () => {
    if (seenThisPage) return true;
    try { return sessionStorage.getItem(INSIGHTS_PROMO_SESSION_KEY) === "1"; }
    catch { return false; }
  };
  const markSeen = () => {
    seenThisPage = true;
    try { sessionStorage.setItem(INSIGHTS_PROMO_SESSION_KEY, "1"); }
    catch { /* session storage can be unavailable in private browsing */ }
  };
  const syncBodyLock = () => {
    const anyOpen = document.querySelector(".cart-drawer.is-open, .guide-modal.is-open, .welcome-offer.is-open, .insights-promo.is-open");
    document.body.classList.toggle("is-locked", Boolean(anyOpen));
  };
  const close = ({ restoreFocus = true } = {}) => {
    if (root.hidden) return;
    root.classList.remove("is-open");
    window.setTimeout(() => {
      root.hidden = true;
      syncBodyLock();
      if (restoreFocus) lastFocused?.focus?.();
    }, 340);
  };
  const open = () => {
    if (wasSeen() || toggle?.checked) {
      markSeen();
      return;
    }
    const anotherOverlayOpen = document.body.classList.contains("is-locked")
      || document.querySelector(".cart-drawer.is-open, .guide-modal.is-open, .welcome-offer.is-open");
    if (anotherOverlayOpen) {
      timer = window.setTimeout(open, 2500);
      return;
    }
    markSeen();
    lastFocused = document.activeElement;
    root.hidden = false;
    requestAnimationFrame(() => {
      root.classList.add("is-open");
      syncBodyLock();
      dialog?.focus();
    });
  };

  root.querySelectorAll("[data-insights-promo-close]").forEach((element) => {
    element.addEventListener("click", () => close());
  });
  root.querySelector("[data-insights-promo-cta]")?.addEventListener("click", () => {
    close({ restoreFocus: false });
    window.setTimeout(() => {
      offer?.scrollIntoView({ behavior: "smooth", block: "center" });
      emphasiseOffer();
      toggle?.focus({ preventScroll: true });
    }, 380);
  });
  dialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(event, dialog);
  });
  document.querySelectorAll("[data-insights-sales-cta]").forEach((element) => {
    element.addEventListener("click", () => {
      window.clearTimeout(timer);
      markSeen();
    });
  });
  toggle?.addEventListener("change", () => {
    if (!toggle.checked) return;
    window.clearTimeout(timer);
    markSeen();
  });

  if (!wasSeen()) timer = window.setTimeout(open, INSIGHTS_PROMO_DELAY_MS);
}

function initialiseCarousel(root, reducedMotion) {
  const carousel = root.querySelector("[data-insights-carousel]");
  const viewport = carousel?.querySelector("[data-insights-carousel-viewport]");
  const slides = [...(carousel?.querySelectorAll("[data-insights-slide]") || [])];
  const dots = [...(carousel?.querySelectorAll("[data-insights-carousel-dot]") || [])];
  const previous = carousel?.querySelector("[data-insights-carousel-prev]");
  const next = carousel?.querySelector("[data-insights-carousel-next]");
  if (!viewport || !slides.length) return;

  let activeIndex = 0;
  let scrollFrame = 0;

  const updateControls = (index) => {
    activeIndex = Math.max(0, Math.min(slides.length - 1, index));
    dots.forEach((dot, dotIndex) => {
      if (dotIndex === activeIndex) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
    if (previous) previous.disabled = activeIndex === 0;
    if (next) next.disabled = activeIndex === slides.length - 1;
  };

  const showSlide = (index) => {
    const targetIndex = Math.max(0, Math.min(slides.length - 1, index));
    viewport.scrollTo({
      left: slides[targetIndex].offsetLeft,
      behavior: reducedMotion ? "auto" : "smooth"
    });
    updateControls(targetIndex);
  };

  previous?.addEventListener("click", () => showSlide(activeIndex - 1));
  next?.addEventListener("click", () => showSlide(activeIndex + 1));
  dots.forEach((dot, index) => dot.addEventListener("click", () => showSlide(index)));
  viewport.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    showSlide(activeIndex + (event.key === "ArrowRight" ? 1 : -1));
  });
  viewport.addEventListener("scroll", () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      const nearest = slides.reduce((best, slide, index) => (
        Math.abs(slide.offsetLeft - viewport.scrollLeft) < Math.abs(slides[best].offsetLeft - viewport.scrollLeft)
          ? index
          : best
      ), 0);
      updateControls(nearest);
    });
  }, { passive: true });

  updateControls(0);
}

export function initialiseInsightsExperience() {
  const root = document.querySelector("[data-insights-experience]");
  if (!root) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const count = root.querySelector("[data-insights-count]");

  initialiseInsightsPromo();

  document.querySelectorAll("[data-insights-sales-cta]").forEach((link) => {
    link.addEventListener("click", emphasiseOffer);
  });

  initialiseCarousel(root, reducedMotion);

  if (reducedMotion || !("IntersectionObserver" in window)) {
    animateOpportunityCount(count, true);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      animateOpportunityCount(count, false);
      observer.unobserve(entry.target);
    });
  }, { threshold: .18 });
  observer.observe(root);
}
