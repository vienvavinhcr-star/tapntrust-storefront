export const ADMIN_USAGE_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Tapntrust Customer Analytics</title>
  <style>
    :root{color-scheme:light;--navy:#061a45;--blue:#1769ed;--blue2:#0d54c8;--line:#d9e3f0;--muted:#61718a;--bg:#f4f7fb;--soft:#edf3fc;--green:#087a47;--red:#b42318;--amber:#9a6700}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--navy);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(1440px,calc(100% - 32px));margin:28px auto 70px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:22px}.brand{font-size:1.2rem;font-weight:900;letter-spacing:-.03em}.top-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.button,.link-button{border:0;border-radius:11px;background:var(--blue);color:#fff;padding:10px 14px;font:inherit;font-weight:800;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.button:hover,.link-button:hover{background:var(--blue2)}.button.secondary,.link-button.secondary{background:#fff;color:var(--navy);border:1px solid var(--line)}.button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}.panel{background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 14px 38px rgba(6,26,69,.07);padding:22px;margin-bottom:18px}.login{display:flex;gap:10px;max-width:680px}.login input,.toolbar input,.toolbar select{min-width:0;border:1px solid var(--line);border-radius:11px;padding:10px 12px;font:inherit;background:#fff;color:var(--navy)}.login input{flex:1}.muted{color:var(--muted)}.error{color:var(--red)}.toolbar{display:flex;align-items:end;justify-content:space-between;gap:14px;flex-wrap:wrap}.toolbar-group{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.field{display:grid;gap:5px}.field span{font-size:.76rem;font-weight:850;color:var(--muted)}.periods{display:flex;gap:6px;flex-wrap:wrap}.period{border:1px solid var(--line);background:#fff;color:var(--navy);padding:9px 12px;border-radius:10px;font-weight:800;cursor:pointer}.period.active{background:var(--navy);color:#fff;border-color:var(--navy)}.kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:16px 0}.kpi{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px}.kpi-label{font-size:.75rem;color:var(--muted);font-weight:800}.kpi-value{font-size:1.9rem;font-weight:900;letter-spacing:-.05em;margin-top:4px}.kpi-note{font-size:.74rem;color:var(--muted);margin-top:4px}.notice{padding:12px 14px;border-radius:13px;background:#f5f8ff;border:1px solid #cbdcf8;color:#31537d}.notice strong{color:var(--navy)}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:15px}.usage-table{width:100%;min-width:1260px;border-collapse:collapse;background:#fff}.usage-table th,.usage-table td{text-align:left;vertical-align:top;padding:12px 10px;border-bottom:1px solid var(--line)}.usage-table th{position:sticky;top:0;background:#f8faff;z-index:1;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}.usage-table tr:last-child td{border-bottom:0}.customer-name{font-weight:850}.subtle{font-size:.78rem;color:var(--muted);margin-top:2px}.pill{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:.72rem;font-weight:850}.pill.active{background:#e9f7ef;color:var(--green)}.pill.inactive{background:#fff2f0;color:var(--red)}.pill.pending{background:#fff7df;color:var(--amber)}.number-main{font-size:1.15rem;font-weight:900}.number-sub{font-size:.72rem;color:var(--muted)}.pair{display:grid;grid-template-columns:repeat(2,minmax(58px,1fr));gap:6px}.pair>div{padding:7px 8px;border:1px solid #e7edf6;border-radius:9px;background:#fbfcff}.pair-label{font-size:.66rem;text-transform:uppercase;color:var(--muted);font-weight:800}.pair-value{font-weight:900}.opp{display:grid;grid-template-columns:repeat(3,minmax(42px,1fr));gap:5px}.opp>div{text-align:center;padding:6px;border-radius:8px;background:#f7f9fd}.empty{padding:36px;text-align:center;color:var(--muted)}.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}.section-head h2{margin:0}.section-head p{margin:3px 0 0}.range-label{font-weight:800;color:var(--blue)}[hidden]{display:none!important}@media(max-width:1100px){.kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:680px){.shell{width:min(100% - 20px,1440px);margin-top:18px}.top{align-items:flex-start}.top-actions{justify-content:flex-end}.login{display:grid}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.toolbar{align-items:stretch}.toolbar-group{width:100%}.field{flex:1}.field input{width:100%}.panel{padding:16px}.kpi-value{font-size:1.55rem}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="top">
      <div><div class="brand">Tapntrust Customer Analytics</div><div class="muted">Customer activity, Review Opportunities and Google API usage</div></div>
      <div class="top-actions"><a class="link-button secondary" href="/admin">Operations</a><button class="button ghost" id="logout" type="button" hidden>Lock dashboard</button></div>
    </header>

    <section class="panel" id="login-panel">
      <h1>Open customer analytics</h1>
      <p class="muted">Use the same private admin token as the Tapntrust operations dashboard. The token stays in this browser tab only.</p>
      <form class="login" id="login-form"><input id="token" type="password" autocomplete="current-password" placeholder="Admin token" required><button class="button">View analytics</button></form>
      <p class="error" id="login-error" hidden></p>
    </section>

    <div id="analytics" hidden>
      <section class="panel">
        <div class="toolbar">
          <div>
            <div class="periods" id="periods">
              <button class="period" data-period="today" type="button">Today</button>
              <button class="period" data-period="7d" type="button">7 days</button>
              <button class="period active" data-period="30d" type="button">30 days</button>
              <button class="period" data-period="all" type="button">Lifetime</button>
            </div>
          </div>
          <div class="toolbar-group">
            <label class="field"><span>Specific day</span><input id="date-filter" type="date"></label>
            <label class="field"><span>Search customer / business</span><input id="search" type="search" placeholder="Email or business"></label>
            <button class="button secondary" id="refresh" type="button">Refresh</button>
          </div>
        </div>
        <p class="muted" style="margin-bottom:0">Showing <span class="range-label" id="range-label">30 days</span>. A button click and a real Google provider call are tracked separately.</p>
      </section>

      <div class="kpis">
        <article class="kpi"><div class="kpi-label">Customers</div><div class="kpi-value" id="kpi-customers">0</div><div class="kpi-note">Unique customer accounts</div></article>
        <article class="kpi"><div class="kpi-label">Active Insights</div><div class="kpi-value" id="kpi-active">0</div><div class="kpi-note">Active locations</div></article>
        <article class="kpi"><div class="kpi-label">Refresh clicks</div><div class="kpi-value" id="kpi-summary-clicks">0</div><div class="kpi-note">Refresh Google Data</div></article>
        <article class="kpi"><div class="kpi-label">Review clicks</div><div class="kpi-value" id="kpi-review-clicks">0</div><div class="kpi-note">Show Google Reviews</div></article>
        <article class="kpi"><div class="kpi-label">Actual Google calls</div><div class="kpi-value" id="kpi-provider">0</div><div class="kpi-note">Summary + Reviews</div></article>
        <article class="kpi"><div class="kpi-label">Rate limited</div><div class="kpi-value" id="kpi-limited">0</div><div class="kpi-note">Clicks that did not call Google</div></article>
      </div>

      <section class="panel">
        <div class="notice"><strong>Cost view:</strong> use the <strong>Actual Google calls</strong> columns when estimating Google Places cost. Click totals include blocked/rate-limited attempts and should not be treated as billable calls.</div>
      </section>

      <section class="panel">
        <div class="section-head"><div><h2>Customers</h2><p class="muted">One row per customer and business location.</p></div><div class="muted" id="result-count"></div></div>
        <div class="table-wrap">
          <table class="usage-table">
            <thead><tr><th>Customer</th><th>Business</th><th>Insights / billing</th><th>Review Opportunities</th><th>Dashboard</th><th>Refresh Google Data</th><th>Show Google Reviews</th><th>Actual API calls</th><th>Last activity</th></tr></thead>
            <tbody id="usage-body"></tbody>
          </table>
        </div>
        <div class="empty" id="empty" hidden>No customers match this view.</div>
      </section>
    </div>
  </main>

  <script>
    (()=>{
      const loginPanel=document.querySelector('#login-panel');
      const loginForm=document.querySelector('#login-form');
      const tokenInput=document.querySelector('#token');
      const loginError=document.querySelector('#login-error');
      const analytics=document.querySelector('#analytics');
      const logout=document.querySelector('#logout');
      const dateFilter=document.querySelector('#date-filter');
      const search=document.querySelector('#search');
      const body=document.querySelector('#usage-body');
      const empty=document.querySelector('#empty');
      const resultCount=document.querySelector('#result-count');
      let selectedPeriod='30d';
      let snapshot=null;

      const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
      const number=value=>new Intl.NumberFormat('en-AU').format(Number(value||0));
      const dateTime=value=>value?new Date(value).toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'}):'—';
      const money=(minor,currency)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:currency||'AUD'}).format(Number(minor||0)/100);
      const token=()=>sessionStorage.getItem('tnt-admin-token')||tokenInput.value;

      async function api(path){
        const response=await fetch(path,{headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'}});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(response.status===401?'That admin token was not accepted.':(data.error||'Could not load customer analytics.'));
        return data;
      }

      function pill(status){
        const normalized=String(status||'not_configured').toLowerCase();
        const cls=normalized==='active'?'active':(normalized==='inactive'||normalized==='expired'||normalized==='cancelled'?'inactive':'pending');
        return '<span class="pill '+cls+'">'+esc(String(status||'Not configured').replaceAll('_',' '))+'</span>';
      }

      function billing(customer){
        if(!customer.subscription)return '<div class="subtle">No Shopify subscription</div>';
        const sub=customer.subscription;
        return '<div class="subtle">'+esc(sub.planCode)+' · '+esc(money(sub.expectedRecurringPriceMinor,sub.currency))+'/month</div><div class="subtle">Billing: '+pill(sub.status)+'</div>';
      }

      function matches(customer,query){
        if(!query)return true;
        const haystack=[customer.email,customer.nickname,customer.businessName,customer.locationName,customer.businessAddress].join(' ').toLowerCase();
        return haystack.includes(query.toLowerCase());
      }

      function renderRows(){
        if(!snapshot)return;
        const query=search.value.trim();
        const rows=snapshot.customers.filter(customer=>matches(customer,query));
        resultCount.textContent=number(rows.length)+' rows';
        empty.hidden=rows.length!==0;
        document.querySelector('.table-wrap').hidden=rows.length===0;
        body.innerHTML=rows.map(customer=>{
          const u=customer.usage;
          const last=customer.lastUsageAt||customer.lastDashboardActivityAt;
          return '<tr>'+
            '<td><div class="customer-name">'+esc(customer.nickname||customer.email)+'</div><div class="subtle">'+esc(customer.email)+'</div><div class="subtle">Since '+esc(new Date(customer.customerSince).toLocaleDateString('en-AU'))+'</div></td>'+
            '<td><div class="customer-name">'+esc(customer.businessName)+'</div><div class="subtle">'+esc(customer.businessAddress||customer.locationName)+'</div><div class="subtle">'+number(customer.cardCount)+' card'+(customer.cardCount===1?'':'s')+'</div></td>'+
            '<td>'+pill(customer.insightsStatus)+billing(customer)+'</td>'+
            '<td><div class="opp"><div><div class="pair-label">7d</div><div class="pair-value">'+number(customer.reviewOpportunities.sevenDays)+'</div></div><div><div class="pair-label">30d</div><div class="pair-value">'+number(customer.reviewOpportunities.thirtyDays)+'</div></div><div><div class="pair-label">Life</div><div class="pair-value">'+number(customer.reviewOpportunities.lifetime)+'</div></div></div></td>'+
            '<td><div class="number-main">'+number(u.dashboardOpens)+'</div><div class="number-sub">opens in range</div></td>'+
            '<td><div class="pair"><div><div class="pair-label">Clicks</div><div class="pair-value">'+number(u.googleSummaryClicks)+'</div></div><div><div class="pair-label">Calls</div><div class="pair-value">'+number(u.googleSummaryProviderCalls)+'</div></div></div></td>'+
            '<td><div class="pair"><div><div class="pair-label">Clicks</div><div class="pair-value">'+number(u.googleReviewsClicks)+'</div></div><div><div class="pair-label">Calls</div><div class="pair-value">'+number(u.googleReviewsProviderCalls)+'</div></div></div></td>'+
            '<td><div class="number-main">'+number(u.totalProviderCalls)+'</div><div class="number-sub">'+number(u.rateLimitedRequests)+' limited · '+number(u.providerUnavailableRequests)+' unavailable</div></td>'+
            '<td>'+esc(dateTime(last))+'</td>'+
          '</tr>';
        }).join('');
      }

      function rangeText(data){
        if(data.range.period==='day')return 'day: '+data.range.selectedDate;
        if(data.range.period==='today')return 'today';
        if(data.range.period==='7d')return 'last 7 days';
        if(data.range.period==='30d')return 'last 30 days';
        return 'lifetime usage';
      }

      function render(data){
        snapshot=data;
        document.querySelector('#kpi-customers').textContent=number(data.totals.customers);
        document.querySelector('#kpi-active').textContent=number(data.totals.activeInsightsLocations);
        document.querySelector('#kpi-summary-clicks').textContent=number(data.totals.googleSummaryClicks);
        document.querySelector('#kpi-review-clicks').textContent=number(data.totals.googleReviewsClicks);
        document.querySelector('#kpi-provider').textContent=number(data.totals.totalProviderCalls);
        document.querySelector('#kpi-limited').textContent=number(data.totals.rateLimitedRequests);
        document.querySelector('#range-label').textContent=rangeText(data);
        renderRows();
      }

      async function load(){
        const params=new URLSearchParams({timezoneOffsetMinutes:String(-new Date().getTimezoneOffset())});
        if(dateFilter.value)params.set('date',dateFilter.value);else params.set('period',selectedPeriod);
        const data=await api('/api/admin/usage?'+params.toString());
        sessionStorage.setItem('tnt-admin-token',token());
        loginPanel.hidden=true;
        analytics.hidden=false;
        logout.hidden=false;
        loginError.hidden=true;
        render(data);
      }

      loginForm.addEventListener('submit',async event=>{event.preventDefault();loginError.hidden=true;try{await load()}catch(error){loginError.textContent=error.message;loginError.hidden=false}});
      document.querySelector('#periods').addEventListener('click',event=>{const button=event.target.closest('[data-period]');if(!button)return;selectedPeriod=button.dataset.period;dateFilter.value='';for(const item of document.querySelectorAll('[data-period]'))item.classList.toggle('active',item===button);load().catch(error=>alert(error.message))});
      dateFilter.addEventListener('change',()=>{if(dateFilter.value){for(const item of document.querySelectorAll('[data-period]'))item.classList.remove('active')}load().catch(error=>alert(error.message))});
      search.addEventListener('input',renderRows);
      document.querySelector('#refresh').addEventListener('click',()=>load().catch(error=>alert(error.message)));
      logout.addEventListener('click',()=>{sessionStorage.removeItem('tnt-admin-token');analytics.hidden=true;logout.hidden=true;loginPanel.hidden=false;tokenInput.value='';snapshot=null});
      if(sessionStorage.getItem('tnt-admin-token'))load().catch(()=>{sessionStorage.removeItem('tnt-admin-token');loginPanel.hidden=false});
    })();
  </script>
</body>
</html>`;
