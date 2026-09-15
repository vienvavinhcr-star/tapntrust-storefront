const ADMIN_ANALYTICS_STYLE = `<style>
  .crm-panel{order:-10}.crm-toolbar{display:flex;align-items:end;justify-content:space-between;gap:12px;flex-wrap:wrap}.crm-periods{display:flex;gap:6px;flex-wrap:wrap}.crm-period{border:1px solid var(--line);background:#fff;color:var(--navy);border-radius:9px;padding:8px 11px;font:inherit;font-size:.82rem;font-weight:800;cursor:pointer}.crm-period.active{background:var(--navy);color:#fff;border-color:var(--navy)}.crm-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.crm-field{display:grid;gap:4px}.crm-field span{font-size:.72rem;color:var(--muted);font-weight:800}.crm-field input{border:1px solid var(--line);border-radius:9px;padding:9px 10px;font:inherit;min-width:170px}.crm-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:16px 0}.crm-kpi{border:1px solid var(--line);border-radius:14px;padding:13px;background:#fbfcff}.crm-kpi__label{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:850}.crm-kpi__value{font-size:1.65rem;font-weight:900;letter-spacing:-.04em;margin-top:3px}.crm-kpi__note{font-size:.7rem;color:var(--muted);margin-top:2px}.crm-note{border:1px solid #cbdcf8;background:#f5f8ff;border-radius:12px;padding:10px 12px;font-size:.8rem;color:#31537d;margin:12px 0}.crm-table-wrap{overflow:auto;border:1px solid var(--line);border-radius:14px}.crm-table{width:100%;min-width:1240px;border-collapse:collapse;background:#fff}.crm-table th,.crm-table td{text-align:left;vertical-align:top;padding:11px 9px;border-bottom:1px solid var(--line)}.crm-table th{background:#f8faff;font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);position:sticky;top:0;z-index:1}.crm-table tr:last-child td{border-bottom:0}.crm-title{font-weight:850}.crm-sub{font-size:.75rem;color:var(--muted);margin-top:2px}.crm-number{font-size:1.15rem;font-weight:900}.crm-pill{display:inline-flex;padding:3px 7px;border-radius:999px;font-size:.7rem;font-weight:850}.crm-pill.active{background:#e9f7ef;color:#087a47}.crm-pill.inactive{background:#fff0ee;color:#b42318}.crm-pill.pending{background:#fff7df;color:#9a6700}.crm-cards{display:grid;gap:5px;margin-top:6px}.crm-cardline{display:flex;align-items:center;gap:6px;max-width:310px}.crm-cardline code{font-size:.69rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.crm-copy{border:0;background:#edf3fc;color:var(--navy);border-radius:7px;padding:4px 7px;font-size:.68rem;font-weight:800;cursor:pointer}.crm-empty{text-align:center;padding:24px;color:var(--muted)}@media(max-width:1000px){.crm-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:620px){.crm-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.crm-tools{width:100%}.crm-field{flex:1}.crm-field input{width:100%;min-width:0}}
</style>`;

const ADMIN_ANALYTICS_SCRIPT = `
(() => {
  const dashboard = document.querySelector('#dashboard');
  const loginForm = document.querySelector('#login-form');
  const tokenInput = document.querySelector('#token');
  if (!dashboard || !loginForm || !tokenInput || document.querySelector('#crm-analytics')) return;

  const panel = document.createElement('section');
  panel.className = 'panel crm-panel';
  panel.id = 'crm-analytics';
  panel.innerHTML = '<div class="crm-toolbar"><div><h2 style="margin:0">Customer CRM & analytics</h2><div class="muted">Checkout email, orders, cards, NFC activity and Insights usage in one place.</div></div><div class="crm-periods"><button class="crm-period" type="button" data-crm-period="today">Today</button><button class="crm-period" type="button" data-crm-period="7d">7 days</button><button class="crm-period active" type="button" data-crm-period="30d">30 days</button><button class="crm-period" type="button" data-crm-period="all">Lifetime</button></div></div><div class="crm-toolbar" style="margin-top:12px"><div class="crm-tools"><label class="crm-field"><span>Specific day</span><input type="date" data-crm-date></label><label class="crm-field"><span>Search</span><input type="search" placeholder="Email, business or order" data-crm-search></label><button class="button secondary compact" type="button" data-crm-refresh>Refresh</button></div><div class="muted" data-crm-range></div></div><div class="crm-kpis"><div class="crm-kpi"><div class="crm-kpi__label">Customer emails</div><div class="crm-kpi__value" data-crm-kpi="customers">—</div><div class="crm-kpi__note">Unique checkout/account emails</div></div><div class="crm-kpi"><div class="crm-kpi__label">Cards</div><div class="crm-kpi__value" data-crm-kpi="cards">—</div><div class="crm-kpi__note">Active / total</div></div><div class="crm-kpi"><div class="crm-kpi__label">NFC taps</div><div class="crm-kpi__value" data-crm-kpi="taps">—</div><div class="crm-kpi__note">Selected period</div></div><div class="crm-kpi"><div class="crm-kpi__label">Lifetime taps</div><div class="crm-kpi__value" data-crm-kpi="lifetime">—</div><div class="crm-kpi__note">All review-page redirects</div></div><div class="crm-kpi"><div class="crm-kpi__label">Active Insights</div><div class="crm-kpi__value" data-crm-kpi="insights">—</div><div class="crm-kpi__note">Locations</div></div><div class="crm-kpi"><div class="crm-kpi__label">Google API calls</div><div class="crm-kpi__value" data-crm-kpi="google">—</div><div class="crm-kpi__note">Actual provider calls</div></div></div><div class="crm-note"><strong>Tracking meaning:</strong> an NFC tap is a TapNTrust-owned Review Opportunity and immediately redirects to the stored Google review page. It does not prove that a Google review was submitted. “Show Google Reviews” below tracks the business owner opening that feature inside Insights.</div><div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Customer / order</th><th>Business</th><th>Cards & URLs</th><th>NFC taps / review-page opens</th><th>Insights</th><th>Dashboard usage</th><th>Last activity</th></tr></thead><tbody data-crm-body></tbody></table><div class="crm-empty" data-crm-empty hidden>No matching customers or businesses.</div></div>';
  dashboard.insertBefore(panel, dashboard.firstElementChild);

  const body = panel.querySelector('[data-crm-body]');
  const empty = panel.querySelector('[data-crm-empty]');
  const dateInput = panel.querySelector('[data-crm-date]');
  const searchInput = panel.querySelector('[data-crm-search]');
  const rangeLabel = panel.querySelector('[data-crm-range]');
  let period = '30d';
  let snapshot = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const number = value => new Intl.NumberFormat('en-AU').format(Number(value || 0));
  const dateTime = value => value ? new Date(value).toLocaleString('en-AU', { dateStyle:'medium', timeStyle:'short' }) : '—';
  const money = (minor, currency) => new Intl.NumberFormat('en-AU', { style:'currency', currency:currency || 'AUD' }).format(Number(minor || 0) / 100);
  const token = () => sessionStorage.getItem('tnt-admin-token') || tokenInput.value;
  const request = async path => {
    const response = await fetch(path, { headers:{ Authorization:'Bearer ' + token(), 'Content-Type':'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load customer analytics.');
    return data;
  };
  const copyText = async text => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement('textarea'); area.value = text; area.style.position='fixed'; area.style.opacity='0'; document.body.append(area); area.select(); document.execCommand('copy'); area.remove();
  };
  const pill = status => {
    const value = String(status || 'not configured');
    const normalized = value.toLowerCase();
    const cls = normalized === 'active' ? 'active' : (normalized === 'inactive' || normalized === 'expired' || normalized === 'cancelled' ? 'inactive' : 'pending');
    return '<span class="crm-pill ' + cls + '">' + esc(value.replaceAll('_',' ')) + '</span>';
  };

  function rangeText(data) {
    if (data.range.period === 'day') return 'Showing ' + data.range.selectedDate;
    if (data.range.period === 'today') return 'Showing today';
    if (data.range.period === '7d') return 'Showing last 7 days';
    if (data.range.period === '30d') return 'Showing last 30 days';
    return 'Showing lifetime';
  }

  function matches(row, query) {
    if (!query) return true;
    const haystack = [row.customerEmail,row.accountEmail,row.orderReference,row.setupReference,row.businessName,row.locationName,row.businessAddress,row.googlePlaceId].join(' ').toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function renderRows() {
    if (!snapshot) return;
    const query = searchInput.value.trim();
    const rows = snapshot.locations.filter(row => matches(row, query));
    empty.hidden = rows.length !== 0;
    body.closest('table').hidden = rows.length === 0;
    body.innerHTML = rows.map(row => {
      const email = row.customerEmail || row.accountEmail || 'No email captured';
      const order = row.orderReference || 'Manual / legacy setup';
      const cards = row.cards.length ? '<div class="crm-cards">' + row.cards.map((card,index) => '<div class="crm-cardline"><span>'+(index+1)+'.</span><code title="'+esc(card.programmingUrl)+'">'+esc(card.label)+' · '+esc(card.publicToken)+'</code><button class="crm-copy" type="button" data-crm-copy="'+esc(card.programmingUrl)+'">Copy</button></div>').join('') + '</div>' : '<div class="crm-sub">No cards</div>';
      const subscription = row.subscription ? '<div class="crm-sub">'+esc(row.subscription.planCode)+' · '+esc(money(row.subscription.recurringPriceMinor,row.subscription.currency))+'/month</div><div class="crm-sub">Billing '+pill(row.subscription.status)+'</div><div class="crm-sub">Next: '+esc(dateTime(row.subscription.nextBillingAt))+'</div>' : '<div class="crm-sub">No paid Insights subscription</div>';
      const usage = row.dashboardUsage;
      const last = [row.lastTapAt,usage.lastActivityAt,row.provisionedAt].filter(Boolean).sort().at(-1) || null;
      return '<tr><td><div class="crm-title">'+esc(email)+'</div><div class="crm-sub">Order: '+esc(order)+'</div><div class="crm-sub">Setup: '+esc(row.setupReference || '—')+'</div><div class="crm-sub">Provisioned: '+esc(dateTime(row.provisionedAt))+'</div></td><td><div class="crm-title">'+esc(row.businessName)+'</div><div class="crm-sub">'+esc(row.businessAddress || row.locationName)+'</div><div class="crm-sub">Place ID: '+esc(row.googlePlaceId || '—')+'</div></td><td><div class="crm-number">'+number(row.activeCardCount)+' / '+number(row.cardCount)+'</div><div class="crm-sub">active / total cards</div>'+cards+'</td><td><div class="crm-number">'+number(row.tapsInRange)+'</div><div class="crm-sub">in selected period</div><div class="crm-sub">'+number(row.lifetimeTaps)+' lifetime</div></td><td>'+pill(row.insightsStatus)+subscription+'</td><td><div class="crm-sub"><strong>'+number(usage.opens)+'</strong> dashboard opens</div><div class="crm-sub"><strong>'+number(usage.refreshGoogleDataClicks)+'</strong> Refresh Google Data</div><div class="crm-sub"><strong>'+number(usage.showGoogleReviewsClicks)+'</strong> Show Google Reviews</div><div class="crm-sub"><strong>'+number(usage.googleProviderCalls)+'</strong> actual Google calls</div><div class="crm-sub">'+number(usage.rateLimited)+' limited · '+number(usage.providerUnavailable)+' unavailable</div></td><td>'+esc(dateTime(last))+'</td></tr>';
    }).join('');
  }

  function render(data) {
    snapshot = data;
    rangeLabel.textContent = rangeText(data);
    panel.querySelector('[data-crm-kpi="customers"]').textContent = number(data.totals.customersWithEmail);
    panel.querySelector('[data-crm-kpi="cards"]').textContent = number(data.totals.activeCards) + ' / ' + number(data.totals.cards);
    panel.querySelector('[data-crm-kpi="taps"]').textContent = number(data.totals.tapsInRange);
    panel.querySelector('[data-crm-kpi="lifetime"]').textContent = number(data.totals.lifetimeTaps);
    panel.querySelector('[data-crm-kpi="insights"]').textContent = number(data.totals.activeInsightsLocations);
    panel.querySelector('[data-crm-kpi="google"]').textContent = number(data.totals.googleProviderCalls);
    renderRows();
  }

  async function loadAnalytics() {
    if (!token()) return;
    const params = new URLSearchParams({ timezoneOffsetMinutes:String(-new Date().getTimezoneOffset()) });
    if (dateInput.value) params.set('date', dateInput.value); else params.set('period', period);
    render(await request('/api/admin/analytics?' + params.toString()));
  }

  panel.querySelector('.crm-periods').addEventListener('click', event => {
    const button = event.target.closest('[data-crm-period]');
    if (!button) return;
    period = button.dataset.crmPeriod;
    dateInput.value = '';
    panel.querySelectorAll('[data-crm-period]').forEach(item => item.classList.toggle('active', item === button));
    loadAnalytics().catch(error => alert(error.message));
  });
  dateInput.addEventListener('change', () => { if (dateInput.value) panel.querySelectorAll('[data-crm-period]').forEach(item => item.classList.remove('active')); loadAnalytics().catch(error => alert(error.message)); });
  searchInput.addEventListener('input', renderRows);
  panel.querySelector('[data-crm-refresh]').addEventListener('click', () => loadAnalytics().catch(error => alert(error.message)));
  panel.addEventListener('click', async event => {
    const button = event.target.closest('[data-crm-copy]');
    if (!button) return;
    const old = button.textContent;
    try { await copyText(button.dataset.crmCopy); button.textContent='Copied'; setTimeout(() => button.textContent=old, 1000); } catch { alert('Could not copy URL.'); }
  });
  loginForm.addEventListener('submit', () => setTimeout(() => loadAnalytics().catch(() => undefined), 0));
  if (sessionStorage.getItem('tnt-admin-token')) loadAnalytics().catch(() => undefined);
})();`;

export function enhanceAdminAnalyticsPage(page: string): string {
  return page
    .replace("</head>", `${ADMIN_ANALYTICS_STYLE}</head>`)
    .replace("</script>\n</body>", `${ADMIN_ANALYTICS_SCRIPT}\n</script>\n</body>`);
}
