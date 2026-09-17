import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { enhanceAdminCrmLabelsPage, handleAdminCrmLabelsRequest } from "../src/admin-crm-labels";
import { handleRequest } from "../src/index";

const BASE = "https://go.tapntrust.com";
const id = () => crypto.randomUUID();

async function location(placeId: string, name: string): Promise<{ businessId: string; locationId: string }> {
  const businessId = id(), locationId = id();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses(id, name) VALUES (?1, ?2)").bind(businessId, name),
    env.DB.prepare(`INSERT INTO locations(id, business_id, business_name, business_address, google_place_id, google_review_url)
      VALUES(?1, ?2, ?3, '1 Test St, Melbourne VIC', ?4, ?5)`)
      .bind(locationId, businessId, name, placeId, `https://search.google.com/local/writereview?placeid=${placeId}`)
  ]);
  return { businessId, locationId };
}

async function batch(input: {
  businessId: string; locationId: string; source: "admin_shopify" | "shopify_webhook";
  reference: string; email: string | null; at?: string;
}): Promise<string> {
  const batchId = id();
  await env.DB.prepare(`INSERT INTO provisioning_batches(
    id, source, external_order_reference, external_setup_reference, request_fingerprint,
    business_id, location_id, physical_card_count, customer_email, created_at
  ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9)`)
    .bind(batchId, input.source, input.reference, `setup-${batchId}`, id(),
      input.businessId, input.locationId, input.email, input.at || "2026-09-16T01:00:00.000Z").run();
  return batchId;
}

async function api(method = "GET", payload?: Record<string, unknown>): Promise<Response> {
  const request = new Request(`${BASE}/api/admin/crm-labels`, {
    method,
    headers: { Origin: BASE, "Content-Type": "application/json" },
    ...(payload ? { body: JSON.stringify(payload) } : {})
  });
  return (await handleAdminCrmLabelsRequest(request, "/api/admin/crm-labels", env.DB)) as Response;
}

async function entries(): Promise<Array<{
  locationId: string; businessIdentity: string; customerEmail: string | null;
  orderReference: string | null; source: string; status: string;
}>> {
  const response = await api();
  expect(response.status).toBe(200);
  const data = await response.json<{entries: Awaited<ReturnType<typeof entries>>}>();
  return data.entries;
}

async function label(locationId: string, customerEmail: string, status: string): Promise<Response> {
  return api("PATCH", {locationId, customerEmail, status});
}

describe("owner CRM source attribution and manual customer labels", () => {
  it("identifies Shopify, CTV, and owner manual sources without confusing CTV with Shopify", async () => {
    const place = `ChIJ_${id().replaceAll("-", "")}`;
    const shop = await location(place, "Shop Example");
    await batch({ ...shop, source: "admin_shopify", reference: "#5001", email: "shop@example.test" });
    const ctv = await location(`${place}_ctv`, "CTV Example");
    const partnerId = id();
    await env.DB.prepare(`INSERT INTO sales_partners(id,email,name,status,tier,allowance_total,provisioned_count,provision_enabled,created_at,updated_at)
      VALUES(?1,?2,'Test Partner','active','silver',5,0,1,'2026-09-16T00:00:00Z','2026-09-16T00:00:00Z')`)
      .bind(partnerId, `${partnerId}@example.test`).run();
    const ctvRef = `MANUAL-CTV-${partnerId}-${id()}`;
    const ctvBatch = await batch({ ...ctv, source: "admin_shopify", reference: ctvRef, email: "ctv@example.test" });
    await env.DB.prepare(`INSERT INTO partner_provisionings(batch_id,partner_id,request_id,customer_email,google_place_id,physical_card_count,created_at)
      VALUES(?1,?2,?3,'ctv@example.test',?4,1,'2026-09-16T01:00:00Z')`)
      .bind(ctvBatch, partnerId, id(), `${place}_ctv`).run();
    const manual = await location(`${place}_manual`, "Manual Example");
    await batch({ ...manual, source: "admin_shopify", reference: `MANUAL-${id()}`, email: "manual@example.test" });
    const result = await entries();
    expect(result.find(row => row.locationId === shop.locationId)?.source).toBe("shop");
    expect(result.find(row => row.locationId === ctv.locationId)?.source).toBe("ctv");
    expect(result.find(row => row.locationId === manual.locationId)?.source).toBe("manual");
    expect(result.find(row => row.locationId === ctv.locationId)?.status).toBe("unlabelled");
  });

  it("saves Active, Cancel and Test per email and verified business across repeat locations", async () => {
    const place = `ChIJ_${id().replaceAll("-", "")}`;
    const first = await location(place, "Repeat Cafe");
    const second = await location(place, "Repeat Cafe");
    await batch({ ...first, source: "admin_shopify", reference: "#5101", email: "REPEAT@example.test" });
    await batch({ ...second, source: "admin_shopify", reference: "#5102", email: "repeat@example.test" });
    expect((await label(first.locationId, "repeat@example.test", "cancel")).status).toBe(200);
    let result = await entries();
    expect(result.filter(row => [first.locationId, second.locationId].includes(row.locationId)).map(row => row.status))
      .toEqual(["cancel", "cancel"]);
    expect((await label(second.locationId, "repeat@example.test", "test")).status).toBe(200);
    result = await entries();
    expect(result.filter(row => [first.locationId, second.locationId].includes(row.locationId)).every(row => row.status === "test")).toBe(true);
    expect((await label(first.locationId, "repeat@example.test", "unlabelled")).status).toBe(200);
    result = await entries();
    expect(result.filter(row => [first.locationId, second.locationId].includes(row.locationId)).every(row => row.status === "unlabelled")).toBe(true);
  });

  it("reactivates Cancel only after a newer verified paid Shopify provision, not a CTV/manual setup", async () => {
    const place = `ChIJ_${id().replaceAll("-", "")}`;
    const first = await location(place, "Returning Cafe");
    await batch({ ...first, source: "admin_shopify", reference: "#5201", email: "return@example.test" });
    expect((await label(first.locationId, "return@example.test", "cancel")).status).toBe(200);
    const ctv = await location(place, "Returning Cafe");
    await batch({ ...ctv, source: "admin_shopify", reference: `MANUAL-CTV-${id()}-${id()}`,
      email: "return@example.test", at: "2030-01-01T00:00:00Z" });
    expect((await entries()).find(row => row.locationId === first.locationId)?.status).toBe("cancel");
    const repurchase = await location(place, "Returning Cafe");
    const repurchaseBatch = await batch({ ...repurchase, source: "admin_shopify", reference: "#5202",
      email: null, at: "2030-01-02T00:00:00Z" });
    await env.DB.prepare("UPDATE provisioning_batches SET customer_email=?1 WHERE id=?2")
      .bind("return@example.test", repurchaseBatch).run();
    expect((await entries()).find(row => row.locationId === first.locationId)?.status).toBe("active");
    expect((await label(first.locationId, "return@example.test", "test")).status).toBe(200);
    const another = await location(place, "Returning Cafe");
    const next = await batch({ ...another, source: "admin_shopify", reference: "#5203",
      email: null, at: "2031-01-02T00:00:00Z" });
    await env.DB.prepare("UPDATE provisioning_batches SET customer_email=?1 WHERE id=?2")
      .bind("return@example.test", next).run();
    expect((await entries()).find(row => row.locationId === first.locationId)?.status).toBe("test");
  });

  it("rejects forged customer identity and cross-origin changes and requires owner authentication", async () => {
    const place = `ChIJ_${id().replaceAll("-", "")}`;
    const original = await location(place, "Security Cafe");
    await batch({ ...original, source: "admin_shopify", reference: "#5301", email: "owner@example.test" });
    expect((await label(original.locationId, "other@example.test", "test")).status).toBe(409);
    expect((await label(original.locationId, "owner@example.test", "invalid")).status).toBe(400);
    const denied = (await handleAdminCrmLabelsRequest(new Request(`${BASE}/api/admin/crm-labels`, {
      method: "PATCH", headers: { Origin: "https://wrong.example", "Content-Type": "application/json" },
      body: JSON.stringify({locationId: original.locationId, customerEmail: "owner@example.test", status: "active"})
    }), "/api/admin/crm-labels", env.DB)) as Response;
    expect(denied.status).toBe(403);
    const unauthenticated = await handleRequest(new Request(`${BASE}/api/admin/crm-labels`),
      env as Parameters<typeof handleRequest>[1], {waitUntil: () => {}} as unknown as ExecutionContext);
    expect(unauthenticated.status).toBe(401);
  });

  it("injects source badge and owner label controls without modifying customer provisioning", () => {
    const page = enhanceAdminCrmLabelsPage("<html><head></head><body>Test</body></html>");
    expect(page).toContain("Shop");
    expect(page).toContain("CTV");
    expect(page).toContain("Status");
    expect(page).toContain("/api/admin/crm-labels");
    expect(page).toContain("<script>");
  });
});
