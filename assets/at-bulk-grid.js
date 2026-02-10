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

/** Theme add-to-cart icon (icon-add-to-cart.svg) – same as add-to-cart-button secondary */
const ADD_TO_CART_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="var(--icon-stroke-width)" d="M16.608 9.421V6.906H3.392v8.016c0 .567.224 1.112.624 1.513.4.402.941.627 1.506.627H8.63M8.818 3h2.333c.618 0 1.212.247 1.649.686a2.35 2.35 0 0 1 .683 1.658v1.562H6.486V5.344c0-.622.246-1.218.683-1.658A2.33 2.33 0 0 1 8.82 3"/><path stroke="currentColor" stroke-linecap="round" stroke-width="var(--icon-stroke-width)" d="M14.608 12.563v5m2.5-2.5h-5"/></svg>';

/**
 * @param {string} sectionId
 * @returns {{ productId: number, productUrl: string, sectionId: string, variants: Array<{ id: number, available: boolean, inventory_quantity: number, inventory_policy: string, option1: string, option2?: string, option3?: string }>, options: Array<{ name: string, position: number, values: string[] }> } | null}
 */
/**
 * Normalize variant objects from compact JSON keys (a,q,p,o1,o2,o3) to full names.
 * Liquid can output compact keys to reduce payload size and avoid truncation.
 */
function normalizeBulkConfig(config) {
  if (!config || !Array.isArray(config.variants)) return config;
  config.variants.forEach((v) => {
    if (v.a !== undefined) v.available = v.a;
    if (v.q !== undefined) v.inventory_quantity = v.q;
    if (v.p !== undefined) v.inventory_policy = v.p;
    if (v.o1 !== undefined) v.option1 = v.o1;
    if (v.o2 !== undefined) v.option2 = v.o2;
    if (v.o3 !== undefined) v.option3 = v.o3;
  });
  return config;
}

function getBulkConfig(sectionId) {
  const section = document.getElementById(`shopify-section-${sectionId}`);
  if (!section) return null;
  const script = section.querySelector(BULK_GRID_SELECTORS.configScript);
  if (!script || !script.textContent) return null;
  try {
    const config = JSON.parse(script.textContent.trim());
    return normalizeBulkConfig(config);
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

  /** Normalize option value for matching (trim, avoid null) */
  const norm = (s) => (s == null ? '' : String(s).trim());
  /** Pre-build map so every variant is findable by (valA|valB) or (valB|valA) – no position/order dependency */
  const variantByOptionPair = new Map();
  config.variants.forEach((v) => {
    const a = norm(v.option1);
    const b = norm(v.option2);
    const c = norm(v.option3);
    if (a && b) {
      variantByOptionPair.set(a + '|' + b, v);
      variantByOptionPair.set(b + '|' + a, v);
    }
    if (a && c) {
      variantByOptionPair.set(a + '|' + c, v);
      variantByOptionPair.set(c + '|' + a, v);
    }
    if (b && c) {
      variantByOptionPair.set(b + '|' + c, v);
      variantByOptionPair.set(c + '|' + b, v);
    }
  });
  const getVariant = (rowVal, colVal) => {
    const r = norm(rowVal);
    const c = norm(colVal);
    return variantByOptionPair.get(r + '|' + c) || variantByOptionPair.get(c + '|' + r);
  };

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
      const v = getVariant(color, size);
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
    '<div class="at-bulk-grid__actions" data-at-bulk-has-quantity="false">' +
    '<span class="at-bulk-grid__total" data-at-bulk-total>Total: 0</span>' +
    '<button type="button" class="button add-to-cart-button button-secondary" data-at-bulk-add-to-cart>' +
    '<span class="add-to-cart-text"><span aria-hidden="true" class="svg-wrapper add-to-cart-icon">' +
    ADD_TO_CART_ICON_SVG +
    '</span><span class="add-to-cart-text__content">Add to cart</span></span>' +
    '</button>' +
    '<button type="button" class="button" data-at-bulk-buy-now>Buy it now</button>' +
    '</div>';

  container.innerHTML = html;
  container.dataset.atBulkGridSectionId = sectionId;

  const searchEl = container.querySelector(BULK_GRID_SELECTORS.search);
  const totalEl = container.querySelector('[data-at-bulk-total]');
  const addBtn = container.querySelector('[data-at-bulk-add-to-cart]');
  const buyNowBtn = container.querySelector('[data-at-bulk-buy-now]');

  const updateTotal = () => {
    const inputs = container.querySelectorAll('[data-at-bulk-qty]');
    let sum = 0;
    inputs.forEach((input) => {
      sum += parseInt(input.value, 10) || 0;
    });
    if (totalEl) totalEl.textContent = 'Total: ' + sum;
    const actionsEl = container.querySelector('.at-bulk-grid__actions');
    if (actionsEl) actionsEl.setAttribute('data-at-bulk-has-quantity', sum > 0 ? 'true' : 'false');
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

  const submitBulkItems = (redirectToCheckout) => {
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
        if (redirectToCheckout) {
          window.location.href = root + 'checkout';
          return;
        }
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
  };

  if (addBtn) addBtn.addEventListener('click', () => submitBulkItems(false));
  if (buyNowBtn) buyNowBtn.addEventListener('click', () => submitBulkItems(true));

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

  const normMobile = (s) => (s == null ? '' : String(s).trim());
  const variantByOptionPairMobile = new Map();
  config.variants.forEach((v) => {
    const a = normMobile(v.option1);
    const b = normMobile(v.option2);
    const c = normMobile(v.option3);
    if (a && b) {
      variantByOptionPairMobile.set(a + '|' + b, v);
      variantByOptionPairMobile.set(b + '|' + a, v);
    }
    if (a && c) {
      variantByOptionPairMobile.set(a + '|' + c, v);
      variantByOptionPairMobile.set(c + '|' + a, v);
    }
    if (b && c) {
      variantByOptionPairMobile.set(b + '|' + c, v);
      variantByOptionPairMobile.set(c + '|' + b, v);
    }
  });
  const getVariantMobile = (rowVal, colVal) => {
    const r = normMobile(rowVal);
    const c = normMobile(colVal);
    return variantByOptionPairMobile.get(r + '|' + c) || variantByOptionPairMobile.get(c + '|' + r);
  };

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
      const v = getVariantMobile(color, size);
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
    '<div class="at-bulk-grid__actions" data-at-bulk-has-quantity="false">' +
    '<span class="at-bulk-grid__total" data-at-bulk-total>Total: 0</span>' +
    '<button type="button" class="button add-to-cart-button button-secondary" data-at-bulk-add-to-cart>' +
    '<span class="add-to-cart-text"><span aria-hidden="true" class="svg-wrapper add-to-cart-icon">' +
    ADD_TO_CART_ICON_SVG +
    '</span><span class="add-to-cart-text__content">Add to cart</span></span>' +
    '</button>' +
    '<button type="button" class="button" data-at-bulk-buy-now>Buy it now</button>' +
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
    const actionsEl = container.querySelector('.at-bulk-grid__actions');
    if (actionsEl) actionsEl.setAttribute('data-at-bulk-has-quantity', sum > 0 ? 'true' : 'false');
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

  const getLineItemsMobile = () => {
    const items = [];
    container.querySelectorAll('[data-at-bulk-qty]').forEach((input) => {
      const qty = parseInt(input.value, 10) || 0;
      if (qty > 0 && input.dataset.variantId) {
        items.push({ id: parseInt(input.dataset.variantId, 10), quantity: qty });
      }
    });
    return items;
  };

  const submitBulkItemsMobile = (redirectToCheckout) => {
    const items = getLineItemsMobile();
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
        if (redirectToCheckout) {
          window.location.href = root + 'checkout';
          return;
        }
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
  };

  const addBtnMobile = container.querySelector('[data-at-bulk-add-to-cart]');
  const buyNowBtnMobile = container.querySelector('[data-at-bulk-buy-now]');
  if (addBtnMobile) addBtnMobile.addEventListener('click', () => submitBulkItemsMobile(false));
  if (buyNowBtnMobile) buyNowBtnMobile.addEventListener('click', () => submitBulkItemsMobile(true));

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
