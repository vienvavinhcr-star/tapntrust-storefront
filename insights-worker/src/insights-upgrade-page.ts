export interface InsightsUpgradePageData {
  firstName: string;
  businessName: string;
  businessAddress: string;
  cardCount: number;
  insightsActive: boolean;
  introEligible: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] || character);
}

function shell(content: string, script = ""): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#071b45">
  <title>Tapntrust Insights upgrade</title>
  <style>
    :root{color-scheme:light;--navy:#071b45;--blue:#146df5;--muted:#60718f;--line:#d7e3f4;--green:#0b9b67}*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--navy);background:radial-gradient(circle at 15% 5%,#dcebff 0,transparent 35%),linear-gradient(145deg,#f8fbff,#eaf2ff);padding:24px}.page{width:min(980px,100%);margin:auto}.brand{display:inline-flex;align-items:center;gap:12px;margin:0 0 20px;color:var(--navy);font-weight:850;text-decoration:none}.brand img{width:46px;height:46px;object-fit:contain}.card{overflow:hidden;border:1px solid rgba(139,171,218,.55);border-radius:30px;background:#fff;box-shadow:0 30px 80px rgba(7,27,69,.16)}.hero{display:grid;grid-template-columns:minmax(260px,.8fr) 1.2fr;align-items:stretch}.art{position:relative;display:grid;min-height:540px;place-items:end center;overflow:hidden;background:linear-gradient(155deg,#e5f2ff,#bcdcff)}.art:before{position:absolute;width:420px;height:420px;border-radius:50%;background:rgba(255,255,255,.7);content:""}.art img{position:relative;z-index:1;width:min(94%,430px);height:auto;filter:drop-shadow(0 18px 30px rgba(7,27,69,.17))}.content{padding:54px 52px}.eyebrow{margin:0 0 12px;color:var(--blue);font-size:.76rem;font-weight:900;letter-spacing:.15em;text-transform:uppercase}h1{margin:0;font-size:clamp(2.1rem,5vw,4.2rem);line-height:.96;letter-spacing:-.055em}.lead{margin:20px 0 28px;color:var(--muted);font-size:1.06rem;line-height:1.65}.business{padding:20px;border:1px solid var(--line);border-radius:18px;background:#f8fbff}.business small{display:block;margin-bottom:6px;color:#6d7f9b;font-weight:750}.business strong{display:block;font-size:1.2rem}.business span{display:block;margin-top:5px;color:var(--muted);line-height:1.45}.facts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.fact{padding:18px;border-radius:17px;background:#f2f7ff}.fact small{display:block;color:#6a7d9b;font-weight:800}.fact strong{display:block;margin-top:8px;font-size:1.4rem}.status-inactive{color:#9a6500}.status-active{color:var(--green)}.price{margin:16px 0;padding:18px;border-radius:18px;background:linear-gradient(135deg,#071b45,#145fd2);color:#fff}.price small,.price span{display:block;color:#cfe2ff}.price strong{display:block;margin:4px 0;font-size:1.55rem}.actions{display:grid;gap:11px;margin-top:18px}.button{display:flex;min-height:54px;align-items:center;justify-content:center;border:0;border-radius:15px;padding:14px 18px;font:inherit;font-weight:850;text-decoration:none;cursor:pointer}.button.primary{color:#fff;background:linear-gradient(135deg,#1883ff,#0757df);box-shadow:0 14px 28px rgba(20,109,245,.25)}.button.secondary{color:var(--navy);background:#eef5ff}.button:disabled{opacity:.6;cursor:wait}.trust{margin:18px 0 0;color:var(--muted);font-size:.84rem;line-height:1.55}.status{min-height:22px;margin:12px 0 0;color:#b33b30;font-weight:700}.quiet{margin-top:16px;text-align:center}.quiet button{border:0;color:#657794;background:transparent;text-decoration:underline;cursor:pointer}.simple{padding:56px;text-align:center}.simple h1{font-size:clamp(2rem,5vw,3.7rem)}.simple .lead{max-width:600px;margin-inline:auto}.simple .button{width:min(330px,100%);margin:26px auto 0}.confirm{width:min(620px,100%);margin:auto;padding:44px;border:1px solid var(--line);border-radius:26px;background:#fff;box-shadow:0 25px 70px rgba(7,27,69,.16)}.confirm h1{font-size:clamp(2rem,7vw,3.2rem)}.confirm form{margin-top:24px}.confirm .button{width:100%}@media(max-width:760px){body{padding:12px}.card{border-radius:24px}.hero{grid-template-columns:1fr}.art{min-height:280px;place-items:end center}.art:before{width:280px;height:280px}.art img{width:min(70%,300px);max-height:280px;object-fit:contain}.content{padding:32px 22px 28px}.facts{grid-template-columns:1fr}.simple{padding:38px 22px}.confirm{padding:34px 22px}}
  </style>
</head>
<body><main class="page">${content}</main>${script ? `<script>${script}</script>` : ""}</body>
</html>`;
}

export function renderUpgradeConfirmationPage(rawToken: string): string {
  const token = escapeHtml(rawToken);
  return shell(`<section class="confirm">
    <p class="eyebrow">Secure business check</p>
    <h1>Continue to your Tapntrust card status</h1>
    <p class="lead">Confirm below to securely view the business connected to this email. This link works once and expires after 15 minutes.</p>
    <form method="post" action="/insights-upgrade/confirm">
      <input type="hidden" name="token" value="${token}">
      <button class="button primary" type="submit">Confirm and continue</button>
    </form>
  </section>`);
}

export function renderUpgradeUnavailablePage(): string {
  return shell(`<section class="confirm">
    <p class="eyebrow">Secure link</p>
    <h1>This link is no longer available</h1>
    <p class="lead">It may have expired or already been used. Start again and we’ll send a fresh link to the email saved with the original Tapntrust order.</p>
    <a class="button primary" href="https://tapntrust.com/insights-only/">Start again</a>
  </section>`);
}

export function renderInsightsUpgradePage(data: InsightsUpgradePageData | null): string {
  if (!data) {
    return shell(`<section class="card simple">
      <p class="eyebrow">Tapntrust Insights</p>
      <h1>Open the secure link in your email</h1>
      <p class="lead">To protect your business information, card totals and Insights status are shown only after you confirm the email saved with the original card order.</p>
      <a class="button primary" href="https://tapntrust.com/insights-only/">Find my business</a>
    </section>`);
  }

  const firstName = escapeHtml(data.firstName);
  const businessName = escapeHtml(data.businessName);
  const businessAddress = escapeHtml(data.businessAddress);
  const cardLabel = `${data.cardCount} Tapntrust card${data.cardCount === 1 ? "" : "s"}`;
  const status = data.insightsActive ? "Active" : "Not activated";
  const price = data.introEligible ? "A$1.99 for your first month" : "A$6.99 per month";
  const priceDetail = data.introEligible ? "Then A$6.99/month. Cancel anytime." : "Renews monthly. Cancel anytime.";
  const actions = data.insightsActive
    ? `<a class="button primary" href="/app">Open private dashboard</a>`
    : `<button class="button primary" id="upgrade-checkout" type="button">Activate Tapntrust Insights</button>
       <a class="button secondary" href="https://tapntrust.com/#shop">Buy more cards</a>`;
  const script = data.insightsActive ? "" : `
    const button=document.getElementById("upgrade-checkout");
    const status=document.getElementById("checkout-status");
    button.addEventListener("click",async()=>{
      button.disabled=true;button.textContent="Preparing secure checkout…";status.textContent="";
      try{
        const response=await fetch("/api/insights-upgrade/checkout",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:"{}"});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok||!payload.checkoutUrl)throw new Error(payload.error||"Checkout is temporarily unavailable.");
        location.assign(payload.checkoutUrl);
      }catch(error){status.textContent=error.message||"Checkout is temporarily unavailable.";button.disabled=false;button.textContent="Activate Tapntrust Insights";}
    });`;

  return shell(`<a class="brand" href="https://tapntrust.com/"><span>Tapntrust Insights</span></a>
  <section class="card hero">
    <div class="art"><img src="/tapntrust-insights-mascot-transparent.png" width="483" height="649" alt="Tapntrust mascot welcoming you to Insights"></div>
    <div class="content">
      <p class="eyebrow">Verified Tapntrust customer</p>
      <h1>Hi ${firstName}. Your cards are ready for Insights.</h1>
      <p class="lead">We found the exact business location connected to your original Tapntrust order.</p>
      <div class="business"><small>Verified business</small><strong>${businessName}</strong><span>${businessAddress}</span></div>
      <div class="facts">
        <div class="fact"><small>Cards connected</small><strong>${cardLabel}</strong></div>
        <div class="fact"><small>Tapntrust Insights</small><strong class="${data.insightsActive ? "status-active" : "status-inactive"}">${status}</strong></div>
      </div>
      ${data.insightsActive ? "" : `<div class="price"><small>Insights only — no shipping</small><strong>${price}</strong><span>${priceDetail}</span></div>`}
      <div class="actions">${actions}</div>
      <p class="status" id="checkout-status" role="status" aria-live="polite"></p>
      <p class="trust">Payment is completed securely in Shopify Checkout. Insights-only checkout contains no physical item and must not add shipping.</p>
      <form class="quiet" method="post" action="/insights-upgrade/logout"><button type="submit">Check another business</button></form>
    </div>
  </section>`, script);
}
