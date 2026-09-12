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
