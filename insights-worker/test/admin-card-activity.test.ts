import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { handleAdminCardActivityRequest } from "../src/admin-card-activity";

const ORIGIN = "https://go.tapntrust.com";
const NOW = new Date("2026-09-16T02:00:00.000Z");

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tap_events"),
    env.DB.prepare("DELETE FROM cards"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM businesses")
  ]);
}

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses (id, name, created_at) VALUES (?1, ?2, ?3)")
      .bind("business-old", "Older Business", "2026-08-01T00:00:00.000Z"),
    env.DB.prepare("INSERT INTO businesses (id, name, created_at) VALUES (?1, ?2, ?3)")
      .bind("business-new", "Newest Business", "2026-09-16T00:00:00.000Z"),
    env.DB.prepare(`
      INSERT INTO locations (id, business_id, business_name, business_address, google_place_id, google_review_url, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).bind("location-old", "business-old", "Older Business", "1 Old St", "place-old", "https://search.google.com/local/writereview?placeid=old", "2026-08-01T00:00:00.000Z"),
    env.DB.prepare(`
      INSERT INTO locations (id, business_id, business_name, business_address, google_place_id, google_review_url, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).bind("location-new", "business-new", "Newest Business", "2 New St", "place-new", "https://search.google.com/local/writereview?placeid=new", "2026-09-16T00:00:00.000Z"),
    env.DB.prepare(`
      INSERT INTO cards (id, public_token, location_id, label, placement_type, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `).bind("card-old", "TNT-AAAAAAAAAAAAAAAAAAAAAAAAAA", "location-old", "Old counter", "counter", "2026-08-10T00:00:00.000Z"),
    env.DB.prepare(`
      INSERT INTO cards (id, public_token, location_id, label, placement_type, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `).bind("card-new", "TNT-BBBBBBBBBBBBBBBBBBBBBBBBBB", "location-new", "New table", "table", "2026-09-16T01:30:00.000Z"),
    env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
      .bind("tap-old", "card-old", "2026-08-20T00:00:00.000Z"),
    env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
      .bind("tap-recent", "card-new", "2026-09-16T01:45:00.000Z"),
    env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
      .bind("tap-seven", "card-old", "2026-09-12T00:00:00.000Z")
  ]);
}

async function get(path: string): Promise<Response> {
  return (await handleAdminCardActivityRequest(
    new Request(`${ORIGIN}${path}`),
    "/api/admin/card-activity",
    env.DB,
    NOW
  )) as Response;
}

beforeEach(async () => {
  await clearDatabase();
  await seed();
});

describe("admin card and activity data", () => {
  it("shows newly provisioned cards first and marks cards from the last 24 hours", async () => {
    const response = await get("/api/admin/card-activity?period=30d&sort=newest&timezoneOffsetMinutes=600");
    const payload = await response.json<{ cards: Array<{ publicToken: string; isNew: boolean; tapsInPeriod: number }> }>();

    expect(response.status).toBe(200);
    expect(payload.cards.map((card) => card.publicToken)).toEqual([
      "TNT-BBBBBBBBBBBBBBBBBBBBBBBBBB",
      "TNT-AAAAAAAAAAAAAAAAAAAAAAAAAA"
    ]);
    expect(payload.cards[0]?.isNew).toBe(true);
    expect(payload.cards[1]?.isNew).toBe(false);
    expect(payload.cards[0]?.tapsInPeriod).toBe(1);
  });

  it("filters recent activity by Today and includes business context", async () => {
    const response = await get("/api/admin/card-activity?period=today&timezoneOffsetMinutes=600&page=1&pageSize=50");
    const payload = await response.json<{
      activity: { total: number; items: Array<{ businessName: string; publicToken: string; label: string }> };
    }>();

    expect(response.status).toBe(200);
    expect(payload.activity.total).toBe(1);
    expect(payload.activity.items).toEqual([
      expect.objectContaining({
        businessName: "Newest Business",
        publicToken: "TNT-BBBBBBBBBBBBBBBBBBBBBBBBBB",
        label: "New table"
      })
    ]);
  });

  it("supports 7 day, 30 day and all activity periods plus search", async () => {
    const seven = await (await get("/api/admin/card-activity?period=7d&timezoneOffsetMinutes=600")).json<{ activity: { total: number } }>();
    const thirty = await (await get("/api/admin/card-activity?period=30d&timezoneOffsetMinutes=600")).json<{ activity: { total: number } }>();
    const all = await (await get("/api/admin/card-activity?period=all&timezoneOffsetMinutes=600")).json<{ activity: { total: number } }>();
    const searched = await (await get("/api/admin/card-activity?period=all&search=newest&timezoneOffsetMinutes=600")).json<{ cards: Array<{ businessName: string }>; activity: { total: number } }>();

    expect(seven.activity.total).toBe(2);
    expect(thirty.activity.total).toBe(2);
    expect(all.activity.total).toBe(3);
    expect(searched.cards).toHaveLength(1);
    expect(searched.cards[0]?.businessName).toBe("Newest Business");
    expect(searched.activity.total).toBe(1);
  });
});
