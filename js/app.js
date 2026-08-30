import config from "./config.js";
import baseCartActions from "./cart.js";
import { createIntegrityCartActions, initialiseCheckoutIntegrityGuard } from "./cart-integrity.js";
import { validHttpsUrl, looksGoogleRelated } from "./validation.js";
import { initialiseBusinessFinder } from "./business-finder.js";
import { businessDetailsFromAttributes } from "./fulfilment.js";
import { initialiseMetadata } from "./metadata.js";
import {
  initialiseMetaCommerceEvents,
  initialiseMetaPixel,
  packageMetaParameters,
  trackMetaEvent
} from "./analytics/meta.js";
import { setText, toast } from "./ui/common.js";
import { createCartUi } from "./ui/cart-drawer.js";
import { createGuideUi } from "./ui/guide.js";
import {
  initialiseBrandAssets,
  initialiseLinkWalkthrough,
  initialiseMobileBuyBar,
  initialiseNavigation,
  initialisePlacementCarousel,
  initialiseProductViewer,
  initialiseScrollReveal,
  initialiseStepDemo
} from "./ui/site.js";
import { initialiseConsultationForm } from "./forms/consultation.js";

const cartActions = createIntegrityCartActions(baseCartActions);
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
let selectedPackage = 2;
let businessFinderController = null;
let editingBusinessLineId = null;
let lastMetaBusinessPlaceId = "";
let cartUi = null;

function formatMoney(value, currency = "AUD") {
  if (currency === "AUD") return money.format(Number(value || 0)).replace("$", "A$");
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(Number(value || 0));
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

function editBusinessForLine(line) {
  editingBusinessLineId = line.id;
  const details = businessDetailsFromAttributes(line.attributes);
  businessFinderController?.restore(details);
  const button = document.querySelector("[data-add-to-cart]");
  if (button) {
    button.dataset.editingBusiness = "true";
    button.innerHTML = "<span>Save business details</span><strong>Update cart</strong>";
  }
  cartUi?.closeCart();
  window.setTimeout(() => {
    document.querySelector("[data-business-finder]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 280);
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
      cartUi?.openCart();
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

const guideUi = createGuideUi();
cartUi = createCartUi({
  cartActions,
  formatMoney,
  updatePackagesFromCatalog,
  onEditBusiness: editBusinessForLine
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.querySelector("[data-guide-modal].is-open")) guideUi.closeGuide();
  else if (document.querySelector("[data-cart-drawer].is-open")) cartUi.closeCart();
});

document.querySelectorAll("[data-current-year]").forEach((element) => { element.textContent = new Date().getFullYear(); });
initialiseBrandAssets();
initialiseNavigation();
initialiseProductViewer();
initialiseMetadata(config);
initialiseMetaPixel(config);
initialiseMetaCommerceEvents();
initialiseProductForm();
cartUi.initialise();
initialiseCheckoutIntegrityGuard(cartActions);
initialiseMobileBuyBar();
guideUi.initialise();
initialiseLinkWalkthrough();
initialiseConsultationForm({ config, toast });
initialiseStepDemo();
initialisePlacementCarousel();
initialiseScrollReveal();
updatePackageSelection(selectedPackage);

const initialState = cartActions.getState();
cartUi.renderCart(initialState);
cartActions.initialise().then((cartState) => {
  cartUi.renderCart(cartState);
  updatePackagesFromCatalog(cartState.catalog);
});
