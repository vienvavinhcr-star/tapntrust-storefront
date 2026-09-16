import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { hashToken, generateOpaqueToken } from "../src/auth";
import { handlePartnerAuth, currentPartner, type PartnerEnv } from "../src/partner-auth";
import { handleOwnerPartners, handlePartnerOperations } from "../src/partner-operations";
import { provisionPartnerCards, type PartnerSetupInput } from "../src/partner-provisioning";
import { PARTNER_PAGE } from "../src/partner-page";
import { handleRequest } from "../src/index";
import type { AdminPlaceSearchProvider } from "../src/admin-place-search";

const NOW = new Date("2026-09-17T02:00:00.000Z");
const ORIGIN = "https://go.tapntrust.com";
const TEST_ENV: PartnerEnv = { DB: env.DB, AUTH_BASE_URL: ORIGIN,
  AUTH_FROM_EMAIL: "partners@example.test", ZEPTOMAIL_API_KEY: "test-only", GOOGLE_PLACES_API_KEY: "test-only" };
const places: AdminPlaceSearchProvider = {
  search: async (query) => [{ placeId: "ChIJ_partner_test", name: `Test ${query}`, address: "1 Test St, Melbourne VIC" }],
  getDetails: async (id) => ({ businessName: "Partner Test Cafe", businessAddress: "1 Test St, Melbourne VIC",
    googlePlaceId: id, googleMapsUrl: "https://maps.google.com/", category: "Cafe",
    reviewUrl: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}` })
};

async function partner(allowance = 10, status = "active"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO sales_partners(id,email,name,status,tier,allowance_total,provisioned_count,provision_enabled,created_at,updated_at)
    VALUES(?1,?2,'Test Partner',?3,'silver',?4,0,1,?5,?5)`)
    .bind(id, `${id}@example.test`, status, allowance, NOW.toISOString()).run();
  return id;
}
async function authenticated(id: string): Promise<string> {
  const token = generateOpaqueToken();
  await env.DB.prepare(`INSERT INTO partner_sessions(id,partner_id,token_hash,expires_at,created_at)
    VALUES(?1,?2,?3,?4,?5)`).bind(crypto.randomUUID(),id,await hashToken(token),
      new Date(NOW.getTime() + 86_400_000).toISOString(),NOW.toISOString()).run();
  return `__Host-tnt_partner_session=${token}`;
}
function setup(count = 3, requestId = crypto.randomUUID(), placeId = "ChIJ_partner_test"): PartnerSetupInput {
  return {requestId,placeId,customerEmail:"customer@example.test",physicalCardCount:count,marketingConsent:false};
}
async function owner(path: string, method = "GET", value?: Record<string, unknown>): Promise<Response> {
  return (await handleOwnerPartners(new Request(ORIGIN + path, {method,headers:{Origin:ORIGIN,"Content-Type":"application/json"},
    ...(value ? {body:JSON.stringify(value)} : {})}),new URL(ORIGIN + path).pathname,TEST_ENV,NOW,
    async () => {})) as Response;
}
async function ctv(path: string, cookie?: string, method = "GET", value?: Record<string, unknown>): Promise<Response> {
  const request=new Request(ORIGIN+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),Origin:ORIGIN,"Content-Type":"application/json"},
    ...(value?{body:JSON.stringify(value)}:{})});
  return (await handlePartnerOperations(request,new URL(request.url).pathname,TEST_ENV,NOW,places)) as Response;
}

 describe("Partner Portal: actual D1 and scoped API behavior", () => {
  it("owner invitations default to Silver 45% and tier changes are owner-controlled", async () => {
    const response=await owner("/api/admin/partners","POST",{name:"New Sales Partner",email:`${crypto.randomUUID()}@example.test`});
    expect(response.status).toBe(201);
    const created=await response.json<{partner:{id:string;tier:string;commissionPercent:number};emailSent:boolean}>();
    expect(created.partner).toMatchObject({tier:"silver",commissionPercent:45});
    expect(created.emailSent).toBe(true);
    const upgraded=await owner(`/api/admin/partners/${created.partner.id}/tier`,"POST",{tier:"gold"});
    expect((await upgraded.json<{partner:{tier:string;commissionPercent:number}}>() ).partner)
      .toMatchObject({tier:"gold",commissionPercent:50});
    const diamond=await owner(`/api/admin/partners/${created.partner.id}/tier`,"POST",{tier:"diamond"});
    expect((await diamond.json<{partner:{tier:string;commissionPercent:number}}>() ).partner)
      .toMatchObject({tier:"diamond",commissionPercent:55});
    const history=await env.DB.prepare("SELECT COUNT(*) AS n FROM partner_tier_events WHERE partner_id=?1")
      .bind(created.partner.id).first<{n:number}>();
    expect(history?.n).toBe(2);
  });

  it("sets 10 physical cards, consumes six and adds another ten without counting sales", async () => {
    const id=await partner(0);
    const set=await owner(`/api/admin/partners/${id}/inventory`,"POST",{kind:"set",count:10,note:"Initial physical cards"});
    expect((await set.json<{partner:{remaining:number}}>() ).partner.remaining).toBe(10);
    const result=await provisionPartnerCards(env.DB,id,setup(6),()=>places.getDetails("ChIJ_partner_test","key"),NOW);
    expect(result.manifest.cards).toHaveLength(6);
    const add=await owner(`/api/admin/partners/${id}/inventory`,"POST",{kind:"add",count:10,note:"Next physical delivery"});
    expect((await add.json<{partner:{allocated:number;provisioned:number;remaining:number}}>() ).partner)
      .toMatchObject({allocated:20,provisioned:6,remaining:14});
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM partner_inventory_events WHERE partner_id=?1")
      .bind(id).first<{n:number}>())?.n).toBe(2);
  });

  it("refuses excessive quantity without creating cards and keeps the same URLs on replay", async () => {
    const id=await partner(3);
    const input=setup(3);
    const first=await provisionPartnerCards(env.DB,id,input,()=>places.getDetails(input.placeId,"key"),NOW);
    expect(first.replayed).toBe(false);
    const second=await provisionPartnerCards(env.DB,id,input,()=>places.getDetails(input.placeId,"key"),NOW);
    expect(second.replayed).toBe(true);
    expect(second.manifest.cards.map(c=>c.publicToken)).toEqual(first.manifest.cards.map(c=>c.publicToken));
    await expect(provisionPartnerCards(env.DB,id,setup(1),()=>places.getDetails(input.placeId,"key"),NOW))
      .rejects.toMatchObject({status:409});
    expect((await env.DB.prepare("SELECT provisioned_count FROM sales_partners WHERE id=?1")
      .bind(id).first<{provisioned_count:number}>())?.provisioned_count).toBe(3);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM partner_provisionings WHERE partner_id=?1")
      .bind(id).first<{n:number}>())?.n).toBe(1);
    await expect(provisionPartnerCards(env.DB,id,{...input,physicalCardCount:1},()=>places.getDetails(input.placeId,"key"),NOW))
      .rejects.toMatchObject({status:409});
  });

  it("enforces remaining allowance for simultaneous requests without partial card creation", async () => {
    const id=await partner(4);
    const attempts=await Promise.allSettled([setup(3),setup(3)].map(input=>
      provisionPartnerCards(env.DB,id,input,()=>places.getDetails(input.placeId,"key"),NOW)));
    expect(attempts.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(attempts.filter(r=>r.status==="rejected")).toHaveLength(1);
    const used=await env.DB.prepare("SELECT provisioned_count FROM sales_partners WHERE id=?1")
      .bind(id).first<{provisioned_count:number}>();
    expect(used?.provisioned_count).toBe(3);
    const cards=await env.DB.prepare(`SELECT COUNT(*) AS n FROM provisioning_batch_cards bc
      JOIN partner_provisionings pp ON pp.batch_id=bc.batch_id WHERE pp.partner_id=?1`)
      .bind(id).first<{n:number}>();
    expect(cards?.n).toBe(3);
  });

  it("uses a separate single-use email link and denies suspended partner sessions", async () => {
    const id=await partner(2,"invited");
    const email=(await env.DB.prepare("SELECT email FROM sales_partners WHERE id=?1").bind(id).first<{email:string}>())?.email as string;
    const sent:string[]=[];
    const requested=await handlePartnerAuth(new Request(ORIGIN+"/api/ctv/auth/request-link",{
      method:"POST",headers:{Origin:ORIGIN,"Content-Type":"application/json"},body:JSON.stringify({email})}),
      "/api/ctv/auth/request-link",TEST_ENV,async (_env,_email,url)=>{sent.push(url);},NOW);
    expect(requested?.status).toBe(200);
    expect(sent).toHaveLength(1);
    const secret=new URL(sent[0] as string).searchParams.get("token") as string;
    const confirm=()=>handlePartnerAuth(new Request(ORIGIN+"/ctv/auth/confirm",{
      method:"POST",headers:{Origin:ORIGIN,"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({token:secret}).toString()}),"/ctv/auth/confirm",TEST_ENV,undefined,NOW);
    const verified=await confirm();
    expect(verified?.status).toBe(303);
    const cookie=verified?.headers.get("Set-Cookie") as string;
    const me=await currentPartner(new Request(ORIGIN+"/ctv",{headers:{Cookie:cookie}}),env.DB,NOW);
    expect(me?.id).toBe(id);
    const consumed=await confirm();
    expect(consumed?.status).toBe(400);
    const suspended=await owner(`/api/admin/partners/${id}/status`,"POST",{status:"suspended"});
    expect(suspended.status).toBe(200);
    expect(await currentPartner(new Request(ORIGIN+"/ctv",{headers:{Cookie:cookie}}),env.DB,NOW)).toBeNull();
  });

  it("isolates each partner's card list and rejects owner-only API access without owner token", async () => {
    const first=await partner(3),second=await partner(3);
    const cookie=await authenticated(first);
    await provisionPartnerCards(env.DB,second,setup(2),()=>places.getDetails("ChIJ_partner_test","key"),NOW);
    const list=await ctv("/api/ctv/batches",cookie);
    expect(list.status).toBe(200);
    expect((await list.json<{batches:unknown[]}>()).batches).toHaveLength(0);
    expect((await ctv("/api/ctv/batches")).status).toBe(401);
    const admin=await handleRequest(new Request(ORIGIN+"/api/admin/partners",{headers:{Cookie:cookie}}),
      env as Parameters<typeof handleRequest>[1],{waitUntil:()=>{}} as unknown as ExecutionContext);
    expect(admin.status).toBe(401);
  });

  it("tracks actual searches, selections and successful provisions separately", async () => {
    const id=await partner(5),cookie=await authenticated(id);
    const searched=await ctv("/api/ctv/places/search?q=Partner%20Cafe",cookie);
    expect(searched.status).toBe(200);
    const selected=await ctv("/api/ctv/places/ChIJ_partner_test",cookie);
    expect(selected.status).toBe(200);
    const success=await ctv("/api/ctv/provision",cookie,"POST",setup(2));
    expect(success.status).toBe(201);
    const rejected=await ctv("/api/ctv/provision",cookie,"POST",setup(5));
    expect(rejected.status).toBe(409);
    const events=await owner(`/api/admin/partners/${id}/activity?period=all&timezoneOffsetMinutes=600`);
    const data=await events.json<{totals:{searches:number;selections:number;uniqueBusinesses:number;cardsProvisioned:number}}>();
    expect(data.totals).toEqual({searches:1,selections:1,uniqueBusinesses:1,cardsProvisioned:2});
  });

  it("renders the customer-view control and keeps partner credentials out of HTML", async () => {
    expect(PARTNER_PAGE).toContain("Customer View");
    expect(PARTNER_PAGE).toContain("localStorage.setItem(preferenceKey");
    expect(PARTNER_PAGE).toContain("customer-view [data-internal]");
    const scripts=Array.from(PARTNER_PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g),m=>m[1]||"");
    expect(scripts).toHaveLength(1);
    for(const script of scripts)expect(()=>new Function(script)).not.toThrow();
    expect(PARTNER_PAGE).not.toContain("test-admin-token-that-is-not-a-production-secret");
  });
});
