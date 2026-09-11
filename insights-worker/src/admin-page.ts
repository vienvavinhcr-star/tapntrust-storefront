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
</head>
<body>
  <main class="shell">
    <header class="top"><div><div class="brand">Tapntrust Insights</div><div class="muted">Phase 1 · tap activity</div></div><span class="badge">Private admin</span></header>
    <section class="panel" id="login-panel">
      <h1>Open your card dashboard</h1>
      <p class="muted">Enter the admin token configured in Cloudflare. It stays in this browser tab only.</p>
      <form class="login" id="login-form"><input id="token" type="password" autocomplete="current-password" placeholder="Admin token" required><button class="button">View insights</button></form>
      <p class="error" id="login-error" hidden></p>
    </section>
    <div id="dashboard" hidden>
      <section class="panel"><div class="muted">Taps this month</div><div class="metric" id="month-count">0</div><div class="muted">Raw tap events; repeat taps are currently counted.</div></section>
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
</body>
</html>`;
