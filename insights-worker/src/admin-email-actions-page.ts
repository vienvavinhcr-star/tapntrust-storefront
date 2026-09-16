const ADMIN_EMAIL_ACTIONS_STYLE = `<style>
  .crm-table{min-width:1480px}.tnt-email-actions{min-width:205px}.tnt-email-actions__stack{display:grid;gap:9px}.tnt-email-actions__group{display:grid;gap:5px;padding-bottom:8px;border-bottom:1px solid var(--line)}.tnt-email-actions__group:last-child{padding-bottom:0;border-bottom:0}.tnt-email-actions__label{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:850}.tnt-email-pill{display:inline-flex;width:max-content;align-items:center;gap:5px;padding:4px 8px;border-radius:999px;font-size:.69rem;font-weight:900}.tnt-email-pill.sent{background:#e8f8ef;color:#087a47}.tnt-email-pill.ready{background:#edf3ff;color:#1254c0}.tnt-email-pill.no{background:#f2f4f7;color:#667085}.tnt-email-pill.warn{background:#fff7df;color:#9a6700}.tnt-email-button{width:max-content;border:1px solid #b9cff5;background:#fff;color:#0b5cff;border-radius:8px;padding:6px 9px;font:inherit;font-size:.72rem;font-weight:850;cursor:pointer}.tnt-email-button:hover{background:#f5f8ff}.tnt-email-button:disabled{cursor:not-allowed;opacity:.62}.tnt-email-actions__email{font-size:.69rem;color:var(--muted);overflow-wrap:anywhere}.tnt-email-actions__error{font-size:.7rem;color:#b42318;line-height:1.35}.tnt-email-actions__loading{font-size:.72rem;color:var(--muted)}
</style>`;

const ADMIN_EMAIL_ACTIONS_SCRIPT = `
(() => {
  const statusCache = new Map();
  const pending = new Map();

  function adminToken() {
    const stored = sessionStorage.getItem('tnt-admin-token');
    const input = document.querySelector('#token');
    return stored || (input ? input.value : '') || '';
  }

  async function apiRequest(path, init) {
    const token = adminToken();
    if (!token) throw new Error('Sign in to the private admin first.');
    const options = init || {};
    const headers = Object.assign({}, options.headers || {}, {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    });
    const response = await fetch(path, Object.assign({}, options, { headers: headers }));
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'Email action failed.');
    return data;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function orderReferenceFromRow(row) {
    const firstCell = row.cells && row.cells.length ? row.cells[0] : null;
    if (!firstCell) return '';
    const lines = Array.from(firstCell.querySelectorAll('.crm-sub'));
    const orderLine = lines.find(function (node) {
      return node.textContent.trim().indexOf('Order:') === 0;
    });
    if (!orderLine) return '';
    const raw = orderLine.textContent.trim();
    const value = raw.slice('Order:'.length).trim();
    return value === 'Manual / legacy setup' ? '' : value;
  }

  function totalCardsFromRow(row) {
    const cell = row.cells && row.cells.length > 2 ? row.cells[2] : null;
    const numberNode = cell ? cell.querySelector('.crm-number') : null;
    const text = numberNode ? numberNode.textContent : '';
    const parts = String(text || '').split('/');
    if (parts.length < 2) return 0;
    const total = Number(parts[1].trim());
    return Number.isFinite(total) ? total : 0;
  }

  function cellHtml(status) {
    if (!status.hasCards) return '<div class="tnt-email-pill no">No provisioned cards</div>';

    const emailHtml = status.email
      ? '<div class="tnt-email-actions__email">Send to: ' + esc(status.email) + '</div>'
      : '<div class="tnt-email-actions__error">No customer email captured</div>';

    const quickHtml = status.quickGuideSent
      ? '<div class="tnt-email-pill sent">✓ Quick Guide Sent</div>'
      : '<div class="tnt-email-pill ready">Quick Guide Ready</div>' + (status.email ? '<button class="tnt-email-button" type="button" data-email-kind="quick-guide">Send Quick Guide</button>' : '');

    let insightsHtml = '<div class="tnt-email-pill no">Insights not purchased</div>';
    if (status.hasInsightsPurchase) {
      insightsHtml = status.insightsSent
        ? '<div class="tnt-email-pill sent">✓ Insights Email Sent</div>'
        : '<div class="tnt-email-pill ready">Insights Purchased</div>' + (status.email ? '<button class="tnt-email-button" type="button" data-email-kind="insights">Send Insights Email</button>' : '');
    }

    return '<div class="tnt-email-actions__stack">' + emailHtml
      + '<div class="tnt-email-actions__group"><div class="tnt-email-actions__label">Quick setup guide</div>' + quickHtml + '</div>'
      + '<div class="tnt-email-actions__group"><div class="tnt-email-actions__label">Tapntrust Insights</div>' + insightsHtml + '</div>'
      + '</div>';
  }

  function renderCell(cell, status) {
    cell.innerHTML = cellHtml(status);
    if (status.orderReference) cell.dataset.orderReference = status.orderReference;
  }

  async function loadStatus(orderReference, cell) {
    if (!orderReference) {
      cell.innerHTML = '<div class="tnt-email-pill no">No Shopify order</div>';
      return;
    }
    if (statusCache.has(orderReference)) {
      renderCell(cell, statusCache.get(orderReference));
      return;
    }

    cell.innerHTML = '<div class="tnt-email-actions__loading">Checking email status…</div>';
    let task = pending.get(orderReference);
    if (!task) {
      task = apiRequest('/api/admin/email-actions/status?orderReference=' + encodeURIComponent(orderReference))
        .then(function (data) {
          statusCache.set(orderReference, data.status);
          return data.status;
        })
        .finally(function () { pending.delete(orderReference); });
      pending.set(orderReference, task);
    }

    try {
      renderCell(cell, await task);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not check email status.';
      cell.innerHTML = '<div class="tnt-email-actions__error">' + esc(message) + '</div><button class="tnt-email-button" type="button" data-email-retry>Retry</button>';
    }
  }

  function ensureHeader(table) {
    const row = table ? table.querySelector('thead tr') : null;
    if (!row || row.querySelector('[data-email-actions-header]')) return;
    const th = document.createElement('th');
    th.dataset.emailActionsHeader = '1';
    th.textContent = 'Email actions';
    row.append(th);
  }

  function decorateRows() {
    const panel = document.querySelector('#crm-analytics');
    const table = panel ? panel.querySelector('.crm-table') : null;
    const body = panel ? panel.querySelector('[data-crm-body]') : null;
    if (!table || !body) return;

    ensureHeader(table);
    Array.from(body.children).forEach(function (row) {
      if (!row || row.tagName !== 'TR') return;
      let cell = row.querySelector('td[data-email-actions-cell]');
      if (!cell) {
        cell = document.createElement('td');
        cell.className = 'tnt-email-actions';
        cell.dataset.emailActionsCell = '1';
        row.append(cell);
      }

      const orderReference = orderReferenceFromRow(row);
      cell.dataset.orderReference = orderReference;
      if (totalCardsFromRow(row) <= 0) {
        cell.innerHTML = '<div class="tnt-email-pill no">No cards</div>';
        return;
      }

      if (cell.dataset.statusLoadedFor !== orderReference) {
        cell.dataset.statusLoadedFor = orderReference;
        loadStatus(orderReference, cell);
      }
    });
  }

  async function sendEmail(button, kind, cell) {
    const orderReference = cell.dataset.orderReference || '';
    const current = statusCache.get(orderReference);
    const email = current && current.email ? current.email : '';
    const label = kind === 'quick-guide' ? 'Quick Guide' : 'Tapntrust Insights email';
    const confirmation = email
      ? 'Send ' + label + ' to ' + email + ' for order ' + orderReference + '?'
      : 'Send ' + label + ' for order ' + orderReference + '?';
    if (!window.confirm(confirmation)) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const data = await apiRequest('/api/admin/email-actions/send', {
        method: 'POST',
        body: JSON.stringify({ orderReference: orderReference, kind: kind })
      });
      statusCache.set(orderReference, data.status);
      renderCell(cell, data.status);
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      let messageNode = cell.querySelector('.tnt-email-actions__error');
      if (!messageNode) {
        messageNode = document.createElement('div');
        messageNode.className = 'tnt-email-actions__error';
        cell.append(messageNode);
      }
      messageNode.textContent = error instanceof Error ? error.message : 'Could not send email.';
    }
  }

  document.addEventListener('click', function (event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const button = target.closest('[data-email-kind]');
    if (button) {
      const cell = button.closest('[data-email-actions-cell]');
      if (cell) sendEmail(button, button.dataset.emailKind, cell);
      return;
    }

    const retry = target.closest('[data-email-retry]');
    if (retry) {
      const cell = retry.closest('[data-email-actions-cell]');
      if (!cell) return;
      const orderReference = cell.dataset.orderReference || '';
      statusCache.delete(orderReference);
      cell.dataset.statusLoadedFor = '';
      loadStatus(orderReference, cell);
    }
  });

  document.addEventListener('click', function (event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target && (target.closest('[data-crm-refresh]') || target.closest('[data-crm-period]'))) statusCache.clear();
  }, true);

  document.addEventListener('change', function (event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('[data-crm-date]')) statusCache.clear();
  }, true);

  function start() {
    const body = document.querySelector('#crm-analytics [data-crm-body]');
    if (!body) return false;
    const observer = new MutationObserver(function () {
      window.setTimeout(decorateRows, 0);
    });
    observer.observe(body, { childList: true });
    decorateRows();
    return true;
  }

  if (!start()) {
    const pageObserver = new MutationObserver(function () {
      if (start()) pageObserver.disconnect();
    });
    pageObserver.observe(document.body, { childList: true, subtree: true });
  }
})();`;

export function enhanceAdminEmailActionsPage(page: string): string {
  return page
    .replace("</head>", `${ADMIN_EMAIL_ACTIONS_STYLE}</head>`)
    .replace("</script>\n</body>", `${ADMIN_EMAIL_ACTIONS_SCRIPT}\n</script>\n</body>`);
}
