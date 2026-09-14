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
