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

const CART_ICON_SELECTOR = '.header-actions__cart-icon';

/**
 * On successful bulk add: optional fly animation, close modal, reset inputs, dispatch CartAddEvent.
 * @param {HTMLElement} container - Bulk grid container
 * @param {() => void} updateTotal - Function to refresh total display
 * @param {HTMLButtonElement | null} addBtn - Add to cart button (source for fly animation)
 * @param {string} sectionId - Section ID for config lookup
 * @param {Object} cart - Cart object from cart.js
 */
function handleBulkAddSuccess(container, updateTotal, addBtn, sectionId, cart) {
  const doAnimation = container.dataset.atBulkAddToCartAnimation === 'true';
  const config = getBulkConfig(sectionId) || bulkGridConfigCache.get(sectionId);
  const productImage = config?.productFeaturedImage;

  if (doAnimation && addBtn && productImage && customElements.get('fly-to-cart')) {
    const cartIcon = document.querySelector(CART_ICON_SELECTOR);
    if (cartIcon) {
      const flyToCartEl = document.createElement('fly-to-cart');
      flyToCartEl.classList.add('fly-to-cart--main');
      flyToCartEl.style.setProperty('background-image', `url(${productImage})`);
      flyToCartEl.style.setProperty('--start-opacity', '0');
      flyToCartEl.source = addBtn;
      flyToCartEl.destination = cartIcon;
      document.body.appendChild(flyToCartEl);
    }
  }

  const dialogComponent = container.closest('dialog-component');
  if (dialogComponent && typeof dialogComponent.closeDialog === 'function') {
    dialogComponent.closeDialog();
  }

  container.querySelectorAll('[data-at-bulk-qty]').forEach((input) => {
    if (input instanceof HTMLInputElement) input.value = '0';
  });
  const section = document.getElementById(`shopify-section-${sectionId}`);
  const form = section?.querySelector('[data-at-bulk-form]');
  const   lineItemsInput = form?.querySelector(BULK_GRID_SELECTORS.lineItemsInput);
  if (lineItemsInput) lineItemsInput.value = '';
  updateTotal();

  document.dispatchEvent(new CartAddEvent(cart, 'at-bulk-grid', { source: 'at-bulk-grid' }));

  // Bulk shoppers always get the cart drawer; regular add-to-cart respects theme setting
  const cartDrawer = document.querySelector('cart-drawer-component');
  if (cartDrawer && typeof cartDrawer.open === 'function') {
    cartDrawer.open();
  }
}

/** Theme add-to-cart icon (icon-add-to-cart.svg) – same as add-to-cart-button secondary */
const ADD_TO_CART_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="var(--icon-stroke-width)" d="M16.608 9.421V6.906H3.392v8.016c0 .567.224 1.112.624 1.513.4.402.941.627 1.506.627H8.63M8.818 3h2.333c.618 0 1.212.247 1.649.686a2.35 2.35 0 0 1 .683 1.658v1.562H6.486V5.344c0-.622.246-1.218.683-1.658A2.33 2.33 0 0 1 8.82 3"/><path stroke="currentColor" stroke-linecap="round" stroke-width="var(--icon-stroke-width)" d="M14.608 12.563v5m2.5-2.5h-5"/></svg>';

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
 * Load full variant set via product page + option_values when product has >250 variants.
 * Uses option_value.variant (selection script) per request; limited concurrency to avoid overloading.
 * See https://shopify.dev/docs/storefronts/themes/product-merchandising/variants/support-high-variant-products
 */
const DEFERRED_FETCH_CONCURRENCY = 10;

function fetchDeferredVariants(config) {
  const valueIds = config?.options?.[0]?.valueIds;
  if (!valueIds?.length || !config.sectionId) return Promise.resolve([]);

  const baseUrl = config.productUrl
    ? new URL(config.productUrl, window.location.origin).href
    : window.location.href.split('?')[0];
  const sectionId = config.sectionId;
  const byId = new Map();
  const debug = window.atBulkGridDebugVerbose === true;

  const tasks = valueIds.map((valueId) => () => {
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}option_values=${encodeURIComponent(valueId)}`;
    return fetch(url)
      .then((res) => {
        if (!res.ok && debug) console.warn('at-bulk-grid: fetch status', res.status, url);
        return res.text();
      })
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const selectionScript = doc.querySelector('script[data-at-bulk-grid-variants-for-selection]');
        const section = doc.getElementById(`shopify-section-${sectionId}`);
        const mainScript = section?.querySelector(BULK_GRID_SELECTORS.configScript);
        const script = selectionScript ?? mainScript;
        if (!script?.textContent) {
          if (debug) console.warn('at-bulk-grid: no config for option_values=' + valueId);
          return;
        }
        const parsed = JSON.parse(script.textContent.trim());
        normalizeBulkConfig(parsed);
        (parsed.variants || []).forEach((v) => {
          if (v && v.id != null) byId.set(v.id, v);
        });
      })
      .catch((err) => console.warn('at-bulk-grid: deferred fetch failed for option_values=' + valueId, err));
  });

  return runWithConcurrency(tasks, DEFERRED_FETCH_CONCURRENCY).then(() => {
    const list = Array.from(byId.values());
    if (debug) console.log('at-bulk-grid: deferred load complete,', list.length, 'variants from', valueIds.length, 'requests');
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
  if (inventory < 25) return 'Limited';
  if (inventory < 100) return '25+';
  return '100+';
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
          : band === 'Limited'
            ? 'at-bulk-grid__availability--low'
            : 'at-bulk-grid__availability--in-stock';
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
    '<div class="at-bulk-grid__actions" data-at-bulk-has-quantity="false">' +
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
    const hasQuantity = sum > 0;
    if (totalEl) totalEl.textContent = 'Total: ' + sum;
    const actionsEl = container.querySelector('.at-bulk-grid__actions');
    if (actionsEl) {
      actionsEl.setAttribute('data-at-bulk-has-quantity', hasQuantity ? 'true' : 'false');
      actionsEl.classList.toggle('at-bulk-grid__actions--has-quantity', hasQuantity);
    }
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
          .then((cart) => {
            handleBulkAddSuccess(container, updateTotal, addBtn, sectionId, cart);
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
    '<div class="at-bulk-grid__actions" data-at-bulk-has-quantity="false">' +
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
    const hasQuantity = sum > 0;
    if (totalEl) totalEl.textContent = 'Total: ' + sum;
    const actionsEl = container.querySelector('.at-bulk-grid__actions');
    if (actionsEl) {
      actionsEl.setAttribute('data-at-bulk-has-quantity', hasQuantity ? 'true' : 'false');
      actionsEl.classList.toggle('at-bulk-grid__actions--has-quantity', hasQuantity);
    }
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
      if (btn.querySelector('span[aria-hidden="true"]')) {
        btn.querySelector('span[aria-hidden="true"]').textContent = open ? '−' : '+';
      }
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
          .then((cart) => {
            handleBulkAddSuccess(container, updateTotal, addBtnMobile, sectionId, cart);
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
    fetchDeferredVariants(config)
      .then((variants) => {
        config = bulkGridConfigCache.get(sectionId) || getBulkConfig(sectionId);
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
      if (container.dataset.atBulkGridSectionId && container.closest('dialog')?.open) {
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
