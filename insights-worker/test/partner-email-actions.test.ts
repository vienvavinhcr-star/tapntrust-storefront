import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { handleAdminEmailActionsRequest, type AdminEmailActionsEnv } from "../src/admin-email-actions";
import { buildAdminAnalyticsRange, createAdminAnalyticsRepository } from "../src/admin-analytics";
import { provisionPartnerCards } from "../src/partner-provisioning";

const ORIGIN = "https://go.tapntrust.com";
const NOW = new Date("2026-09-17T01:48:00.000Z");
const emailEnv: AdminEmailActionsEnv = {
  DB: env.DB,
  RESEND_API_KEY: "unit-test-resend-key",
  SHOPIFY_CLIENT_ID: "",
  SHOPIFY_CLIENT_SECRET: "",
  SHOPIFY_SHOP_DOMAIN: "",
  SHOPIFY_ADMIN_API_VERSION: "2026-07",
  SHOPIFY_INSIGHTS_VARIANT_ID: "test-variant"
};

async function provision(email: string) {
  const id = crypto.randomUUID();
  const placeId = `ChIJ_${crypto.randomUUID().replaceAll("-", "")}`;
  await env.DB.prepare(`INSERT INTO sales_partners(id,email,name,status,tier,allowance_total,provisioned_count,provision_enabled,created_at,updated_at)
    VALUES(?1,?2,'Email Test Partner','active','silver',10,0,1,?3,?3)`)
    .bind(id, `${id}@example.test`, NOW.toISOString()).run();
  return provisionPartnerCards(env.DB, id, {
    requestId: crypto.randomUUID(), placeId, customerEmail: email,
    physicalCardCount: 2, marketingConsent: false
  }, async () => ({
    businessName: `Partner Email Test ${id}`,
    businessAddress: "1 Test St, Melbourne VIC 3000",
    googlePlaceId: placeId,
    googleMapsUrl: "https://maps.google.com/",
    category: "Cafe",
    reviewUrl: `https://search.google.com/local/writereview?placeid=${placeId}`
  }), NOW);
}

function requestStatus(reference: string) {
  const url = `${ORIGIN}/api/admin/email-actions/status?orderReference=${encodeURIComponent(reference)}`;
  return handleAdminEmailActionsRequest(new Request(url), "/api/admin/email-actions/status", emailEnv);
}

function requestSend(reference: string, kind: "quick-guide" | "insights") {
  return handleAdminEmailActionsRequest(new Request(`${ORIGIN}/api/admin/email-actions/send`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderReference: reference, kind })
  }), "/api/admin/email-actions/send", emailEnv);
}

afterEach(() => vi.unstubAllGlobals());

describe("CTV manual provisioning: CRM email and owner Quick Guide", () => {
  it("copies the customer email to CRM and reads CTV status without querying Shopify", async () => {
    const email = `owner-test-${crypto.randomUUID()}@example.test`;
    const result = await provision(email);
    const batch = result.manifest;
    expect(batch.externalOrderReference).toMatch(/^MANUAL-CTV-/);
    const stored = await env.DB.prepare(`SELECT pb.customer_email AS crm_email, pp.customer_email AS partner_email
      FROM provisioning_batches pb JOIN partner_provisionings pp ON pp.batch_id=pb.id WHERE pb.id=?1`)
      .bind(batch.id).first<{crm_email:string;partner_email:string}>();
    expect(stored).toMatchObject({crm_email:email,partner_email:email});
    const range = buildAdminAnalyticsRange(new URL(`${ORIGIN}/api/admin/analytics?period=all`), NOW);
    const snapshot = await createAdminAnalyticsRepository(env.DB, ORIGIN).getSnapshot(range, NOW);
    expect(snapshot.locations.find(location => location.locationId === batch.locationId)?.customerEmail).toBe(email);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("CTV email status must never call Shopify"); }));
    const response = await requestStatus(batch.externalOrderReference);
    expect(response?.status).toBe(200);
    expect((await response?.json() as {status:{email:string;hasCards:boolean;cardCount:number;quickGuideSent:boolean;hasInsightsPurchase:boolean}}).status)
      .toMatchObject({email,hasCards:true,cardCount:2,quickGuideSent:false,hasInsightsPurchase:false});
  });

  it("sends a CTV Quick Guide once via Resend, saves the receipt, and never tags a Shopify order", async () => {
    const email = `quick-guide-${crypto.randomUUID()}@example.test`;
    const batch = (await provision(email)).manifest;
    const sent: Array<{url:string;to:string[];idempotencyKey:string;attachmentCount:number}> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.resend.com/emails");
      const body = JSON.parse(String(init?.body)) as {to:string[];attachments:unknown[];template:{id:string}};
      expect(body.template.id).toBe("tapntrust-order-quick-setup");
      sent.push({url:String(url),to:body.to,idempotencyKey:new Headers(init?.headers).get("Idempotency-Key") || "",attachmentCount:body.attachments.length});
      return Response.json({id:"test-email-id"});
    }));
    const first = await requestSend(batch.externalOrderReference,"quick-guide");
    expect(first?.status).toBe(200);
    expect((await first?.json() as {result:string;status:{quickGuideSent:boolean}})).toMatchObject({result:"sent",status:{quickGuideSent:true}});
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({to:[email],idempotencyKey:`admin-quick-guide/ctv/${batch.id}`,attachmentCount:2});
    const receipt = await env.DB.prepare("SELECT recipient_email FROM partner_quick_guide_sends WHERE batch_id=?1")
      .bind(batch.id).first<{recipient_email:string}>();
    expect(receipt?.recipient_email).toBe(email);
    const second = await requestSend(batch.externalOrderReference,"quick-guide");
    expect(second?.status).toBe(200);
    expect((await second?.json() as {result:string}).result).toBe("duplicate");
    expect(sent).toHaveLength(1);
    const status = await requestStatus(batch.externalOrderReference);
    expect((await status?.json() as {status:{quickGuideSent:boolean}}).status.quickGuideSent).toBe(true);
    const insights = await requestSend(batch.externalOrderReference,"insights");
    expect(insights?.status).toBe(409);
    expect(sent).toHaveLength(1);
  });
});
