import { describe, expect, it } from "vitest";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { ADMIN_USAGE_PAGE } from "../src/admin-usage-page";
import { handleRequest } from "../src/index";

describe("Phase 4D admin usage dashboard", () => {
  it("renders the customer and Google usage controls without embedding private values", () => {
    expect(ADMIN_USAGE_PAGE).toContain("Tapntrust Customer Analytics");
    expect(ADMIN_USAGE_PAGE).toContain("Refresh Google Data");
    expect(ADMIN_USAGE_PAGE).toContain("Show Google Reviews");
    expect(ADMIN_USAGE_PAGE).toContain("Actual Google calls");
    expect(ADMIN_USAGE_PAGE).toContain("/api/admin/usage?");
    expect(ADMIN_USAGE_PAGE).toContain("Review Opportunities");
    expect(ADMIN_USAGE_PAGE).toContain("Specific day");
    expect(ADMIN_USAGE_PAGE).not.toContain("ADMIN_API_TOKEN");
    expect(ADMIN_USAGE_PAGE).not.toContain("GOOGLE_PLACES_API_KEY");
  });

  it("serves the private analytics shell with no-store and restrictive framing policy", async () => {
    const response = await handleRequest(
      new Request("https://go.tapntrust.com/admin/usage"),
      env,
      createExecutionContext()
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain("Tapntrust Customer Analytics");
  });
});
