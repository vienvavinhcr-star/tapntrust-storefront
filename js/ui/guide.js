import { setBodyLock, trapFocus } from "./common.js";

export function createGuideUi() {
  let lastFocusedElement = null;

  function openGuide() {
    const modal = document.querySelector("[data-guide-modal]");
    const backdrop = document.querySelector("[data-guide-backdrop]");
    if (!modal || !backdrop) return;
    lastFocusedElement = document.activeElement;
    modal.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      modal.classList.add("is-open");
      backdrop.classList.add("is-visible");
      setBodyLock();
      modal.focus();
    });
  }

  function closeGuide() {
    const modal = document.querySelector("[data-guide-modal]");
    const backdrop = document.querySelector("[data-guide-backdrop]");
    if (!modal || modal.hidden) return;
    modal.classList.remove("is-open");
    backdrop.classList.remove("is-visible");
    window.setTimeout(() => {
      modal.hidden = true;
      backdrop.hidden = true;
      setBodyLock();
      lastFocusedElement?.focus?.();
    }, 210);
  }

  function initialise() {
    document.querySelectorAll("[data-guide-open]").forEach((button) => button.addEventListener("click", openGuide));
    document.querySelector("[data-guide-close]")?.addEventListener("click", closeGuide);
    document.querySelector("[data-guide-backdrop]")?.addEventListener("click", closeGuide);
    const modal = document.querySelector("[data-guide-modal]");
    modal?.addEventListener("keydown", (event) => trapFocus(event, modal));
  }

  return { initialise, openGuide, closeGuide };
}
