import { describe, expect, it } from "vitest";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { ADMIN_PAGE } from "../src/admin-page";
import { handleRequest } from "../src/index";

describe("Phase 4D integrated admin usage dashboard", () => {
  it("renders customer and Google usage controls inside the private admin page", () => {
    expect(ADMIN_PAGE).toContain("Customer analytics");
    expect(ADMIN_PAGE).toContain("Refresh Google Data");
    expect(ADMIN_PAGE).toContain("Show Google Reviews");
    expect(ADMIN_PAGE).toContain("Actual Google calls");
    expect(ADMIN_PAGE).toContain("/api/admin/usage?");
    expect(ADMIN_PAGE).toContain("Review Opportunities");
    expect(ADMIN_PAGE).toContain("Specific day");
    expect(ADMIN_PAGE).toContain("Card operations");
    expect(ADMIN_PAGE).not.toContain("GOOGLE_PLACES_API_KEY");
  });

  it("serves the integrated admin shell with no-store and restrictive framing policy", async () => {
    const response = await handleRequest(
      new Request("https://go.tapntrust.com/admin"),
      env,
      createExecutionContext()
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain("Customer analytics");
    expect(html).toContain("Card operations");
  });
});
