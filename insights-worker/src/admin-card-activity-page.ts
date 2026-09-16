const ADMIN_CARD_ACTIVITY_STYLE = `<style>
  .admin-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0 16px}.admin-toolbar__group{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.admin-filter-button{border:1px solid var(--line);background:#fff;color:var(--navy);border-radius:999px;padding:7px 11px;font:inherit;font-size:.78rem;font-weight:800;cursor:pointer}.admin-filter-button.active{border-color:#9bbcf4;background:#eaf2ff;color:#0d55c9}.admin-toolbar input,.admin-toolbar select{border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--navy);padding:9px 11px;font:inherit;min-width:0}.admin-toolbar input{flex:1 1 220px}.admin-toolbar select{flex:0 1 190px}.admin-toolbar__summary{font-size:.78rem;color:var(--muted);margin-left:auto}.admin-cards-root{display:grid;gap:14px}.admin-card-group{display:grid;gap:10px}.admin-card-group__head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.admin-card-group__head h3{margin:0;font-size:.92rem}.admin-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.admin-card{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff}.admin-card.is-new{border-color:#aac6f7;box-shadow:0 0 0 2px #edf4ff inset}.admin-card__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.admin-card__title{min-width:0}.admin-card__title strong{display:block}.admin-card__business{color:var(--muted);font-size:.84rem;overflow-wrap:anywhere}.admin-card__metric{text-align:right;white-space:nowrap}.admin-card__metric strong{display:block;font-size:1.35rem}.admin-card__metric span{color:var(--muted);font-size:.72rem}.admin-card__meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:7px}.admin-card__created{font-size:.75rem;color:var(--muted)}.admin-new-badge{display:inline-flex;align-items:center;border-radius:999px;background:#e8f7ef;color:#087a47;padding:3px 7px;font-size:.68rem;font-weight:850}.admin-card .programming-url{margin-top:9px}.admin-card .edit{margin-top:10px}.admin-activity-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:12px}.admin-empty{padding:18px;border:1px dashed var(--line);border-radius:12px;color:var(--muted);text-align:center}.admin-loading{opacity:.6;pointer-events:none}@media(max-width:700px){.admin-toolbar{align-items:stretch}.admin-toolbar__group{width:100%}.admin-toolbar input,.admin-toolbar select{width:100%;flex:1 1 100%}.admin-toolbar__summary{margin-left:0;width:100%}.admin-card-grid{grid-template-columns:1fr}.admin-card .edit{grid-template-columns:1fr}.admin-activity-footer{align-items:stretch;flex-direction:column}.admin-activity-footer .button{width:100%}}
</style>`;

const ADMIN_CARD_ACTIVITY_SCRIPT = `
(() => {
  const cardsRoot = document.querySelector('#cards');
  const recentBody = document.querySelector('#recent');
  if (!cardsRoot || !recentBody || document.querySelector('[data-admin-card-controls]')) return;
  const cardsPanel = cardsRoot.closest('.panel');
  const activityPanel = recentBody.closest('.panel');
  if (!cardsPanel || !activityPanel) return;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const token = () => sessionStorage.getItem('tnt-admin-token') || document.querySelector('#token')?.value || '';
  const request = async (path, init = {}) => {
    const adminToken = token();
    if (!adminToken) throw new Error('Sign in to the private admin first.');
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json', ...(init.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The admin request failed.');
    return data;
  };
  const timezoneOffsetMinutes = () => -new Date().getTimezoneOffset();
  const periodLabel = period => period === 'today' ? 'Today' : period === '7d' ? '7 days' : period === '30d' ? '30 days' : 'All time';
  const formatDate = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    return date.toLocaleString([], { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  };
  const debounce = (fn, wait = 250) => {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
  };

  const cardsState = { period: '30d', search: '', sort: 'newest' };
  const activityState = { period: 'today', search: '', page: 1, pageSize: 50, total: 0, loading: false };

  const cardsControls = document.createElement('div');
  cardsControls.dataset.adminCardControls = '1';
  cardsControls.innerHTML = '<div class="muted">Newest provisioned cards are shown first. Change the period to update tap counts.</div><div class="admin-toolbar"><div class="admin-toolbar__group" data-card-period></div><input data-card-search type="search" placeholder="Search business, token or placement"><select data-card-sort aria-label="Sort cards"><option value="newest">Newest provisioned</option><option value="oldest">Oldest provisioned</option><option value="most_taps">Most taps</option><option value="business">Business A-Z</option></select><span class="admin-toolbar__summary" data-card-summary></span></div>';
  cardsPanel.querySelector('h2')?.insertAdjacentElement('afterend', cardsControls);
  cardsRoot.classList.remove('grid');
  cardsRoot.classList.add('admin-cards-root');

  const activityControls = document.createElement('div');
  activityControls.innerHTML = '<div class="muted">Newest tap activity first.</div><div class="admin-toolbar"><div class="admin-toolbar__group" data-activity-period></div><input data-activity-search type="search" placeholder="Search business, token or placement"><span class="admin-toolbar__summary" data-activity-summary></span></div>';
  activityPanel.querySelector('h2')?.insertAdjacentElement('afterend', activityControls);
  const recentTable = recentBody.closest('table');
  if (recentTable) recentTable.querySelector('thead').innerHTML = '<tr><th>Time</th><th>Business</th><th>Token</th><th>Placement</th></tr>';
  const activityFooter = document.createElement('div');
  activityFooter.className = 'admin-activity-footer';
  activityFooter.innerHTML = '<span class="muted" data-activity-count></span><button class="button secondary compact" type="button" data-activity-more hidden>Load more</button>';
  recentTable?.parentElement?.insertAdjacentElement('afterend', activityFooter);

  const periods = [['today','Today'],['7d','7 days'],['30d','30 days'],['all','All']];
  const renderPeriodButtons = (container, active, attribute) => {
    container.innerHTML = periods.map(([value,label]) => '<button type="button" class="admin-filter-button '+(value === active ? 'active' : '')+'" '+attribute+'="'+value+'">'+label+'</button>').join('');
  };
  renderPeriodButtons(cardsControls.querySelector('[data-card-period]'), cardsState.period, 'data-card-period-value');
  renderPeriodButtons(activityControls.querySelector('[data-activity-period]'), activityState.period, 'data-activity-period-value');

  const cardMarkup = card => {
    const options = ['counter','table','reception','register','other'].map(type => '<option value="'+type+'" '+(type === card.placementType ? 'selected' : '')+'>'+type+'</option>').join('');
    return '<article class="admin-card '+(card.isNew ? 'is-new' : '')+'"><div class="admin-card__top"><div class="admin-card__title"><strong>'+escapeHtml(card.label)+'</strong><div class="token">'+escapeHtml(card.publicToken)+'</div><div class="admin-card__business">'+escapeHtml(card.businessName)+'</div></div><div class="admin-card__metric"><strong>'+Number(card.tapsInPeriod || 0)+'</strong><span>'+escapeHtml(periodLabel(cardsState.period))+'</span></div></div><div class="admin-card__meta">'+(card.isNew ? '<span class="admin-new-badge">New</span>' : '')+'<span class="admin-card__created">Provisioned '+escapeHtml(formatDate(card.createdAt))+'</span></div><div class="programming-url"><span class="token">'+escapeHtml(card.programmingUrl)+'</span><button class="button secondary compact" type="button" data-copy-card-url="'+escapeHtml(card.programmingUrl)+'">Copy URL</button></div><form class="edit" data-enhanced-card-edit data-token="'+escapeHtml(card.publicToken)+'"><input name="label" maxlength="80" value="'+escapeHtml(card.label)+'" aria-label="Card label"><select name="placementType" aria-label="Placement type">'+options+'</select><button class="button secondary">Save</button></form></article>';
  };

  const renderCards = cards => {
    const fresh = cards.filter(card => card.isNew);
    const older = cards.filter(card => !card.isNew);
    if (!cards.length) {
      cardsRoot.innerHTML = '<div class="admin-empty">No cards match these filters.</div>';
      return;
    }
    let html = '';
    if (fresh.length) html += '<section class="admin-card-group"><div class="admin-card-group__head"><h3>Recently provisioned</h3><span class="muted">Last 24 hours</span></div><div class="admin-card-grid">'+fresh.map(cardMarkup).join('')+'</div></section>';
    if (older.length) html += '<section class="admin-card-group"><div class="admin-card-group__head"><h3>'+(fresh.length ? 'All other cards' : 'Cards')+'</h3><span class="muted">'+older.length+' card'+(older.length === 1 ? '' : 's')+'</span></div><div class="admin-card-grid">'+older.map(cardMarkup).join('')+'</div></section>';
    cardsRoot.innerHTML = html;
  };

  const cardQuery = () => {
    const params = new URLSearchParams({
      period: cardsState.period,
      sort: cardsState.sort,
      search: cardsState.search,
      timezoneOffsetMinutes: String(timezoneOffsetMinutes()),
      page: '1',
      pageSize: '50'
    });
    return '/api/admin/card-activity?' + params.toString();
  };
  const refreshCards = async () => {
    if (!token()) return;
    cardsRoot.classList.add('admin-loading');
    try {
      const data = await request(cardQuery());
      renderCards(Array.isArray(data.cards) ? data.cards : []);
      cardsControls.querySelector('[data-card-summary]').textContent = (data.cards?.length || 0) + ' cards · taps: ' + periodLabel(cardsState.period);
    } catch (error) {
      cardsRoot.innerHTML = '<div class="admin-empty error">'+escapeHtml(error instanceof Error ? error.message : 'Could not load cards.')+'</div>';
    } finally {
      cardsRoot.classList.remove('admin-loading');
    }
  };

  const activityQuery = () => {
    const params = new URLSearchParams({
      period: activityState.period,
      search: activityState.search,
      sort: 'newest',
      timezoneOffsetMinutes: String(timezoneOffsetMinutes()),
      page: String(activityState.page),
      pageSize: String(activityState.pageSize)
    });
    return '/api/admin/card-activity?' + params.toString();
  };
  const renderActivityRows = (items, append) => {
    const rows = items.map(item => '<tr><td>'+escapeHtml(new Date(item.tappedAt).toLocaleString())+'</td><td>'+escapeHtml(item.businessName)+'</td><td class="token">'+escapeHtml(item.publicToken)+'</td><td>'+escapeHtml(item.label)+'</td></tr>').join('');
    if (append) recentBody.insertAdjacentHTML('beforeend', rows);
    else recentBody.innerHTML = rows || '<tr><td colspan="4" class="muted">No tap activity for this period.</td></tr>';
  };
  const refreshActivity = async (append = false) => {
    if (!token() || activityState.loading) return;
    activityState.loading = true;
    recentBody.closest('table')?.classList.add('admin-loading');
    try {
      const data = await request(activityQuery());
      const activity = data.activity || {};
      activityState.total = Number(activity.total || 0);
      renderActivityRows(Array.isArray(activity.items) ? activity.items : [], append);
      const shown = Math.min(activityState.page * activityState.pageSize, activityState.total);
      activityControls.querySelector('[data-activity-summary]').textContent = periodLabel(activityState.period);
      activityFooter.querySelector('[data-activity-count]').textContent = 'Showing ' + shown + ' of ' + activityState.total + ' events';
      activityFooter.querySelector('[data-activity-more]').hidden = !activity.hasMore;
    } catch (error) {
      if (!append) recentBody.innerHTML = '<tr><td colspan="4" class="error">'+escapeHtml(error instanceof Error ? error.message : 'Could not load activity.')+'</td></tr>';
    } finally {
      activityState.loading = false;
      recentBody.closest('table')?.classList.remove('admin-loading');
    }
  };

  cardsControls.addEventListener('click', event => {
    const button = event.target.closest('[data-card-period-value]');
    if (!button) return;
    cardsState.period = button.dataset.cardPeriodValue;
    renderPeriodButtons(cardsControls.querySelector('[data-card-period]'), cardsState.period, 'data-card-period-value');
    refreshCards();
  });
  cardsControls.querySelector('[data-card-sort]').addEventListener('change', event => { cardsState.sort = event.target.value; refreshCards(); });
  cardsControls.querySelector('[data-card-search]').addEventListener('input', debounce(event => { cardsState.search = event.target.value.trim(); refreshCards(); }));

  activityControls.addEventListener('click', event => {
    const button = event.target.closest('[data-activity-period-value]');
    if (!button) return;
    activityState.period = button.dataset.activityPeriodValue;
    activityState.page = 1;
    renderPeriodButtons(activityControls.querySelector('[data-activity-period]'), activityState.period, 'data-activity-period-value');
    refreshActivity(false);
  });
  activityControls.querySelector('[data-activity-search]').addEventListener('input', debounce(event => { activityState.search = event.target.value.trim(); activityState.page = 1; refreshActivity(false); }));
  activityFooter.querySelector('[data-activity-more]').addEventListener('click', () => { activityState.page += 1; refreshActivity(true); });

  cardsRoot.addEventListener('submit', async event => {
    const edit = event.target;
    if (!(edit instanceof HTMLFormElement) || !edit.matches('[data-enhanced-card-edit]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const button = edit.querySelector('button');
    button.disabled = true;
    try {
      await request('/api/admin/cards/' + encodeURIComponent(edit.dataset.token), {
        method: 'PATCH',
        body: JSON.stringify({ label: edit.elements.label.value, placementType: edit.elements.placementType.value })
      });
      await Promise.all([refreshCards(), refreshActivity(false)]);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not update the card.');
    } finally {
      button.disabled = false;
    }
  }, true);

  const refreshAll = () => Promise.all([refreshCards(), refreshActivity(false)]);
  document.querySelector('#login-form')?.addEventListener('submit', () => {
    window.setTimeout(refreshAll, 300);
    window.setTimeout(refreshAll, 850);
  });
  if (token()) window.setTimeout(refreshAll, 0);
})();`;

export function enhanceAdminCardActivityPage(page: string): string {
  return page
    .replace("</head>", `${ADMIN_CARD_ACTIVITY_STYLE}</head>`)
    .replace("</script>\n</body>", `${ADMIN_CARD_ACTIVITY_SCRIPT}\n</script>\n</body>`);
}
