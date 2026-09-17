// Owner-only customer CRM metadata. Labels do not mutate Shopify orders,
// Insights subscriptions or the active state of NFC cards.
type CrmStatus = "active" | "cancel" | "test" | "unlabelled";
type CrmSource = "shop" | "ctv" | "manual" | "unknown";

interface CrmRow {
  location_id: string;
  business_identity: string;
  customer_email: string | null;
  order_reference: string | null;
  setup_reference: string | null;
  source: CrmSource;
  status: CrmStatus | null;
}

export interface CrmLabelEntry {
  locationId: string;
  businessIdentity: string;
  customerEmail: string | null;
  orderReference: string | null;
  setupReference: string | null;
  source: CrmSource;
  status: CrmStatus;
}

function safeJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff"
  } });
}

async function listCrmLabels(db: D1Database): Promise<CrmLabelEntry[]> {
  const rows = await db.prepare(`
    WITH latest AS (
      SELECT l.id AS location_id,
        COALESCE(NULLIF(TRIM(l.google_place_id), ''), 'location:' || l.id) AS business_identity,
        (SELECT pb.id FROM provisioning_batches pb WHERE pb.location_id = l.id
          ORDER BY pb.created_at DESC, pb.id DESC LIMIT 1) AS batch_id,
        COALESCE(
          (SELECT pb.customer_email FROM provisioning_batches pb
            WHERE pb.location_id = l.id AND pb.customer_email IS NOT NULL
            ORDER BY pb.created_at DESC LIMIT 1),
          (SELECT s.billing_email FROM insights_subscriptions s
            WHERE s.location_id = l.id AND s.provider = 'shopify'
            ORDER BY s.created_at DESC LIMIT 1),
          (SELECT u.email FROM customer_business_access a
            JOIN customer_users u ON u.id = a.user_id
            WHERE a.business_id = l.business_id AND u.active = 1
            ORDER BY a.created_at ASC LIMIT 1)
        ) AS customer_email
      FROM locations l
    )
    SELECT latest.location_id, latest.business_identity,
      LOWER(TRIM(latest.customer_email)) AS customer_email,
      pb.external_order_reference AS order_reference,
      pb.external_setup_reference AS setup_reference,
      CASE WHEN pp.batch_id IS NOT NULL THEN 'ctv'
           WHEN pb.external_order_reference LIKE 'MANUAL-%' THEN 'manual'
           WHEN pb.id IS NOT NULL THEN 'shop'
           ELSE 'unknown' END AS source,
      cl.status
    FROM latest
    LEFT JOIN provisioning_batches pb ON pb.id = latest.batch_id
    LEFT JOIN partner_provisionings pp ON pp.batch_id = pb.id
    LEFT JOIN crm_customer_labels cl
      ON cl.business_identity = latest.business_identity
      AND cl.customer_email = LOWER(TRIM(latest.customer_email))
  `).all<CrmRow>();
  return rows.results.map(row => ({
    locationId: row.location_id,
    businessIdentity: row.business_identity,
    customerEmail: row.customer_email || null,
    orderReference: row.order_reference,
    setupReference: row.setup_reference,
    source: row.source,
    status: row.status || "unlabelled"
  }));
}

export async function handleAdminCrmLabelsRequest(
  request: Request, pathname: string, db: D1Database
): Promise<Response | null> {
  if (pathname !== "/api/admin/crm-labels") return null;
  if (request.method === "GET") return safeJson({ entries: await listCrmLabels(db) });
  if (request.method !== "PATCH") return safeJson({ error: "Method not allowed" }, 405);
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return safeJson({ error: "Origin not allowed" }, 403);
  }
  if (Number(request.headers.get("Content-Length") || 0) > 1024) {
    return safeJson({ error: "Request too large" }, 413);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 1024) return safeJson({ error: "Request too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return safeJson({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return safeJson({ error: "Invalid request" }, 400);
  const input = body as Record<string, unknown>;
  const locationId = typeof input.locationId === "string" ? input.locationId : "";
  const email = typeof input.customerEmail === "string" ? input.customerEmail.trim().toLowerCase() : "";
  const status = input.status;
  if (!/^[a-f0-9-]{36}$/i.test(locationId) || !email || email.length > 254
    || !["active", "cancel", "test", "unlabelled"].includes(String(status))) {
    return safeJson({ error: "Invalid customer label" }, 400);
  }
  // Re-read the current identity on the server. Never trust a client-provided
  // Place ID or attach a label to a different customer's email.
  const current = (await listCrmLabels(db)).find(row => row.locationId === locationId && row.customerEmail === email);
  if (!current) return safeJson({ error: "Customer or business changed. Refresh and try again." }, 409);
  if (status === "unlabelled") {
    await db.prepare("DELETE FROM crm_customer_labels WHERE business_identity = ?1 AND customer_email = ?2")
      .bind(current.businessIdentity, email).run();
  } else {
    await db.prepare(`
      INSERT INTO crm_customer_labels(business_identity, customer_email, status, updated_at)
      VALUES(?1, ?2, ?3, ?4)
      ON CONFLICT(business_identity, customer_email) DO UPDATE SET
        status = excluded.status, updated_at = excluded.updated_at
    `).bind(current.businessIdentity, email, status, new Date().toISOString()).run();
  }
  return safeJson({ entry: { ...current, status } });
}

const CRM_LABELS_STYLE = `<style>
.crm-identity-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.crm-origin{display:inline-flex;align-items:center;padding:4px 8px;border-radius:7px;background:#e9f1ff;color:#174c9e;font-weight:850;font-size:.67rem;letter-spacing:.02em}
.crm-origin.ctv{background:#e8f6f0;color:#11734f}.crm-origin.manual{background:#eef0f6;color:#52627c}
.crm-owner-label{display:inline-flex;align-items:center;gap:5px;font-size:.67rem;font-weight:750;color:#5a708f}
.crm-owner-label select{max-width:118px;padding:4px 6px;background:white;color:#203958;border:1px solid #cbd8e8;border-radius:7px;font:inherit;font-weight:800;cursor:pointer}
.crm-owner-label select:disabled{opacity:.55;cursor:wait}.crm-owner-label select[data-status="active"]{color:#087a47}.crm-owner-label select[data-status="cancel"]{color:#b42318}.crm-owner-label select[data-status="test"]{color:#8656bb}
.crm-identity-error{font-size:.68rem;color:#b42318}
</style>`;

const CRM_LABELS_SCRIPT = `<script>
(() => {
  const endpoint='/api/admin/crm-labels';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const token=()=>sessionStorage.getItem('tnt-admin-token')||document.querySelector('#token')?.value||'';
  let entries=[],currentBody=null,observer=null,requesting=null;
  const textLine=(cell,prefix)=>Array.from(cell.querySelectorAll('.crm-sub')).find(node=>node.textContent.trim().startsWith(prefix))?.textContent.trim().slice(prefix.length).trim()||'';
  function draw(){
    const body=document.querySelector('#crm-analytics [data-crm-body]');if(!body)return;
    for(const row of Array.from(body.children)){
      const cell=row.cells?.[0];if(!cell)continue;
      const order=textLine(cell,'Order:'),setup=textLine(cell,'Setup:');
      const email=cell.querySelector('.crm-title')?.textContent.trim().toLowerCase()||'';
      const entry=entries.find(item=>item.orderReference===order&&item.setupReference===setup&&item.customerEmail===email);
      const existing=cell.querySelector('.crm-identity-bar');
      if(!entry){existing?.remove();continue;}
      const bar=existing||document.createElement('div');bar.className='crm-identity-bar';
      bar.innerHTML='<span class="crm-origin '+esc(entry.source)+'" title="Most recent card provisioning source">'+esc(entry.source==='ctv'?'CTV':entry.source==='shop'?'Shop':entry.source==='manual'?'Manual':'Unknown')+'</span>'+
        '<label class="crm-owner-label">Status <select data-crm-status data-location="'+esc(entry.locationId)+'" data-email="'+esc(entry.customerEmail)+'" data-status="'+esc(entry.status)+'">'+
        [['unlabelled','Unlabelled'],['active','Active'],['cancel','Cancel'],['test','Test']].map(item=>'<option value="'+item[0]+'"'+(entry.status===item[0]?' selected':'')+'>'+item[1]+'</option>').join('')+'</select></label>';
      if(!existing)cell.prepend(bar);
    }
  }
  async function load(){
    if(!token()||requesting)return requesting;
    requesting=(async()=>{const result=await fetch(endpoint,{headers:{Authorization:'Bearer '+token()}});
      if(!result.ok)throw new Error('Unable to load CRM labels');const body=await result.json();entries=body.entries||[];draw();})();
    try{await requesting;}catch(error){console.warn('CRM labels could not be loaded',error);}finally{requesting=null;}
  }
  function watch(){
    const body=document.querySelector('#crm-analytics [data-crm-body]');
    if(!body||currentBody===body)return Boolean(body);
    observer?.disconnect();currentBody=body;
    observer=new MutationObserver(()=>{load();draw();});observer.observe(body,{childList:true});load();return true;
  }
  if(!watch()){
    const bootstrap=new MutationObserver(()=>{if(watch())bootstrap.disconnect()});
    bootstrap.observe(document.body,{childList:true,subtree:true});
  }
  document.addEventListener('click',event=>{
    if(event.target instanceof Element&&event.target.closest('[data-crm-refresh],[data-crm-period]')){
      entries=[];setTimeout(load,0);
    }
  });
  document.addEventListener('change',async event=>{
    const select=event.target;
    if(!(select instanceof HTMLSelectElement)||!select.matches('[data-crm-status]'))return;
    const current=entries.find(row=>row.locationId===select.dataset.location&&row.customerEmail===select.dataset.email);
    if(!current)return;
    const previous=current.status;select.disabled=true;
    const bar=select.closest('.crm-identity-bar');bar?.querySelector('.crm-identity-error')?.remove();
    try{
      const response=await fetch(endpoint,{method:'PATCH',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify({locationId:current.locationId,customerEmail:current.customerEmail,status:select.value})});
      const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Could not save status');
      entries.forEach(row=>{if(row.businessIdentity===current.businessIdentity&&row.customerEmail===current.customerEmail)row.status=data.entry.status});
      draw();
    }catch(error){select.value=previous;const message=document.createElement('div');message.className='crm-identity-error';message.textContent=error instanceof Error?error.message:'Could not save status';bar?.append(message)}finally{select.disabled=false;}
  });
})();
</script>`;

export function enhanceAdminCrmLabelsPage(page: string): string {
  return page.replace("</head>", CRM_LABELS_STYLE + "</head>")
    .replace("</body>", CRM_LABELS_SCRIPT + "</body>");
}
