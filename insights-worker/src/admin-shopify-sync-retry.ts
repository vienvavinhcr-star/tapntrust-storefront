const ADMIN_SHOPIFY_SYNC_RETRY_STYLE = `<style>
  .shopify-sync-recovery{margin:14px 0 18px;border:1px solid #c9daf7;border-radius:14px;background:#f7faff;padding:14px}.shopify-sync-recovery__head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.shopify-sync-recovery__head h3{margin:0;font-size:1rem}.shopify-sync-recovery__head p{margin:4px 0 0;font-size:.82rem;color:var(--muted)}.shopify-sync-recovery__list{display:grid;gap:8px;margin-top:12px}.shopify-sync-recovery__item{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--line);border-radius:12px;background:#fff;padding:10px 12px}.shopify-sync-recovery__meta{min-width:0}.shopify-sync-recovery__meta strong,.shopify-sync-recovery__meta span{display:block}.shopify-sync-recovery__meta span{font-size:.78rem;color:var(--muted);overflow-wrap:anywhere}.shopify-sync-recovery__status{margin-top:10px;font-size:.82rem;color:var(--muted)}.shopify-sync-recovery__status.ok{color:#087a47}.shopify-sync-recovery__status.error{color:#b42318}@media(max-width:700px){.shopify-sync-recovery__head,.shopify-sync-recovery__item{align-items:stretch;flex-direction:column}.shopify-sync-recovery__item .button{width:100%}}
</style>`;

const ADMIN_SHOPIFY_SYNC_RETRY_SCRIPT = `
(() => {
  const batchesBody = document.querySelector('#batches');
  if (!batchesBody || document.querySelector('[data-shopify-sync-recovery]')) return;
  const panel = batchesBody.closest('.panel');
  if (!panel) return;

  const recovery = document.createElement('div');
  recovery.className = 'shopify-sync-recovery';
  recovery.dataset.shopifySyncRecovery = '1';
  recovery.innerHTML = '<div class="shopify-sync-recovery__head"><div><h3>Shopify programming sync recovery</h3><p>Retry only the Shopify write-back for cards that already exist. This never creates, replaces or re-provisions NFC cards.</p></div><button class="button secondary compact" type="button" data-sync-refresh>Refresh</button></div><div class="shopify-sync-recovery__list" data-sync-list><div class="muted">Sign in to load Shopify-linked provisioning batches.</div></div><div class="shopify-sync-recovery__status" data-sync-status></div>';
  const tableWrap = batchesBody.closest('div');
  panel.insertBefore(recovery, tableWrap || batchesBody.parentElement);

  const list = recovery.querySelector('[data-sync-list]');
  const status = recovery.querySelector('[data-sync-status]');

  const adminToken = () => sessionStorage.getItem('tnt-admin-token') || document.querySelector('#token')?.value || '';
  const request = async (path, init = {}) => {
    const token = adminToken();
    if (!token) throw new Error('Sign in to the private admin first.');
    const response = await fetch(path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The Shopify sync request failed.');
    return data;
  };

  const setStatus = (message, kind = '') => {
    status.textContent = message;
    status.className = 'shopify-sync-recovery__status' + (kind ? ' ' + kind : '');
  };

  const linkedBatch = batch => Boolean(batch?.id)
    && typeof batch.externalOrderReference === 'string'
    && !batch.externalOrderReference.startsWith('MANUAL-');

  const render = batches => {
    const linked = (Array.isArray(batches) ? batches : []).filter(linkedBatch).slice(0, 12);
    list.replaceChildren();
    if (!linked.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'No Shopify-linked provisioning batches yet.';
      list.append(empty);
      return;
    }
    linked.forEach(batch => {
      const item = document.createElement('div');
      item.className = 'shopify-sync-recovery__item';
      const meta = document.createElement('div');
      meta.className = 'shopify-sync-recovery__meta';
      const title = document.createElement('strong');
      title.textContent = batch.externalOrderReference + ' · ' + (batch.businessName || 'Business');
      const detail = document.createElement('span');
      detail.textContent = String(batch.physicalCardCount || 0) + ' existing card' + (Number(batch.physicalCardCount) === 1 ? '' : 's') + ' · setup ' + (batch.externalSetupReference || '—');
      meta.append(title, detail);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button secondary compact';
      button.dataset.retryShopifySync = batch.id;
      button.dataset.orderReference = batch.externalOrderReference || '';
      button.dataset.cardCount = String(batch.physicalCardCount || 0);
      button.textContent = 'Retry Shopify sync';
      item.append(meta, button);
      list.append(item);
    });
  };

  const loadBatches = async () => {
    if (!adminToken()) return;
    try {
      setStatus('Loading Shopify-linked batches…');
      const data = await request('/api/admin/provisioning/batches');
      render(data.batches || []);
      setStatus('Choose Retry Shopify sync only when the cards already exist in TapNTrust.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load provisioning batches.', 'error');
    }
  };

  recovery.addEventListener('click', async event => {
    const refreshButton = event.target.closest('[data-sync-refresh]');
    if (refreshButton) {
      await loadBatches();
      return;
    }
    const button = event.target.closest('[data-retry-shopify-sync]');
    if (!button) return;
    const batchId = button.dataset.retryShopifySync;
    if (!batchId) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Syncing…';
    setStatus('Sending the existing programming URLs to Shopify. No cards are being created.');
    try {
      const data = await request('/api/admin/provisioning/batches/' + encodeURIComponent(batchId) + '/sync-shopify', {
        method: 'POST',
        body: '{}'
      });
      const cardCount = Number(data.manifest?.cards?.length || button.dataset.cardCount || 0);
      const orderName = data.shopifyOrderSync?.orderName || button.dataset.orderReference || 'Shopify order';
      button.textContent = 'Synced ✓';
      setStatus(cardCount + ' existing programming URL' + (cardCount === 1 ? '' : 's') + ' synced to ' + orderName + '. No cards were created.', 'ok');
      window.setTimeout(() => { button.textContent = original; button.disabled = false; }, 2200);
    } catch (error) {
      button.textContent = 'Retry Shopify sync';
      button.disabled = false;
      setStatus(error instanceof Error ? error.message : 'Could not sync programming URLs to Shopify.', 'error');
    }
  });

  document.querySelector('#login-form')?.addEventListener('submit', () => {
    window.setTimeout(loadBatches, 250);
    window.setTimeout(loadBatches, 750);
  });
  if (adminToken()) window.setTimeout(loadBatches, 0);
})();`;

export function enhanceAdminShopifySyncRetry(page: string): string {
  return page
    .replace("</head>", `${ADMIN_SHOPIFY_SYNC_RETRY_STYLE}</head>`)
    .replace("</script>\n</body>", `${ADMIN_SHOPIFY_SYNC_RETRY_SCRIPT}\n</script>\n</body>`);
}
