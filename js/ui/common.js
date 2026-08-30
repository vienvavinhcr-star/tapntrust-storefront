export function setText(selector, value, root = document) {
  const element = root.querySelector(selector);
  if (element) element.textContent = value;
}

export function toast(message, type = "info") {
  const region = document.querySelector("[data-toast-region]");
  if (!region) return;
  const item = document.createElement("div");
  item.className = `toast${type === "error" ? " toast--error" : ""}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

function focusableElements(container) {
  return [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.offsetParent !== null);
}

export function trapFocus(event, container) {
  if (event.key !== "Tab") return;
  const elements = focusableElements(container);
  if (!elements.length) return;
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function setBodyLock() {
  const anyOpen = document.querySelector(".cart-drawer.is-open, .guide-modal.is-open, .welcome-offer.is-open");
  document.body.classList.toggle("is-locked", Boolean(anyOpen));
}