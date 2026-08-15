import config from "./config.js";

const CART_FRAGMENT = `
  fragment CartFields on Cart {
    id
    checkoutUrl
    totalQuantity
    discountCodes { code applicable }
    cost {
      subtotalAmount { amount currencyCode }
      totalAmount { amount currencyCode }
    }
    lines(first: 100) {
      nodes {
        id
        quantity
        attributes { key value }
        cost { totalAmount { amount currencyCode } }
        merchandise {
          ... on ProductVariant {
            id
            title
            image { url altText width height }
            price { amount currencyCode }
            product { title handle }
          }
        }
      }
    }
  }
`;

export class ShopifyError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ShopifyError";
    this.details = details;
  }
}

function storeDomain() {
  return String(config.SHOPIFY_STORE_DOMAIN || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
}

export function isShopifyConfigured() {
  const domain = storeDomain();
  const token = String(config.SHOPIFY_STOREFRONT_TOKEN || "").trim();
  return Boolean(domain && token && domain.includes("."));
}

async function storefrontRequest(query, variables = {}) {
  if (!isShopifyConfigured()) {
    throw new ShopifyError("Shopify Storefront API is not configured.");
  }

  const endpoint = `https://${storeDomain()}/api/${config.SHOPIFY_API_VERSION}/graphql.json`;
  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": config.SHOPIFY_STOREFRONT_TOKEN
      },
      body: JSON.stringify({ query, variables })
    });
  } catch (error) {
    throw new ShopifyError("We couldn't reach Shopify. Check your connection and try again.", [error]);
  }

  if (!response.ok) {
    throw new ShopifyError(`Shopify returned an unexpected response (${response.status}).`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new ShopifyError(payload.errors[0].message || "Shopify could not complete the request.", payload.errors);
  }

  return payload.data;
}

function assertMutation(result, key) {
  const payload = result?.[key];
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw new ShopifyError(errors[0].message || "Shopify could not update the cart.", errors);
  }
  const warnings = payload?.warnings || [];
  const inventoryWarning = warnings.find((warning) => [
    "MERCHANDISE_NOT_ENOUGH_STOCK",
    "MERCHANDISE_OUT_OF_STOCK"
  ].includes(warning.code));
  if (inventoryWarning) {
    throw new ShopifyError(inventoryWarning.message || "That package does not have enough Shopify inventory.", warnings);
  }
  if (!payload?.cart) {
    throw new ShopifyError("Shopify did not return a cart. Please try again.");
  }
  return payload.cart;
}

export async function fetchProductByHandle(handle) {
  const query = `
    query ProductByHandle($handle: String!) {
      product(handle: $handle) {
        id
        title
        handle
        featuredImage { url altText width height }
        variants(first: 50) {
          nodes {
            id
            title
            availableForSale
            selectedOptions { name value }
            price { amount currencyCode }
            image { url altText width height }
          }
        }
      }
    }
  `;
  const data = await storefrontRequest(query, { handle });
  if (!data.product) {
    throw new ShopifyError(`Shopify product not found for handle: ${handle}`);
  }
  return data.product;
}

export async function createCart(lines = [], discountCodes = []) {
  const mutation = `
    mutation CartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart { ...CartFields }
        userErrors { field message code }
        warnings { code message target }
      }
    }
    ${CART_FRAGMENT}
  `;
  const data = await storefrontRequest(mutation, { input: { lines, discountCodes } });
  return assertMutation(data, "cartCreate");
}

export async function fetchCart(cartId) {
  const query = `
    query Cart($id: ID!) {
      cart(id: $id) { ...CartFields }
    }
    ${CART_FRAGMENT}
  `;
  const data = await storefrontRequest(query, { id: cartId });
  return data.cart;
}

export async function addCartLines(cartId, lines) {
  const mutation = `
    mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ...CartFields }
        userErrors { field message code }
        warnings { code message target }
      }
    }
    ${CART_FRAGMENT}
  `;
  const data = await storefrontRequest(mutation, { cartId, lines });
  return assertMutation(data, "cartLinesAdd");
}

export async function updateCartLines(cartId, lines) {
  const mutation = `
    mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ...CartFields }
        userErrors { field message code }
        warnings { code message target }
      }
    }
    ${CART_FRAGMENT}
  `;
  const data = await storefrontRequest(mutation, { cartId, lines });
  return assertMutation(data, "cartLinesUpdate");
}

export async function removeCartLines(cartId, lineIds) {
  const mutation = `
    mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart { ...CartFields }
        userErrors { field message code }
        warnings { code message target }
      }
    }
    ${CART_FRAGMENT}
  `;
  const data = await storefrontRequest(mutation, { cartId, lineIds });
  return assertMutation(data, "cartLinesRemove");
}

export async function updateCartDiscountCodes(cartId, discountCodes) {
  const mutation = `
    mutation CartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]!) {
      cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
        cart { ...CartFields }
        userErrors { field message code }
        warnings { code message target }
      }
    }
    ${CART_FRAGMENT}
  `;
  const data = await storefrontRequest(mutation, { cartId, discountCodes });
  return assertMutation(data, "cartDiscountCodesUpdate");
}
