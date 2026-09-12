export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Tapntrust Insights</title>
  <style>
    :root{color-scheme:light;--navy:#061a45;--blue:#1769ed;--line:#d9e3f0;--muted:#61718a;--bg:#f4f7fb}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--navy);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(1080px,calc(100% - 32px));margin:40px auto 80px}.top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:28px}.brand{font-size:1.15rem;font-weight:850;letter-spacing:-.02em}.badge{padding:6px 10px;border-radius:999px;background:#e7f0ff;color:var(--blue);font-size:.78rem;font-weight:750}.panel{background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 16px 40px rgba(6,26,69,.08);padding:24px;margin-bottom:20px}.login{display:flex;gap:10px}.login input,.edit input,.edit select{min-width:0;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit}.login input{flex:1}.button{border:0;border-radius:10px;background:var(--blue);color:#fff;padding:10px 16px;font:inherit;font-weight:750;cursor:pointer}.button.secondary{background:#edf3fc;color:var(--navy)}.metric{font-size:2.6rem;font-weight:850;letter-spacing:-.06em}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.card{border:1px solid var(--line);border-radius:16px;padding:18px}.card__head{display:flex;justify-content:space-between;gap:12px}.count{font-size:1.6rem;font-weight:850}.token{font:600 .78rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.edit{display:grid;grid-template-columns:1fr 130px auto;gap:8px;margin-top:14px}.recent{width:100%;border-collapse:collapse}.recent th,.recent td{text-align:left;padding:11px 8px;border-bottom:1px solid var(--line)}.recent th{font-size:.78rem;color:var(--muted)}[hidden]{display:none!important}.error{color:#b42318}@media(max-width:620px){.shell{margin-top:22px}.top{align-items:flex-start}.login,.edit{grid-template-columns:1fr;display:grid}.recent th:nth-child(2),.recent td:nth-child(2){display:none}}
  </style>
  <style>
    .ops-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.ops-field{display:grid;gap:6px}.ops-field span{font-size:.78rem;font-weight:800;color:var(--muted)}.ops-field input,.ops-field select{width:100%;min-width:0;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;background:#fff;color:var(--navy)}.ops-wide{grid-column:1/-1}.ops-check{display:flex;align-items:center;gap:9px}.ops-check input{width:auto}.ops-message{margin-top:14px;padding:12px 14px;border-radius:12px;background:#edf7f2;color:#087a47}.ops-message.error{background:#fff0ee;color:#b42318}.manifest{margin-top:16px;border:1px solid #bcd0f5;border-radius:14px;background:#f5f8ff;padding:16px}.manifest ol{padding-left:24px}.manifest .token{overflow-wrap:anywhere}.button.danger{background:#fff0ee;color:#b42318;border:1px solid #f4c7c2}.button:disabled{opacity:.55;cursor:wait}.ops-grid .button{align-self:end}.ops-divider{border:0;border-top:1px solid var(--line);margin:24px 0}@media(max-width:700px){.ops-grid{grid-template-columns:1fr}.ops-wide{grid-column:auto}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="top"><div><div class="brand">Tapntrust Operations</div><div class="muted">Cards, provisioning and Insights access</div></div><span class="badge">Private admin</span></header>
    <section class="panel" id="login-panel">
      <h1>Open your card dashboard</h1>
      <p class="muted">Enter the admin token configured in Cloudflare. It stays in this browser tab only.</p>
      <form class="login" id="login-form"><input id="token" type="password" autocomplete="current-password" placeholder="Admin token" required><button class="button">View insights</button></form>
      <p class="error" id="login-error" hidden></p>
    </section>
    <div id="dashboard" hidden>
      <section class="panel"><div class="muted">Taps this month</div><div class="metric" id="month-count">0</div><div class="muted">Raw tap events; repeat taps are currently counted.</div></section>
      <section class="panel">
        <h2>Provision physical NFC cards</h2>
        <p class="muted">Every card receives a permanent Tapntrust redirect URL. A reused order/setup reference must contain exactly the same provisioning details.</p>
        <form id="provision-form" class="ops-grid">
          <label class="ops-field"><span>Shopify order reference</span><input name="externalOrderReference" maxlength="160" placeholder="#1001" required></label>
          <label class="ops-field"><span>Business setup reference</span><input name="externalSetupReference" maxlength="160" placeholder="Setup ID from the order" required></label>
          <label class="ops-field"><span>Business action</span><select name="businessMode"><option value="new">Create new business</option><option value="existing">Use existing business</option></select></label>
          <label class="ops-field" data-new-business><span>New business name</span><input name="businessName" maxlength="160"></label>
          <label class="ops-field" data-existing-business hidden><span>Existing business</span><select name="businessId"></select></label>
          <label class="ops-field"><span>Location action</span><select name="locationMode"><option value="new">Create new location</option><option value="existing">Use existing location</option></select></label>
          <label class="ops-field" data-existing-location hidden><span>Existing location</span><select name="locationId"></select></label>
          <label class="ops-field" data-new-location><span>Business address</span><input name="businessAddress" maxlength="300"></label>
          <label class="ops-field" data-new-location><span>Google Place ID (optional)</span><input name="googlePlaceId" maxlength="200"></label>
          <label class="ops-field ops-wide"><span>Confirmed Google review destination</span><input name="googleReviewUrl" type="url" maxlength="2048" required></label>
          <label class="ops-field"><span>Physical NFC card quantity</span><input name="physicalCardCount" type="number" min="1" max="100" value="1" required></label>
          <label class="ops-check"><input name="activateNow" type="checkbox"> Activate Insights after provisioning</label>
          <label class="ops-field ops-wide" data-provision-email hidden><span>Confirmed Insights customer email</span><input name="customerEmail" type="email" maxlength="254"></label>
          <div class="ops-wide"><button class="button" type="submit">Provision cards</button></div>
        </form>
        <div id="provision-message" class="ops-message" role="status" hidden></div>
        <div id="manifest" class="manifest" hidden></div>
      </section>
      <section class="panel">
        <h2>Insights access</h2>
        <p class="muted">Activate an existing location later without replacing cards, tokens or historical taps.</p>
        <form id="activation-form" class="ops-grid">
          <label class="ops-field"><span>Confirmed customer email</span><input name="email" type="email" maxlength="254" required></label>
          <label class="ops-field"><span>Business</span><select name="businessId" required></select></label>
          <label class="ops-field"><span>Location</span><select name="locationId" required></select></label>
          <div><button class="button" type="submit">Activate Insights</button></div>
        </form>
        <div id="activation-message" class="ops-message" role="status" hidden></div>
        <hr class="ops-divider">
        <h3>Owner recovery tools</h3>
        <div class="grid">
          <form id="revoke-form" class="card ops-grid">
            <h3 class="ops-wide">Revoke incorrect customer access</h3>
            <label class="ops-field"><span>Customer email</span><input name="email" type="email" maxlength="254" required></label>
            <label class="ops-field"><span>Business</span><select name="businessId" required></select></label>
            <div class="ops-wide"><button class="button danger" type="submit">Revoke business access</button></div>
          </form>
          <form id="deactivate-form" class="card ops-grid">
            <h3 class="ops-wide">Deactivate location entitlement</h3>
            <label class="ops-field ops-wide"><span>Location</span><select name="locationId" required></select></label>
            <div class="ops-wide"><button class="button danger" type="submit">Deactivate Insights</button></div>
          </form>
        </div>
        <div id="recovery-message" class="ops-message" role="status" hidden></div>
      </section>
      <section class="panel"><h2>Recent provisioning</h2><div style="overflow:auto"><table class="recent"><thead><tr><th>Created</th><th>Order / setup</th><th>Business</th><th>Cards</th></tr></thead><tbody id="batches"></tbody></table></div></section>
      <section class="panel"><h2>Cards</h2><div class="grid" id="cards"></div></section>
      <section class="panel"><h2>Recent activity</h2><div style="overflow:auto"><table class="recent"><thead><tr><th>Time</th><th>Token</th><th>Placement</th></tr></thead><tbody id="recent"></tbody></table></div></section>
    </div>
  </main>
  <script>
    const form=document.querySelector('#login-form'),tokenInput=document.querySelector('#token'),errorBox=document.querySelector('#login-error'),dashboard=document.querySelector('#dashboard');
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const request=async(path,options={})=>{const token=sessionStorage.getItem('tnt-admin-token')||tokenInput.value;const response=await fetch(path,{...options,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})}});if(!response.ok)throw new Error(response.status===401?'That admin token was not accepted.':'Could not load insights.');return response.json()};
    async function load(){const data=await request('/api/admin/summary');sessionStorage.setItem('tnt-admin-token',tokenInput.value||sessionStorage.getItem('tnt-admin-token')||'');document.querySelector('#login-panel').hidden=true;dashboard.hidden=false;document.querySelector('#month-count').textContent=data.monthTapCount;document.querySelector('#cards').innerHTML=data.cards.map(card=>'<article class="card"><div class="card__head"><div><strong>'+esc(card.label)+'</strong><div class="token">'+esc(card.publicToken)+'</div><div class="muted">'+esc(card.businessName)+'</div></div><div><span class="count">'+card.monthTaps+'</span><div class="muted">this month</div></div></div><form class="edit" data-token="'+esc(card.publicToken)+'"><input name="label" maxlength="80" value="'+esc(card.label)+'" aria-label="Card label"><select name="placementType" aria-label="Placement type">'+['counter','table','reception','register','other'].map(type=>'<option value="'+type+'" '+(type===card.placementType?'selected':'')+'>'+type+'</option>').join('')+'</select><button class="button secondary">Save</button></form></article>').join('');document.querySelector('#recent').innerHTML=data.recentTaps.map(tap=>'<tr><td>'+esc(new Date(tap.tappedAt).toLocaleString())+'</td><td class="token">'+esc(tap.publicToken)+'</td><td>'+esc(tap.label)+'</td></tr>').join('')||'<tr><td colspan="3" class="muted">No taps yet.</td></tr>'}
    form.addEventListener('submit',async event=>{event.preventDefault();errorBox.hidden=true;try{await load()}catch(error){errorBox.textContent=error.message;errorBox.hidden=false}});
    document.querySelector('#cards').addEventListener('submit',async event=>{event.preventDefault();const edit=event.target;if(!(edit instanceof HTMLFormElement))return;const button=edit.querySelector('button');button.disabled=true;try{await request('/api/admin/cards/'+encodeURIComponent(edit.dataset.token),{method:'PATCH',body:JSON.stringify({label:edit.elements.label.value,placementType:edit.elements.placementType.value})});await load()}catch(error){alert(error.message)}finally{button.disabled=false}});
    if(sessionStorage.getItem('tnt-admin-token'))load().catch(()=>sessionStorage.removeItem('tnt-admin-token'));
  </script>
  <script>
    (()=>{
      const provisionForm=document.querySelector('#provision-form'),activationForm=document.querySelector('#activation-form'),revokeForm=document.querySelector('#revoke-form'),deactivateForm=document.querySelector('#deactivate-form');
      let options=[];
      const opsEsc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
      const opsRequest=async(path,init={})=>{const adminToken=sessionStorage.getItem('tnt-admin-token')||document.querySelector('#token').value;const response=await fetch(path,{...init,headers:{Authorization:'Bearer '+adminToken,'Content-Type':'application/json',...(init.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'The operation could not be completed.');return data};
      const show=(selector,text,isError=false)=>{const box=document.querySelector(selector);box.textContent=text;box.className='ops-message'+(isError?' error':'');box.hidden=false};
      const businessChoices=()=>options.map(item=>'<option value="'+opsEsc(item.id)+'">'+opsEsc(item.name)+'</option>').join('');
      const locationsFor=businessId=>(options.find(item=>item.id===businessId)?.locations||[]);
      const locationChoices=(businessId,all=false)=>(all?options.flatMap(item=>item.locations):locationsFor(businessId)).map(item=>'<option value="'+opsEsc(item.id)+'" data-url="'+opsEsc(item.googleReviewUrl)+'">'+opsEsc(item.businessName+' · '+(item.businessAddress||'No address')+' · Insights '+item.insightsStatus)+'</option>').join('');
      function syncProvisionFields(){const businessMode=provisionForm.elements.businessMode.value;if(businessMode==='new'&&provisionForm.elements.locationMode.value==='existing')provisionForm.elements.locationMode.value='new';const locationMode=provisionForm.elements.locationMode.value;document.querySelector('[data-new-business]').hidden=businessMode!=='new';document.querySelector('[data-existing-business]').hidden=businessMode!=='existing';provisionForm.elements.locationMode.querySelector('option[value="existing"]').disabled=businessMode!=='existing';document.querySelector('[data-existing-location]').hidden=locationMode!=='existing';for(const field of document.querySelectorAll('[data-new-location]'))field.hidden=locationMode==='existing';if(businessMode==='existing'){provisionForm.elements.locationId.innerHTML=locationChoices(provisionForm.elements.businessId.value);if(locationMode==='existing')provisionForm.elements.googleReviewUrl.value=provisionForm.elements.locationId.selectedOptions[0]?.dataset.url||''}}
      function syncActivationLocations(){activationForm.elements.locationId.innerHTML=locationChoices(activationForm.elements.businessId.value)}
      function fillSelectors(){const businesses=businessChoices();for(const select of document.querySelectorAll('select[name="businessId"]')){const current=select.value;select.innerHTML=businesses;if(current)select.value=current}syncProvisionFields();syncActivationLocations();deactivateForm.elements.locationId.innerHTML=locationChoices('',true)}
      async function loadOperations(){const [optionData,batchData]=await Promise.all([opsRequest('/api/admin/provisioning/options'),opsRequest('/api/admin/provisioning/batches')]);options=optionData.businesses;fillSelectors();document.querySelector('#batches').innerHTML=batchData.batches.map(batch=>'<tr><td>'+opsEsc(new Date(batch.createdAt).toLocaleString())+'</td><td>'+opsEsc(batch.externalOrderReference)+'<br><span class="token">'+opsEsc(batch.externalSetupReference)+'</span></td><td>'+opsEsc(batch.businessName)+'</td><td>'+batch.physicalCardCount+'</td></tr>').join('')||'<tr><td colspan="4" class="muted">No cards provisioned yet.</td></tr>'}
      async function refresh(){await Promise.all([loadOperations(),typeof load==='function'?load():Promise.resolve()])}
      function renderManifest(result){const manifest=result.manifest,box=document.querySelector('#manifest');box.innerHTML='<strong>'+opsEsc(manifest.businessName)+'</strong><div class="muted">'+opsEsc(manifest.externalOrderReference)+' · '+manifest.physicalCardCount+' physical cards'+(result.replayed?' · Existing manifest returned':'')+'</div><ol>'+manifest.cards.map(card=>'<li><span class="token">'+opsEsc(card.programmingUrl)+'</span></li>').join('')+'</ol>';box.hidden=false}
      document.querySelector('#login-form').addEventListener('submit',()=>loadOperations().catch(()=>undefined));
      provisionForm.elements.businessMode.addEventListener('change',syncProvisionFields);provisionForm.elements.locationMode.addEventListener('change',syncProvisionFields);provisionForm.elements.businessId.addEventListener('change',syncProvisionFields);provisionForm.elements.locationId.addEventListener('change',syncProvisionFields);activationForm.elements.businessId.addEventListener('change',syncActivationLocations);
      provisionForm.elements.activateNow.addEventListener('change',()=>{const field=document.querySelector('[data-provision-email]');field.hidden=!provisionForm.elements.activateNow.checked;provisionForm.elements.customerEmail.required=provisionForm.elements.activateNow.checked});
      provisionForm.addEventListener('submit',async event=>{event.preventDefault();const button=provisionForm.querySelector('button[type="submit"]');button.disabled=true;try{const data=Object.fromEntries(new FormData(provisionForm));data.physicalCardCount=Number(data.physicalCardCount);const result=await opsRequest('/api/admin/provisioning/batches',{method:'POST',body:JSON.stringify(data)});renderManifest(result);if(provisionForm.elements.activateNow.checked){try{await opsRequest('/api/admin/insights/activations',{method:'POST',body:JSON.stringify({email:provisionForm.elements.customerEmail.value,businessId:result.manifest.businessId,locationId:result.manifest.locationId})});show('#provision-message','Cards provisioned and Insights activated.')}catch(activationError){show('#provision-message','Cards were provisioned, but Insights activation failed: '+activationError.message,true)}}else show('#provision-message','Cards provisioned. No customer account or dashboard access was created.');await refresh()}catch(error){show('#provision-message',error.message,true)}finally{button.disabled=false}});
      activationForm.addEventListener('submit',async event=>{event.preventDefault();const button=activationForm.querySelector('button');button.disabled=true;try{await opsRequest('/api/admin/insights/activations',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(activationForm)))});show('#activation-message','Insights is active. Existing cards, tokens and historical taps were preserved.');await refresh()}catch(error){show('#activation-message',error.message,true)}finally{button.disabled=false}});
      revokeForm.addEventListener('submit',async event=>{event.preventDefault();const button=revokeForm.querySelector('button');button.disabled=true;try{await opsRequest('/api/admin/insights/access/revoke',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(revokeForm)))});show('#recovery-message','The selected customer no longer has access to this business.');await refresh()}catch(error){show('#recovery-message',error.message,true)}finally{button.disabled=false}});
      deactivateForm.addEventListener('submit',async event=>{event.preventDefault();const button=deactivateForm.querySelector('button');button.disabled=true;try{await opsRequest('/api/admin/insights/entitlements/deactivate',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(deactivateForm)))});show('#recovery-message','Insights is inactive for this location. Redirects and tap recording continue.');await refresh()}catch(error){show('#recovery-message',error.message,true)}finally{button.disabled=false}});
      if(sessionStorage.getItem('tnt-admin-token'))loadOperations().catch(()=>undefined);
    })();
  </script>
</body>
</html>`;
