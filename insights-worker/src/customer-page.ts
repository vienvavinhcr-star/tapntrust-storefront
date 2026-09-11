export const CUSTOMER_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Tapntrust Insights</title>
  <style>
    :root{color-scheme:light;--navy:#061a45;--blue:#1769ed;--sky:#eaf2ff;--line:#d7e2f1;--muted:#64748b;--bg:#f4f7fb;--green:#147a49}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#eef4ff 0,#f7f9fc 340px);color:var(--navy);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(1080px,calc(100% - 32px));margin:36px auto 80px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:28px}.brand{font-size:1.15rem;font-weight:850;letter-spacing:-.02em}.eyebrow{color:var(--blue);font-size:.75rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.panel{background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:0 18px 45px rgba(6,26,69,.08);padding:26px;margin-bottom:20px}.login{max-width:660px;margin:70px auto}.login h1{font-size:clamp(2rem,7vw,3.6rem);line-height:1.03;letter-spacing:-.055em;margin:.35em 0}.login-form{display:flex;gap:10px;margin-top:24px}.input{flex:1;min-width:0;border:1px solid #bdcce0;border-radius:12px;padding:13px 14px;font:inherit}.button{border:0;border-radius:12px;background:var(--blue);color:#fff;padding:12px 18px;font:inherit;font-weight:800;cursor:pointer}.button:disabled{opacity:.6;cursor:wait}.button.secondary{background:var(--sky);color:var(--navy)}.muted{color:var(--muted)}.success{color:var(--green);font-weight:700}.error{color:#b42318;font-weight:700}.account{display:flex;align-items:center;gap:12px}.metric{font-size:clamp(2.8rem,8vw,5rem);font-weight:900;letter-spacing:-.07em;line-height:1}.business{margin-top:22px}.business-head{display:flex;align-items:end;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);padding-bottom:14px}.business-count{font-size:1.8rem;font-weight:900}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-top:16px}.card{border:1px solid var(--line);border-radius:16px;padding:18px}.card-head{display:flex;justify-content:space-between;gap:12px}.count{font-size:1.65rem;font-weight:900}.token{font:650 .76rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.status{display:inline-block;margin-top:9px;padding:4px 8px;border-radius:999px;background:#e9f7ef;color:var(--green);font-size:.72rem;font-weight:800}.status.off{background:#f1f3f6;color:var(--muted)}.recent{width:100%;border-collapse:collapse}.recent th,.recent td{text-align:left;padding:11px 8px;border-bottom:1px solid var(--line)}.recent th{font-size:.76rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}[hidden]{display:none!important}@media(max-width:640px){.shell{margin-top:22px}.top,.business-head{align-items:flex-start}.login-form{display:grid}.account .muted{display:none}.recent th:nth-child(2),.recent td:nth-child(2){display:none}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="top"><div><div class="brand">Tapntrust Insights</div><div class="muted">Your card activity</div></div><div class="account" id="account" hidden><span class="muted" id="account-email"></span><button class="button secondary" id="logout" type="button">Sign out</button></div></header>
    <section class="panel login" id="login-panel">
      <div class="eyebrow">Passwordless sign in</div>
      <h1>See how your Tapntrust cards are being used.</h1>
      <p class="muted">Enter the email connected to your business. We will send a secure, single-use sign-in link.</p>
      <form class="login-form" id="login-form"><input class="input" id="email" type="email" autocomplete="email" maxlength="254" placeholder="you@business.com" required><button class="button" id="send-link">Email me a sign-in link</button></form>
      <p id="login-message" role="status" hidden></p>
    </section>
    <div id="dashboard" hidden>
      <section class="panel"><div class="eyebrow">This month</div><div class="metric" id="month-count">0</div><div class="muted">Raw NFC card taps across your businesses.</div></section>
      <div id="businesses"></div>
    </div>
  </main>
  <script>
    const loginPanel=document.querySelector('#login-panel'),dashboard=document.querySelector('#dashboard'),account=document.querySelector('#account'),message=document.querySelector('#login-message'),form=document.querySelector('#login-form'),button=document.querySelector('#send-link');
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const api=(path,options={})=>fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const recentRows=taps=>taps.map(tap=>'<tr><td>'+esc(new Date(tap.tappedAt).toLocaleString())+'</td><td class="token">'+esc(tap.publicToken)+'</td><td>'+esc(tap.label)+'</td></tr>').join('')||'<tr><td colspan="3" class="muted">No taps yet.</td></tr>';
    const cardMarkup=card=>'<article class="card"><div class="card-head"><div><strong>'+esc(card.label)+'</strong><div class="token">'+esc(card.publicToken)+'</div><div class="muted">'+esc(card.businessAddress)+'</div><span class="status '+(card.active?'':'off')+'">'+(card.active?'Active':'Inactive')+'</span></div><div><div class="count">'+card.monthTaps+'</div><div class="muted">this month</div></div></div><p class="muted">'+card.lifetimeTaps+' lifetime taps</p></article>';
    const businessMarkup=business=>'<section class="panel business"><div class="business-head"><div><div class="eyebrow">Business</div><h2>'+esc(business.name)+'</h2></div><div><div class="business-count">'+business.monthTapCount+'</div><div class="muted">taps this month</div></div></div><div class="grid">'+business.cards.map(cardMarkup).join('')+'</div><h3>Recent activity</h3><div style="overflow:auto"><table class="recent"><thead><tr><th>Time</th><th>Card</th><th>Placement</th></tr></thead><tbody>'+recentRows(business.recentTaps)+'</tbody></table></div></section>';
    async function load(){const response=await api('/api/customer/summary');if(response.status===401){loginPanel.hidden=false;dashboard.hidden=true;account.hidden=true;return}if(!response.ok)throw new Error('Could not load your insights.');const data=await response.json();document.querySelector('#account-email').textContent=data.email;document.querySelector('#month-count').textContent=data.monthTapCount;document.querySelector('#businesses').innerHTML=data.businesses.map(businessMarkup).join('')||'<section class="panel"><h2>No business access yet</h2><p class="muted">Contact Tapntrust Support so we can connect this account to your business.</p></section>';loginPanel.hidden=true;dashboard.hidden=false;account.hidden=false}
    form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;message.hidden=true;try{const response=await api('/api/auth/request-link',{method:'POST',body:JSON.stringify({email:document.querySelector('#email').value})});if(!response.ok)throw new Error(response.status===400?'Enter a valid email address.':'Could not request a sign-in link.');message.className='success';message.textContent='If this email has Tapntrust Insights access, a sign-in link is on its way. Check your inbox.'}catch(error){message.className='error';message.textContent=error.message}finally{message.hidden=false;button.disabled=false}});
    document.querySelector('#logout').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST'});location.assign('/app')});
    load().catch(()=>{message.className='error';message.textContent='Could not load your dashboard. Please try again.';message.hidden=false});
  </script>
</body>
</html>`;
