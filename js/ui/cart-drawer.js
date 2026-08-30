import { setBodyLock, setText, toast, trapFocus } from "./common.js";
import { trackMetaEvent, upsellMetaParameters } from "../analytics/meta.js";
import { FULFILMENT_KEYS } from "../fulfilment.js";

export function createCartUi({ cartActions, formatMoney, updatePackagesFromCatalog, onEditBusiness }) {
  let lastFocusedElement = null;

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

  function initialise() {
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
        if (action.dataset.lineAction === "change-business") onEditBusiness(current);
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
        trackMetaEvent("AddToCart", upsellMetaParameters(cartActions, button.dataset.upsellAdd));
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

  return { initialise, openCart, closeCart, renderCart };
}
