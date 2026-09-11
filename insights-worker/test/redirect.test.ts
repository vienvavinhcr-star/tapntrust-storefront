import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { handleRequest } from "../src/index";

const REVIEW_URL = "https://search.google.com/local/writereview?placeid=ChIJ-example";

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM customer_sessions"),
    env.DB.prepare("DELETE FROM auth_magic_links"),
    env.DB.prepare("DELETE FROM customer_business_access"),
    env.DB.prepare("DELETE FROM customer_users"),
    env.DB.prepare("DELETE FROM tap_events"),
    env.DB.prepare("DELETE FROM cards"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM businesses")
  ]);
}

async function seedCard({
  cardId,
  token,
  label,
  locationId = "loc_shared",
  active = 1
}: {
  cardId: string;
  token: string;
  label: string;
  locationId?: string;
  active?: number;
}): Promise<void> {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO businesses (id, name) VALUES ('biz_test', 'Test Business')
  `).run();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO locations (
      id, business_id, business_name, business_address, google_place_id, google_review_url
    ) VALUES (?1, 'biz_test', 'Test Business', 'Melbourne VIC', 'ChIJ-example', ?2)
  `).bind(locationId, REVIEW_URL).run();
  await env.DB.prepare(`
    INSERT INTO cards (id, public_token, location_id, label, placement_type, active)
    VALUES (?1, ?2, ?3, ?4, 'counter', ?5)
  `).bind(cardId, token, locationId, label, active).run();
}

async function request(path: string, init?: RequestInit): Promise<{ response: Response; context: ExecutionContext }> {
  const context = createExecutionContext();
  const response = await handleRequest(new Request(`https://go.tapntrust.com${path}`, init), env, context);
  return { response, context };
}

beforeEach(clearDatabase);

describe("Tapntrust redirect", () => {
  it("records a valid card tap and redirects to its stored Google URL", async () => {
    await seedCard({ cardId: "card_a", token: "TNT-A7K29", label: "Front counter" });

    const { response, context } = await request("/t/TNT-A7K29");
    await waitOnExecutionContext(context);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(REVIEW_URL);
    const row = await env.DB.prepare("SELECT card_id FROM tap_events").first<{ card_id: string }>();
    expect(row?.card_id).toBe("card_a");
  });

  it("tracks two cards separately when they share one destination", async () => {
    await seedCard({ cardId: "card_a", token: "TNT-A7K29", label: "Counter" });
    await seedCard({ cardId: "card_b", token: "TNT-B8M42", label: "Table" });

    const first = await request("/t/TNT-A7K29");
    const second = await request("/t/TNT-B8M42");
    await Promise.all([waitOnExecutionContext(first.context), waitOnExecutionContext(second.context)]);

    const result = await env.DB.prepare(`
      SELECT card_id, COUNT(*) AS count FROM tap_events GROUP BY card_id ORDER BY card_id
    `).all<{ card_id: string; count: number }>();
    expect(result.results).toEqual([
      { card_id: "card_a", count: 1 },
      { card_id: "card_b", count: 1 }
    ]);
  });

  it("returns the same safe response for unknown and inactive cards", async () => {
    await seedCard({ cardId: "card_off", token: "TNT-OFF55", label: "Old table", active: 0 });

    const unknown = await request("/t/TNT-NOPE5");
    const inactive = await request("/t/TNT-OFF55");

    expect(unknown.response.status).toBe(404);
    expect(inactive.response.status).toBe(404);
    expect(await unknown.response.text()).toBe(await inactive.response.text());
  });

  it("still redirects when recording the tap fails", async () => {
    const repository = {
      findCardByToken: async () => ({
        id: "card_a",
        publicToken: "TNT-A7K29",
        label: "Counter",
        placementType: "counter" as const,
        active: true,
        locationActive: true,
        googleReviewUrl: REVIEW_URL
      }),
      recordTap: async () => { throw new Error("simulated write failure"); },
      getSummary: async () => ({ monthTapCount: 0, cards: [], recentTaps: [] }),
      updateCard: async () => null
    };
    const context = createExecutionContext();
    const response = await handleRequest(
      new Request("https://go.tapntrust.com/t/TNT-A7K29"),
      env,
      context,
      repository
    );
    await waitOnExecutionContext(context);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(REVIEW_URL);
  });

  it("does not redirect to a non-Google stored URL", async () => {
    await seedCard({ cardId: "card_bad", token: "TNT-BAD55", label: "Bad destination" });
    await env.DB.prepare("UPDATE locations SET google_review_url = 'https://example.com/phish'").run();

    const { response } = await request("/t/TNT-BAD55");

    expect(response.status).toBe(404);
    expect(response.headers.get("Location")).toBeNull();
  });
});

describe("admin card labels", () => {
  it("requires the admin token", async () => {
    const { response } = await request("/api/admin/summary");
    expect(response.status).toBe(401);
  });

  it("updates label and placement without changing token or destination", async () => {
    await seedCard({ cardId: "card_a", token: "TNT-A7K29", label: "Old label" });
    const { response } = await request("/api/admin/cards/TNT-A7K29", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer test-admin-token-that-is-not-a-production-secret",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ label: "Reception desk", placementType: "reception" })
    });

    expect(response.status).toBe(200);
    const card = await env.DB.prepare(`
      SELECT c.public_token, c.label, c.placement_type, l.google_review_url
      FROM cards c JOIN locations l ON l.id = c.location_id
      WHERE c.id = 'card_a'
    `).first<{ public_token: string; label: string; placement_type: string; google_review_url: string }>();
    expect(card).toEqual({
      public_token: "TNT-A7K29",
      label: "Reception desk",
      placement_type: "reception",
      google_review_url: REVIEW_URL
    });
  });
});
