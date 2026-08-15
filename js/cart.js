import config from "./config.js";
import {
  ShopifyError,
  isShopifyConfigured,
  fetchProductByHandle,
  createCart,
  fetchCart,
  addCartLines,
  updateCartLines,
  removeCartLines,
  updateCartDiscountCodes
} from "./shopify.js";
import {
  FULFILMENT_KEYS,
  LEGACY_FULFILMENT_KEYS,
  ITEM_ROLES,
  buildFulfilmentAttributes,
  businessDetailsFromAttributes,
  mergeFulfilmentAttributes
} from "./fulfilment.js";

const CART_ID_KEY = "tapntrust_shopify_cart_id";
const DEMO_CART_KEY = "tapntrust_preview_cart";
const PENDING_DISCOUNT_KEY = "tapntrust_pending_discount";
const ACTIVE_SETUP_KEY = "tapntrust_active_business_setup_id";
const CARD_IMAGE = "assets/products/tapntrust-nfc-card-transparent.webp";
const STAND_IMAGE = "assets/products/tapntrust-counter-stand-transparent.webp";

const fallbackCatalog = {
  main: {
    title: "TapNTrust NFC Review Card",
    handle: config.MAIN_PRODUCT_HANDLE,
    image: CARD_IMAGE,
    variants: [
      { id: "preview-main-1", count: 1, title: "1 Card", price: 39.95, currency: "AUD", available: true },
      { id: "preview-main-2", count: 2, title: "2 Cards", price: 59.95, currency: "AUD", available: true },
      { id: "preview-main-3", count: 3, title: "3 Cards", price: 74.95, currency: "AUD", available: true },
      { id: "preview-main-5", count: 5, title: "5 Cards", price: 109.95, currency: "AUD", available: true }
    ]
  },
  stand: {
    title: "TapNTrust Counter Stand",
    handle: config.STAND_PRODUCT_HANDLE,
    image: STAND_IMAGE,
    variants: [{ id: "preview-stand", title: "Default Title", price: 14.49, currency: "AUD", available: true }]
  },
  extra: {
    title: "TapNTrust Extra NFC Card",
    handle: config.EXTRA_CARD_PRODUCT_HANDLE,
    image: CARD_IMAGE,
    variants: [{ id: "preview-extra", title: "Default Title", price: 20.99, currency: "AUD", available: true }]
  }
};

const state = {
  mode: isShopifyConfigured() && typeof window !== "undefined" ? "shopify" : "preview",
  ready: false,
  loading: false,
  catalog: fallbackCatalog,
  cart: null,
  error: null
};

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ }
}

function storageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* Storage is optional. */ }
}

function emit() {
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("tapntrust:cart-change", { detail: getCartState() }));
  }
}

function setLoading(loading) {
  state.loading = loading;
  emit();
}

function attributeObject(attributes = []) {
  return attributes.reduce((result, attribute) => {
    result[attribute.key] = attribute.value;
    return result;
  }, {});
}

function classifyLine(handle, attributes) {
  const role = attributes[FULFILMENT_KEYS.itemRole] || attributes[LEGACY_FULFILMENT_KEYS.itemRole];
  if (role === ITEM_ROLES.primary || handle === config.MAIN_PRODUCT_HANDLE) return "primary";
  if (role === ITEM_ROLES.extra || handle === config.EXTRA_CARD_PRODUCT_HANDLE) return "extra";
  if (role === ITEM_ROLES.stand || handle === config.STAND_PRODUCT_HANDLE) return "stand";
  return "other";
}

function normaliseShopifyCart(cart) {
  if (!cart) return null;
  const subtotal = Number(cart.cost?.subtotalAmount?.amount || 0);
  const total = Number(cart.cost?.totalAmount?.amount || subtotal);
  const lines = (cart.lines?.nodes || [])
    .filter((line) => Number(line.quantity || 0) > 0)
    .map((line) => {
      const attributes = attributeObject(line.attributes);
      const merchandise = line.merchandise;
      return {
        id: line.id,
        variantId: merchandise?.id,
        title: merchandise?.product?.title || "Product",
        variantTitle: merchandise?.title === "Default Title" ? "" : merchandise?.title || "",
        productHandle: merchandise?.product?.handle || "",
        quantity: line.quantity,
        attributes,
        kind: classifyLine(merchandise?.product?.handle, attributes),
        image: merchandise?.image?.url || CARD_IMAGE,
        imageAlt: merchandise?.image?.altText || merchandise?.product?.title || "TapNTrust product",
        unitPrice: Number(merchandise?.price?.amount || 0),
        lineTotal: Number(line.cost?.totalAmount?.amount || 0)
      };
    });
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    currency: cart.cost?.subtotalAmount?.currencyCode || "AUD",
    totalQuantity: Number(cart.totalQuantity || 0),
    subtotal,
    total,
    discountAmount: Math.max(0, subtotal - total),
    discountCodes: (cart.discountCodes || []).filter((item) => item.applicable).map((item) => item.code),
    lines
  };
}

function recalculatePreviewCart(cart) {
  const subtotal = cart.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const hasWelcome = cart.discountCodes.includes(config.WELCOME_DISCOUNT_CODE);
  const discountAmount = hasWelcome ? subtotal * 0.15 : 0;
  cart.subtotal = subtotal;
  cart.discountAmount = discountAmount;
  cart.total = subtotal - discountAmount;
  cart.totalQuantity = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
  cart.lines.forEach((line) => { line.lineTotal = line.unitPrice * line.quantity; });
  return cart;
}

function newPreviewCart() {
  return recalculatePreviewCart({
    id: "preview-cart",
    checkoutUrl: "",
    currency: "AUD",
    totalQuantity: 0,
    subtotal: 0,
    total: 0,
    discountAmount: 0,
    discountCodes: [],
    lines: []
  });
}

function restorePreviewCart() {
  const raw = storageGet(DEMO_CART_KEY);
  if (!raw) return newPreviewCart();
  try {
    const cart = JSON.parse(raw);
    if (!Array.isArray(cart.lines)) return newPreviewCart();
    migratePreviewFulfilment(cart);
    return recalculatePreviewCart(cart);
  } catch {
    return newPreviewCart();
  }
}

function migrationKey(attributes = {}) {
  const details = businessDetailsFromAttributes(attributes);
  return `${details.businessName}\n${details.reviewUrl}`;
}

function needsFulfilmentMigration(attributes = {}, kind = "") {
  const hasPublicMetadata = Object.values(LEGACY_FULFILMENT_KEYS).some((key) => Object.hasOwn(attributes, key));
  if (kind === "stand") {
    return hasPublicMetadata || attributes[FULFILMENT_KEYS.itemRole] !== ITEM_ROLES.stand;
  }
  return hasPublicMetadata
    || Boolean(attributes["Review URL"])
    || !attributes[FULFILMENT_KEYS.reviewLink]
    || !attributes[FULFILMENT_KEYS.reviewLinkStatus]
    || !attributes[FULFILMENT_KEYS.reviewLinkSource]
    || !attributes[FULFILMENT_KEYS.setupId];
}

function migratePreviewFulfilment(cart) {
  const setups = new Map();
  cart.lines.filter((line) => line.kind === "primary").forEach((line) => {
    const setupId = line.attributes?.[FULFILMENT_KEYS.setupId] || businessSetupId();
    setups.set(migrationKey(line.attributes), setupId);
  });
  cart.lines.forEach((line) => {
    if (!["primary", "extra", "stand"].includes(line.kind) || !needsFulfilmentMigration(line.attributes, line.kind)) return;
    if (line.kind === "stand") {
      line.attributes = mergeFulfilmentAttributes(line.attributes, buildFulfilmentAttributes({}, { itemRole: ITEM_ROLES.stand }));
      return;
    }
    const details = businessDetailsFromAttributes(line.attributes);
    if (!details.businessName || !details.reviewUrl) return;
    const setupId = line.attributes?.[FULFILMENT_KEYS.setupId] || setups.get(migrationKey(line.attributes)) || businessSetupId();
    const next = buildFulfilmentAttributes(details, { itemRole: line.kind === "extra" ? ITEM_ROLES.extra : ITEM_ROLES.primary, setupId });
    line.attributes = mergeFulfilmentAttributes(line.attributes, next);
  });
}

function persistPreviewCart() {
  if (state.cart) storageSet(DEMO_CART_KEY, JSON.stringify(state.cart));
}

function productImage(product, fallback) {
  return product.featuredImage?.url || fallback;
}

function variantCount(variant) {
  const optionValue = variant.selectedOptions?.find((option) => /package|cards?/i.test(option.name))?.value;
  const source = `${optionValue || ""} ${variant.title || ""}`;
  const match = source.match(/\b(1|2|3|5)\b/);
  return match ? Number(match[1]) : null;
}

function normaliseProduct(product, fallbackImage) {
  return {
    title: product.title,
    handle: product.handle,
    image: productImage(product, fallbackImage),
    variants: product.variants.nodes.map((variant) => ({
      id: variant.id,
      count: variantCount(variant),
      title: variant.title,
      price: Number(variant.price.amount),
      currency: variant.price.currencyCode,
      available: variant.availableForSale,
      image: variant.image?.url || productImage(product, fallbackImage),
      imageAlt: variant.image?.altText || product.title
    }))
  };
}

async function loadCatalog() {
  const [main, stand, extra] = await Promise.all([
    fetchProductByHandle(config.MAIN_PRODUCT_HANDLE),
    fetchProductByHandle(config.STAND_PRODUCT_HANDLE),
    fetchProductByHandle(config.EXTRA_CARD_PRODUCT_HANDLE)
  ]);

  const catalog = {
    main: normaliseProduct(main, CARD_IMAGE),
    stand: normaliseProduct(stand, STAND_IMAGE),
    extra: normaliseProduct(extra, CARD_IMAGE)
  };
  const requiredCounts = [1, 2, 3, 5];
  const missing = requiredCounts.filter((count) => !catalog.main.variants.some((variant) => variant.count === count));
  if (missing.length) {
    throw new ShopifyError(`The main Shopify product is missing package variants: ${missing.join(", ")} card(s).`);
  }
  if (!catalog.stand.variants[0] || !catalog.extra.variants[0]) {
    throw new ShopifyError("The Counter Stand or Extra NFC Card product has no Shopify variant.");
  }
  return catalog;
}

function pendingDiscountCodes() {
  const code = storageGet(PENDING_DISCOUNT_KEY);
  return code ? [code] : [];
}

function saveShopifyCart(cart) {
  state.cart = normaliseShopifyCart(cart);
  storageSet(CART_ID_KEY, cart.id);
  if (state.cart.discountCodes.length) storageRemove(PENDING_DISCOUNT_KEY);
}

function zeroQuantityLineIds(cart) {
  return (cart?.lines?.nodes || [])
    .filter((line) => Number(line.quantity || 0) <= 0)
    .map((line) => line.id)
    .filter(Boolean);
}

async function cleanupZeroQuantityLines(cart) {
  const lineIds = zeroQuantityLineIds(cart);
  if (!lineIds.length) return cart;
  return removeCartLines(cart.id, lineIds);
}

async function migrateShopifyFulfilment(cart) {
  const nodes = cart?.lines?.nodes || [];
  const setups = new Map();
  nodes.forEach((line) => {
    const attributes = attributeObject(line.attributes);
    const kind = classifyLine(line.merchandise?.product?.handle, attributes);
    if (kind !== "primary") return;
    setups.set(migrationKey(attributes), attributes[FULFILMENT_KEYS.setupId] || businessSetupId());
  });

  const updates = nodes.flatMap((line) => {
    const attributes = attributeObject(line.attributes);
    const kind = classifyLine(line.merchandise?.product?.handle, attributes);
    if (!["primary", "extra", "stand"].includes(kind) || !needsFulfilmentMigration(attributes, kind)) return [];
    if (kind === "stand") {
      const fulfilment = buildFulfilmentAttributes({}, { itemRole: ITEM_ROLES.stand });
      const merged = mergeFulfilmentAttributes(attributes, fulfilment);
      return [{ id: line.id, attributes: Object.entries(merged).map(([key, value]) => ({ key, value: String(value) })) }];
    }
    const details = businessDetailsFromAttributes(attributes);
    if (!details.businessName || !details.reviewUrl) return [];
    const setupId = attributes[FULFILMENT_KEYS.setupId] || setups.get(migrationKey(attributes)) || businessSetupId();
    const fulfilment = buildFulfilmentAttributes(details, { itemRole: kind === "extra" ? ITEM_ROLES.extra : ITEM_ROLES.primary, setupId });
    const merged = mergeFulfilmentAttributes(attributes, fulfilment);
    return [{ id: line.id, attributes: Object.entries(merged).map(([key, value]) => ({ key, value: String(value) })) }];
  });
  return updates.length ? updateCartLines(cart.id, updates) : cart;
}

function isExpiredCartError(error) {
  return error instanceof ShopifyError && error.details.some((detail) => /cart.*(not found|invalid|expired)/i.test(`${detail.code || ""} ${detail.message || ""}`));
}

async function addShopifyLines(lines) {
  const inputs = lines.map((line) => ({
    merchandiseId: line.variantId,
    quantity: line.quantity,
    attributes: Object.entries(line.attributes || {}).map(([key, value]) => ({ key, value: String(value) }))
  }));

  if (!state.cart?.id) {
    saveShopifyCart(await createCart(inputs, pendingDiscountCodes()));
    return;
  }

  try {
    const updated = await addCartLines(state.cart.id, inputs);
    const returnedLines = updated?.lines?.nodes || [];
    if (!returnedLines.length || Number(updated.totalQuantity || 0) <= 0) {
      storageRemove(CART_ID_KEY);
      const discountCodes = state.cart?.discountCodes?.length ? state.cart.discountCodes : pendingDiscountCodes();
      saveShopifyCart(await createCart(inputs, discountCodes));
      return;
    }
    saveShopifyCart(updated);
  } catch (error) {
    if (!isExpiredCartError(error)) throw error;
    storageRemove(CART_ID_KEY);
    saveShopifyCart(await createCart(inputs, pendingDiscountCodes()));
  }
}

function previewLineId() {
  return globalThis.crypto?.randomUUID?.() || `preview-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function businessSetupId() {
  return globalThis.crypto?.randomUUID?.() || `setup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addPreviewLine({ product, variant, kind, attributes = {} }) {
  const matching = state.cart.lines.find((line) => line.variantId === variant.id && JSON.stringify(line.attributes) === JSON.stringify(attributes));
  if (matching) {
    matching.quantity += 1;
  } else {
    state.cart.lines.push({
      id: previewLineId(),
      variantId: variant.id,
      title: product.title,
      variantTitle: variant.title === "Default Title" ? "" : variant.title,
      productHandle: product.handle,
      quantity: 1,
      attributes,
      kind,
      image: variant.image || product.image,
      imageAlt: variant.imageAlt || product.title,
      unitPrice: variant.price,
      lineTotal: variant.price
    });
  }
  recalculatePreviewCart(state.cart);
  persistPreviewCart();
}

export async function initialiseCart() {
  state.loading = true;
  state.error = null;
  emit();

  if (state.mode === "preview") {
    state.cart = restorePreviewCart();
    state.ready = true;
    state.loading = false;
    emit();
    return getCartState();
  }

  try {
    state.catalog = await loadCatalog();
    const cartId = storageGet(CART_ID_KEY);
    if (cartId) {
      let cart = await fetchCart(cartId);
      if (cart) cart = await cleanupZeroQuantityLines(cart);
      if (cart) cart = await migrateShopifyFulfilment(cart);
      if (cart) saveShopifyCart(cart);
      else storageRemove(CART_ID_KEY);
    }
    state.ready = true;
  } catch (error) {
    state.error = error;
    state.ready = false;
  } finally {
    state.loading = false;
    emit();
  }
  return getCartState();
}

export function getCartState() {
  return {
    mode: state.mode,
    ready: state.ready,
    loading: state.loading,
    catalog: state.catalog,
    cart: state.cart,
    error: state.error
  };
}

export function getMainVariant(packageCount) {
  return state.catalog.main.variants.find((variant) => variant.count === Number(packageCount));
}

export async function addMainPackage({
  packageCount,
  businessName,
  businessAddress = "",
  googlePlaceId = "",
  reviewUrl,
  googleMapsUrl = "",
  reviewLinkStatus = "Ready",
  reviewLinkSource = googlePlaceId ? "Google Places" : "Manual"
}) {
  if (state.mode === "shopify" && !state.ready) {
    throw state.error || new ShopifyError("Shopify products are not ready. Please try again.");
  }
  const variant = getMainVariant(packageCount);
  if (!variant) throw new ShopifyError("That card package is not available.");
  if (!variant.available) throw new ShopifyError("That card package is currently unavailable.");

  const setupId = businessSetupId();
  const attributes = buildFulfilmentAttributes({
    businessName,
    businessAddress,
    googlePlaceId,
    reviewUrl,
    googleMapsUrl,
    reviewLinkStatus,
    reviewLinkSource
  }, { itemRole: ITEM_ROLES.primary, setupId });
  setLoading(true);
  try {
    if (state.mode === "shopify") {
      await addShopifyLines([{ variantId: variant.id, quantity: 1, attributes }]);
    } else {
      addPreviewLine({ product: state.catalog.main, variant, kind: "primary", attributes });
    }
    storageSet(ACTIVE_SETUP_KEY, setupId);
    state.error = null;
  } catch (error) {
    state.error = error;
    throw error;
  } finally {
    setLoading(false);
  }
  return getCartState();
}

function inheritedDetails() {
  const activeSetupId = storageGet(ACTIVE_SETUP_KEY);
  const primaryLines = (state.cart?.lines || []).filter((line) => line.kind === "primary");
  const primary = primaryLines.find((line) => line.attributes?.[FULFILMENT_KEYS.setupId] === activeSetupId)
    || (state.mode === "preview" ? primaryLines.at(-1) : primaryLines[0]);
  if (!primary) throw new ShopifyError("Choose a card package before adding extras.");
  return buildFulfilmentAttributes(businessDetailsFromAttributes(primary.attributes), {
    itemRole: ITEM_ROLES.extra,
    setupId: primary.attributes[FULFILMENT_KEYS.setupId] || businessSetupId()
  });
}

export async function addUpsell(kind) {
  if (state.mode === "shopify" && !state.ready) throw state.error || new ShopifyError("Shopify is not ready.");
  const product = state.catalog[kind];
  const variant = product?.variants?.[0];
  if (!product || !variant) throw new ShopifyError("That add-on is not available.");
  const attributes = kind === "extra"
    ? inheritedDetails()
    : buildFulfilmentAttributes({}, { itemRole: ITEM_ROLES.stand });

  setLoading(true);
  try {
    if (state.mode === "shopify") {
      await addShopifyLines([{ variantId: variant.id, quantity: 1, attributes }]);
    } else {
      addPreviewLine({ product, variant, kind, attributes });
    }
    state.error = null;
  } catch (error) {
    state.error = error;
    throw error;
  } finally {
    setLoading(false);
  }
  return getCartState();
}

export async function changeLineQuantity(lineId, quantity) {
  const nextQuantity = Math.max(1, Number(quantity));
  setLoading(true);
  try {
    if (state.mode === "shopify") {
      saveShopifyCart(await updateCartLines(state.cart.id, [{ id: lineId, quantity: nextQuantity }]));
    } else {
      const line = state.cart.lines.find((item) => item.id === lineId);
      if (line) line.quantity = nextQuantity;
      recalculatePreviewCart(state.cart);
      persistPreviewCart();
    }
  } finally {
    setLoading(false);
  }
  return getCartState();
}

export async function changePrimaryPackage(lineId, packageCount) {
  const line = state.cart?.lines?.find((item) => item.id === lineId && item.kind === "primary");
  const variant = getMainVariant(packageCount);
  if (!line) throw new ShopifyError("The card package could not be found in this cart.");
  if (!variant?.available) throw new ShopifyError("That card package is currently unavailable.");

  setLoading(true);
  try {
    if (state.mode === "shopify") {
      // Shopify preserves existing line attributes when attributes are omitted.
      saveShopifyCart(await updateCartLines(state.cart.id, [{ id: lineId, merchandiseId: variant.id, quantity: 1 }]));
    } else {
      line.variantId = variant.id;
      line.variantTitle = variant.title === "Default Title" ? "" : variant.title;
      line.unitPrice = variant.price;
      line.image = variant.image || state.catalog.main.image;
      line.imageAlt = variant.imageAlt || state.catalog.main.title;
      recalculatePreviewCart(state.cart);
      persistPreviewCart();
    }
  } finally {
    setLoading(false);
  }
  return getCartState();
}

function linesForBusinessSetup(primaryLine) {
  const setupId = primaryLine.attributes?.[FULFILMENT_KEYS.setupId];
  if (setupId) {
    return state.cart.lines.filter((line) => line.id === primaryLine.id || (line.kind === "extra" && line.attributes?.[FULFILMENT_KEYS.setupId] === setupId));
  }

  const previous = businessDetailsFromAttributes(primaryLine.attributes);
  return state.cart.lines.filter((line) => {
    if (line.id === primaryLine.id) return true;
    if (line.kind !== "extra") return false;
    const candidate = businessDetailsFromAttributes(line.attributes);
    return candidate.businessName === previous.businessName && candidate.reviewUrl === previous.reviewUrl;
  });
}

export async function updateBusinessForLine(lineId, details) {
  const primary = state.cart?.lines?.find((line) => line.id === lineId && line.kind === "primary");
  if (!primary) throw new ShopifyError("The card package could not be found in this cart.");
  const setupId = primary.attributes?.[FULFILMENT_KEYS.setupId] || businessSetupId();
  const affected = linesForBusinessSetup(primary);
  const updates = affected.map((line) => ({
    id: line.id,
    attributes: mergeFulfilmentAttributes(line.attributes, buildFulfilmentAttributes(details, {
      itemRole: line.kind === "extra" ? ITEM_ROLES.extra : ITEM_ROLES.primary,
      setupId
    }))
  }));

  setLoading(true);
  try {
    if (state.mode === "shopify") {
      const inputs = updates.map((update) => ({
        id: update.id,
        attributes: Object.entries(update.attributes).map(([key, value]) => ({ key, value: String(value) }))
      }));
      saveShopifyCart(await updateCartLines(state.cart.id, inputs));
    } else {
      updates.forEach((update) => {
        const line = state.cart.lines.find((item) => item.id === update.id);
        if (line) line.attributes = update.attributes;
      });
      persistPreviewCart();
    }
  } finally {
    setLoading(false);
  }
  return getCartState();
}

export async function removeLine(lineId) {
  setLoading(true);
  try {
    if (state.mode === "shopify") {
      saveShopifyCart(await removeCartLines(state.cart.id, [lineId]));
    } else {
      state.cart.lines = state.cart.lines.filter((line) => line.id !== lineId);
      recalculatePreviewCart(state.cart);
      persistPreviewCart();
    }
  } finally {
    setLoading(false);
  }
  return getCartState();
}

export async function applyDiscount(code = config.WELCOME_DISCOUNT_CODE) {
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) throw new ShopifyError("No discount code was provided.");

  if (!state.cart?.lines?.length) {
    storageSet(PENDING_DISCOUNT_KEY, cleanCode);
    return { pending: true, state: getCartState() };
  }

  setLoading(true);
  try {
    if (state.mode === "shopify") {
      saveShopifyCart(await updateCartDiscountCodes(state.cart.id, [cleanCode]));
      if (!state.cart.discountCodes.includes(cleanCode)) {
        throw new ShopifyError("Shopify did not accept this discount code. Confirm it is active in Shopify Admin.");
      }
    } else {
      state.cart.discountCodes = [cleanCode];
      recalculatePreviewCart(state.cart);
      persistPreviewCart();
    }
    storageRemove(PENDING_DISCOUNT_KEY);
  } finally {
    setLoading(false);
  }
  return { pending: false, state: getCartState() };
}

export const cartActions = {
  initialise: initialiseCart,
  getState: getCartState,
  getMainVariant,
  addMainPackage,
  addUpsell,
  changeLineQuantity,
  changePrimaryPackage,
  updateBusinessForLine,
  removeLine,
  applyDiscount
};

export default cartActions;
