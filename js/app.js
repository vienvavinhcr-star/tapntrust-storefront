import config from "./config.js";
import cartActions from "./cart.js";
import { validHttpsUrl, looksGoogleRelated } from "./validation.js";
import { initialiseBusinessFinder } from "./business-finder.js";
import { FULFILMENT_KEYS, businessDetailsFromAttributes } from "./fulfilment.js";

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
let selectedPackage = 2;
let lastFocusedElement = null;
let businessFinderController = null;
let editingBusinessLineId = null;
let lastMetaBusinessPlaceId = "";

function trackMetaEvent(eventName, parameters = {}) {
  if (typeof window.fbq !== "function") return false;
  try {
    window.fbq("track", eventName, parameters);
    return true;
  } catch {
    return false;
  }
}

function packageMetaParameters(packageCount = selectedPackage) {
  const option = document.querySelector(`[data-package="${Number(packageCount)}"]`);
  const value = Number(option?.dataset.price || 0);
  const currency = option?.dataset.currency || "AUD";
  return {
    content_name: "Tapntrust NFC Review Card",
    content_category: `${Number(packageCount)}-card package`,
    content_type: "product",
    currency,
    value,
    num_items: 1
  };
}

function upsellMetaParameters(kind) {
  const product = cartActions.getState().catalog?.[kind];
  const variant = product?.variants?.[0];
  return {
    content_name: product?.title || (kind === "stand" ? "Tapntrust Counter Stand" : "Tapntrust Extra NFC Card"),
    content_category: kind === "stand" ? "Counter stand" : "Extra NFC card",
    content_type: "product",
    currency: variant?.currency || "AUD",
    value: Number(variant?.price || 0),
    num_items: 1
  };
}

function initialiseMetaCommerceEvents() {
  const oneCard = document.querySelector('[data-package="1"]');
  trackMetaEvent("ViewContent", {
    content_name: "Tapntrust NFC Review Card",
    content_category: "NFC Review Card",
    content_type: "product",
    currency: oneCard?.dataset.currency || "AUD",
    value: Number(oneCard?.dataset.price || 39.95)
  });

}

function formatMoney(value, currency = "AUD") {
  if (currency === "AUD") return money.format(Number(value || 0)).replace("$", "A$");
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(Number(value || 0));
}

function setText(selector, value, root = document) {
  const element = root.querySelector(selector);
  if (element) element.textContent = value;
}

function toast(message, type = "info") {
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

function trapFocus(event, container) {
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

function setBodyLock() {
  const anyOpen = document.querySelector(".cart-drawer.is-open, .guide-modal.is-open");
  document.body.classList.toggle("is-locked", Boolean(anyOpen));
}

function initialiseBrandAssets() {
  document.querySelectorAll("[data-brand-logo]").forEach((logo) => {
    const markMissing = () => logo.classList.add("is-missing");
    logo.addEventListener("error", markMissing, { once: true });
    if (logo.complete && logo.naturalWidth === 0) markMissing();
  });
}

function initialiseNavigation() {
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

function initialiseProductViewer() {
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

function safeSiteUrl() {
  const value = String(config.SITE_URL || "").trim().replace(/\/$/, "");
  try { return new URL(value).protocol === "https:" ? value : ""; } catch { return ""; }
}

function initialiseMetadata() {
  const siteUrl = safeSiteUrl();
  if (siteUrl) {
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = `${siteUrl}/`;
    document.head.append(canonical);
    const ogUrl = document.createElement("meta");
    ogUrl.setAttribute("property", "og:url");
    ogUrl.content = `${siteUrl}/`;
    document.head.append(ogUrl);
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Tapntrust",
        ...(siteUrl ? { url: `${siteUrl}/`, logo: `${siteUrl}/assets/brand/tapntrust-logo.png` } : {})
      },
      {
        "@type": "Product",
        name: "Tapntrust NFC Review Card",
        description: "A 12 × 12 cm NFC review card programmed for the business location selected by the customer.",
        brand: { "@type": "Brand", name: "Tapntrust" },
        ...(siteUrl ? { image: `${siteUrl}/assets/products/tapntrust-nfc-card-transparent.webp` } : {}),
        offers: [
          { "@type": "Offer", name: "1 Card", price: "39.95", priceCurrency: "AUD", availability: "https://schema.org/InStock" },
          { "@type": "Offer", name: "2 Cards", price: "59.95", priceCurrency: "AUD", availability: "https://schema.org/InStock" },
          { "@type": "Offer", name: "3 Cards", price: "74.95", priceCurrency: "AUD", availability: "https://schema.org/InStock" },
          { "@type": "Offer", name: "5 Cards", price: "109.95", priceCurrency: "AUD", availability: "https://schema.org/InStock" }
        ]
      }
    ]
  };
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(structuredData);
  document.head.append(script);

  if (/^\d+$/.test(String(config.META_PIXEL_ID || "")) && typeof window.fbq !== "function") {
    const fbq = function (...args) { fbq.callMethod ? fbq.callMethod(...args) : fbq.queue.push(args); };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    window.fbq = window.fbq || fbq;
    const pixelScript = document.createElement("script");
    pixelScript.async = true;
    pixelScript.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.append(pixelScript);
    window.fbq("init", config.META_PIXEL_ID);
    window.fbq("track", "PageView");
  }
}

function updatePackageSelection(count) {
  selectedPackage = Number(count);
  document.querySelectorAll("[data-package]").forEach((option) => {
    const selected = Number(option.dataset.package) === selectedPackage;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  });
  const selectedButton = document.querySelector(`[data-package="${selectedPackage}"]`);
  const price = Number(selectedButton?.dataset.price || 0);
  const label = `${selectedPackage}-card package`;
  setText("[data-add-to-cart] span", `Add ${label}`);
  setText("[data-add-to-cart] strong", formatMoney(price));
  updatePackageValueDisplay();
}

function updatePackageValueDisplay() {
  const options = [...document.querySelectorAll("[data-package]")];
  const singleOption = options.find((option) => Number(option.dataset.package) === 1);
  const singlePrice = Number(singleOption?.dataset.price || 0);
  const packageGrid = document.querySelector("[data-package-grid]");
  const standardUnitPrice = Number(packageGrid?.dataset.standardUnitPrice || singlePrice);
  if (!singlePrice || !standardUnitPrice) return;

  options.forEach((option) => {
    const count = Number(option.dataset.package);
    const price = Number(option.dataset.price || 0);
    const currency = option.dataset.currency || "AUD";
    const unitPrice = price / count;
    const regularTotal = standardUnitPrice * count;
    const saving = Math.max(0, regularTotal - price);
    const savingPercent = Math.round((saving / regularTotal) * 100);
    const comparePrice = option.querySelector("[data-compare-price]");

    setText("[data-unit-price]", formatMoney(unitPrice, currency), option);
    setText("[data-save-percent]", `Save ${savingPercent}%`, option);
    setText("[data-save-amount]", `You save ${formatMoney(saving, currency)}`, option);
    if (comparePrice) {
      comparePrice.hidden = saving <= 0;
      comparePrice.textContent = saving > 0 ? formatMoney(regularTotal, currency) : "";
    }
  });

  const selected = options.find((option) => Number(option.dataset.package) === selectedPackage);
  const summary = document.querySelector("[data-package-summary]");
  if (!selected || !summary) return;
  const price = Number(selected.dataset.price || 0);
  const currency = selected.dataset.currency || "AUD";
  const regularTotal = standardUnitPrice * selectedPackage;
  const saving = Math.max(0, regularTotal - price);
  const standardPriceLabel = formatMoney(standardUnitPrice, currency);
  if (selectedPackage === 1) {
    summary.innerHTML = `<span class="package-comparison__icon" aria-hidden="true">✓</span><span class="package-comparison__copy"><strong>1-card package saves ${formatMoney(saving, currency)}</strong> compared with the ${standardPriceLabel} standard price.</span>`;
  } else if (selectedPackage === 3) {
    summary.innerHTML = `<span class="package-comparison__icon" aria-hidden="true">✓</span><span class="package-comparison__copy"><strong>3-card package saves ${formatMoney(saving, currency)}</strong> and includes free standard shipping Australia-wide.</span>`;
  } else if (selectedPackage === 5) {
    summary.innerHTML = `<span class="package-comparison__icon" aria-hidden="true">✓</span><span class="package-comparison__copy"><strong>5-card package saves ${formatMoney(saving, currency)}</strong> with free standard shipping and a free A$14.49 Counter Stand included.</span>`;
  } else {
    summary.innerHTML = `<span class="package-comparison__icon" aria-hidden="true">✓</span><span class="package-comparison__copy"><strong>${selectedPackage}-card package saves ${formatMoney(saving, currency)}</strong> compared with the ${standardPriceLabel} standard per-card price.</span>`;
  }
}

function updatePackagesFromCatalog(catalog) {
  if (!catalog?.main?.variants) return;
  catalog.main.variants.forEach((variant) => {
    const option = document.querySelector(`[data-package="${variant.count}"]`);
    if (!option) return;
    option.dataset.price = String(variant.price);
    option.dataset.currency = variant.currency || "AUD";
    const price = option.querySelector(".package-option__price");
    if (price) price.textContent = formatMoney(variant.price, variant.currency);
    option.disabled = !variant.available;
    if (!variant.available) option.setAttribute("aria-label", `${variant.title} — currently unavailable`);
  });
  updatePackageSelection(selectedPackage);
}

function validateProductForm(form) {
  const finder = form.querySelector("[data-business-finder]");
  const error = form.querySelector('[data-error-for="businessDetails"]');
  const manualName = form.querySelector("[data-manual-business-name]");
  const manualAddress = form.querySelector("[data-manual-business-address]");
  const manualUrl = form.querySelector("[data-manual-review-url]");
  error.textContent = "";
  manualName.removeAttribute("aria-invalid");
  manualUrl.removeAttribute("aria-invalid");

  if (finder.dataset.mode === "manual") {
    const businessName = manualName.value.trim();
    const reviewUrl = manualUrl.value.trim();
    if (!businessName) {
      error.textContent = "Enter your business name.";
      manualName.setAttribute("aria-invalid", "true");
      manualName.focus();
      return null;
    }
    if (!validHttpsUrl(reviewUrl)) {
      error.textContent = "Enter a complete, secure review URL beginning with https://";
      manualUrl.setAttribute("aria-invalid", "true");
      manualUrl.focus();
      return null;
    }
    return {
      businessName,
      businessAddress: manualAddress.value.trim(),
      googlePlaceId: "",
      reviewUrl,
      googleMapsUrl: "",
      reviewLinkStatus: "Ready",
      reviewLinkSource: "Manual"
    };
  }

  const values = {
    businessName: form.elements.businessName.value.trim(),
    businessAddress: form.elements.businessAddress.value.trim(),
    googlePlaceId: form.elements.googlePlaceId.value.trim(),
    reviewUrl: form.elements.reviewUrl.value.trim(),
    googleMapsUrl: form.elements.googleMapsUrl.value.trim(),
    reviewLinkStatus: form.elements.reviewLinkStatus.value.trim() || "Ready",
    reviewLinkSource: form.elements.reviewLinkSource.value.trim() || "Google Places"
  };
  if (finder.dataset.mode !== "selected" || !values.businessName || !values.googlePlaceId || !validHttpsUrl(values.reviewUrl)) {
    error.textContent = "Search for your business and select the correct location before adding the package.";
    form.querySelector("[data-business-search]")?.focus();
    return null;
  }
  return values;
}

function initialiseProductForm() {
  document.querySelector("[data-package-grid]")?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-package]");
    if (option && !option.disabled) updatePackageSelection(option.dataset.package);
  });

  const form = document.querySelector("[data-product-form]");
  if (!form) return;
  const finderRoot = form.querySelector("[data-business-finder]");
  const urlInput = form.querySelector("[data-manual-review-url]");
  const warning = form.querySelector("[data-url-warning]");

  businessFinderController = initialiseBusinessFinder({
    root: finderRoot,
    apiKey: config.GOOGLE_MAPS_API_KEY,
    onChange: (details = {}) => {
      form.querySelector('[data-error-for="businessDetails"]').textContent = "";
      if (
        details.mode === "selected"
        && details.googlePlaceId
        && !editingBusinessLineId
        && details.googlePlaceId !== lastMetaBusinessPlaceId
      ) {
        lastMetaBusinessPlaceId = details.googlePlaceId;
        trackMetaEvent("Search", {
          content_category: "Business location lookup",
          search_string: "Google business location"
        });
      }
    }
  });

  urlInput.addEventListener("input", () => {
    const value = urlInput.value.trim();
    warning.hidden = !validHttpsUrl(value) || looksGoogleRelated(value);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = validateProductForm(form);
    if (!values) return;
    const button = form.querySelector("[data-add-to-cart]");
    const status = form.querySelector("[data-add-status]");
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = "Adding to cart…";
    status.textContent = "";
    try {
      if (editingBusinessLineId) {
        await cartActions.updateBusinessForLine(editingBusinessLineId, values);
        editingBusinessLineId = null;
        status.textContent = "Business details updated in your cart.";
        button.dataset.editingBusiness = "false";
      } else {
        await cartActions.addMainPackage({ packageCount: selectedPackage, ...values });
        trackMetaEvent("AddToCart", packageMetaParameters(selectedPackage));
        status.textContent = "Added to your cart.";
      }
      openCart();
      toast(status.textContent);
    } catch (error) {
      status.textContent = error.message || "We couldn't add this product. Please try again.";
      toast(status.textContent, "error");
    } finally {
      button.disabled = false;
      button.innerHTML = original;
      updatePackageSelection(selectedPackage);
    }
  });
}

function openCart() {
  const drawer = document.querySelector("[data-cart-drawer]");
  const backdrop = document.querySelector("[data-cart-backdrop]");
  if (!drawer || !backdrop) return;
  lastFocusedElement = document.activeElement;
  drawer.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    drawer.classList.add("is-open");
    backdrop.classList.add("is-visible");
    setBodyLock();
    drawer.focus();
  });
}

function closeCart() {
  const drawer = document.querySelector("[data-cart-drawer]");
  const backdrop = document.querySelector("[data-cart-backdrop]");
  if (!drawer || drawer.hidden) return;
  drawer.classList.remove("is-open");
  backdrop.classList.remove("is-visible");
  window.setTimeout(() => {
    drawer.hidden = true;
    backdrop.hidden = true;
    setBodyLock();
    lastFocusedElement?.focus?.();
  }, 260);
}

function lineAttributesList(line) {
  const list = document.createElement("ul");
  list.className = "cart-line__attributes";
  const businessName = line.attributes?.[FULFILMENT_KEYS.businessName];
  const businessAddress = line.attributes?.[FULFILMENT_KEYS.businessAddress];
  if (businessName) {
    const item = document.createElement("li");
    item.textContent = `Business: ${businessName}`;
    list.append(item);
  }
  if (businessAddress) {
    const item = document.createElement("li");
    item.textContent = businessAddress.replace(/,?\s*Australia$/i, "");
    item.title = businessAddress;
    list.append(item);
  }
  return list;
}

function createPackageSelector(line) {
  const wrapper = document.createElement("label");
  wrapper.className = "cart-line__package-select";
  wrapper.textContent = "Package ";
  const select = document.createElement("select");
  select.dataset.packageChange = "";
  select.setAttribute("aria-label", "Change card package");
  cartActions.getState().catalog.main.variants.forEach((variant) => {
    const option = document.createElement("option");
    option.value = String(variant.count);
    option.textContent = `${variant.count} card${variant.count === 1 ? "" : "s"} — ${formatMoney(variant.price, variant.currency)}`;
    option.disabled = !variant.available;
    option.selected = variant.id === line.variantId;
    select.append(option);
  });
  wrapper.append(select);
  return wrapper;
}

function packageCountForLine(line, catalog = cartActions.getState().catalog) {
  if (line?.kind !== "primary") return null;
  return catalog?.main?.variants?.find((variant) => variant.id === line.variantId)?.count
    || Number(String(line.variantTitle || "").match(/\b(1|2|3|5)\b/)?.[1] || 0)
    || null;
}

function createCartLine(line, currency) {
  const article = document.createElement("article");
  article.className = "cart-line";
  article.classList.add(`cart-line--${line.kind}`);
  article.dataset.lineId = line.id;

  const imageWrap = document.createElement("div");
  imageWrap.className = "cart-line__image";
  const image = document.createElement("img");
  image.src = line.image || "assets/products/tapntrust-nfc-card-transparent.webp";
  image.alt = line.imageAlt || "Tapntrust product";
  image.loading = "lazy";
  imageWrap.append(image);

  const details = document.createElement("div");
  details.className = "cart-line__details";

  if (line.kind === "extra") {
    const offer = document.createElement("span");
    offer.className = "cart-line__offer";
    offer.textContent = "Special add-on offer";
    details.append(offer);
  }

  const title = document.createElement("h3");
  title.textContent = line.title;
  details.append(title);
  if (line.variantTitle) {
    const variant = document.createElement("p");
    variant.className = "cart-line__variant";
    variant.textContent = line.variantTitle;
    details.append(variant);
  }
  details.append(lineAttributesList(line));
  if (line.kind === "primary") {
    details.append(createPackageSelector(line));
    const changeBusiness = document.createElement("button");
    changeBusiness.type = "button";
    changeBusiness.className = "cart-line__change-business";
    changeBusiness.dataset.lineAction = "change-business";
    changeBusiness.textContent = "Change business";
    details.append(changeBusiness);

    const packageCount = packageCountForLine(line);
    if (packageCount === 3 || packageCount === 5) {
      const bundleNote = document.createElement("div");
      bundleNote.className = "cart-line__product-note cart-line__product-note--bundle";
      const bundleTitle = document.createElement("strong");
      const bundleText = document.createElement("span");
      if (packageCount === 5) {
        bundleTitle.textContent = "Best Value bundle inclusions";
        bundleText.textContent = "FREE standard shipping Australia-wide and one FREE A$14.49 Counter Stand are included.";
      } else {
        bundleTitle.textContent = "Sweet spot package";
        bundleText.textContent = "Three customer touchpoints at A$24.98 per card, with FREE standard shipping Australia-wide.";
      }
      bundleNote.append(bundleTitle, bundleText);
      details.append(bundleNote);
    }
  }

  if (line.kind === "stand" || line.kind === "extra") {
    const productNote = document.createElement("div");
    productNote.className = "cart-line__product-note";
    const noteTitle = document.createElement("strong");
    const noteText = document.createElement("span");

    if (line.kind === "stand") {
      noteTitle.textContent = "Optional clear acrylic display";
      noteText.textContent = "Keeps your Tapntrust card upright, stable and easy to notice on the counter.";
    } else {
      noteTitle.textContent = "Extra card for your selected location";
      noteText.textContent = "Programmed with the same business and Google review link as your card package.";
    }

    productNote.append(noteTitle, noteText);
    details.append(productNote);
  }

  const aside = document.createElement("div");
  aside.className = "cart-line__aside";
  const priceGroup = document.createElement("div");
  priceGroup.className = "cart-line__price-group";
  const price = document.createElement("strong");
  price.textContent = formatMoney(line.lineTotal, currency);
  priceGroup.append(price);
  if (line.kind === "extra") {
    const priceNote = document.createElement("small");
    priceNote.textContent = "Package add-on price";
    priceGroup.append(priceNote);
  }
  aside.append(priceGroup);

  if (line.kind === "primary") {
    const quantity = document.createElement("span");
    quantity.className = "cart-line__variant";
    quantity.textContent = `Qty ${line.quantity}`;
    aside.append(quantity);
  } else {
    const quantity = document.createElement("div");
    quantity.className = "quantity-control";
    quantity.setAttribute("aria-label", `Quantity for ${line.title}`);
    const minus = document.createElement("button");
    minus.type = "button";
    minus.dataset.lineAction = "decrease";
    minus.setAttribute("aria-label", `Decrease ${line.title} quantity`);
    minus.textContent = "−";
    minus.disabled = line.quantity <= 1;
    const count = document.createElement("span");
    count.textContent = line.quantity;
    const plus = document.createElement("button");
    plus.type = "button";
    plus.dataset.lineAction = "increase";
    plus.setAttribute("aria-label", `Increase ${line.title} quantity`);
    plus.textContent = "+";
    quantity.append(minus, count, plus);
    aside.append(quantity);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "cart-line__remove";
  remove.dataset.lineAction = "remove";
  remove.textContent = "Remove";
  aside.append(remove);
  article.append(imageWrap, details, aside);
  return article;
}

function renderCart(cartState) {
  const { cart, loading, mode, error } = cartState;
  const lines = cart?.lines || [];
  const count = cart?.totalQuantity || 0;
  const cartLines = document.querySelector("[data-cart-lines]");
  const empty = document.querySelector("[data-cart-empty]");
  const content = document.querySelector("[data-cart-content]");
  const footer = document.querySelector("[data-cart-footer]");
  const upsells = document.querySelector("[data-cart-upsells]");
  const checkout = document.querySelector("[data-checkout]");
  const notice = document.querySelector("[data-cart-notice]");
  document.querySelectorAll("[data-cart-count]").forEach((item) => { item.textContent = count; });
  document.querySelectorAll("[data-cart-open]").forEach((button) => button.setAttribute("aria-label", `Open shopping cart, ${count} item${count === 1 ? "" : "s"}`));
  setText("[data-cart-heading-count]", `(${count})`);
  const loadingOverlay = document.querySelector("[data-cart-loading]");
  if (loadingOverlay) loadingOverlay.hidden = !loading;

  if (notice) {
    const message = error?.message || "";
    notice.textContent = message;
    notice.hidden = !message;
  }

  if (!lines.length) {
    empty.hidden = false;
    content.hidden = true;
    footer.hidden = true;
    return;
  }

  empty.hidden = true;
  content.hidden = false;
  footer.hidden = false;
  cartLines.replaceChildren(...lines.map((line) => createCartLine(line, cart.currency)));
  upsells.hidden = !lines.some((line) => line.kind === "primary");

  const hasFiveCardBundle = lines.some((line) => packageCountForLine(line, cartState.catalog) === 5);
  const standUpsell = document.querySelector('[data-upsell-card="stand"]');
  const standDescription = standUpsell?.querySelector("[data-upsell-description]");
  const standPrice = standUpsell?.querySelector("[data-upsell-price]");
  standUpsell?.classList.toggle("upsell-card--included", hasFiveCardBundle);
  if (standDescription) {
    standDescription.textContent = hasFiveCardBundle
      ? "Included FREE with your 5-card bundle"
      : "Keep your card upright and visible.";
  }
  if (standPrice) {
    if (hasFiveCardBundle) standPrice.innerHTML = "<del>A$14.49</del><span>FREE</span>";
    else standPrice.textContent = "A$14.49";
  }

  document.querySelectorAll("[data-upsell-add]").forEach((button) => {
    const kind = button.dataset.upsellAdd;
    if (kind === "stand" && hasFiveCardBundle) {
      button.disabled = true;
      button.textContent = "Included";
      return;
    }
    const added = lines.some((line) => line.kind === kind);
    button.disabled = added;
    button.textContent = added ? "Added" : "Add";
  });

  const discountRow = document.querySelector("[data-cart-discount-row]");
  if (discountRow) discountRow.hidden = !(cart.discountAmount > 0);
  setText("[data-cart-discount]", cart.discountAmount > 0 ? `−${formatMoney(cart.discountAmount, cart.currency)}` : "");
  setText("[data-cart-subtotal]", formatMoney(cart.total, cart.currency));

  if (mode === "shopify" && cart.checkoutUrl) {
    checkout.href = cart.checkoutUrl;
    checkout.setAttribute("aria-disabled", "false");
    checkout.removeAttribute("tabindex");
  } else {
    checkout.href = "#";
    checkout.setAttribute("aria-disabled", "true");
    checkout.setAttribute("tabindex", "-1");
  }
}

function editBusinessForLine(line) {
  editingBusinessLineId = line.id;
  const details = businessDetailsFromAttributes(line.attributes);
  businessFinderController?.restore(details);
  const button = document.querySelector("[data-add-to-cart]");
  if (button) {
    button.dataset.editingBusiness = "true";
    button.innerHTML = "<span>Save business details</span><strong>Update cart</strong>";
  }
  closeCart();
  window.setTimeout(() => {
    document.querySelector("[data-business-finder]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 280);
}

function initialiseCartUi() {
  document.querySelectorAll("[data-cart-open]").forEach((button) => button.addEventListener("click", openCart));
  document.querySelector("[data-cart-close]")?.addEventListener("click", closeCart);
  document.querySelector("[data-cart-backdrop]")?.addEventListener("click", closeCart);
  document.querySelector("[data-cart-shop]")?.addEventListener("click", () => {
    closeCart();
    document.querySelector("#shop")?.scrollIntoView({ behavior: "smooth" });
  });

  document.querySelector("[data-cart-lines]")?.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-line-action]");
    const lineElement = event.target.closest("[data-line-id]");
    if (!action || !lineElement) return;
    const current = cartActions.getState().cart?.lines.find((line) => line.id === lineElement.dataset.lineId);
    if (!current) return;
    try {
      if (action.dataset.lineAction === "remove") await cartActions.removeLine(current.id);
      if (action.dataset.lineAction === "increase") await cartActions.changeLineQuantity(current.id, current.quantity + 1);
      if (action.dataset.lineAction === "decrease") await cartActions.changeLineQuantity(current.id, current.quantity - 1);
      if (action.dataset.lineAction === "change-business") editBusinessForLine(current);
    } catch (error) {
      toast(error.message || "We couldn't update the cart.", "error");
    }
  });

  document.querySelector("[data-cart-lines]")?.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-package-change]");
    const lineElement = event.target.closest("[data-line-id]");
    if (!select || !lineElement) return;
    select.disabled = true;
    try {
      await cartActions.changePrimaryPackage(lineElement.dataset.lineId, Number(select.value));
      toast("Card package updated. Business details were preserved.");
    } catch (error) {
      toast(error.message || "We couldn't change that package.", "error");
      renderCart(cartActions.getState());
    }
  });

  document.querySelector("[data-cart-upsells]")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-upsell-add]");
    if (!button) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Adding…";
    try {
      await cartActions.addUpsell(button.dataset.upsellAdd);
      trackMetaEvent("AddToCart", upsellMetaParameters(button.dataset.upsellAdd));
      toast(button.dataset.upsellAdd === "stand" ? "Counter Stand added." : "Extra NFC Card added with the same business details.");
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      toast(error.message || "We couldn't add that item.", "error");
    }
  });

  const drawer = document.querySelector("[data-cart-drawer]");
  drawer?.addEventListener("keydown", (event) => trapFocus(event, drawer));
  document.addEventListener("tapntrust:cart-change", (event) => {
    renderCart(event.detail);
    updatePackagesFromCatalog(event.detail.catalog);
  });
}

function initialiseMobileBuyBar() {
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

function initialiseGuide() {
  document.querySelectorAll("[data-guide-open]").forEach((button) => button.addEventListener("click", openGuide));
  document.querySelector("[data-guide-close]")?.addEventListener("click", closeGuide);
  document.querySelector("[data-guide-backdrop]")?.addEventListener("click", closeGuide);
  const modal = document.querySelector("[data-guide-modal]");
  modal?.addEventListener("keydown", (event) => trapFocus(event, modal));
}

function initialiseLinkWalkthrough() {
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
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = (current + direction + tabs.length) % tabs.length;
      showStep(Number(tabs[next].dataset.linkStep), true);
    });
  });

  document.querySelector("[data-guide-demo-start]")?.addEventListener("click", () => {
    showStep(1, true);
    walkthrough.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function initialiseConsultationForm({ toast }) {
  const form = document.querySelector("[data-consultation-form]");
  if (!form) return;

  const status = form.querySelector("[data-consultation-status]");
  const button = form.querySelector('button[type="submit"]');
  const endpoint = String(config.CONSULTATION_ENDPOINT || "").trim();

  const setStatus = (message, type = "") => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", type === "error");
    status.classList.toggle("is-success", type === "success");
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const payload = Object.fromEntries(new FormData(form).entries());

    if (!endpoint) {
      const supportEmail = String(config.SUPPORT_EMAIL || "").trim();
      if (!supportEmail) {
        setStatus("Email support is temporarily unavailable. Please contact us through Facebook or Instagram.", "error");
        return;
      }

      const subject = `Tapntrust enquiry from ${String(payload.name || "customer").trim()}`;
      const body = [
        `Name: ${String(payload.name || "").trim()}`,
        `Phone: ${String(payload.phone || "").trim()}`,
        `Email: ${String(payload.email || "Not provided").trim() || "Not provided"}`,
        `Topic: ${String(payload.topic || "General enquiry").trim()}`,
        "",
        String(payload.message || "").trim()
      ].join("\n");

      setStatus("Opening your email app with the enquiry prepared…", "success");
      window.location.href = `mailto:${encodeURIComponent(supportEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return;
    }

    let url;
    try {
      url = new URL(endpoint, window.location.href);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error("Unsupported consultation endpoint");
    } catch {
      setStatus("Online enquiries are temporarily unavailable. Please use a contact option below.", "error");
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    setStatus("Sending your request…");

    try {
      const response = await fetch(url.href, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error("Consultation request failed");
      form.reset();
      setStatus("Thanks — your request has been sent. Tapntrust will contact you soon.", "success");
      toast("Consultation request sent");
    } catch {
      setStatus("We couldn’t send your request. Please use a contact option below.", "error");
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });
}

function initialiseStepDemo() {
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

function initialisePlacementCarousel() {
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

function initialiseScrollReveal() {
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const groups = [
    { selector: ".friction .section-heading, .friction-solution, .how .section-heading, .purchase-bridge__copy, .placement-showcase .section-heading, .placement-gallery .section-heading, .customer-feedback .section-heading", type: "up", step: 0 },
    { selector: ".value-strip__grid > div", type: "up", step: 45 },
    { selector: ".friction-list li", type: "up", step: 55 },
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

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.querySelector("[data-guide-modal].is-open")) closeGuide();
  else if (document.querySelector("[data-cart-drawer].is-open")) closeCart();
});

document.querySelectorAll("[data-current-year]").forEach((element) => { element.textContent = new Date().getFullYear(); });
initialiseBrandAssets();
initialiseNavigation();
initialiseProductViewer();
initialiseMetadata();
initialiseMetaCommerceEvents();
initialiseProductForm();
initialiseCartUi();
initialiseMobileBuyBar();
initialiseGuide();
initialiseLinkWalkthrough();
initialiseConsultationForm({ toast });
initialiseStepDemo();
initialisePlacementCarousel();
initialiseScrollReveal();
updatePackageSelection(selectedPackage);

const initialState = cartActions.getState();
renderCart(initialState);
cartActions.initialise().then((cartState) => {
  renderCart(cartState);
  updatePackagesFromCatalog(cartState.catalog);
});
