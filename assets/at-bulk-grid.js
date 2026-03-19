/**
 * AT Bulk order grid – opens modal/sheet, renders color×size grid, aggregates quantities.
 * Hooks into data-at-bulk-grid, data-at-bulk-grid-trigger, data-at-bulk-line-items.
 * Uses variant data from AT variant picker (script[data-at-bulk-grid-config]).
 */

import { formatMoney } from '@theme/money-formatting';
import { CartAddEvent } from '@theme/events';

const BULK_GRID_SELECTORS = {
  container: '[data-at-bulk-grid]',
  trigger: '[data-at-bulk-grid-trigger]',
  lineItemsInput: '[data-at-bulk-line-items]',
  configScript: 'script[data-at-bulk-grid-config]',
  search: '[data-at-bulk-search]',
};

const MOBILE_BREAKPOINT = 750;

/** Quick-add context constants */
const QUICK_ADD_MODAL_CONTENT_ID = 'quick-add-modal-content';
const QUICK_ADD_BULK_DIALOG_ID = 'at-bulk-grid-quick-add-dialog';
const QUICK_ADD_CLOSE_BTN_ID = 'at-bulk-grid-quick-add-close';
/** Sentinel sectionId key used to store quick-add config in the cache */
const QUICK_ADD_SECTION_KEY = '__at_quick_add__';

const CART_ICON_SELECTOR = '.header-actions__cart-icon';

/**
 * On successful bulk add: optional fly animation, close modal, reset inputs, dispatch CartAddEvent.
 * Cart opens after fly animation completes (0.6s) to match theme add-to-cart timing.
 * @param {HTMLElement} container - Bulk grid container
 * @param {() => void} updateTotal - Function to refresh total display
 * @param {HTMLButtonElement | null} addBtn - Add to cart button (source for fly animation)
 * @param {string} sectionId - Section ID for config lookup
 * @param {Object} cart - Cart object from cart.js
 */
async function handleBulkAddSuccess(container, updateTotal, addBtn, sectionId, cart) {
  const doAnimation = container.dataset.atBulkAddToCartAnimation === 'true';
  const config = getBulkConfig(sectionId) || bulkGridConfigCache.get(sectionId);
  const productImage = config?.productFeaturedImage;

  /** @type {Element | null} */
  let flyToCartEl = null;
  if (doAnimation && addBtn && productImage && customElements.get('fly-to-cart')) {
    const cartIcon = document.querySelector(CART_ICON_SELECTOR);
    const dialog = container.closest('dialog');
    if (cartIcon) {
      flyToCartEl = document.createElement('fly-to-cart');
      flyToCartEl.classList.add('fly-to-cart--main');
      flyToCartEl.style.setProperty('background-image', `url(${productImage})`);
      flyToCartEl.style.setProperty('--start-opacity', '0');
      flyToCartEl.source = addBtn;
      flyToCartEl.destination = cartIcon;
      // Append to dialog (top layer) so animation appears above the modal
      const flyParent = dialog || document.body;
      flyParent.appendChild(flyToCartEl);
    }
  }

  // Wait for fly animation to complete (0.6s) before closing modal and opening cart.
  // Fixed delay matches fly-to-cart--main animation-duration in base.css.
  if (flyToCartEl) {
    await new Promise((r) => setTimeout(r, 650));
  }

  const dialogComponent = container.closest('dialog-component');
  if (dialogComponent && typeof dialogComponent.closeDialog === 'function') {
    dialogComponent.closeDialog();
  } else {
    // Quick-add context: close bulk grid native <dialog>
    const nativeDialog = container.closest('dialog');
    if (nativeDialog && typeof nativeDialog.close === 'function') {
      nativeDialog.close();
    }
    // Also close the quick-add modal so the cart drawer isn't obscured
    const quickAddDialog = document.getElementById('quick-add-dialog');
    if (quickAddDialog && typeof quickAddDialog.closeDialog === 'function') {
      quickAddDialog.closeDialog();
    }
  }

  container.querySelectorAll('[data-at-bulk-qty]').forEach((input) => {
    if (input instanceof HTMLInputElement) input.value = '0';
  });
  const section = document.getElementById(`shopify-section-${sectionId}`);
  const form = section?.querySelector('[data-at-bulk-form]');
  const lineItemsInput = form?.querySelector(BULK_GRID_SELECTORS.lineItemsInput);
  if (lineItemsInput) lineItemsInput.value = '';
  updateTotal();

  document.dispatchEvent(new CartAddEvent(cart, 'at-bulk-grid', { source: 'at-bulk-grid' }));

  const cartDrawer = document.querySelector('cart-drawer-component');
  if (cartDrawer && typeof cartDrawer.open === 'function') {
    cartDrawer.open();
  }
}

/** Theme add-to-cart icon (icon-add-to-cart.svg) – same as add-to-cart-button secondary */
const ADD_TO_CART_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="var(--icon-stroke-width)" d="M16.608 9.421V6.906H3.392v8.016c0 .567.224 1.112.624 1.513.4.402.941.627 1.506.627H8.63M8.818 3h2.333c.618 0 1.212.247 1.649.686a2.35 2.35 0 0 1 .683 1.658v1.562H6.486V5.344c0-.622.246-1.218.683-1.658A2.33 2.33 0 0 1 8.82 3"/><path stroke="currentColor" stroke-linecap="round" stroke-width="var(--icon-stroke-width)" d="M14.608 12.563v5m2.5-2.5h-5"/></svg>';

/** Theme accordion caret – same as icon-caret.svg (mobile bulk grid expand/collapse) */
const ICON_CARET_SVG =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 5.5L7 9.5L3 5.5" stroke="currentColor" stroke-width="var(--icon-stroke-width)" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Theme quantity selector icons – same as quantity-selector.liquid (mobile bulk grid +/-) */
const ICON_MINUS_SVG =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.75 7H11.25" stroke="currentColor" stroke-width="var(--icon-stroke-width)" stroke-linecap="round"/></svg>';
const ICON_PLUS_SVG =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path class="vertical" d="M2.75 7H11.25" stroke="currentColor" stroke-width="var(--icon-stroke-width)" stroke-linecap="round"/><path class="horizontal" d="M7 2.75L7 11.25" stroke="currentColor" stroke-width="var(--icon-stroke-width)" stroke-linecap="round"/></svg>';

/**
 * @param {string} sectionId
 * @returns {{ productId: number, productUrl: string, sectionId: string, variants: Array<{ id: number, available: boolean, inventory_quantity: number, inventory_policy: string, option1: string, option2?: string, option3?: string }>, options: Array<{ name: string, position: number, values: string[] }> } | null}
 */
/**
 * Normalize variant entries: either index arrays [id,a,q,p,i1,i2[,i3],price,compare_at_price]
 * or compact objects (a,q,p,o1,o2,o3,pr,cp). Liquid outputs index arrays to stay under section size limits.
 */
function normalizeBulkConfig(config) {
  if (!config || !Array.isArray(config.variants)) return config;
  const opts = config.options || [];
  config.variants.forEach((v, i) => {
    if (Array.isArray(v)) {
      const len = v.length;
      const price = len >= 2 ? v[len - 2] : 0;
      const compareAtPrice = len >= 1 ? v[len - 1] : 0;
      const rest = len >= 2 ? v.slice(0, len - 2) : v;
      const [id, a, q, p, i1, i2, i3] = rest;
      const values0 = opts[0]?.values || [];
      const values1 = opts[1]?.values || [];
      const values2 = opts[2]?.values || [];
      config.variants[i] = {
        id,
        available: !!a,
        inventory_quantity: q,
        inventory_policy: p,
        option1: values0[i1],
        option2: values1[i2],
        option3: opts.length >= 3 ? values2[i3] : null,
        price: price,
        compare_at_price: compareAtPrice,
      };
    } else {
      if (v.a !== undefined) v.available = v.a;
      if (v.q !== undefined) v.inventory_quantity = v.q;
      if (v.p !== undefined) v.inventory_policy = v.p;
      if (v.o1 !== undefined) v.option1 = v.o1;
      if (v.o2 !== undefined) v.option2 = v.o2;
      if (v.o3 !== undefined) v.option3 = v.o3;
      if (v.pr !== undefined) v.price = v.pr;
      if (v.cp !== undefined) v.compare_at_price = v.cp;
    }
  });
  return config;
}

function getBulkConfig(sectionId) {
  // Quick-add context: config lives in the cache, not in a section element
  if (sectionId === QUICK_ADD_SECTION_KEY) {
    return bulkGridConfigCache.get(QUICK_ADD_SECTION_KEY) || null;
  }
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

/** Expected variant count from options (for deferred-load check). */
function expectedVariantCount(config) {
  if (!config?.options?.length) return 0;
  let n = 1;
  config.options.forEach((o) => {
    n *= (o.values && o.values.length) || 0;
  });
  return n;
}

/** Run promise-returning tasks with a concurrency limit; resolves when all complete. */
function runWithConcurrency(tasks, limit) {
  let index = 0;
  function runNext() {
    if (index >= tasks.length) return Promise.resolve();
    return tasks[index++]().then(() => runNext());
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  return Promise.all(workers);
}

/**
 * Check whether the initial config already covers every option1/option2 combination.
 * Returns true when we need to defer-load more variants.
 */
function needsDeferredLoad(config) {
  const expected = expectedVariantCount(config);
  return (
    expected > 0 &&
    (config.variants?.length ?? 0) < expected &&
    (config.options?.[0]?.valueIds?.length ?? 0) > 0
  );
}

/**
 * Load full variant set via the Shopify AJAX product JSON endpoint.
 *
 * /products/{handle}.json returns ALL variants with no 250-variant cap, making it
 * far more reliable than the Section Rendering API + option_values approach (which
 * requires option_value.variant to work in a standalone section context – it doesn't).
 *
 * A hover-prefetch promise stored in quickAddHoverPreloads (keyed by the JSON URL)
 * is reused when available so the network request is already in-flight before the
 * user opens the bulk grid.
 *
 * Trade-off: the product JSON endpoint does not expose inventory_quantity, so deferred
 * variants show "In" / "Out" availability without a "Low" stock indicator.  The initial
 * 250 variants (from the Liquid config script) retain full inventory data.
 */
function fetchDeferredVariants(config) {
  const allValueIds = config?.options?.[0]?.valueIds;
  if (!allValueIds?.length) return Promise.resolve([]);

  const debug = window.atBulkGridDebugVerbose === true;

  // Seed byId with the initial variants (which include inventory_quantity from Liquid).
  // We only add NEW variant IDs from the JSON fetch so this data is preserved.
  const byId = new Map();
  (config.variants || []).forEach((v) => {
    if (v && v.id != null) byId.set(v.id, v);
  });

  if (!needsDeferredLoad(config)) {
    if (debug) console.log('at-bulk-grid: all variants already present, skipping deferred fetch');
    return Promise.resolve(Array.from(byId.values()));
  }

  if (!config.productUrl) {
    if (debug) console.warn('at-bulk-grid: fetchDeferredVariants – no productUrl in config');
    return Promise.resolve(Array.from(byId.values()));
  }

  const productPath = new URL(config.productUrl, window.location.origin).pathname;
  const jsonUrl = productPath.replace(/\/$/, '') + '.json';

  // Reuse an in-flight hover-prefetch (keyed by JSON URL) if one already exists.
  // If not, start our own and register it so concurrent callers share the same fetch.
  let dataPromise = quickAddHoverPreloads.get(jsonUrl);
  if (!dataPromise) {
    dataPromise = fetch(jsonUrl, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    quickAddHoverPreloads.set(jsonUrl, dataPromise);
  }

  return dataPromise.then((data) => {
    if (!data?.product?.variants?.length) {
      if (debug) console.warn('at-bulk-grid: no variants in product.json response', jsonUrl);
      return Array.from(byId.values());
    }

    const opts = config.options || [];
    const hasThirdOption = opts.length >= 3;

    data.product.variants.forEach((v) => {
      if (v?.id == null) return;
      if (byId.has(v.id)) return; // Preserve initial variant data (includes inventory_quantity)

      // product.json prices are decimal strings (e.g. "10.66" for USD).
      // Convert to the cents-integer format that Liquid's {{ v.price }} outputs.
      const price = v.price ? Math.round(parseFloat(v.price) * 100) : 0;
      const compareAtPrice = v.compare_at_price ? Math.round(parseFloat(v.compare_at_price) * 100) : 0;

      byId.set(v.id, {
        id: v.id,
        available: !!v.available,
        inventory_quantity: undefined, // not exposed by product.json
        inventory_policy: v.inventory_policy || 'deny',
        option1: v.option1 ?? null,
        option2: v.option2 ?? null,
        option3: hasThirdOption ? (v.option3 ?? null) : null,
        price,
        compare_at_price: compareAtPrice,
      });
    });

    const list = Array.from(byId.values());
    if (debug) console.log('at-bulk-grid: deferred load complete –', list.length, 'total variants');
    return list;
  });
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
  if (inventory < 1000) return String(inventory);
  return '1000+';
}

/**
 * Format variant price HTML: compare-at (strikethrough) when on sale, then price. Matches theme price snippet.
 * @param {{ price: number, compare_at_price?: number }} variant - price/compare_at_price in minor units (cents)
 * @param {{ moneyFormat?: string, currency?: string }} config
 * @returns {string} HTML fragment
 */
function formatVariantPriceHtml(variant, config) {
  let format = config?.moneyFormat?.trim() || '';
  const currency = (config?.currency || 'USD').toString().toUpperCase();
  if (!format) format = currency === 'USD' ? '${{amount}}' : '{{amount}} ' + currency;
  const price = variant?.price ?? 0;
  const compareAt = variant?.compare_at_price ?? 0;
  const priceStr = formatMoney(price, format, currency);
  const onSale = compareAt > price && compareAt > 0;
  const compareAtStr = onSale ? formatMoney(compareAt, format, currency) : '';
  if (onSale) {
    return (
      '<span class="at-bulk-grid__price"><s class="compare-at-price">' +
      escapeHtml(compareAtStr) +
      '</s> <span class="price">' +
      escapeHtml(priceStr) +
      '</span></span>'
    );
  }
  return '<span class="at-bulk-grid__price"><span class="price">' + escapeHtml(priceStr) + '</span></span>';
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
    html += '<td class="at-bulk-grid__color-cell"><div class="at-bulk-grid__color-cell-inner">';
    if (swatchStyle) {
      html += '<span class="at-bulk-grid__swatch swatch" style="' + swatchStyle + '" aria-hidden="true"></span>';
    }
    html += '<span class="at-bulk-grid__color-name">' + escapeHtml(color) + '</span></div></td>';
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
          : band === '1000+' || band === 'In stock'
            ? 'at-bulk-grid__availability--in-stock'
            : 'at-bulk-grid__availability--low';
      const priceHtml = formatVariantPriceHtml(v, config);
      html +=
        '<td data-at-bulk-cell data-variant-id="' +
        v.id +
        '">' +
        '<div class="at-bulk-grid__cell-inner">' +
        '<input type="number" class="at-bulk-grid__qty-input" min="0" value="0" data-at-bulk-qty data-variant-id="' +
        v.id +
        '" aria-label="Quantity ' +
        escapeAttr(color) +
        ' ' +
        escapeAttr(size) +
        '">' +
        priceHtml +
        '<span class="at-bulk-grid__availability ' +
        bandClass +
        '">' +
        band +
        '</span></div></td>';
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  html +=
    '<div class="at-bulk-grid__actions">' +
    '<span class="at-bulk-grid__total" data-at-bulk-total>Total: 0</span>' +
    '<button type="button" class="button add-to-cart-button button-primary" data-at-bulk-add-to-cart>' +
    '<span class="add-to-cart-text"><span aria-hidden="true" class="svg-wrapper add-to-cart-icon">' +
    ADD_TO_CART_ICON_SVG +
    '</span><span class="add-to-cart-text__content">Add to cart</span></span>' +
    '</button>' +
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

  container.addEventListener('input', (e) => {
    if (e.target.matches('[data-at-bulk-qty]')) updateTotal();
  });
  container.addEventListener('change', (e) => {
    if (e.target.matches('[data-at-bulk-qty]')) updateTotal();
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

  const submitBulkItems = () => {
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
        fetch(root + 'cart.js')
          .then((r) => r.json())
          .then(async (cart) => {
            await handleBulkAddSuccess(container, updateTotal, addBtn, sectionId, cart);
          })
          .catch(() => {});
      })
      .catch((err) => console.error('at-bulk-grid: cart add failed', err));
  };

  if (addBtn) addBtn.addEventListener('click', submitBulkItems);

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
    html += '<span class="at-bulk-grid__color-name">' + escapeHtml(color) + '</span> <span class="svg-wrapper icon-caret icon-animated at-bulk-grid__accordion-icon" aria-hidden="true" data-at-bulk-accordion-icon>' + ICON_CARET_SVG + '</span>';
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
          : band === '1000+' || band === 'In stock'
            ? 'at-bulk-grid__availability--in-stock'
            : 'at-bulk-grid__availability--low';
      const priceHtmlMobile = formatVariantPriceHtml(v, config);
      html +=
        '<div class="at-bulk-grid__mobile-size-row">' +
        '<span>' +
        escapeHtml(size) +
        ' ' +
        priceHtmlMobile +
        ' <span class="at-bulk-grid__availability ' +
        bandClass +
        '">' +
        band +
        '</span></span>' +
        '<div class="quantity-selector-wrapper at-bulk-grid__qty-selector-wrapper">' +
        '<div class="quantity-selector at-bulk-grid__qty-selector">' +
        '<button type="button" class="button quantity-minus button-unstyled" aria-label="Decrease quantity" data-at-bulk-qty-minus>' +
        '<span class="visually-hidden">Decrease quantity</span><span class="svg-wrapper icon-plus">' +
        ICON_MINUS_SVG +
        '</span></button>' +
        '<input type="number" class="at-bulk-grid__qty-input" min="0" value="0" data-at-bulk-qty data-variant-id="' +
        v.id +
        '" aria-label="Quantity ' +
        escapeAttr(size) +
        '">' +
        '<button type="button" class="button quantity-plus button-unstyled" aria-label="Increase quantity" data-at-bulk-qty-plus>' +
        '<span class="visually-hidden">Increase quantity</span><span class="svg-wrapper icon-plus">' +
        ICON_PLUS_SVG +
        '</span></button>' +
        '</div></div>' +
        '</div>';
    });
    html += '</div></div>';
  });

  html += '</div>';
  html +=
    '<div class="at-bulk-grid__actions">' +
    '<span class="at-bulk-grid__total" data-at-bulk-total>Total: 0</span>' +
    '<button type="button" class="button add-to-cart-button button-primary" data-at-bulk-add-to-cart>' +
    '<span class="add-to-cart-text"><span aria-hidden="true" class="svg-wrapper add-to-cart-icon">' +
    ADD_TO_CART_ICON_SVG +
    '</span><span class="add-to-cart-text__content">Add to cart</span></span>' +
    '</button>' +
    '</div>';

  if (container._atBulkMobileAbortController) {
    container._atBulkMobileAbortController.abort();
  }
  container._atBulkMobileAbortController = new AbortController();
  const mobileSignal = container._atBulkMobileAbortController.signal;

  container.innerHTML = html;
  container.dataset.atBulkGridSectionId = sectionId;

  const totalEl = container.querySelector('[data-at-bulk-total]');
  const updateTotal = () => {
    const inputs = container.querySelectorAll('[data-at-bulk-qty]');
    let sum = 0;
    inputs.forEach((input) => {
      sum += parseInt(input.value, 10) || 0;
    });
    if (totalEl) totalEl.textContent = 'Total: ' + sum;
  };

  container.addEventListener('input', (e) => {
    if (e.target.matches('[data-at-bulk-qty]')) updateTotal();
  }, { signal: mobileSignal });
  container.addEventListener('change', (e) => {
    if (e.target.matches('[data-at-bulk-qty]')) updateTotal();
  }, { signal: mobileSignal });

  container.addEventListener('click', (e) => {
    const minusBtn = e.target.closest('[data-at-bulk-qty-minus]');
    const plusBtn = e.target.closest('[data-at-bulk-qty-plus]');
    const wrapper = minusBtn?.closest('.at-bulk-grid__qty-selector-wrapper') || plusBtn?.closest('.at-bulk-grid__qty-selector-wrapper');
    const input = wrapper?.querySelector('[data-at-bulk-qty]');
    if (!input) return;
    if (minusBtn) {
      e.preventDefault();
      e.stopPropagation();
      const val = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
      input.value = String(val);
      updateTotal();
    } else if (plusBtn) {
      e.preventDefault();
      e.stopPropagation();
      const val = (parseInt(input.value, 10) || 0) + 1;
      input.value = String(val);
      updateTotal();
    }
  }, { signal: mobileSignal });

  container.querySelectorAll('[data-at-bulk-accordion-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const content = btn.nextElementSibling;
      const open = content?.getAttribute('hidden') != null;
      content?.toggleAttribute('hidden', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      updateTotal();
    });
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

  const submitBulkItemsMobile = () => {
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
        fetch(root + 'cart.js')
          .then((r) => r.json())
          .then(async (cart) => {
            await handleBulkAddSuccess(container, updateTotal, addBtnMobile, sectionId, cart);
          })
          .catch(() => {});
      })
      .catch((err) => console.error('at-bulk-grid: cart add failed', err));
  };

  const addBtnMobile = container.querySelector('[data-at-bulk-add-to-cart]');
  if (addBtnMobile) addBtnMobile.addEventListener('click', submitBulkItemsMobile);

  updateTotal();
}

/** Cache full config per section after deferred load so we don't re-fetch on reopen. */
const bulkGridConfigCache = new Map();

/** Cache for in-flight deferred variant load promises (from hover/focus preload). */
const deferredLoadPromises = new Map();

/**
 * Per-product hover preloads for the quick-add context, keyed by productId.
 * Populated when the user hovers a "Choose" button on a collection/home page,
 * before they click it and before the quick-add AJAX request completes.
 * @type {Map<number|string, Promise<any[]> | null>}
 */
const quickAddHoverPreloads = new Map();

/**
 * Start loading deferred variants before the modal opens (called on hover/focus of trigger).
 * The promise is reused by renderGrid to avoid duplicate fetches.
 */
function preloadBulkGridVariants(sectionId) {
  if (deferredLoadPromises.has(sectionId) || bulkGridConfigCache.has(sectionId)) return;

  const config = getBulkConfig(sectionId);
  if (!config) return;

  const expected = expectedVariantCount(config);
  const needDeferred = expected > 0 && config.variants.length < expected && (config.options?.[0]?.valueIds?.length ?? 0) > 0;
  if (!needDeferred) return;

  deferredLoadPromises.set(sectionId, fetchDeferredVariants(config));
}

function renderGrid(container) {
  const sectionId = container.dataset.atBulkGridSectionId;
  if (!sectionId) return;

  let config = bulkGridConfigCache.get(sectionId) || getBulkConfig(sectionId);
  if (!config) return;

  const expected = expectedVariantCount(config);
  const needDeferred = expected > 0 && config.variants.length < expected && (config.options?.[0]?.valueIds?.length ?? 0) > 0;

  if (needDeferred) {
    bulkGridConfigCache.delete(sectionId);
    container.innerHTML = '<p class="at-bulk-grid__loading" aria-live="polite">Loading variants…</p>';
    const fetchPromise = deferredLoadPromises.get(sectionId) || fetchDeferredVariants(config);
    deferredLoadPromises.delete(sectionId);
    fetchPromise
      .then((variants) => {
        // For QUICK_ADD_SECTION_KEY the cache was just cleared above and there is no
        // shopify-section-{id} DOM element to fall back to, so use the closure-captured
        // config as a last resort.  This is the primary fix for the quick-add context
        // where the grid was stuck at "Loading variants…" forever.
        config = bulkGridConfigCache.get(sectionId) || getBulkConfig(sectionId) || config;
        if (!config) return;
        if (variants.length >= expected) {
          config.variants = variants;
        } else {
          const byId = new Map((config.variants || []).map((v) => [v.id, v]));
          variants.forEach((v) => byId.set(v.id, v));
          config.variants = Array.from(byId.values());
        }
        bulkGridConfigCache.set(sectionId, config);
        const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
        if (isMobile) {
          renderMobileGrid(container, config, sectionId);
        } else {
          renderDesktopGrid(container, config, sectionId);
        }
      })
      .catch((err) => {
        console.error('at-bulk-grid: deferred load failed', err);
        container.innerHTML = '<p class="at-bulk-grid__empty">Unable to load all variants. Try again later.</p>';
      });
    return;
  }

  if (config.variants?.length) bulkGridConfigCache.set(sectionId, config);
  const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
  if (isMobile) {
    renderMobileGrid(container, config, sectionId);
  } else {
    renderDesktopGrid(container, config, sectionId);
  }
}

/**
 * Set up bulk grid support for the quick-add modal context (modal-in-modal).
 *
 * Optimized loading mirrors the product-page path:
 *   1. A MutationObserver watches #quick-add-modal-content and starts the deferred
 *      variant fetch the moment the config script appears in the DOM — before the
 *      user touches the bulk trigger.  This reuses deferredLoadPromises exactly like
 *      the hover/focusin preload does on the product page.
 *   2. A window-capture click interceptor (fires before Horizon's document-capture
 *      handler) calls renderGrid(), which picks up the already-in-flight promise
 *      instead of starting a cold fetch on click.
 */
function initQuickAddBulkGrid() {
  const bulkDialog = document.getElementById(QUICK_ADD_BULK_DIALOG_ID);
  const closeBtn = document.getElementById(QUICK_ADD_CLOSE_BTN_ID);

  if (!bulkDialog) return;

  if (closeBtn) {
    closeBtn.addEventListener('click', () => bulkDialog.close());
  }

  // Backdrop click closes the dialog
  bulkDialog.addEventListener('click', (e) => {
    if (e.target === bulkDialog) bulkDialog.close();
  });

  // ── Hover preload on "Choose" buttons ───────────────────────────────────
  // On hover over a product card's "Choose" button, immediately prefetch
  // /products/{handle}.json so the data is already in the browser's HTTP cache
  // (or fully resolved) by the time the user opens the bulk grid modal.
  // fetchDeferredVariants reuses the same promise (keyed by JSON URL) so there
  // is never more than one in-flight request per product per page load.
  document.addEventListener(
    'mouseover',
    (e) => {
      if (!(e.target instanceof Element)) return;
      const btn = e.target.closest('.quick-add__button--choose');
      if (!btn) return;

      const card = btn.closest('product-card') || btn.closest('[data-product-id]');
      if (!card) return;
      const productLink = /** @type {HTMLAnchorElement | null} */ (card.querySelector('a[href*="/products/"]'));
      if (!productLink?.href) return;

      const url = new URL(productLink.href, window.location.origin);
      // Extract the handle, handling both /products/handle and /collections/x/products/handle
      const match = url.pathname.match(/\/products\/([^/?#]+)/);
      if (!match) return;
      const jsonUrl = `/products/${match[1]}.json`;

      if (quickAddHoverPreloads.has(jsonUrl)) return;

      // Start the fetch and register it immediately to prevent duplicate requests
      quickAddHoverPreloads.set(
        jsonUrl,
        fetch(jsonUrl, { headers: { Accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      );
    },
    { passive: true }
  );

  // ── Deferred-variant preload via MutationObserver ────────────────────────
  // Second line of defence: fires when quick-add.js morphs content into
  // #quick-add-modal-content.  Reuses the hover-preload promise when one
  // exists; otherwise starts a fresh deferred fetch.
  const quickAddContent = document.getElementById(QUICK_ADD_MODAL_CONTENT_ID);
  let lastPreloadedProductId = null;

  /**
   * Called on every MutationObserver tick.  Parses the config and kicks off
   * fetchDeferredVariants, which internally reuses any in-flight hover-prefetch
   * promise (keyed by product JSON URL) so there is never more than one request.
   */
  function tryPreloadQuickAdd() {
    const configScript = quickAddContent?.querySelector(BULK_GRID_SELECTORS.configScript);
    if (!configScript?.textContent) return;

    let config;
    try {
      config = JSON.parse(configScript.textContent.trim());
      normalizeBulkConfig(config);
    } catch {
      return;
    }

    // Guard: don't re-preload when the same product is still showing
    if (config.productId != null && config.productId === lastPreloadedProductId) return;
    lastPreloadedProductId = config.productId ?? null;

    // Clear stale state from the previous product
    bulkGridConfigCache.delete(QUICK_ADD_SECTION_KEY);
    deferredLoadPromises.delete(QUICK_ADD_SECTION_KEY);
    bulkGridConfigCache.set(QUICK_ADD_SECTION_KEY, config);

    if (!needsDeferredLoad(config)) return;

    // fetchDeferredVariants automatically reuses any hover-prefetch promise
    // for this product's .json URL, so no explicit coordination is needed here.
    deferredLoadPromises.set(QUICK_ADD_SECTION_KEY, fetchDeferredVariants(config));
  }

  if (quickAddContent) {
    new MutationObserver(tryPreloadQuickAdd).observe(quickAddContent, {
      childList: true,
      subtree: true,
    });
  }

  // ── Window-capture click interceptor ────────────────────────────────────
  // WHY window, not document:
  // Horizon's component.js registers document.addEventListener('click', …, { capture: true })
  // at startup (before at-bulk-grid.js loads), so its document-capture handler fires
  // first in registration order and calls showDialog() before ours could stop it.
  // window capture fires one step higher (window → document → … → target), so our
  // listener runs before Horizon's, and stopPropagation() here prevents the event
  // from ever reaching document, keeping at-buy-buttons__bulk-dialog closed.
  window.addEventListener('click', (e) => {
    const trigger = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest(BULK_GRID_SELECTORS.trigger) : null);
    if (!trigger) return;

    const qac = document.getElementById(QUICK_ADD_MODAL_CONTENT_ID);
    if (!qac || !qac.contains(trigger)) return;

    // Stop Horizon's document-capture handler from opening the wrong dialog
    e.stopPropagation();

    // Config should already be cached from the MutationObserver preload.
    // Fall back to parsing from the DOM if the observer hasn't fired yet.
    if (!bulkGridConfigCache.has(QUICK_ADD_SECTION_KEY)) {
      const configScript = qac.querySelector(BULK_GRID_SELECTORS.configScript);
      if (!configScript?.textContent) return;
      try {
        const config = JSON.parse(configScript.textContent.trim());
        normalizeBulkConfig(config);
        bulkGridConfigCache.set(QUICK_ADD_SECTION_KEY, config);
      } catch {
        return;
      }
    }

    const container = bulkDialog.querySelector(BULK_GRID_SELECTORS.container);
    if (!container) return;

    container.dataset.atBulkGridSectionId = QUICK_ADD_SECTION_KEY;

    // renderGrid picks up the already-in-flight deferredLoadPromises entry
    // instead of starting a cold fetch, matching the product-page experience.
    renderGrid(container);

    if (typeof bulkDialog.showModal === 'function') {
      bulkDialog.showModal();
    }
  }, true); // capture phase on window – fires before Horizon's document-capture handler
}

function init() {
  document.querySelectorAll(BULK_GRID_SELECTORS.trigger).forEach((trigger) => {
    const preload = () => {
      const container = trigger.closest('.at-buy-buttons__bulk-popup-component')?.querySelector(BULK_GRID_SELECTORS.container)
        || document.querySelector(BULK_GRID_SELECTORS.container);
      const sectionId = container?.dataset?.atBulkGridSectionId;
      if (sectionId) preloadBulkGridVariants(sectionId);
    };
    trigger.addEventListener('mouseenter', preload, { once: true });
    trigger.addEventListener('focusin', preload, { once: true });

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
      if (container.dataset.atBulkGridSectionId && container.closest('dialog')?.open) {
        renderGrid(container);
      }
    });
  });

  initQuickAddBulkGrid();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/**
 * Console diagnostic for bulk grid: run atBulkGridDebug() or atBulkGridDebug('Turf Green').
 * Use cached config (after deferred load) when available so you see full variant set.
 * Set atBulkGridDebugVerbose = true before opening the grid to log each deferred fetch.
 */
window.atBulkGridDebug = function (searchOptionValue) {
  const container = document.querySelector(BULK_GRID_SELECTORS.container);
  const sectionIdFromContainer = container?.dataset?.atBulkGridSectionId;
  const cached = sectionIdFromContainer ? bulkGridConfigCache.get(sectionIdFromContainer) : null;
  let config = cached || null;
  let sectionId = sectionIdFromContainer || null;

  if (!config) {
    const script = document.querySelector('script[data-at-bulk-grid-config]');
    if (!script || !script.textContent) {
      console.warn('atBulkGridDebug: No config. Open the bulk grid on a product page (and wait for "Loading variants…" to finish if it appears).');
      return null;
    }
    sectionId = script.dataset.atSectionId || script.getAttribute('data-at-section-id');
    if (!sectionId) {
      const sectionEl = script.closest('[id^="shopify-section-"]');
      if (sectionEl?.id) sectionId = sectionEl.id.replace('shopify-section-', '');
    }
    if (!sectionId) {
      console.warn('atBulkGridDebug: Could not determine section id.');
      return null;
    }
    try {
      config = JSON.parse(script.textContent.trim());
      normalizeBulkConfig(config);
    } catch (e) {
      console.error('atBulkGridDebug: Failed to parse config:', e);
      return null;
    }
  }
  if (cached) console.log('atBulkGridDebug: using cached config (post–deferred load)');

  const norm = (s) => (s == null ? '' : String(s).trim());
  const searchLower = (searchOptionValue || 'Turf Green').toLowerCase();

  const variantsMatching = config.variants.filter(
    (v) =>
      norm(v.option1).toLowerCase().includes(searchLower) ||
      norm(v.option2).toLowerCase().includes(searchLower) ||
      norm(v.option3).toLowerCase().includes(searchLower)
  );

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

  const mapKeysSample = Array.from(variantByOptionPair.keys()).slice(0, 20);
  const lookupTurfGreenS =
    variantByOptionPair.get('Turf Green|S') ||
    variantByOptionPair.get('S|Turf Green') ||
    variantByOptionPair.get(norm('Turf Green') + '|' + norm('S')) ||
    variantByOptionPair.get(norm('S') + '|' + norm('Turf Green'));

  const firstVariants = config.variants.slice(0, 2).map((v) => ({
    id: v.id,
    o1: v.option1,
    o1Length: (v.option1 && v.option1.length) || 0,
    o2: v.option2,
    o2Length: (v.option2 && v.option2.length) || 0,
  }));
  const lastVariants = config.variants.slice(-2).map((v) => ({
    id: v.id,
    o1: v.option1,
    o1Length: (v.option1 && v.option1.length) || 0,
    o2: v.option2,
    o2Length: (v.option2 && v.option2.length) || 0,
  }));

  const scriptEl = document.querySelector('script[data-at-bulk-grid-config]');
  const out = {
    fromCache: !!cached,
    variantCount: config.variants.length,
    options: config.options?.map((o) => ({ name: o.name, position: o.position, valueCount: (o.values || []).length })),
    variantsMatchingSearch: variantsMatching.length,
    variantsMatchingSample: variantsMatching.slice(0, 3).map((v) => ({ id: v.id, option1: v.option1, option2: v.option2 })),
    mapSize: variantByOptionPair.size,
    mapKeysSample,
    lookupTurfGreenS: lookupTurfGreenS ? { id: lookupTurfGreenS.id, option1: lookupTurfGreenS.option1, option2: lookupTurfGreenS.option2 } : null,
    firstVariants,
    lastVariants,
    configRawLength: scriptEl?.textContent?.length ?? null,
  };

  console.log('atBulkGridDebug:', out);
  return out;
};
