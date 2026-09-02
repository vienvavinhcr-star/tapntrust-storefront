const STYLE_HREF = "css/welcome-cart-promo.css?v=20260902-1";

function ensureStyles() {
  if (document.querySelector('link[data-welcome-cart-promo-styles]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_HREF;
  link.dataset.welcomeCartPromoStyles = "";
  document.head.append(link);
}

function placePromo() {
  const drawer = document.querySelector("[data-cart-drawer]");
  const content = drawer?.querySelector("[data-cart-content]");
  const promo = drawer?.querySelector("[data-welcome-cart-offer]");
  if (!drawer || !content || !promo) return false;

  promo.classList.add("welcome-cart-offer--top");
  if (content.firstElementChild !== promo) content.prepend(promo);
  return true;
}

export function initialiseWelcomeCartPromoLayout() {
  ensureStyles();
  if (placePromo()) return;

  const observer = new MutationObserver(() => {
    if (!placePromo()) return;
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

initialiseWelcomeCartPromoLayout();
