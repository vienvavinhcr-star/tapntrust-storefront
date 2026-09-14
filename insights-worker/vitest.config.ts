import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./insights-worker/wrangler.jsonc" },
      miniflare: {
        bindings: {
          ADMIN_API_TOKEN: "test-admin-token-that-is-not-a-production-secret",
          GOOGLE_PLACES_API_KEY: "test-google-places-key-not-a-production-secret",
          SHOPIFY_CLIENT_ID: "test-shopify-client-id",
          SHOPIFY_CLIENT_SECRET: "test-shopify-webhook-secret-not-for-production",
          SHOPIFY_SHOP_DOMAIN: "tapntrust-test.myshopify.com",
          SHOPIFY_ADMIN_API_VERSION: "2026-07",
          STOREFRONT_ORIGIN: "https://tapntrust.com",
          SHOPIFY_INSIGHTS_VARIANT_ID: "400000000001",
          SHOPIFY_INSIGHTS_INTRO_SELLING_PLAN_ID: "500000000001",
          SHOPIFY_INSIGHTS_STANDARD_SELLING_PLAN_ID: "500000000002",
          TEST_MIGRATIONS: await readD1Migrations("./insights-worker/migrations")
        }
      }
    }))
  ],
  test: {
    include: ["insights-worker/test/**/*.test.ts"],
    setupFiles: ["./insights-worker/test/apply-migrations.ts"]
  }
});
