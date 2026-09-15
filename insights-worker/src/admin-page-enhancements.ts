const ADMIN_PROVISIONING_STYLE = `<style>
  .provision-source{display:flex;gap:10px;flex-wrap:wrap;padding:4px 0 2px}.provision-source label{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:12px;padding:10px 14px;background:#fff;cursor:pointer}.provision-source input{width:auto}.admin-finder{grid-column:1/-1;border:1px solid var(--line);border-radius:14px;padding:16px;background:#f8fbff}.admin-finder__top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}.admin-finder__search{position:relative}.admin-finder__search input{width:100%;border:1px solid var(--line);border-radius:10px;padding:11px 12px;font:inherit}.admin-finder__results{display:grid;gap:6px;margin-top:8px}.admin-finder__result{width:100%;text-align:left;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#fff;color:var(--navy);cursor:pointer}.admin-finder__result strong,.admin-finder__result small{display:block}.admin-finder__result small{color:var(--muted);margin-top:2px}.admin-finder__status{font-size:.82rem;color:var(--muted);margin-top:8px}.admin-finder__selected{border:1px solid #9fc2fb;border-radius:12px;padding:12px;background:#eef5ff}.admin-finder__selected strong,.admin-finder__selected span{display:block}.admin-finder__selected span{color:var(--muted);font-size:.86rem}.admin-finder__actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}@media(max-width:700px){.provision-source{display:grid}.admin-finder__top{align-items:flex-start;flex-direction:column}}
</style>`;

const ADMIN_PROVISIONING_SCRIPT = `
(() => {
  const form = document.querySelector('#provision-form');
  if (!form || form.dataset.manualEnhanced === '1') return;
  form.dataset.manualEnhanced = '1';

  const orderInput = form.elements.externalOrderReference;
  const setupInput = form.elements.externalSetupReference;
  const businessMode = form.elements.businessMode;
  const locationMode = form.elements.locationMode;
  const businessName = form.elements.businessName;
  const businessAddress = form.elements.businessAddress;
  const googlePlaceId = form.elements.googlePlaceId;
  const reviewUrl = form.elements.googleReviewUrl;
  const orderLabel = orderInput.closest('label');
  const setupLabel = setupInput.closest('label');
  const businessNameLabel = businessName.closest('label');
  const addressLabel = businessAddress.closest('label');
  const placeLabel = googlePlaceId.closest('label');
  const reviewLabel = reviewUrl.closest('label');

  const source = document.createElement('div');
  source.className = 'ops-wide';
  source.innerHTML = '<span style="display:block;font-size:.78rem;font-weight:800;color:var(--muted);margin-bottom:6px">Provision source</span><div class="provision-source"><label><input type="radio" name="provisioningSource" value="manual" checked> Manual setup</label><label><input type="radio" name="provisioningSource" value="shopify"> Shopify order</label></div><div class="muted" style="font-size:.82rem;margin-top:6px" data-source-help>Manual setup creates cards directly and does not contact Shopify.</div>';
  form.insertBefore(source, form.firstElementChild);

  const finder = document.createElement('div');
  finder.className = 'admin-finder';
  finder.innerHTML = '<div class="admin-finder__top"><div><strong>Find business on Google</strong><div class="muted" style="font-size:.82rem">Search and select the exact location. TapNTrust will fill the business name, address, Place ID and review link automatically.</div></div><button class="button secondary compact" type="button" data-finder-manual>Enter manually</button></div><div data-finder-search><div class="admin-finder__search"><input type="search" autocomplete="off" placeholder="Start typing a business name or suburb" aria-label="Find business on Google"></div><div class="admin-finder__status" data-finder-status>Type at least 3 characters.</div><div class="admin-finder__results" data-finder-results hidden></div></div><div class="admin-finder__selected" data-finder-selected hidden><strong data-finder-selected-name></strong><span data-finder-selected-address></span><span data-finder-selected-category></span><div class="admin-finder__actions"><button class="button secondary compact" type="button" data-finder-change>Change business</button><button class="button secondary compact" type="button" data-finder-manual-selected>Edit manually</button></div></div>';
  businessNameLabel.parentNode.insertBefore(finder, businessNameLabel);

  const finderSearch = finder.querySelector('[data-finder-search]');
  const finderInput = finder.querySelector('input[type="search"]');
  const finderStatus = finder.querySelector('[data-finder-status]');
  const finderResults = finder.querySelector('[data-finder-results]');
  const finderSelected = finder.querySelector('[data-finder-selected]');
  const selectedName = finder.querySelector('[data-finder-selected-name]');
  const selectedAddress = finder.querySelector('[data-finder-selected-address]');
  const selectedCategory = finder.querySelector('[data-finder-selected-category]');
  const sourceHelp = source.querySelector('[data-source-help]');
  let finderMode = 'search';
  let searchTimer = 0;
  let searchSequence = 0;

  const adminFetch = async path => {
    const adminToken = sessionStorage.getItem('tnt-admin-token') || document.querySelector('#token').value;
    const response = await fetch(path, { headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Business search is unavailable right now.');
    return data;
  };

  const clearFinderResults = () => {
    finderResults.replaceChildren();
    finderResults.hidden = true;
  };

  const setFinderFields = details => {
    businessName.value = details.businessName || '';
    businessAddress.value = details.businessAddress || '';
    googlePlaceId.value = details.googlePlaceId || '';
    reviewUrl.value = details.reviewUrl || '';
  };

  const showFinderSearch = clear => {
    finderMode = 'search';
    finderSearch.hidden = false;
    finderSelected.hidden = true;
    if (clear) {
      finderInput.value = '';
      setFinderFields({});
      finderStatus.textContent = 'Type at least 3 characters.';
      clearFinderResults();
    }
    syncFinderVisibility();
    finderInput.focus();
  };

  const showManualEntry = () => {
    finderMode = 'manual';
    finderSearch.hidden = true;
    finderSelected.hidden = true;
    clearFinderResults();
    syncFinderVisibility();
    businessName.focus();
  };

  const showSelected = details => {
    finderMode = 'selected';
    setFinderFields(details);
    selectedName.textContent = details.businessName || 'Selected business';
    selectedAddress.textContent = details.businessAddress || 'Address not supplied by Google';
    selectedCategory.textContent = details.category || 'Google business listing';
    finderSearch.hidden = true;
    finderSelected.hidden = false;
    clearFinderResults();
    syncFinderVisibility();
  };

  function syncSource() {
    const mode = form.elements.provisioningSource.value;
    const manual = mode === 'manual';
    orderLabel.hidden = manual;
    setupLabel.hidden = manual;
    orderInput.required = !manual;
    setupInput.required = !manual;
    if (manual) {
      orderInput.value = '';
      setupInput.value = '';
      sourceHelp.textContent = 'Manual setup creates cards directly in TapNTrust and does not contact Shopify.';
    } else {
      sourceHelp.textContent = 'Shopify order mode links the generated programming URLs back to the matching Shopify order.';
    }
  }

  function syncFinderVisibility() {
    const active = businessMode.value === 'new' && locationMode.value === 'new';
    finder.hidden = !active;
    if (!active) {
      businessNameLabel.hidden = businessMode.value !== 'new';
      addressLabel.hidden = locationMode.value === 'existing';
      placeLabel.hidden = locationMode.value === 'existing';
      reviewLabel.hidden = false;
      return;
    }
    const manual = finderMode === 'manual';
    businessNameLabel.hidden = !manual;
    addressLabel.hidden = !manual;
    placeLabel.hidden = !manual;
    reviewLabel.hidden = !manual;
  }

  const renderSuggestions = suggestions => {
    clearFinderResults();
    if (!suggestions.length) {
      finderStatus.textContent = 'No matching locations found. Try adding a suburb or enter the details manually.';
      return;
    }
    suggestions.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-finder__result';
      const strong = document.createElement('strong');
      strong.textContent = item.name || 'Business location';
      const small = document.createElement('small');
      small.textContent = item.address || 'Address available after selection';
      button.append(strong, small);
      button.addEventListener('click', async () => {
        finderInput.disabled = true;
        finderStatus.textContent = 'Confirming this Google location…';
        try {
          const data = await adminFetch('/api/admin/places/' + encodeURIComponent(item.placeId));
          showSelected(data.business);
          finderStatus.textContent = '';
        } catch (error) {
          finderStatus.textContent = error.message;
        } finally {
          finderInput.disabled = false;
        }
      });
      finderResults.append(button);
    });
    finderResults.hidden = false;
    finderStatus.textContent = suggestions.length + ' matching location' + (suggestions.length === 1 ? '' : 's') + '. Choose the correct address.';
  };

  finderInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    const query = finderInput.value.trim();
    const sequence = ++searchSequence;
    clearFinderResults();
    if (query.length < 3) {
      finderStatus.textContent = query ? 'Keep typing to search.' : 'Type at least 3 characters.';
      return;
    }
    finderStatus.textContent = 'Searching Google business locations…';
    searchTimer = window.setTimeout(async () => {
      try {
        const data = await adminFetch('/api/admin/places/search?q=' + encodeURIComponent(query));
        if (sequence !== searchSequence) return;
        renderSuggestions(data.suggestions || []);
      } catch (error) {
        if (sequence !== searchSequence) return;
        finderStatus.textContent = error.message + ' You can enter the details manually instead.';
      }
    }, 280);
  });

  finder.querySelector('[data-finder-manual]').addEventListener('click', showManualEntry);
  finder.querySelector('[data-finder-manual-selected]').addEventListener('click', showManualEntry);
  finder.querySelector('[data-finder-change]').addEventListener('click', () => showFinderSearch(true));
  source.querySelectorAll('input[name="provisioningSource"]').forEach(input => input.addEventListener('change', syncSource));
  businessMode.addEventListener('change', syncFinderVisibility);
  locationMode.addEventListener('change', syncFinderVisibility);

  const description = form.previousElementSibling;
  if (description && description.classList.contains('muted')) {
    description.textContent = 'Create cards manually or from a Shopify order. Every physical card receives its own permanent TapNTrust redirect URL.';
  }

  syncSource();
  syncFinderVisibility();
})();`;

export function enhanceAdminPage(page: string): string {
  return page
    .replace("</head>", `${ADMIN_PROVISIONING_STYLE}</head>`)
    .replace("</script>\n</body>", `${ADMIN_PROVISIONING_SCRIPT}\n</script>\n</body>`);
}
