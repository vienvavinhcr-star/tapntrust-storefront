function createOpportunityAnimation(element, reducedMotion) {
  if (!element) return null;
  const finalTarget = Number(element.dataset.countTo || 139);
  const fastTarget = Math.max(0, finalTarget - 5);
  const preview = element.closest("[data-insights-preview]");
  const momentum = preview?.querySelector("[data-insights-momentum]");
  if (!preview || !Number.isFinite(finalTarget) || finalTarget < 0) return null;

  let active = false;
  let generation = 0;
  let animationFrame = 0;
  const timeouts = new Set();

  const clearSchedule = () => {
    cancelAnimationFrame(animationFrame);
    timeouts.forEach((timeout) => window.clearTimeout(timeout));
    timeouts.clear();
  };

  const schedule = (callback, delay, token) => {
    const timeout = window.setTimeout(() => {
      timeouts.delete(timeout);
      if (active && token === generation) callback();
    }, delay);
    timeouts.add(timeout);
  };

  const showFinalState = () => {
    element.textContent = finalTarget.toLocaleString("en-AU");
    if (momentum) momentum.textContent = "+28%";
    preview.style.setProperty("--insights-progress", "100%");
    preview.style.setProperty("--insights-card-progress", "57%");
    preview.style.setProperty("--insights-stage", "1");
    preview.classList.add("is-card-ready", "is-time-ready", "is-ready");
  };

  const runCycle = (token) => {
    if (!active || token !== generation || !element.isConnected) return;
    const duration = 1550;
    const startedAt = performance.now();
    element.textContent = "0";
    if (momentum) momentum.textContent = "+22%";
    preview.style.setProperty("--insights-progress", "0%");
    preview.style.setProperty("--insights-card-progress", "0%");
    preview.style.setProperty("--insights-stage", "0");
    preview.classList.remove("is-card-ready", "is-time-ready", "is-ready");

    const renderFastCount = (now) => {
      if (!active || token !== generation) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = Math.round(fastTarget * eased).toLocaleString("en-AU");
      if (momentum) momentum.textContent = `+${22 + Math.round(eased * 6)}%`;
      preview.style.setProperty("--insights-progress", `${Math.round(eased * 100)}%`);
      preview.style.setProperty("--insights-card-progress", `${Math.round(eased * 57)}%`);
      preview.style.setProperty("--insights-stage", eased.toFixed(3));
      if (progress < 1) {
        animationFrame = requestAnimationFrame(renderFastCount);
        return;
      }

      let current = fastTarget;
      const renderSlowCount = () => {
        current += 1;
        element.textContent = current.toLocaleString("en-AU");
        if (current >= fastTarget + 2) preview.classList.add("is-card-ready");
        if (current >= fastTarget + 4) preview.classList.add("is-time-ready");
        if (current < finalTarget) {
          schedule(renderSlowCount, 760, token);
          return;
        }
        preview.classList.add("is-ready");
        schedule(() => runCycle(token), 10000, token);
      };
      schedule(renderSlowCount, 760, token);
    };

    animationFrame = requestAnimationFrame(renderFastCount);
  };

  return {
    start() {
      if (active) return;
      active = true;
      generation += 1;
      clearSchedule();
      if (reducedMotion) showFinalState();
      else runCycle(generation);
    },
    stop() {
      if (!active) return;
      active = false;
      generation += 1;
      clearSchedule();
    }
  };
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
  const preview = count?.closest("[data-insights-preview]");
  const opportunityAnimation = createOpportunityAnimation(count, reducedMotion);

  document.querySelectorAll("[data-insights-sales-cta]").forEach((link) => {
    link.addEventListener("click", emphasiseOffer);
  });

  initialiseCarousel(root, reducedMotion);

  if (!preview || !opportunityAnimation) return;

  if (!("IntersectionObserver" in window)) {
    opportunityAnimation.start();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) opportunityAnimation.start();
      else opportunityAnimation.stop();
    });
  }, { threshold: .32, rootMargin: "0px 0px -8% 0px" });
  observer.observe(preview);
}
