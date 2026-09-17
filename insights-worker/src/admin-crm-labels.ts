// CRM annotations are independent of Shopify payment, NFC availability and Insights billing.
export type CrmLabel = 'active' | 'cancel' | 'test';

type CrmRow = {
  location_id: string;
  email: string | null;
  order_reference: string | null;
  label: CrmLabel | null;
  last_paid_batch_id: string | null;
  latest_paid_batch_id: string | null;
  has_shop: number;
  has_ctv: number;
  has_manual: number;
};

const CRM_ROWS = `
  SELECT l.id AS location_id,
    COALESCE(
      (SELECT pb.customer_email FROM provisioning_batches pb WHERE pb.location_id=l.id AND pb.customer_email IS NOT NULL ORDER BY pb.created_at DESC, pb.id DESC LIMIT 1),
      s.billing_email,
      (SELECT u.email FROM customer_business_access a JOIN customer_users u ON u.id=a.user_id WHERE a.business_id=l.business_id AND u.active=1 ORDER BY a.created_at LIMIT 1)
    ) AS email,
    (SELECT pb.external_order_reference FROM provisioning_batches pb WHERE pb.location_id=l.id ORDER BY pb.created_at DESC, pb.id DESC LIMIT 1) AS order_reference,
    cl.status AS label, cl.last_paid_batch_id,
    (SELECT pb.id FROM provisioning_batches pb WHERE pb.location_id=l.id AND pb.source='shopify_webhook'
      AND LOWER(pb.customer_email)=LOWER(COALESCE(
        (SELECT newer.customer_email FROM provisioning_batches newer WHERE newer.location_id=l.id AND newer.customer_email IS NOT NULL ORDER BY newer.created_at DESC, newer.id DESC LIMIT 1),
        s.billing_email,
        (SELECT u.email FROM customer_business_access a JOIN customer_users u ON u.id=a.user_id WHERE a.business_id=l.business_id AND u.active=1 ORDER BY a.created_at LIMIT 1)
      )) ORDER BY pb.created_at DESC, pb.id DESC LIMIT 1) AS latest_paid_batch_id,
    EXISTS(SELECT 1 FROM provisioning_batches pb WHERE pb.location_id=l.id AND pb.source='shopify_webhook') AS has_shop,
    EXISTS(SELECT 1 FROM provisioning_batches pb JOIN partner_provisionings pp ON pp.batch_id=pb.id WHERE pb.location_id=l.id) AS has_ctv,
    EXISTS(SELECT 1 FROM provisioning_batches pb WHERE pb.location_id=l.id AND pb.source='admin_shopify'
      AND pb.external_order_reference LIKE 'MANUAL-%' AND NOT EXISTS(SELECT 1 FROM partner_provisionings pp WHERE pp.batch_id=pb.id)) AS has_manual
  FROM locations l
  LEFT JOIN insights_subscriptions s ON s.location_id=l.id AND s.provider='shopify'
  LEFT JOIN customer_crm_labels cl ON cl.location_id=l.id AND cl.customer_email=LOWER(COALESCE(
    (SELECT pb.customer_email FROM provisioning_batches pb WHERE pb.location_id=l.id AND pb.customer_email IS NOT NULL ORDER BY pb.created_at DESC, pb.id DESC LIMIT 1),
    s.billing_email,
    (SELECT u.email FROM customer_business_access a JOIN customer_users u ON u.id=a.user_id WHERE a.business_id=l.business_id AND u.active=1 ORDER BY a.created_at LIMIT 1)
  ))
`;

function response(value: unknown, status = 200): Response {
  return Response.json(value, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

function presentation(row: CrmRow) {
  const sources: string[] = [];
  if (row.has_shop) sources.push('Shop');
  if (row.has_ctv) sources.push('CTV');
  if (row.has_manual) sources.push('Manual');
  if (!sources.length) sources.push('Legacy');
  // Only a subsequent verified paid Shopify batch may revive a manually cancelled
  // CRM label. A CTV provision alone is not evidence of a paid sale.
  const revived = row.label === 'cancel' && !!row.latest_paid_batch_id &&
    row.latest_paid_batch_id !== row.last_paid_batch_id;
  return {
    locationId:row.location_id,
    orderReference:row.order_reference,
    email:row.email,
    sources,
    status:revived ? 'active' : (row.label || 'active'),
    autoReactivated:revived
  };
}

export async function handleAdminCrmLabelsRequest(request: Request, pathname: string, db: D1Database): Promise<Response | null> {
  if (pathname !== '/api/admin/customer-crm-labels') return null;
  if (request.method === 'GET') {
    const result = await db.prepare(CRM_ROWS + ' ORDER BY l.created_at DESC').all<CrmRow>();
    return response({rows:result.results.map(presentation)});
  }
  if (request.method !== 'POST') return response({error:'Method not allowed'},405);
  if (Number(request.headers.get('Content-Length') || 0) > 1024) return response({error:'Request too large'},413);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1024) return response({error:'Request too large'},413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return response({error:'Invalid request'},400);
    body = parsed as Record<string, unknown>;
  } catch {return response({error:'Invalid JSON'},400);}
  const locationId = body.locationId;
  const email = body.email;
  const status = body.status;
  if (typeof locationId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(locationId) ||
      typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      (status !== 'active' && status !== 'cancel' && status !== 'test')) {
    return response({error:'Invalid customer label'},400);
  }
  const row = await db.prepare(CRM_ROWS + ' WHERE l.id=?1 LIMIT 1').bind(locationId).first<CrmRow>();
  if (!row || !row.email || row.email.toLowerCase() !== email.trim().toLowerCase()) {
    return response({error:'Customer record changed. Refresh and try again.'},409);
  }
  await db.prepare(`INSERT INTO customer_crm_labels(location_id,customer_email,status,last_paid_batch_id,updated_at)
    VALUES(?1,?2,?3,?4,?5)
    ON CONFLICT(location_id,customer_email) DO UPDATE SET status=excluded.status,
      last_paid_batch_id=excluded.last_paid_batch_id,updated_at=excluded.updated_at`)
    .bind(row.location_id,row.email.toLowerCase(),status,row.latest_paid_batch_id,new Date().toISOString()).run();
  return response({row:presentation({...row,label:status,last_paid_batch_id:row.latest_paid_batch_id})});
}

const CRM_LABELS_STYLE = `<style>
.crm-source-status{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.crm-source-tags{display:flex;gap:4px;flex-wrap:wrap}.crm-source-tag{font-size:.65rem;font-weight:800;background:#e9f1ff;color:#164b97;border-radius:999px;padding:3px 7px}
.crm-source-tag.ctv{background:#e8f6ee;color:#166c43}.crm-source-tag.manual{background:#f1eefc;color:#6246a1}
.crm-owner-status{border:1px solid #ccd7e8;background:#fff;color:#142d50;border-radius:8px;padding:5px 7px;font:inherit;font-size:.72rem;font-weight:750;max-width:110px}
.crm-owner-status[data-status='cancel']{border-color:#e8b6b6;color:#a52b21}.crm-owner-status[data-status='test']{border-color:#d9c48c;color:#87620b}
.crm-status-note{font-size:.65rem;color:#647795;margin:3px 0 0}
</style>`;

const CRM_LABELS_SCRIPT = `<script>
(() => {
  const panel=document.querySelector('#crm-analytics');
  if(!panel || document.querySelector('#tnt-crm-labels-marker'))return;
  const marker=document.createElement('span');marker.id='tnt-crm-labels-marker';marker.hidden=true;panel.append(marker);
  const body=panel.querySelector('[data-crm-body]');
  const token=()=>sessionStorage.getItem('tnt-admin-token')||document.querySelector('#token')?.value||'';
  let rows=new Map(),loading=false;
  const clean=text=>String(text||'').trim();
  const rowReference=row=>{
    const first=row.cells[0];
    const order=Array.from(first?.querySelectorAll('.crm-sub')||[]).find(el=>clean(el.textContent).startsWith('Order:'));
    return order?clean(order.textContent).slice(6).trim():'';
  };
  async function api(method,data){const response=await fetch('/api/admin/customer-crm-labels',{
    method,headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},
    ...(data?{body:JSON.stringify(data)}:{})});
    const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Could not save label');return payload;
  }
  function decorate(){
    for(const tr of Array.from(body?.children||[])){
      if(tr.tagName!=='TR'||!tr.cells[0])continue;
      const reference=rowReference(tr),record=rows.get(reference);
      if(!record||tr.querySelector('.crm-source-status'))continue;
      const container=document.createElement('div');container.className='crm-source-status';
      const tags=document.createElement('div');tags.className='crm-source-tags';
      for(const source of record.sources){const pill=document.createElement('span');pill.className='crm-source-tag '+source.toLowerCase();pill.textContent=source;tags.append(pill);}
      const select=document.createElement('select');select.className='crm-owner-status';
      select.setAttribute('aria-label','Owner CRM status for '+(record.email||reference));
      for(const [value,label] of [['active','Active'],['cancel','Cancel'],['test','Test']]){
        const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);
      }
      select.value=record.status;select.dataset.status=record.status;
      select.addEventListener('change',async()=>{
        const next=select.value,previous=select.dataset.status;select.disabled=true;
        try{const result=await api('POST',{locationId:record.locationId,email:record.email,status:next});
          rows.set(reference,result.row);select.dataset.status=result.row.status;
        }catch(error){select.value=previous;window.alert(error.message||'Could not save label');}
        finally{select.disabled=false;}
      });
      container.append(tags,select);tr.cells[0].prepend(container);
      if(record.autoReactivated){const note=document.createElement('div');note.className='crm-status-note';note.textContent='Reactivated after a new paid Shop order';container.after(note);}
    }
  }
  async function refresh(){if(!token()||loading)return;loading=true;
    try{const data=await api('GET');rows=new Map(data.rows.filter(row=>row.orderReference).map(row=>[row.orderReference,row]));
      for(const node of body.querySelectorAll('.crm-source-status,.crm-status-note'))node.remove();decorate();
    }catch(error){console.warn('CRM labels unavailable:',error.message);}finally{loading=false;}
  }
  const observer=new MutationObserver(()=>decorate());observer.observe(body,{childList:true});
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-crm-refresh],[data-crm-period],[data-owner-tab="customers"]'))refresh();
  });
  document.addEventListener('change',event=>{if(event.target.closest('[data-crm-date]'))refresh();});
  refresh();
})();
</script>`;

export function enhanceAdminCrmLabelsPage(page: string): string {
  // A separate script is allowed by the existing owner-only inline-script CSP.
  return page.replace('</head>', CRM_LABELS_STYLE+'</head>')
    .replace('</body>', CRM_LABELS_SCRIPT+'\n</body>');
}
