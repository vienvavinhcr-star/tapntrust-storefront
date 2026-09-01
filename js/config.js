/**
 * Public GitHub Pages configuration.
 * Storefront tokens are designed for browser use. Admin/private tokens are not.
 */
import "./test-mode.js?v=20260901-1";
import("./clarity-events.js?v=20260901-2").catch(() => {});

export const config = Object.freeze({
  SHOPIFY_STORE_DOMAIN: "https://iz8qif-0j.myshopify.com",
  SHOPIFY_STOREFRONT_TOKEN: "d5ece3960c932e194af79a157d7560bd",
  SHOPIFY_API_VERSION: "2026-07",
  MAIN_PRODUCT_HANDLE: "tapntrust-nfc-review-card",
  STAND_PRODUCT_HANDLE: "tapntrust-counter-stand",
  EXTRA_CARD_PRODUCT_HANDLE: "tapntrust-extra-nfc-card",
  GOOGLE_MAPS_API_KEY: "AIzaSyCOTsNKgB-NNvqfe2UFySJKE-_X4LCXFJU",
  CONSULTATION_ENDPOINT: "",
  SITE_URL: "https://tapntrust.com",
  META_PIXEL_ID: "2121538478429149",
  SUPPORT_EMAIL: "support@tapntrust.com",
  FACEBOOK_URL: "https://www.facebook.com/tapntrust.com.au/",
  INSTAGRAM_URL: "https://www.instagram.com/tapntrust.au/"
});

export default config;