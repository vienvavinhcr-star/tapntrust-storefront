export const INSIGHTS_ACTIVATION_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Activate TapNTrust Insights</title>
  <style>
    :root{color-scheme:light;--navy:#071a3d;--blue:#1769ed;--blue2:#0f56ca;--ink:#10213d;--muted:#65758f;--line:#d9e3f0;--soft:#f4f8fd;--ok:#127a55;--warn:#9a5b08;--white:#fff;--shadow:0 22px 60px rgba(7,26,61,.11)}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#f7faff 0,#eef4fb 100%);color:var(--ink);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}
    button,input{font:inherit}.shell{width:min(1040px,calc(100% - 28px));margin:0 auto;padding:24px 0 56px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:34px}.brand{font-weight:900;letter-spacing:-.03em;color:var(--navy);font-size:1.08rem}.brand span{color:var(--blue)}.back{color:var(--navy);text-decoration:none;font-weight:800;font-size:.92rem}.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:30px;align-items:stretch}.hero-copy,.panel{background:rgba(255,255,255,.93);border:1px solid var(--line);border-radius:28px;box-shadow:var(--shadow)}.hero-copy{padding:42px}.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border-radius:999px;background:#eaf2ff;color:#164f9e;font-size:.78rem;font-weight:900;letter-spacing:.05em;text-transform:uppercase}.hero h1{margin:20px 0 14px;color:var(--navy);font-size:clamp(2.35rem,5vw,4.4rem);line-height:.98;letter-spacing:-.055em}.hero-copy>p{color:var(--muted);font-size:1.03rem;max-width:58ch}.points{display:grid;gap:12px;margin:26px 0 0;padding:0;list-style:none}.points li{display:flex;gap:11px;align-items:flex-start;color:#31435f}.dot{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#eaf8f2;color:var(--ok);font-weight:900;flex:0 0 24px}.panel{padding:28px;min-height:420px}.state{display:none}.state.is-active{display:block}.panel h2{margin:0 0 8px;color:var(--navy);font-size:1.6rem;letter-spacing:-.035em}.muted{color:var(--muted)}.field{display:grid;gap:7px;margin:22px 0}.field label{font-weight:850;color:var(--navy)}.field input{width:100%;border:1px solid #cbd8e8;border-radius:13px;padding:14px 15px;outline:none;background:#fff}.field input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(23,105,237,.11)}.button{display:inline-flex;align-items:center;justify-content:center;width:100%;border:0;border-radius:13px;background:linear-gradient(180deg,var(--blue),var(--blue2));color:#fff;padding:14px 18px;font-weight:900;cursor:pointer;box-shadow:0 10px 24px rgba(23,105,237,.2)}.button:disabled{opacity:.55;cursor:not-allowed}.button.secondary{background:#fff;color:var(--navy);border:1px solid var(--line);box-shadow:none}.message{margin-top:14px;padding:12px 14px;border-radius:12px;background:var(--soft);color:#41516a;font-size:.9rem}.message.error{background:#fff1f1;color:#8f2929}.business-list{display:grid;gap:14px;margin-top:18px}.business-card{border:1px solid var(--line);background:#fff;border-radius:18px;padding:18px}.business-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.business-name{margin:0;color:var(--navy);font-size:1.18rem;font-weight:900}.status{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font-size:.72rem;font-weight:900;white-space:nowrap;background:#eef3f8;color:#506078}.status.active{background:#e7f7ef;color:var(--ok)}.meta{margin-top:7px;color:var(--muted);font-size:.89rem}.metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.metric{background:var(--soft);border-radius:12px;padding:10px}.metric strong{display:block;color:var(--navy);font-size:1.08rem}.metric span{color:var(--muted);font-size:.75rem}.cards{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:7px}.cards li{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #edf2f7;padding-top:8px;font-size:.87rem}.cards small{color:var(--muted)}.offer{margin-top:16px;border:1px solid #cfe0f8;border-radius:16px;padding:15px;background:linear-gradient(180deg,#f7fbff,#eef6ff)}.offer-price{font-size:1.45rem;line-height:1.1;color:var(--navy);font-weight:950;letter-spacing:-.035em}.offer-sub{color:var(--muted);font-size:.84rem;margin-top:5px}.actions{display:grid;gap:9px;margin-top:14px}.loader{width:20px;height:20px;border:2px solid #c8d4e6;border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite;margin:22px auto}.privacy{margin-top:18px;color:#7b899c;font-size:.78rem;text-align:center}@keyframes spin{to{transform:rotate(360deg)}}
    @media(max-width:760px){.shell{width:min(100% - 20px,560px);padding-top:16px}.topbar{margin-bottom:18px}.hero{grid-template-columns:1fr;gap:16px}.hero-copy{padding:26px 22px}.hero h1{font-size:clamp(2.45rem,13vw,3.5rem)}.panel{padding:20px;border-radius:22px}.metric-row{grid-template-columns:1fr 1fr}.metric-row .metric:last-child{grid-column:1/-1}.business-head{display:block}.status{margin-top:8px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
  </style>
</head>
<body>
  <main class="shell">
    <div class="topbar"><div class="brand">TapNTrust <span>Insights</span></div><a class="back" href="https://tapntrust.com">Back to TapNTrust</a></div>
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">For existing card owners</span>
        <h1>See what your cards are already telling you.</h1>
        <p>Your TapNTrust cards can already create review opportunities. Insights helps you understand which cards are getting tapped, when activity happens and where to focus next.</p>
        <ul class="points">
          <li><span class="dot">✓</span><span>See Review Opportunities by card and location.</span></li>
          <li><span class="dot">✓</span><span>Understand timing and card performance without changing your NFC setup.</span></li>
          <li><span class="dot">✓</span><span>Keep Google reputation activity visible in one simple dashboard.</span></li>
        </ul>
      </div>
      <div class="panel" aria-live="polite">
        <section class="state is-active" data-state="loading"><div class="loader" aria-label="Loading"></div></section>
        <section class="state" data-state="signin">
          <h2>Find your TapNTrust setup</h2>
          <p class="muted">Enter the email used when your NFC cards were purchased. We’ll send a secure one-time link before showing any business or card details.</p>
          <form data-signin-form>
            <div class="field"><label for="email">Purchase email</label><input id="email" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="you@business.com"></div>
            <button class="button" type="submit" data-signin-button>Send secure link</button>
          </form>
          <div class="message" data-signin-message hidden></div>
          <p class="privacy">For privacy, entering an email alone never reveals customer, business or card information.</p>
        </section>
        <section class="state" data-state="account">
          <div class="business-head"><div><h2>Your TapNTrust setup</h2><p class="muted" data-account-email></p></div><button class="button secondary" style="width:auto;padding:9px 12px" type="button" data-logout>Sign out</button></div>
          <div class="business-list" data-business-list></div>
        </section>
        <section class="state" data-state="empty"><h2>No eligible card setup found</h2><p class="muted">We verified your email, but could not find a TapNTrust card purchase linked to it yet. If you used another email, sign out and try that address.</p><button class="button secondary" type="button" data-empty-logout>Try another email</button></section>
      </div>
    </section>
  </main>
  <script>
    (()=>{
      const states=[...document.querySelectorAll('[data-state]')];
      const list=document.querySelector('[data-business-list]');
      const accountEmail=document.querySelector('[data-account-email]');
      const money=new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'});
      const show=(name)=>states.forEach(el=>el.classList.toggle('is-active',el.dataset.state===name));
      const escText=(value)=>String(value??'');
      const api=async(url,options={})=>{
        const response=await fetch(url,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok){const error=new Error(payload.error||'Something went wrong. Please try again.');error.status=response.status;throw error;}return payload;
      };
      const fmt=(minor)=>money.format(Number(minor||0)/100).replace('$','A$');
      async function load(){
        try{
          const data=await api('/api/insights/activation/summary');
          if(!data.locations?.length){show('empty');return;}
          accountEmail.textContent=data.email;
          list.replaceChildren();
          data.locations.forEach(renderLocation);
          show('account');
        }catch(error){if(error.status===401)show('signin');else{show('signin');const box=document.querySelector('[data-signin-message]');box.hidden=false;box.className='message error';box.textContent='TapNTrust Insights is temporarily unavailable. Please try again.';}}
      }
      function metric(label,value){const el=document.createElement('div');el.className='metric';const strong=document.createElement('strong');strong.textContent=escText(value);const span=document.createElement('span');span.textContent=label;el.append(strong,span);return el;}
      function renderLocation(location){
        const card=document.createElement('article');card.className='business-card';
        const head=document.createElement('div');head.className='business-head';
        const titleWrap=document.createElement('div');const title=document.createElement('h3');title.className='business-name';title.textContent=location.businessName;const address=document.createElement('div');address.className='meta';address.textContent=location.businessAddress||location.locationName||'';titleWrap.append(title,address);
        const status=document.createElement('span');status.className='status'+(location.insightsStatus==='active'?' active':'');status.textContent=location.insightsStatus==='active'?'Insights active':'Insights not active';head.append(titleWrap,status);card.append(head);
        const metrics=document.createElement('div');metrics.className='metric-row';metrics.append(metric('NFC cards',location.cardCount),metric('Review Opportunities',location.lifetimeReviewOpportunities),metric('Active cards',location.activeCardCount));card.append(metrics);
        const ul=document.createElement('ul');ul.className='cards';(location.cards||[]).forEach(item=>{const li=document.createElement('li');const name=document.createElement('span');name.textContent=item.label||'TapNTrust card';const taps=document.createElement('small');taps.textContent=item.lifetimeTaps+' taps';li.append(name,taps);ul.append(li)});card.append(ul);
        if(location.insightsStatus==='active'){
          const actions=document.createElement('div');actions.className='actions';const a=document.createElement('a');a.className='button';a.href='/app';a.textContent='Open TapNTrust Insights';actions.append(a);card.append(actions);
        }else{
          const offer=document.createElement('div');offer.className='offer';const price=document.createElement('div');price.className='offer-price';price.textContent='Checking your price…';const sub=document.createElement('div');sub.className='offer-sub';sub.textContent='We confirm eligibility before checkout.';const actions=document.createElement('div');actions.className='actions';const button=document.createElement('button');button.className='button';button.type='button';button.disabled=true;button.textContent='Activate TapNTrust Insights';actions.append(button);offer.append(price,sub,actions);card.append(offer);
          api('/api/insights/activation/quote?locationId='+encodeURIComponent(location.locationId)).then(q=>{
            price.textContent=q.introEligible?fmt(q.firstMonthMinor)+' first month':fmt(q.recurringMinor)+'/month';
            sub.textContent=q.introEligible?'Then '+fmt(q.recurringMinor)+'/month. Renews monthly.':'Standard monthly pricing. Renews monthly.';
            button.disabled=false;
          }).catch(()=>{price.textContent='Pricing check unavailable';sub.textContent='Please refresh and try again before checkout.';button.disabled=true;});
          button.addEventListener('click',async()=>{
            button.disabled=true;button.textContent='Preparing secure checkout…';
            try{const result=await api('/api/insights/activation/checkout',{method:'POST',body:JSON.stringify({locationId:location.locationId})});window.location.assign(result.checkoutUrl)}catch(error){sub.textContent=error.message||'Could not prepare checkout.';button.disabled=false;button.textContent='Try again';}
          });
        }
        list.append(card);
      }
      const form=document.querySelector('[data-signin-form]');
      form?.addEventListener('submit',async(event)=>{event.preventDefault();const email=new FormData(form).get('email');const button=document.querySelector('[data-signin-button]');const box=document.querySelector('[data-signin-message]');button.disabled=true;box.hidden=true;try{const result=await api('/api/insights/activation/request-link',{method:'POST',body:JSON.stringify({email})});box.className='message';box.textContent=result.message||'Check your email for a secure link.';box.hidden=false;}catch(error){box.className='message error';box.textContent=error.message;box.hidden=false;}finally{button.disabled=false;}});
      async function logout(){try{await fetch('/api/insights/activation/logout',{method:'POST',credentials:'same-origin'})}finally{location.href='/insights'}}
      document.querySelector('[data-logout]')?.addEventListener('click',logout);document.querySelector('[data-empty-logout]')?.addEventListener('click',logout);
      load();
    })();
  </script>
</body>
</html>`;
