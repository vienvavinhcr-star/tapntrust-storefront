export function initialiseBrandAssets() {
  document.querySelectorAll("[data-brand-logo]").forEach((logo) => {
    const markMissing = () => logo.classList.add("is-missing");
    logo.addEventListener("error", markMissing, { once: true });
    if (logo.complete && logo.naturalWidth === 0) markMissing();
  });
}

export function initialiseNavigation() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-primary-nav]");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    toggle.setAttribute("aria-label", open ? "Open navigation" : "Close navigation");
    nav.classList.toggle("is-open", !open);
  });
  nav.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
    nav.classList.remove("is-open");
  });
}

export function initialiseProductViewer() {
  const viewer = document.querySelector("[data-product-viewer]");
  const card = viewer?.querySelector("[data-product-card]");
  if (!viewer || !card) return;

  let activePointer = null;
  let startX = 0;
  let startY = 0;
  let startRotateX = 0;
  let startRotateY = 0;
  let rotateX = 0;
  let rotateY = 0;
  const maxRotateX = 14;
  const maxRotateY = 24;
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

  const render = () => {
    card.style.setProperty("--card-rotate-x", `${rotateX}deg`);
    card.style.setProperty("--card-rotate-y", `${rotateY}deg`);
  };

  viewer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || activePointer !== null) return;
    activePointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startRotateX = rotateX;
    startRotateY = rotateY;
    viewer.classList.add("is-dragging");
    viewer.setPointerCapture(event.pointerId);
  });

  viewer.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointer) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    rotateY = clamp(startRotateY + (deltaX * .2), maxRotateY);
    rotateX = clamp(startRotateX - (deltaY * .2), maxRotateX);
    render();
  });

  const releasePointer = (event) => {
    if (event.pointerId !== activePointer) return;
    if (viewer.hasPointerCapture(event.pointerId)) viewer.releasePointerCapture(event.pointerId);
    activePointer = null;
    viewer.classList.remove("is-dragging");
  };

  viewer.addEventListener("pointerup", releasePointer);
  viewer.addEventListener("pointercancel", releasePointer);
  viewer.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 8 : 4;
    if (event.key === "ArrowLeft") rotateY = clamp(rotateY - step, maxRotateY);
    else if (event.key === "ArrowRight") rotateY = clamp(rotateY + step, maxRotateY);
    else if (event.key === "ArrowUp") rotateX = clamp(rotateX + step, maxRotateX);
    else if (event.key === "ArrowDown") rotateX = clamp(rotateX - step, maxRotateX);
    else if (event.key === "Home") rotateX = rotateY = 0;
    else return;
    event.preventDefault();
    render();
  });
}

export function initialiseMobileBuyBar() {
  const bar = document.querySelector("[data-mobile-buy-bar]");
  const hero = document.querySelector(".hero");
  const shop = document.querySelector("#shop");
  const drawer = document.querySelector("[data-cart-drawer]");
  if (!bar || !hero || !shop) return;

  const mobileQuery = window.matchMedia("(max-width: 620px)");
  let frame = 0;

  const update = () => {
    frame = 0;
    const heroRect = hero.getBoundingClientRect();
    const shopRect = shop.getBoundingClientRect();
    const pastHero = heroRect.bottom <= Math.min(120, window.innerHeight * .16);
    const shopVisible = shopRect.top < window.innerHeight * .9 && shopRect.bottom > window.innerHeight * .1;
    const cartOpen = drawer?.classList.contains("is-open");
    const visible = mobileQuery.matches && pastHero && !shopVisible && !cartOpen;

    bar.classList.toggle("is-visible", visible);
    bar.setAttribute("aria-hidden", String(!visible));
    document.body.classList.toggle("has-mobile-buy-bar", visible);
  };

  const scheduleUpdate = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(update);
  };

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("hashchange", scheduleUpdate);
  mobileQuery.addEventListener?.("change", scheduleUpdate);
  if (drawer && "MutationObserver" in window) {
    new MutationObserver(scheduleUpdate).observe(drawer, { attributes: true, attributeFilter: ["class", "hidden"] });
  }
  bar.querySelector("a")?.addEventListener("click", () => {
    bar.classList.remove("is-visible");
    bar.setAttribute("aria-hidden", "true");
    document.body.classList.remove("has-mobile-buy-bar");
  });

  update();
}

export function initialiseLinkWalkthrough() {
  const walkthrough = document.querySelector("[data-link-walkthrough]");
  if (!walkthrough) return;
  const tabs = [...walkthrough.querySelectorAll("[data-link-step]")];
  const panels = [...walkthrough.querySelectorAll("[data-link-panel]")];

  const showStep = (step, moveFocus = false) => {
    tabs.forEach((tab) => {
      const active = Number(tab.dataset.linkStep) === step;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && moveFocus) tab.focus();
    });
    panels.forEach((panel) => {
      const active = Number(panel.dataset.linkPanel) === step;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => showStep(Number(tab.dataset.linkStep)));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = (current + direction + tabs.length) % tabs.length;
      showStep(Number(tabs[next].dataset.linkStep), true);
    });
  });

  document.querySelector("[data-guide-demo-start]")?.addEventListener("click", () => {
    showStep(1, true);
    walkthrough.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

export function initialiseStepDemo() {
  const typed = document.querySelector("[data-step-typing]");
  const item = typed?.closest(".steps li");
  if (!typed || !item) return;

  const message = typed.textContent.trim();
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    typed.textContent = message;
    return;
  }

  item.classList.add("step-demo-enabled");
  typed.textContent = "";
  let isVisible = false;
  let sequenceId = 0;
  const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  const reset = () => {
    item.classList.remove("is-demo-active", "is-demo-complete", "is-demo-submitted");
    typed.textContent = "";
  };

  const play = async (id) => {
    reset();
    await wait(70);
    if (!isVisible || id !== sequenceId) return;
    item.classList.add("is-demo-active");
    await wait(1080);
    if (!isVisible || id !== sequenceId) return;

    for (const [index, character] of Array.from(message).entries()) {
      typed.textContent += character;
      let typingDelay = character === " " ? 28 : 40 + ((index * 13) % 24);
      if ([".", ",", "!", "?"].includes(character)) typingDelay = 170;
      if (message.slice(0, index + 1).endsWith("products")) typingDelay += 130;
      await wait(typingDelay);
      if (!isVisible || id !== sequenceId) return;
    }

    item.classList.add("is-demo-complete");
    await wait(680);
    if (!isVisible || id !== sequenceId) return;
    item.classList.add("is-demo-submitted");
    await wait(850);
    if (!isVisible || id !== sequenceId) return;
    item.classList.remove("is-demo-submitted");
    await wait(3000);
    if (isVisible && id === sequenceId) play(id);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      isVisible = entry.isIntersecting;
      sequenceId += 1;
      if (isVisible) play(sequenceId);
      else reset();
    });
  }, { threshold: .42, rootMargin: "0px 0px -4% 0px" });

  observer.observe(item);
}

export function initialisePlacementCarousel() {
  const carousel = document.querySelector("[data-placement-carousel]");
  const viewport = carousel?.querySelector("[data-placement-viewport]");
  const track = carousel?.querySelector("[data-placement-track]");
  const slides = [...(carousel?.querySelectorAll("[data-placement-slide]") || [])];
  const previous = carousel?.querySelector("[data-placement-prev]");
  const next = carousel?.querySelector("[data-placement-next]");
  const dots = carousel?.querySelector("[data-placement-dots]");
  const current = carousel?.querySelector("[data-placement-current]");
  const status = carousel?.querySelector("[data-placement-status]");
  if (!carousel || !viewport || !track || slides.length < 2 || !previous || !next || !dots) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let index = 0;
  let visibleCount = 1;
  let timer = null;
  let isPaused = false;
  let touchStartX = null;

  const measure = () => {
    const slideWidth = slides[0].getBoundingClientRect().width;
    const styles = window.getComputedStyle(track);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
    visibleCount = Math.max(1, Math.min(slides.length, Math.round((viewport.clientWidth + gap) / (slideWidth + gap))));
  };

  const maxIndex = () => Math.max(0, slides.length - visibleCount);

  const updateDots = () => {
    dots.replaceChildren();
    for (let dotIndex = 0; dotIndex <= maxIndex(); dotIndex += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Show placement idea ${dotIndex + 1}`);
      button.addEventListener("click", () => goTo(dotIndex, true));
      dots.append(button);
    }
  };

  const render = (announce = false) => {
    index = Math.max(0, Math.min(index, maxIndex()));
    track.style.transform = `translate3d(${-slides[index].offsetLeft}px, 0, 0)`;
    const end = Math.min(slides.length, index + visibleCount);
    if (current) current.textContent = end === index + 1 ? `${index + 1}` : `${index + 1}–${end}`;
    if (status && announce) status.textContent = `Showing placement ideas ${index + 1} to ${end} of ${slides.length}.`;
    [...dots.children].forEach((button, dotIndex) => button.setAttribute("aria-current", String(dotIndex === index)));
    slides.forEach((slide, slideIndex) => slide.setAttribute("aria-hidden", String(slideIndex < index || slideIndex >= end)));
  };

  const stopAutoPlay = () => {
    if (timer) window.clearInterval(timer);
    timer = null;
  };

  const startAutoPlay = () => {
    stopAutoPlay();
    if (isPaused || reduceMotion.matches || document.hidden) return;
    timer = window.setInterval(() => goTo(index >= maxIndex() ? 0 : index + 1), 6500);
  };

  function goTo(newIndex, announce = false) {
    index = newIndex < 0 ? maxIndex() : newIndex > maxIndex() ? 0 : newIndex;
    render(announce);
    startAutoPlay();
  }

  const setPaused = (paused) => {
    isPaused = paused;
    if (paused) stopAutoPlay();
    else startAutoPlay();
  };

  previous.addEventListener("click", () => goTo(index - 1, true));
  next.addEventListener("click", () => goTo(index + 1, true));
  carousel.addEventListener("mouseenter", () => setPaused(true));
  carousel.addEventListener("mouseleave", () => setPaused(false));
  carousel.addEventListener("focusin", () => setPaused(true));
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) setPaused(false);
  });
  viewport.addEventListener("touchstart", (event) => { touchStartX = event.touches[0]?.clientX ?? null; }, { passive: true });
  viewport.addEventListener("touchend", (event) => {
    if (touchStartX === null) return;
    const distance = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    if (Math.abs(distance) > 44) goTo(index + (distance < 0 ? 1 : -1), true);
    touchStartX = null;
  }, { passive: true });
  document.addEventListener("visibilitychange", startAutoPlay);
  reduceMotion.addEventListener?.("change", startAutoPlay);

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      measure();
      updateDots();
      render();
      startAutoPlay();
    }, 140);
  });

  measure();
  updateDots();
  render();
  startAutoPlay();
}

export function initialiseScrollReveal() {
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const groups = [
    { selector: ".customer-brands__heading, .how .section-heading, .purchase-bridge__copy, .placement-showcase .section-heading, .placement-gallery .section-heading, .customer-feedback .section-heading", type: "up", step: 0 },
    { selector: ".value-strip__grid > div", type: "up", step: 45 },
    { selector: ".steps li", type: "up", step: 75 },
    { selector: ".review-impact__copy, .review-impact__visual, .purchase-bridge__visual, .shop__visual-column, .product-configurator", type: "soft-scale", step: 90 },
    { selector: ".placement-card, .feedback-card", type: "up", step: 45 },
    { selector: ".stand-section__visual, .stand-section__copy", type: "soft-scale", step: 90 },
    { selector: ".faq__grid > *, .contact-band__grid > *", type: "up", step: 85 }
  ];
  const targets = [];
  const seen = new Set();

  groups.forEach(({ selector, type, step }) => {
    document.querySelectorAll(selector).forEach((element, index) => {
      if (seen.has(element)) return;
      seen.add(element);
      element.dataset.reveal = type;
      element.style.setProperty("--reveal-delay", `${Math.min(index * step, 180)}ms`);
      targets.push(element);
    });
  });

  if (!targets.length) return;
  document.documentElement.classList.add("reveal-ready");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: .1, rootMargin: "0px 0px -7% 0px" });

  requestAnimationFrame(() => targets.forEach((target) => observer.observe(target)));
}
