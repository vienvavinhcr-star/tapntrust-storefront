const PARTNER_ADMIN_STYLES = `<style>
.tnt-owner-nav{display:flex;gap:8px;margin:8px 0 20px}.tnt-owner-nav button{border:1px solid #d9e3f0;background:white;color:#34506f;border-radius:12px;padding:11px 18px;font:inherit;font-weight:800;cursor:pointer}.tnt-owner-nav button.selected{background:#1769ed;border-color:#1769ed;color:#fff}.tnt-partner-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0}.tnt-partner-toolbar input,.tnt-partner-toolbar select,.tnt-partner-field input,.tnt-partner-field select{min-width:0;padding:10px;border:1px solid #d5e1f0;border-radius:10px;background:#fff;color:#10254a;font:inherit}.tnt-partner-toolbar input{flex:1 1 180px}.tnt-partner-field{display:grid;gap:6px;font-size:.82rem;font-weight:800;color:#536b88}.tnt-partner-field input,.tnt-partner-field select{width:100%}.tnt-partner-table{width:100%;border-collapse:collapse}.tnt-partner-table th,.tnt-partner-table td{padding:11px 9px;border-bottom:1px solid #e1eaf4;text-align:left;font-size:.82rem}.tnt-partner-table th{color:#71819a;font-size:.72rem}.tnt-partner-table tr:last-child td{border:0}.tnt-partner-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}.tnt-partner-stat{background:#f1f6ff;border-radius:12px;padding:12px}.tnt-partner-stat strong{font-size:1.5rem;display:block}.tnt-partner-stat small{color:#637894}.tnt-partner-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.tnt-partner-block{padding:16px;border:1px solid #dce5f2;border-radius:14px;margin-top:14px}.tnt-partner-block h3{margin:0 0 10px;font-size:.98rem}.tnt-partner-block p{font-size:.8rem;color:#647795;margin:5px 0 12px}.tnt-partner-badge{border-radius:999px;padding:4px 9px;background:#ecf5ff;color:#1556ae;font-size:.71rem;font-weight:800}.tnt-partner-empty{padding:20px;color:#647795;text-align:center}.tnt-partner-message{padding:11px 13px;border-radius:12px;background:#e8f5ed;color:#147347;margin:10px 0}.tnt-partner-message.error{background:#fff0ee;color:#a52b21}.tnt-partner-url{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid #e1eaf4}.tnt-partner-url code{overflow-wrap:anywhere;font-size:.76rem}.tnt-partner-actions{display:flex;flex-wrap:wrap;gap:8px}.tnt-partner-tiers{display:flex;gap:8px;flex-wrap:wrap}.tnt-partner-tiers button{border:1px solid #c9d8eb;border-radius:9px;background:#fff;padding:8px 13px;cursor:pointer;font-weight:800}.tnt-partner-tiers button.active{background:#e9f2ff;border-color:#1769ed;color:#1757ac}.tnt-partner-muted{color:#647795;font-size:.8rem}@media(max-width:700px){.tnt-partner-form{grid-template-columns:1fr}.tnt-partner-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.tnt-partner-table th,.tnt-partner-table td{padding:9px 5px}.tnt-partner-table td:nth-child(3),.tnt-partner-table th:nth-child(3){display:none}.tnt-owner-nav button{flex:1}.tnt-partner-toolbar input,.tnt-partner-toolbar select{width:100%;flex:1 1 100%}}
</style>`;

const PARTNER_ADMIN_SCRIPT = `<script>
(() => {
  const dashboard=document.querySelector('#dashboard');
  if(!dashboard || document.querySelector('#tnt-sales-partners'))return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ownerToken=()=>sessionStorage.getItem('tnt-admin-token')||document.querySelector('#token')?.value||'';
  const api=async(path,init={})=>{
    const response=await fetch(path,{...init,headers:{Authorization:'Bearer '+ownerToken(),'Content-Type':'application/json',...(init.headers||{})}});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Could not complete this action.');return data;
  };
  const day=value=>new Date(value).toLocaleString([], {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const stamp=value=>value?esc(day(value)):'—';
  const wrapper=document.createElement('div');wrapper.id='tnt-customers';
  Array.from(dashboard.children).forEach(node=>wrapper.append(node));
  const nav=document.createElement('nav');nav.className='tnt-owner-nav';nav.innerHTML='<button type="button" data-owner-tab="customers" class="selected">Customers</button><button type="button" data-owner-tab="partners">Sales Partners</button>';
  const partners=document.createElement('section');partners.id='tnt-sales-partners';partners.hidden=true;
  partners.innerHTML='<div class="panel"><div class="tnt-partner-toolbar"><div style="flex:1"><h2 style="margin:0">Sales Partners</h2><div class="tnt-partner-muted">Invite partners, allocate physical cards, and review their provisioning and activity.</div></div><button class="button" type="button" id="tnt-invite-toggle">+ Invite partner</button></div><form id="tnt-invite-form" class="tnt-partner-form" hidden><label class="tnt-partner-field">Full name<input name="name" maxlength="120" required></label><label class="tnt-partner-field">Email<input name="email" type="email" maxlength="254" required></label><div><button class="button" type="submit">Send invitation</button></div></form><div id="tnt-list-message" class="tnt-partner-message" hidden></div><div class="tnt-partner-toolbar"><input type="search" id="tnt-partner-search" placeholder="Search name or email"><select id="tnt-partner-status"><option value="all">All statuses</option><option value="invited">Invited</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="revoked">Revoked</option></select><select id="tnt-partner-tier"><option value="all">All tiers</option><option value="silver">Silver · 45%</option><option value="gold">Gold · 50%</option><option value="diamond">Diamond · 55%</option></select></div><div style="overflow:auto"><table class="tnt-partner-table"><thead><tr><th>Partner</th><th>Tier</th><th>Status</th><th>Allocated</th><th>Used</th><th>Remaining</th><th></th></tr></thead><tbody id="tnt-partner-list"></tbody></table></div><div class="tnt-partner-actions" style="justify-content:space-between;margin-top:12px"><span id="tnt-list-count" class="tnt-partner-muted"></span><button class="button secondary compact" id="tnt-list-more" hidden type="button">Load more</button></div></div><div class="panel" id="tnt-partner-profile" hidden></div>';
  dashboard.append(nav,wrapper,partners);
  let listPage=1,selected=null,activityPage=1,activityPeriod='7d',activitySearch='',loading=false;
  const show=(target,msg,error=false)=>{const box=document.querySelector(target);box.textContent=msg;box.className='tnt-partner-message'+(error?' error':'');box.hidden=false;};
  nav.addEventListener('click',event=>{const button=event.target.closest('[data-owner-tab]');if(!button)return;
    const on=button.dataset.ownerTab==='partners';wrapper.hidden=on;partners.hidden=!on;
    nav.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===button));
    if(on)loadList(false);
  });
  document.querySelector('#tnt-invite-toggle').addEventListener('click',()=>{const form=document.querySelector('#tnt-invite-form');form.hidden=!form.hidden});
  document.querySelector('#tnt-invite-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector('button');button.disabled=true;
    try{const data=await api('/api/admin/partners',{method:'POST',body:JSON.stringify({name:form.elements.name.value,email:form.elements.email.value})});
      show('#tnt-list-message',data.message, !data.emailSent);form.reset();form.hidden=true;await loadList(false);
    }catch(error){show('#tnt-list-message',error.message,true)}finally{button.disabled=false}
  });
  const state=()=>new URLSearchParams({search:document.querySelector('#tnt-partner-search').value.trim(),status:document.querySelector('#tnt-partner-status').value,tier:document.querySelector('#tnt-partner-tier').value,page:String(listPage),pageSize:'30'});
  async function loadList(append){if(loading)return;loading=true;if(!append)listPage=1;
    try{const data=await api('/api/admin/partners?'+state());const rows=data.partners.map(p=>'<tr><td><strong>'+esc(p.name)+'</strong><br><span class="tnt-partner-muted">'+esc(p.email)+'</span></td><td><span class="tnt-partner-badge">'+esc(p.tier)+' · '+p.commissionPercent+'%</span></td><td>'+esc(p.status)+'</td><td>'+p.allocated+'</td><td>'+p.provisioned+'</td><td>'+p.remaining+'</td><td><button type="button" class="button secondary compact" data-partner="'+esc(p.id)+'">Manage</button></td></tr>').join('');
      const body=document.querySelector('#tnt-partner-list');if(append)body.insertAdjacentHTML('beforeend',rows);else body.innerHTML=rows||'<tr><td colspan="7" class="tnt-partner-empty">No partners match your filters.</td></tr>';
      document.querySelector('#tnt-list-count').textContent='Showing '+Math.min(data.total,listPage*30)+' of '+data.total+' partners';
      document.querySelector('#tnt-list-more').hidden=listPage*30>=data.total;
    }catch(error){show('#tnt-list-message',error.message,true)}finally{loading=false}
  }
  let timer;document.querySelector('#tnt-partner-search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>loadList(false),280)});
  document.querySelectorAll('#tnt-partner-status,#tnt-partner-tier').forEach(select=>select.addEventListener('change',()=>loadList(false)));
  document.querySelector('#tnt-list-more').addEventListener('click',()=>{listPage++;loadList(true)});
  document.querySelector('#tnt-partner-list').addEventListener('click',event=>{const button=event.target.closest('[data-partner]');if(button)openPartner(button.dataset.partner)});
  function profileHtml(data){const p=data.partner;return '<div class="tnt-partner-toolbar"><button type="button" class="button secondary compact" data-close-partner>← Back to partners</button><span class="tnt-partner-badge">'+esc(p.tier)+' · '+p.commissionPercent+'%</span><span class="tnt-partner-badge">'+esc(p.status)+'</span></div><h2>'+esc(p.name)+'</h2><p class="tnt-partner-muted">'+esc(p.email)+'</p><div class="tnt-partner-stats"><div class="tnt-partner-stat"><strong>'+p.allocated+'</strong><small>Allocated</small></div><div class="tnt-partner-stat"><strong>'+p.provisioned+'</strong><small>Provisioned</small></div><div class="tnt-partner-stat"><strong>'+p.remaining+'</strong><small>Remaining</small></div><div class="tnt-partner-stat"><strong>'+p.commissionPercent+'%</strong><small>Commission tier</small></div></div>'+
    '<div class="tnt-partner-block"><h3>Membership & access</h3><p>Tier changes are decided by the owner; provisioned cards do not imply sales.</p><div class="tnt-partner-form"><label class="tnt-partner-field">Membership tier<select id="tnt-set-tier"><option value="silver" '+(p.tier==='silver'?'selected':'')+'>Silver · 45%</option><option value="gold" '+(p.tier==='gold'?'selected':'')+'>Gold · 50%</option><option value="diamond" '+(p.tier==='diamond'?'selected':'')+'>Diamond · 55%</option></select></label><label class="tnt-partner-field">Account status<select id="tnt-set-status">'+['invited','active','suspended','revoked'].map(s=>'<option value="'+s+'" '+(p.status===s?'selected':'')+'>'+s+'</option>').join('')+'</select></label></div><div class="tnt-partner-actions" style="margin-top:12px"><button class="button secondary compact" data-save-tier>Save tier</button><button class="button secondary compact" data-save-status>Save status</button><button class="button secondary compact" data-resend>Resend sign-in invitation</button><button class="button secondary compact" data-toggle-provision>'+ (p.provisionEnabled?'Pause provisioning':'Resume provisioning')+'</button></div></div>'+
    '<div class="tnt-partner-block"><h3>Physical card allowance</h3><p>Set a total or add a new physical card delivery. Neither action marks cards sold.</p><form id="tnt-inventory-form" class="tnt-partner-form"><label class="tnt-partner-field">Action<select name="kind"><option value="add">Add physical cards</option><option value="set">Set total allowance</option></select></label><label class="tnt-partner-field">Quantity<input type="number" name="count" min="1" max="100000" required></label><label class="tnt-partner-field">Internal note (optional)<input name="note" maxlength="200" placeholder="Handed over 10 cards"></label><div style="align-self:end"><button class="button" type="submit">Update allowance</button></div></form></div>'+
    '<div id="tnt-profile-message" class="tnt-partner-message" hidden></div><div class="tnt-partner-block"><h3>Provisioning history</h3><div style="overflow:auto"><table class="tnt-partner-table"><thead><tr><th>Created</th><th>Business</th><th>Customer email</th><th>Cards</th><th>Programming</th></tr></thead><tbody>'+data.batches.map(b=>'<tr><td>'+stamp(b.created_at)+'</td><td>'+esc(b.business_name)+'<br><span class="tnt-partner-muted">'+esc(b.business_address)+'</span></td><td>'+esc(b.customer_email)+'</td><td>'+b.physical_card_count+'</td><td><button type="button" class="button secondary compact" data-owner-manifest="'+esc(b.batch_id)+'">View URLs</button></td></tr><tr data-owner-manifest-row="'+esc(b.batch_id)+'" hidden><td colspan="5"></td></tr>').join('')+'</tbody></table></div>'+(data.batches.length?'':'<div class="tnt-partner-empty">No provisioning records yet.</div>')+'</div>'+
    '<div class="tnt-partner-block"><h3>Partner activity</h3><div class="tnt-partner-tiers" data-activity-periods>'+[['today','Today'],['7d','7 days'],['30d','30 days'],['all','All']].map(item=>'<button type="button" data-period="'+item[0]+'" class="'+(activityPeriod===item[0]?'active':'')+'">'+item[1]+'</button>').join('')+'</div><div class="tnt-partner-toolbar"><input id="tnt-activity-search" type="search" value="'+esc(activitySearch)+'" placeholder="Search business or action"></div><div id="tnt-activity-metrics" class="tnt-partner-stats"></div><div style="overflow:auto"><table class="tnt-partner-table"><thead><tr><th>Time</th><th>Action</th><th>Business / search</th><th>Cards</th></tr></thead><tbody id="tnt-activity-body"></tbody></table></div><div class="tnt-partner-toolbar"><span id="tnt-activity-count" class="tnt-partner-muted" style="flex:1"></span><button id="tnt-activity-more" class="button secondary compact" type="button" hidden>Load more</button></div></div>'+
    '<div class="tnt-partner-block"><h3>Inventory history</h3>'+data.inventory.map(e=>'<div class="tnt-partner-url"><span>'+esc(e.kind)+' · '+e.adjustment+' cards ('+e.previous_total+' → '+e.new_total+')<br><span class="tnt-partner-muted">'+esc(e.note)+'</span></span><small>'+stamp(e.created_at)+'</small></div>').join('')+'</div>'+
    '<div class="tnt-partner-block"><h3>Membership & account history</h3>'+data.membershipHistory.map(e=>'<div class="tnt-partner-url">'+esc(e.previous_tier)+' → '+esc(e.new_tier)+'<small>'+stamp(e.created_at)+'</small></div>').join('')+data.accountHistory.map(e=>'<div class="tnt-partner-url">'+esc(e.action)+'<small>'+stamp(e.created_at)+'</small></div>').join('')+'</div>';
  }
  async function openPartner(id){try{
    const data=await api('/api/admin/partners/'+encodeURIComponent(id));selected=data.partner;
    document.querySelector('#tnt-sales-partners > .panel').hidden=true;
    const profile=document.querySelector('#tnt-partner-profile');profile.hidden=false;profile.innerHTML=profileHtml(data);
    activityPage=1;loadActivity(false);profile.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){show('#tnt-list-message',error.message,true)}}
  async function update(path,payload){try{await api('/api/admin/partners/'+selected.id+'/'+path,{method:'POST',body:JSON.stringify(payload)});await openPartner(selected.id);await loadList(false);}
    catch(error){show('#tnt-profile-message',error.message,true)}}
  async function loadActivity(append){if(!selected)return;
    const params=new URLSearchParams({period:activityPeriod,timezoneOffsetMinutes:String(-new Date().getTimezoneOffset()),search:activitySearch,page:String(activityPage),pageSize:'30'});
    try{const data=await api('/api/admin/partners/'+selected.id+'/activity?'+params);
      document.querySelector('#tnt-activity-metrics').innerHTML=[['Searches',data.totals.searches],['Selections',data.totals.selections],['Unique businesses',data.totals.uniqueBusinesses],['Cards provisioned',data.totals.cardsProvisioned]].map(pair=>'<div class="tnt-partner-stat"><strong>'+pair[1]+'</strong><small>'+pair[0]+'</small></div>').join('');
      const rows=data.activity.map(e=>'<tr><td>'+stamp(e.created_at)+'</td><td>'+esc(e.event_type.replaceAll('_',' '))+'</td><td>'+esc(e.business_name||e.search_query||'—')+'</td><td>'+(e.physical_card_count||'—')+'</td></tr>').join('');
      const body=document.querySelector('#tnt-activity-body');if(append)body.insertAdjacentHTML('beforeend',rows);else body.innerHTML=rows||'<tr><td colspan="4" class="tnt-partner-empty">No activity for this period.</td></tr>';
      document.querySelector('#tnt-activity-count').textContent='Showing '+Math.min(data.total,activityPage*30)+' of '+data.total+' events';
      document.querySelector('#tnt-activity-more').hidden=activityPage*30>=data.total;
    }catch(error){show('#tnt-profile-message',error.message,true)}
  }
  document.querySelector('#tnt-partner-profile').addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||!selected)return;
    if(button.hasAttribute('data-close-partner')){document.querySelector('#tnt-partner-profile').hidden=true;document.querySelector('#tnt-sales-partners > .panel').hidden=false;selected=null;return;}
    if(button.hasAttribute('data-save-tier'))return update('tier',{tier:document.querySelector('#tnt-set-tier').value});
    if(button.hasAttribute('data-save-status')){const status=document.querySelector('#tnt-set-status').value;
      if(status==='revoked'&&!confirm('Revoke this partner access? Existing customer cards will continue to work.'))return;
      return update('status',{status});}
    if(button.hasAttribute('data-toggle-provision'))return update('status',{provisionEnabled:!selected.provisionEnabled});
    if(button.hasAttribute('data-resend'))return update('invite',{});
    if(button.dataset.period){activityPeriod=button.dataset.period;activityPage=1;document.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('active',b===button));return loadActivity(false)}
    if(button.id==='tnt-activity-more'){activityPage++;return loadActivity(true)}
    if(button.dataset.ownerManifest){const row=document.querySelector('[data-owner-manifest-row="'+button.dataset.ownerManifest+'"]');
      if(!row.hidden){row.hidden=true;button.textContent='View URLs';return;}
      try{const data=await api('/api/admin/provisioning/batches/'+encodeURIComponent(button.dataset.ownerManifest));
        row.querySelector('td').innerHTML=data.manifest.cards.map(card=>'<div class="tnt-partner-url"><code>'+esc(card.programmingUrl)+'</code><button type="button" class="button secondary compact" data-copy-owner="'+esc(card.programmingUrl)+'">Copy URL</button></div>').join('');
        row.hidden=false;button.textContent='Hide URLs';
      }catch(error){show('#tnt-profile-message',error.message,true)}return;}
    if(button.dataset.copyOwner){try{await navigator.clipboard.writeText(button.dataset.copyOwner);button.textContent='Copied'}catch{show('#tnt-profile-message','Could not copy URL',true)}}
  });
  document.querySelector('#tnt-partner-profile').addEventListener('submit',async event=>{
    if(event.target.id!=='tnt-inventory-form'||!selected)return;event.preventDefault();
    const form=event.target;const kind=form.elements.kind.value,count=Number(form.elements.count.value);
    if(kind==='set'&&!confirm('Set this partner’s TOTAL allowance to '+count+' cards?'))return;
    await update('inventory',{kind,count,note:form.elements.note.value});
  });
  document.querySelector('#tnt-partner-profile').addEventListener('input',event=>{
    if(event.target.id!=='tnt-activity-search')return;clearTimeout(timer);timer=setTimeout(()=>{activitySearch=event.target.value.trim();activityPage=1;loadActivity(false)},300);
  });
})();
</script>`;

export function enhanceAdminPartnersPage(page: string): string {
  return page.replace("</head>", `${PARTNER_ADMIN_STYLES}</head>`).replace("</body>", `${PARTNER_ADMIN_SCRIPT}</body>`);
}
