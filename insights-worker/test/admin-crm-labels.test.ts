import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { handleRequest } from '../src/index';
import { handleAdminCrmLabelsRequest, enhanceAdminCrmLabelsPage } from '../src/admin-crm-labels';

const ORIGIN = 'https://go.tapntrust.com';
const NOW = '2026-09-17T01:00:00.000Z';
type Row = {locationId:string;orderReference:string;email:string;sources:string[];status:string;autoReactivated:boolean};

async function readRows(): Promise<Row[]> {
  const result = await handleAdminCrmLabelsRequest(new Request(ORIGIN+'/api/admin/customer-crm-labels'),'/api/admin/customer-crm-labels',env.DB);
  expect(result?.status).toBe(200);
  return (await result?.json() as {rows:Row[]}).rows;
}

async function mark(locationId:string,email:string,status:string): Promise<Response> {
  return (await handleAdminCrmLabelsRequest(new Request(ORIGIN+'/api/admin/customer-crm-labels',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locationId,email,status})
  }),'/api/admin/customer-crm-labels',env.DB)) as Response;
}

describe('Owner CRM source and manual customer status',()=>{
  it('keeps Shop and CTV sources separate, retains Cancel after a CTV provision, and revives only after a later verified paid Shop batch',async()=>{
    const id=crypto.randomUUID(),biz='biz-'+id,loc='loc-'+id,partner='partner-'+id;
    const first='shop1-'+id,ctv='ctv-'+id,second='shop2-'+id;
    const email='returning-'+id+'@example.test';
    await env.DB.batch([
      env.DB.prepare('INSERT INTO businesses(id,name) VALUES(?1,?2)').bind(biz,'CRM Test Business'),
      env.DB.prepare(`INSERT INTO locations(id,business_id,business_name,business_address,google_place_id,google_review_url)
        VALUES(?1,?2,'CRM Test Business','Melbourne VIC',?3,?4)`)
        .bind(loc,biz,'ChIJcrm'+id.replace(/-/g,''),'https://search.google.com/local/writereview?placeid=ChIJcrm'),
      env.DB.prepare(`INSERT INTO sales_partners(id,email,name,status,tier,allowance_total,provisioned_count,provision_enabled,created_at,updated_at)
        VALUES(?1,?2,'Partner','active','silver',5,0,1,?3,?3)`).bind(partner,'partner-'+id+'@example.test',NOW),
      env.DB.prepare(`INSERT INTO provisioning_batches(id,source,external_order_reference,external_setup_reference,request_fingerprint,business_id,location_id,physical_card_count,customer_email,created_at)
        VALUES(?1,'shopify_webhook',?2,?3,?4,?5,?6,1,?7,'2026-09-17T01:00:00.000Z')`)
        .bind(first,'#paid-'+id,'setup-first-'+id,'fp-first-'+id,biz,loc,email),
      env.DB.prepare(`INSERT INTO provisioning_batches(id,source,external_order_reference,external_setup_reference,request_fingerprint,business_id,location_id,physical_card_count,customer_email,created_at)
        VALUES(?1,'admin_shopify',?2,?2,?3,?4,?5,1,?6,'2026-09-17T02:00:00.000Z')`)
        .bind(ctv,'MANUAL-CTV-'+id,'fp-ctv-'+id,biz,loc,email),
      env.DB.prepare(`INSERT INTO partner_provisionings(batch_id,partner_id,request_id,customer_email,marketing_consent,google_place_id,physical_card_count,created_at)
        VALUES(?1,?2,?3,?4,0,'ChIJcrm',1,'2026-09-17T02:00:00.000Z')`)
        .bind(ctv,partner,'request-'+id,email)
    ]);
    const initial=(await readRows()).find(row=>row.locationId===loc);
    expect(initial).toMatchObject({email,orderReference:'MANUAL-CTV-'+id,status:'active',sources:['Shop','CTV']});
    expect((await mark(loc,email,'cancel')).status).toBe(200);
    expect((await readRows()).find(row=>row.locationId===loc)?.status).toBe('cancel');
    // A later partner provisioning for the same customer is NOT evidence of payment.
    const anotherCtv='ctv-another-'+id;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO provisioning_batches(id,source,external_order_reference,external_setup_reference,request_fingerprint,business_id,location_id,physical_card_count,customer_email,created_at)
        VALUES(?1,'admin_shopify',?2,?2,?3,?4,?5,1,?6,'2026-09-17T03:00:00.000Z')`).bind(anotherCtv,'MANUAL-CTV-another-'+id,'fp-another-'+id,biz,loc,email),
      env.DB.prepare(`INSERT INTO partner_provisionings(batch_id,partner_id,request_id,customer_email,marketing_consent,google_place_id,physical_card_count,created_at)
        VALUES(?1,?2,?3,?4,0,'ChIJcrm',1,'2026-09-17T03:00:00.000Z')`).bind(anotherCtv,partner,'request-another-'+id,email)
    ]);
    expect((await readRows()).find(row=>row.locationId===loc)?.status).toBe('cancel');
    // A new paid Shopify card order is authoritative; do not create a new customer row.
    await env.DB.prepare(`INSERT INTO provisioning_batches(id,source,external_order_reference,external_setup_reference,request_fingerprint,business_id,location_id,physical_card_count,customer_email,created_at)
      VALUES(?1,'shopify_webhook',?2,?3,?4,?5,?6,1,?7,'2026-09-17T04:00:00.000Z')`)
      .bind(second,'#repaid-'+id,'setup-second-'+id,'fp-second-'+id,biz,loc,email).run();
    const revived=(await readRows()).filter(row=>row.locationId===loc);
    expect(revived).toHaveLength(1);
    expect(revived[0]).toMatchObject({status:'active',autoReactivated:true,orderReference:'#repaid-'+id,sources:['Shop','CTV']});
    expect((await mark(loc,email,'test')).status).toBe(200);
    expect((await readRows()).find(row=>row.locationId===loc)?.status).toBe('test');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM provisioning_batches WHERE location_id=?1').bind(loc).first<{n:number}>())?.n).toBe(4);
  });

  it('rejects non-owner access, invalid labels and stale customer email; keeps existing inline script count',async()=>{
    const unauthorized=await handleRequest(new Request(ORIGIN+'/api/admin/customer-crm-labels'),
      env as Parameters<typeof handleRequest>[1],{waitUntil:()=>{}} as unknown as ExecutionContext);
    expect(unauthorized.status).toBe(401);
    expect((await mark('location-does-not-exist','test@example.test','active')).status).toBe(409);
    expect((await mark('location-does-not-exist','test@example.test','paid')).status).toBe(400);
    const html=enhanceAdminCrmLabelsPage('<html><head></head><body><script>const x=1;</script>\n</body></html>');
    expect(Array.from(html.matchAll(/<script>/g))).toHaveLength(1);
    expect(html).toContain('crm-owner-status');
  });
});
