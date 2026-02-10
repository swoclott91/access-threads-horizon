/**
 * AT Bulk order grid – opens modal/sheet, renders color×size grid, aggregates quantities.
 * Hooks into data-at-bulk-grid, data-at-bulk-grid-trigger, data-at-bulk-line-items.
 * Uses variant data from AT variant picker (script[data-at-bulk-grid-config]).
 */

const BULK_GRID_SELECTORS = {
  container: '[data-at-bulk-grid]',
  trigger: '[data-at-bulk-grid-trigger]',
  lineItemsInput: '[data-at-bulk-line-items]',
  configScript: 'script[data-at-bulk-grid-config]',
  search: '[data-at-bulk-search]',
};

const MOBILE_BREAKPOINT = 750;

/**
 * @param {string} sectionId
 * @returns {{ productId: number, productUrl: string, sectionId: string, variants: Array<{ id: number, available: boolean, inventory_quantity: number, inventory_policy: string, option1: string, option2?: string, option3?: string }>, options: Array<{ name: string, position: number, values: string[] }> } | null}
 */
function getBulkConfig(sectionId) {
  const section = document.getElementById(`shopify-section-${sectionId}`);
  if (!section) return null;
  const script = section.querySelector(BULK_GRID_SELECTORS.configScript);
  if (!script || !script.textContent) return null;
  try {
    return JSON.parse(script.textContent.trim());
  } catch {
    return null;
  }
}

/**
 * @param {number} qty
 * @param {boolean} available
 * @param {number} inventory
 * @param {string} policy
 * @returns {string}
 */
function availabilityBand(qty, available, inventory, policy) {
  if (!available) return 'Out';
  if (policy !== 'deny' || inventory === null || inventory === undefined) return 'In stock';
  if (inventory <= 0) return 'Out';
  if (inventory < 25) return 'Limited';
  if (inventory < 100) return '25+';
  return '100+';
}

/**
 * @param {HTMLElement} container
 * @param {ReturnType<getBulkConfig>} config
 * @param {string} sectionId
 */
function renderDesktopGrid(container, config, sectionId) {
  if (!config || !config.variants?.length || !config.options?.length) {
    container.innerHTML = '<p class="at-bulk-grid__empty">No variants available for bulk order.</p>';
    return;
  }

  const optionRow = config.options[0];
  const optionCol = config.options[1] || config.options[0];
  const colorValues = optionRow.values || [];
  const colorDetails = optionRow.valueDetails || [];
  const sizeValues = optionCol.values || [];
  const optionRowName = optionRow.name;
  const optionColName = optionCol.name;

  const getSwatchStyle = (colorName) => {
    const detail = colorDetails.find((d) => d && d.name === colorName);
    if (!detail || !detail.swatchBackground) return '';
    return 'background:' + String(detail.swatchBackground).replace(/"/g, "'") + ';';
  };

  const getVariant = (opt1, opt2) =>
    config.variants.find(
      (v) =>
        (v.option1 === opt1 && (optionColName === optionRowName ? true : v.option2 === opt2)) ||
        (v.option2 === opt1 && v.option1 === opt2)
    ) ||
    config.variants.find((v) => v.option1 === opt1 && (v.option2 === opt2 || (!opt2 && !v.option2)));

  let html = '';
  html += '<div class="at-bulk-grid__search-wrap">';
  html += `<input type="search" class="at-bulk-grid__search" placeholder="Search ${optionRowName}..." data-at-bulk-search aria-label="Search ${optionRowName}">`;
  html += '</div>';
  html += '<div class="at-bulk-grid__table-wrapper">';
  html += '<table class="at-bulk-grid__table">';
  html += '<thead><tr><th>' + optionRowName + '</th>';
  sizeValues.forEach((s) => {
    html += '<th>' + s + '</th>';
  });
  html += '</tr></thead><tbody>';

  colorValues.forEach((color) => {
    const swatchStyle = getSwatchStyle(color);
    html += '<tr data-at-bulk-color-row data-at-bulk-color-value="' + escapeAttr(color) + '">';
    html += '<td class="at-bulk-grid__color-cell">';
    if (swatchStyle) {
      html += '<span class="at-bulk-grid__swatch swatch" style="' + swatchStyle + '" aria-hidden="true"></span>';
    }
    html += '<span class="at-bulk-grid__color-name">' + escapeHtml(color) + '</span></td>';
    sizeValues.forEach((size) => {
      const v = getVariant(color, size) || getVariant(size, color);
      if (!v) {
        html += '<td>—</td>';
        return;
      }
      const band = availabilityBand(
        v.inventory_quantity,
        v.available,
        v.inventory_quantity,
        v.inventory_policy || ''
      );
      const bandClass =
        band === 'Out'
          ? 'at-bulk-grid__availability--out'
          : band === 'Limited'
            ? 'at-bulk-grid__availability--low'
            : 'at-bulk-grid__availability--in-stock';
      html +=
        '<td data-at-bulk-cell data-variant-id="' +
        v.id +
        '">' +
        '<input type="number" class="at-bulk-grid__qty-input" min="0" value="0" data-at-bulk-qty data-variant-id="' +
        v.id +
        '" aria-label="Quantity ' +
        escapeAttr(color) +
        ' ' +
        escapeAttr(size) +
        '">' +
        '<span class="at-bulk-grid__availability ' +
        bandClass +
        '">' +
        band +
        '</span></td>';
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  html +=
    '<div class="at-bulk-grid__actions">' +
    '<span class="at-bulk-grid__total" data-at-bulk-total>Total: 0</span>' +
    '<button type="button" class="button add-to-cart-button" data-at-bulk-add-to-cart>Add to cart</button>' +
    '</div>';

  container.innerHTML = html;
  container.dataset.atBulkGridSectionId = sectionId;

  const searchEl = container.querySelector(BULK_GRID_SELECTORS.search);
  const totalEl = container.querySelector('[data-at-bulk-total]');
  const addBtn = container.querySelector('[data-at-bulk-add-to-cart]');

  const updateTotal = () => {
    const inputs = container.querySelectorAll('[data-at-bulk-qty]');
    let sum = 0;
    inputs.forEach((input) => {
      sum += parseInt(input.value, 10) || 0;
    });
    if (totalEl) totalEl.textContent = 'Total: ' + sum;
  };

  const getLineItems = () => {
    const items = [];
    container.querySelectorAll('[data-at-bulk-qty]').forEach((input) => {
      const qty = parseInt(input.value, 10) || 0;
      if (qty > 0 && input.dataset.variantId) {
        items.push({ id: parseInt(input.dataset.variantId, 10), quantity: qty });
      }
    });
    return items;
  };

  container.querySelectorAll('[data-at-bulk-qty]').forEach((input) => {
    input.addEventListener('input', updateTotal);
    input.addEventListener('change', updateTotal);
  });

  if (searchEl) {
    searchEl.addEventListener('input', () => {
      const q = (searchEl.value || '').trim().toLowerCase();
      container.querySelectorAll('[data-at-bulk-color-row]').forEach((row) => {
        const val = (row.dataset.atBulkColorValue || '').toLowerCase();
        row.style.display = q && !val.includes(q) ? 'none' : '';
      });
    });
  }

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const items = getLineItems();
      if (items.length === 0) return;
      const section = document.getElementById(`shopify-section-${sectionId}`);
      const form = section?.querySelector('[data-at-bulk-form]');
      const lineItemsInput = form?.querySelector(BULK_GRID_SELECTORS.lineItemsInput);
      if (lineItemsInput) lineItemsInput.value = JSON.stringify(items);

      const root = window.Shopify?.routes?.root || '/';
      fetch(root + 'cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.status && data.status !== 200) {
            console.warn('at-bulk-grid: cart add response', data);
          }
          window.dispatchEvent(new CustomEvent('at:bulk:added', { detail: { items, response: data } }));
          const rootRefresh = window.Shopify?.routes?.root || '/';
          fetch(rootRefresh + 'cart.js')
            .then((r) => r.json())
            .then((cart) => {
              document.body.dispatchEvent(
                new CustomEvent('cart:update', {
                  bubbles: true,
                  detail: { resource: cart, sourceId: 'at-bulk-grid', data: {} },
                })
              );
            })
            .catch(() => {});
        })
        .catch((err) => console.error('at-bulk-grid: cart add failed', err));
    });
  }

  updateTotal();
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Mobile: accordion per color, size rows with qty + availability.
 */
function renderMobileGrid(container, config, sectionId) {
  if (!config || !config.variants?.length || !config.options?.length) {
    container.innerHTML = '<p class="at-bulk-grid__empty">No variants available for bulk order.</p>';
    return;
  }

  const optionRow = config.options[0];
  const optionCol = config.options[1] || config.options[0];
  const colorValues = optionRow.values || [];
  const colorDetails = optionRow.valueDetails || [];
  const sizeValues = optionCol.values || [];
  const optionRowName = optionRow.name;
  const optionColName = optionCol.name;

  const getSwatchStyle = (colorName) => {
    const detail = colorDetails.find((d) => d && d.name === colorName);
    if (!detail || !detail.swatchBackground) return '';
    return 'background:' + String(detail.swatchBackground).replace(/"/g, "'") + ';';
  };

  const getVariant = (opt1, opt2) =>
    config.variants.find(
      (v) =>
        (v.option1 === opt1 && (optionColName === optionRowName ? true : v.option2 === opt2)) ||
        (v.option2 === opt1 && v.option1 === opt2)
    ) || config.variants.find((v) => v.option1 === opt1 && (v.option2 === opt2 || (!opt2 && !v.option2)));

  let html = '';
  html += '<input type="search" class="at-bulk-grid__search" placeholder="Search ' + escapeAttr(optionRowName) + '..." data-at-bulk-search aria-label="Search ' + escapeAttr(optionRowName) + '">';
  html += '<div class="at-bulk-grid__mobile-accordions">';

  colorValues.forEach((color) => {
    const swatchStyle = getSwatchStyle(color);
    html += '<div class="at-bulk-grid__mobile-accordion" data-at-bulk-color-row data-at-bulk-color-value="' + escapeAttr(color) + '">';
    html += '<button type="button" class="at-bulk-grid__mobile-accordion-header" data-at-bulk-accordion-toggle aria-expanded="false">';
    if (swatchStyle) {
      html += '<span class="at-bulk-grid__swatch swatch" style="' + swatchStyle + '" aria-hidden="true"></span>';
    }
    html += '<span class="at-bulk-grid__color-name">' + escapeHtml(color) + '</span> <span aria-hidden="true">+</span>';
    html += '</button>';
    html += '<div class="at-bulk-grid__mobile-accordion-content" hidden>';
    sizeValues.forEach((size) => {
      const v = getVariant(color, size) || getVariant(size, color);
      if (!v) return;
      const band = availabilityBand(
        v.inventory_quantity,
        v.available,
        v.inventory_quantity,
        v.inventory_policy || ''
      );
      const bandClass =
        band === 'Out'
          ? 'at-bulk-grid__availability--out'
          : band === 'Limited'
            ? 'at-bulk-grid__availability--low'
            : 'at-bulk-grid__availability--in-stock';
      html +=
        '<div class="at-bulk-grid__mobile-size-row">' +
        '<span>' +
        escapeHtml(size) +
        ' <span class="at-bulk-grid__availability ' +
        bandClass +
        '">' +
        band +
        '</span></span>' +
        '<input type="number" class="at-bulk-grid__qty-input" min="0" value="0" data-at-bulk-qty data-variant-id="' +
        v.id +
        '" aria-label="Quantity ' +
        escapeAttr(size) +
        '">' +
        '</div>';
    });
    html += '</div></div>';
  });

  html += '</div>';
  html +=
    '<div class="at-bulk-grid__actions">' +
    '<span class="at-bulk-grid__total" data-at-bulk-total>Total: 0</span>' +
    '<button type="button" class="button add-to-cart-button" data-at-bulk-add-to-cart>Add to cart</button>' +
    '</div>';

  container.innerHTML = html;
  container.dataset.atBulkGridSectionId = sectionId;

  container.querySelectorAll('[data-at-bulk-accordion-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const content = btn.nextElementSibling;
      const open = content?.getAttribute('hidden') != null;
      content?.toggleAttribute('hidden', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (btn.querySelector('span[aria-hidden="true"]')) {
        btn.querySelector('span[aria-hidden="true"]').textContent = open ? '−' : '+';
      }
    });
  });

  const totalEl = container.querySelector('[data-at-bulk-total]');
  const updateTotal = () => {
    const inputs = container.querySelectorAll('[data-at-bulk-qty]');
    let sum = 0;
    inputs.forEach((input) => {
      sum += parseInt(input.value, 10) || 0;
    });
    if (totalEl) totalEl.textContent = 'Total: ' + sum;
  };
  container.querySelectorAll('[data-at-bulk-qty]').forEach((input) => {
    input.addEventListener('input', updateTotal);
    input.addEventListener('change', updateTotal);
  });

  const searchEl = container.querySelector('.at-bulk-grid__search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      const q = (searchEl.value || '').trim().toLowerCase();
      container.querySelectorAll('[data-at-bulk-color-row]').forEach((row) => {
        const val = (row.dataset.atBulkColorValue || '').toLowerCase();
        row.style.display = q && !val.includes(q) ? 'none' : '';
      });
    });
  }

  const addBtn = container.querySelector('[data-at-bulk-add-to-cart]');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const items = [];
      container.querySelectorAll('[data-at-bulk-qty]').forEach((input) => {
        const qty = parseInt(input.value, 10) || 0;
        if (qty > 0 && input.dataset.variantId) {
          items.push({ id: parseInt(input.dataset.variantId, 10), quantity: qty });
        }
      });
      if (items.length === 0) return;
      const section = document.getElementById(`shopify-section-${sectionId}`);
      const form = section?.querySelector('[data-at-bulk-form]');
      const lineItemsInput = form?.querySelector(BULK_GRID_SELECTORS.lineItemsInput);
      if (lineItemsInput) lineItemsInput.value = JSON.stringify(items);

      const root = window.Shopify?.routes?.root || '/';
      fetch(root + 'cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.status && data.status !== 200) {
            console.warn('at-bulk-grid: cart add response', data);
          }
          window.dispatchEvent(new CustomEvent('at:bulk:added', { detail: { items, response: data } }));
          const root = window.Shopify?.routes?.root || '/';
          fetch(root + 'cart.js')
            .then((r) => r.json())
            .then((cart) => {
              document.body.dispatchEvent(
                new CustomEvent('cart:update', {
                  bubbles: true,
                  detail: { resource: cart, sourceId: 'at-bulk-grid', data: {} },
                })
              );
            })
            .catch(() => {});
        })
        .catch((err) => console.error('at-bulk-grid: cart add failed', err));
    });
  }

  updateTotal();
}

function renderGrid(container) {
  const sectionId = container.dataset.atBulkGridSectionId;
  if (!sectionId) return;
  const config = getBulkConfig(sectionId);
  const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
  if (isMobile) {
    renderMobileGrid(container, config, sectionId);
  } else {
    renderDesktopGrid(container, config, sectionId);
  }
}

function init() {
  document.querySelectorAll(BULK_GRID_SELECTORS.trigger).forEach((trigger) => {
    trigger.addEventListener('click', (e) => {
      const container = document.querySelector(BULK_GRID_SELECTORS.container);
      if (!container) return;
      const dialogComponent = container.closest('dialog-component');
      if (dialogComponent && !trigger.closest('dialog-component')?.contains(container)) {
        e.preventDefault();
        if (typeof dialogComponent.showDialog === 'function') {
          dialogComponent.showDialog();
        }
      }
    });
  });

  document.querySelectorAll(BULK_GRID_SELECTORS.container).forEach((container) => {
    const dialogComponent = container.closest('dialog-component');
    if (dialogComponent) {
      dialogComponent.addEventListener('dialog:open', () => {
        renderGrid(container);
      });
    }
  });

  window.addEventListener('resize', () => {
    document.querySelectorAll(BULK_GRID_SELECTORS.container).forEach((container) => {
      if (container.dataset.atBulkSectionId && container.closest('dialog')?.open) {
        renderGrid(container);
      }
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
