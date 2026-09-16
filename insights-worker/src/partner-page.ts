export const PARTNER_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Tapntrust · Partner Portal</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#10254a;background:#f3f6fc;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-height:100vh}button,input,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}a{color:#1769ed}.wrap{width:min(1120px,calc(100% - 32px));margin:auto}.topbar{background:#10264d;color:#fff;padding:17px 0}.topbar-inner{display:flex;align-items:center;justify-content:space-between;gap:16px}.logo{font-weight:900;letter-spacing:-.045em;font-size:1.35rem}.logo span{color:#82b5ff}.top-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.top-actions button{border:1px solid #5c7194;background:transparent;color:#fff;border-radius:10px;padding:8px 11px;font-size:.84rem}.top-actions button.active{background:#fff;color:#10264d}.main{padding:30px 0 70px}.hero{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.eyebrow{text-transform:uppercase;letter-spacing:.12em;color:#7b8ba5;font-size:.72rem;font-weight:800}.hero h1{margin:3px 0;font-size:clamp(1.45rem,3vw,2rem);letter-spacing:-.04em}.subtle{color:#697b96;font-size:.85rem}.layout{display:grid;grid-template-columns:200px minmax(0,1fr);gap:22px}.nav{display:grid;align-content:start;gap:7px}.nav button{border:1px solid transparent;border-radius:12px;color:#526784;text-align:left;padding:12px 14px;background:transparent;font-size:.91rem;font-weight:700}.nav button.selected{background:#e8f0ff;color:#1255c5;border-color:#c9dcfb}.content{min-width:0}.panel{background:#fff;border:1px solid #dce5f1;border-radius:18px;padding:22px;box-shadow:0 10px 28px rgba(14,37,76,.035);margin-bottom:17px}.panel h2{font-size:1.12rem;letter-spacing:-.025em;margin:0 0 6px}.panel p{margin:0 0 15px;color:#647895;font-size:.87rem}.tier{display:flex;align-items:center;justify-content:space-between;gap:16px;background:#132b58;color:#fff;border-radius:17px;padding:17px 21px;margin-bottom:16px}.tier strong{font-size:1.22rem}.tier .rate{font-size:1.85rem;letter-spacing:-.05em;font-weight:900}.tier small{color:#bed2ee;display:block}.tier.gold{background:#45351c}.tier.diamond{background:#193c62}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:17px}.stat{background:#fff;border:1px solid #dce5f1;border-radius:14px;padding:15px}.stat strong{display:block;font-size:1.65rem;letter-spacing:-.045em}.stat small{font-size:.77rem;color:#697b96}.pill{display:inline-flex;padding:4px 9px;border-radius:999px;background:#e8f6ed;color:#187548;font-size:.7rem;font-weight:800}.button{background:#1769ed;color:#fff;border:0;border-radius:10px;padding:11px 16px;font-weight:800}.button.secondary{background:#eaf1fd;color:#164f9c}.button.ghost{background:#fff;color:#1769ed;border:1px solid #bfd2f2}.button.small{padding:7px 10px;font-size:.77rem}.form{display:grid;gap:15px}.field{display:grid;gap:6px;font-size:.84rem;font-weight:750}.field input,.field select{width:100%;min-width:0;border:1px solid #cddbee;border-radius:11px;padding:12px;color:#142d55;background:#fff;outline-offset:3px}.search-results{display:grid;gap:7px}.search-results button{text-align:left;background:#fff;border:1px solid #d5e2f5;padding:11px;border-radius:10px;color:#10254a}.search-results button:hover{border-color:#1769ed;background:#f5f9ff}.search-results strong,.search-results small{display:block}.search-results small{color:#697b96}.selected-business{border:1px solid #accaf9;background:#f1f6ff;border-radius:12px;padding:15px}.selected-business strong,.selected-business span{display:block}.selected-business span{color:#596d8b;font-size:.84rem;margin:4px 0 11px}.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.row.between{justify-content:space-between}.divider{border:0;border-top:1px solid #e1e9f5;margin:10px 0}.notice{border-radius:12px;padding:12px 14px;background:#ecf6ff;color:#21568f;font-size:.84rem;margin:8px 0}.notice.error{background:#fff1ef;color:#9a271a}.notice.success{background:#eaf8ee;color:#147647}.batch{border:1px solid #dce5f1;border-radius:12px;padding:14px;margin-top:9px}.batch strong{display:block}.batch small{color:#697b96}.url-row{display:flex;gap:9px;align-items:center;justify-content:space-between;border-top:1px solid #e1e9f5;padding:10px 0}.url-row code{font-size:.77rem;overflow-wrap:anywhere;word-break:break-word;min-width:0}.empty{text-align:center;color:#697b96;padding:28px;border:1px dashed #ccdbee;border-radius:12px}.login{max-width:450px;margin:55px auto}.hidden,[hidden]{display:none!important}.customer-view [data-internal]{display:none!important}.customer-view .layout{grid-template-columns:minmax(0,1fr)}.customer-view .content{max-width:780px;margin:auto;width:100%}.customer-view .hero{display:none}.customer-view .main{padding-top:28px}.customer-view [data-section]:not([data-section="setup"]){display:none!important}
@media(max-width:800px){.layout{grid-template-columns:1fr}.nav{display:flex;gap:5px;overflow:auto;padding-bottom:4px}.nav button{white-space:nowrap;padding:9px 11px}.main{padding-top:20px}.hero{align-items:flex-start}.stats{gap:8px}.stat{padding:12px}.stat strong{font-size:1.35rem}}@media(max-width:470px){.wrap{width:calc(100% - 24px)}.panel{padding:17px}.topbar-inner{align-items:flex-start}.top-actions{justify-content:flex-end}.logo{font-size:1.05rem}.tier{padding:14px}.tier .rate{font-size:1.5rem}.url-row{align-items:flex-start;flex-direction:column}}
</style></head><body>
<header class="topbar"><div class="wrap topbar-inner"><div class="logo">Tap<span>n</span>trust <span style="font-weight:500;color:#b9d1ee;font-size:.78rem;letter-spacing:0">/ Partners</span></div><div class="top-actions"><button id="view-toggle" type="button" hidden>Customer View</button><button id="logout" type="button" hidden>Sign out</button></div></div></header>
<main class="wrap main"><section id="login" class="panel login"><div class="eyebrow">Partner access</div><h1>Welcome to Tapntrust.</h1><p>Sign in with the email address your Tapntrust manager invited.</p><form id="login-form" class="form"><label class="field">Your work email<input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label><button class="button">Send secure sign-in link</button></form><div id="login-message" class="notice" role="status" hidden></div></section>
<div id="app" hidden><div class="hero"><div><div class="eyebrow">Partner workspace</div><h1 id="greeting">Your dashboard</h1><div class="subtle">Set up cards for your customers with confidence.</div></div><button class="button" type="button" id="start-setup">+ New card setup</button></div><div class="layout"><nav class="nav" data-internal aria-label="Partner navigation"><button type="button" class="selected" data-tab="dashboard">Overview</button><button type="button" data-tab="setup">New card setup</button><button type="button" data-tab="cards">My cards</button></nav><div class="content">
<section data-section="dashboard"><div id="tier-banner" class="tier silver" data-internal><div><small>YOUR PARTNER TIER</small><strong id="tier-name">Silver Member</strong></div><div style="text-align:right"><div class="rate" id="tier-rate">45%</div><small>Commission</small></div></div><div class="stats" data-internal><div class="stat"><strong id="allocated">0</strong><small>Cards allocated</small></div><div class="stat"><strong id="provisioned">0</strong><small>Provisioned</small></div><div class="stat"><strong id="remaining">0</strong><small>Remaining</small></div></div><div class="panel"><div class="row between"><h2>Recent provisioning</h2><button class="button secondary small" type="button" data-tab="cards">View all</button></div><p>These are cards configured, not confirmed sales.</p><div id="recent-batches"></div></div></section>
<section data-section="setup" hidden><div class="panel"><div class="eyebrow">Customer setup</div><h2>Provision NFC review cards</h2><p>Find the correct Google business, confirm the customer email, then create permanent programming URLs.</p><form id="setup-form" class="form"><label class="field">Find a business on Google<input id="business-search" type="search" autocomplete="off" placeholder="Business name or suburb" minlength="3" maxlength="120"></label><div id="search-status" class="subtle" aria-live="polite">Enter at least 3 characters to search.</div><div id="search-results" class="search-results" hidden></div><div id="chosen" class="selected-business" hidden><strong id="chosen-name"></strong><span id="chosen-address"></span><button class="button secondary small" id="change-business" type="button">Change business</button></div><input type="hidden" id="place-id"><hr class="divider"><label class="field">Customer email *<input name="customerEmail" type="email" autocomplete="email" maxlength="254" placeholder="customer@business.com" required></label><label class="field">Physical NFC card quantity *<input name="physicalCardCount" type="number" min="1" max="100" value="1" required></label><label class="row" style="font-size:.8rem;color:#526784"><input type="checkbox" name="marketingConsent"> Customer agrees to receive optional product and Insights updates by email</label><label class="row" style="font-size:.85rem"><input name="confirmed" type="checkbox" required> I confirm this is the correct business and card quantity.</label><button class="button" type="submit" id="provision-button">Provision cards</button></form><div id="setup-message" class="notice" role="status" hidden></div><div id="setup-manifest" hidden></div></div></section>
<section data-section="cards" hidden><div class="panel"><div class="row between"><div><h2>My cards</h2><p>Newest provisioning batches first. Your existing programming URLs stay permanent.</p></div><button class="button secondary small" type="button" id="refresh-batches">Refresh</button></div><div id="all-batches"></div><div class="row between" style="margin-top:16px"><span class="subtle" id="batch-page"></span><button id="load-more" class="button secondary small" hidden type="button">Load more</button></div></div></section>
</div></div></div></main>
<script>
(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const app = $('#app'),login = $('#login');
  const preferenceKey = 'tnt-partner-customer-view';
  let customerView = false, me = null, chosen = null, searchTimer = 0, searchSeq = 0, setupRequestId = crypto.randomUUID(), batchPage = 1;
  try { customerView = localStorage.getItem(preferenceKey) === '1'; } catch {}
  const message = (selector,text,type='') => { const node=$(selector); node.textContent=text; node.className='notice '+type; node.hidden=false; };
  const api = async (path,opts={}) => {
    const response=await fetch(path,{credentials:'same-origin',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'The request could not be completed.');
    return data;
  };
  const date = value => new Date(value).toLocaleString([], {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const copy = async text => {if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else{const input=document.createElement('textarea');input.value=text;document.body.append(input);input.select();document.execCommand('copy');input.remove();}};
  const setView = enabled => {
    customerView=enabled;
    document.body.classList.toggle('customer-view',enabled);
    $('#view-toggle').textContent=enabled?'Exit Customer View':'Customer View';
    $('#view-toggle').classList.toggle('active',enabled);
    try{localStorage.setItem(preferenceKey,enabled?'1':'0')}catch{}
    if(enabled)showTab('setup');
  };
  function showTab(tab){
    if(customerView)tab='setup';
    document.querySelectorAll('[data-section]').forEach(section=>{section.hidden=section.dataset.section!==tab});
    document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('selected',button.dataset.tab===tab));
    if(tab==='cards')loadBatches(false);
  }
  const batchMarkup = row => '<div class="batch"><div class="row between"><div><strong>'+esc(row.business_name)+'</strong><small>'+esc(date(row.created_at))+' · '+Number(row.physical_card_count)+' cards</small></div><button type="button" class="button secondary small" data-manifest="'+esc(row.batch_id)+'">View URLs</button></div><div data-manifest-result="'+esc(row.batch_id)+'" hidden></div></div>';
  function renderManifest(manifest){
    const urls=manifest.cards.map(card=>card.programmingUrl);
    return '<div style="margin-top:12px"><div class="row between"><strong>'+urls.length+' programming URLs</strong><button class="button small ghost" type="button" data-copy="'+esc(urls.join('\\n'))+'">Copy all URLs</button></div>'+manifest.cards.map(card=>'<div class="url-row"><div><strong>'+esc(card.label)+'</strong><br><code>'+esc(card.programmingUrl)+'</code></div><button class="button small secondary" type="button" data-copy="'+esc(card.programmingUrl)+'">Copy URL</button></div>').join('')+'</div>';
  }
  async function loadMe(){
    const data=await api('/api/ctv/me');me=data.partner;
    login.hidden=true;app.hidden=false;$('#view-toggle').hidden=false;$('#logout').hidden=false;
    $('#greeting').textContent='Welcome, '+me.name.split(' ')[0];
    $('#tier-banner').className='tier '+me.tier;
    $('#tier-name').textContent=me.tier.charAt(0).toUpperCase()+me.tier.slice(1)+' Member';
    $('#tier-rate').textContent=me.commissionPercent+'%';
    $('#allocated').textContent=me.allocated;$('#provisioned').textContent=me.provisioned;$('#remaining').textContent=me.remaining;
    $('#setup-form').elements.physicalCardCount.max=String(Math.max(1,Math.min(100,me.remaining)));
    $('#recent-batches').innerHTML=data.recent.length?data.recent.map(batchMarkup).join(''):'<div class="empty">No cards provisioned yet.</div>';
    $('#provision-button').disabled=!me.provisionEnabled||me.remaining<1;
    if(!me.provisionEnabled||me.remaining<1)message('#setup-message','Provisioning is unavailable. Contact TapNTrust for more physical cards.');
    setView(customerView);
  }
  $('#login-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
    try{const data=await api('/api/ctv/auth/request-link',{method:'POST',body:JSON.stringify({email:event.target.elements.email.value})});message('#login-message',data.message,'success');}
    catch(error){message('#login-message',error.message,'error')}
    finally{button.disabled=false}
  });
  $('#view-toggle').addEventListener('click',()=>setView(!customerView));
  $('#logout').addEventListener('click',async()=>{await api('/api/ctv/auth/logout',{method:'POST',body:'{}'}).catch(()=>{});location.assign('/ctv')});
  document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>showTab(button.dataset.tab)));
  $('#start-setup').addEventListener('click',()=>showTab('setup'));
  $('#business-search').addEventListener('input',event=>{
    chosen=null;$('#place-id').value='';$('#chosen').hidden=true;
    const q=event.target.value.trim(),seq=++searchSeq;
    clearTimeout(searchTimer);$('#search-results').hidden=true;$('#search-results').replaceChildren();
    if(q.length<3){$('#search-status').textContent='Enter at least 3 characters to search.';return;}
    $('#search-status').textContent='Searching Google businesses...';
    searchTimer=setTimeout(async()=>{
      try{const data=await api('/api/ctv/places/search?q='+encodeURIComponent(q));if(seq!==searchSeq)return;
        $('#search-results').innerHTML=data.suggestions.map(item=>'<button type="button" data-place="'+esc(item.placeId)+'"><strong>'+esc(item.name)+'</strong><small>'+esc(item.address)+'</small></button>').join('');
        $('#search-status').textContent=data.suggestions.length?'Choose the exact business location.':'No results found. Try another search.';
        $('#search-results').hidden=!data.suggestions.length;
      }catch(error){if(seq===searchSeq)$('#search-status').textContent=error.message;}
    },500);
  });
  $('#search-results').addEventListener('click',async event=>{
    const button=event.target.closest('[data-place]');if(!button)return;
    $('#search-status').textContent='Verifying business...';
    try{const data=await api('/api/ctv/places/'+encodeURIComponent(button.dataset.place));
      chosen=data.business;$('#place-id').value=chosen.googlePlaceId;
      $('#chosen-name').textContent=chosen.businessName;$('#chosen-address').textContent=chosen.businessAddress;
      $('#chosen').hidden=false;$('#search-results').hidden=true;$('#business-search').hidden=true;
      $('#search-status').textContent='Business confirmed with Google.';setupRequestId=crypto.randomUUID();
    }catch(error){$('#search-status').textContent=error.message;}
  });
  $('#change-business').addEventListener('click',()=>{chosen=null;$('#place-id').value='';$('#chosen').hidden=true;$('#business-search').hidden=false;$('#business-search').value='';$('#search-status').textContent='Enter at least 3 characters to search.';$('#business-search').focus()});
  $('#setup-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!chosen){message('#setup-message','Select and confirm a Google business first.','error');return;}
    const form=event.target,button=$('#provision-button');button.disabled=true;message('#setup-message','Creating your permanent NFC programming URLs...');
    try{const data=await api('/api/ctv/provision',{method:'POST',body:JSON.stringify({requestId:setupRequestId,placeId:chosen.googlePlaceId,customerEmail:form.elements.customerEmail.value,physicalCardCount:Number(form.elements.physicalCardCount.value),marketingConsent:form.elements.marketingConsent.checked})});
      message('#setup-message',data.replayed?'Existing card setup retrieved. No additional cards were created.':'Cards provisioned successfully. Copy the URLs below.','success');
      $('#setup-manifest').innerHTML=renderManifest(data.manifest);$('#setup-manifest').hidden=false;
      await loadMe();setupRequestId=crypto.randomUUID();form.elements.confirmed.checked=false;
    }catch(error){message('#setup-message',error.message,'error')}
    finally{button.disabled=!!me&&(!me.provisionEnabled||me.remaining<1)}
  });
  async function loadBatches(append){
    if(!append)batchPage=1;
    try{const data=await api('/api/ctv/batches?page='+batchPage+'&pageSize=20');
      const output=data.batches.map(batchMarkup).join('');
      if(append)$('#all-batches').insertAdjacentHTML('beforeend',output);else $('#all-batches').innerHTML=output||'<div class="empty">You have not provisioned any cards yet.</div>';
      $('#load-more').hidden=data.batches.length<20;
      $('#batch-page').textContent='Page '+batchPage;
    }catch(error){if(!append)$('#all-batches').textContent=error.message;}
  }
  $('#refresh-batches').addEventListener('click',()=>loadBatches(false));
  $('#load-more').addEventListener('click',()=>{batchPage++;loadBatches(true)});
  document.addEventListener('click',async event=>{
    const copier=event.target.closest('[data-copy]');
    if(copier){try{await copy(copier.dataset.copy);copier.textContent='Copied';setTimeout(()=>copier.textContent=copier.dataset.copy.includes('\\n')?'Copy all URLs':'Copy URL',1400)}catch{alert('Copy failed.')}return;}
    const viewer=event.target.closest('[data-manifest]');
    if(!viewer)return;
    const root=viewer.closest('.batch')?.querySelector('[data-manifest-result]');
    if(!root)return;
    if(!root.hidden){root.hidden=true;viewer.textContent='View URLs';return;}
    try{const data=await api('/api/ctv/batches/'+encodeURIComponent(viewer.dataset.manifest));root.innerHTML=renderManifest(data.manifest);root.hidden=false;viewer.textContent='Hide URLs';}
    catch(error){root.textContent=error.message;root.hidden=false;}
  });
  loadMe().catch(()=>{login.hidden=false;app.hidden=true});
})();
</script></body></html>`;
