import { Component } from '@theme/component';
import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { CartAddEvent, ThemeEvents } from '@theme/events';

/**
 * Set window.__WAGNER_DEBUG__ = true in the console to enable verbose logging
 * and the simulateFEProductAdded dev helper.
 */
const WAGNER_DEBUG = () => window.__WAGNER_DEBUG__ === true;

const WAGNER_PROXY = '/apps/wagner';
const FE_TRUSTED_ORIGIN = 'https://app.fulfillengine.com';

/** @param {...unknown} args */
function log(...args) {
  if (WAGNER_DEBUG()) console.log('[Wagner FE]', ...args);
}

// ─── Public Helper Functions ───────────────────────────────────────────────

/**
 * POST to Wagner to create a Fulfill Engine designer session.
 *
 * @param {{ shop_domain: string, source: 'product_page'|'global', shopify_product_id?: string, shopify_variant_id?: string, garment_sku?: string, quantity?: number }} context
 * @returns {Promise<{ ok: boolean, iframe_url: string, launch_context: object }>}
 */
export async function createWagnerDesignerSession(context) {
  const body = {
    shop_domain: context.shop_domain,
    source: context.source,
    quantity: context.quantity ?? 1,
  };

  if (context.source === 'product_page') {
    body.shopify_product_id = context.shopify_product_id;
    body.shopify_variant_id = context.shopify_variant_id;
    body.garment_sku = context.garment_sku;
  }

  log('Creating designer session', body);

  const response = await fetch(`${WAGNER_PROXY}/designer-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return { ...data, httpStatus: response.status };
}

/**
 * Forward a raw FE PRODUCT_ADDED event payload to Wagner and receive cart lines.
 *
 * @param {object} eventData - Raw payload from the FE iframe postMessage.
 * @param {{ launch_context: object }} session - Session object returned by createWagnerDesignerSession.
 * @returns {Promise<{ ok: boolean, cart_items: Array<{id: number, quantity: number, properties: object}>, httpStatus: number }>}
 */
export async function handleFulfillEngineProductAdded(eventData, session) {
  const body = {
    shop_domain: session.launch_context.shop_domain,
    context: session.launch_context,
    event: eventData,
  };

  log('Posting FE PRODUCT_ADDED to Wagner', body);

  const response = await fetch(`${WAGNER_PROXY}/fe-product-added`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return { ...data, httpStatus: response.status };
}

/**
 * Add Wagner-returned cart line items to the Shopify cart via /cart/add.js.
 * Preserves item order and all _wagner_* properties exactly as returned.
 *
 * @param {Array<{id: number, quantity: number, properties: object}>} items
 * @returns {Promise<object>} Shopify cart add response.
 */
export async function addWagnerItemsToCart(items) {
  log('Adding Wagner items to cart', items);

  const response = await fetch(Theme.routes.cart_add_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.description || `Cart add failed (HTTP ${response.status})`);
  }

  const result = await response.json();
  log('Cart add result', result);
  return result;
}

/**
 * Open the global wagner-fe-dialog with an already-created session object,
 * skipping the session-creation fetch step.
 *
 * @param {{ ok: boolean, iframe_url: string, launch_context: object }} session
 */
export function openFulfillEngineDesigner(session) {
  const dialog = document.querySelector('wagner-fe-dialog');

  if (!dialog) {
    console.warn('[Wagner FE] <wagner-fe-dialog> not found. Make sure fulfill-engine-modal.liquid is rendered.');
    return;
  }

  dialog.openWithSession(session);
}

// ─── WagnerFeDialog custom element ─────────────────────────────────────────

/**
 * @typedef {object} WagnerFeDialogRefs
 * @property {HTMLDialogElement} dialog
 * @property {HTMLElement} loadingState
 * @property {HTMLElement} errorState
 * @property {HTMLElement} errorMessage
 * @property {HTMLElement} iframeContainer
 * @property {HTMLIFrameElement} feIframe
 */

/**
 * Manages the Fulfill Engine designer iframe modal.
 * Singleton – rendered once via snippets/fulfill-engine-modal.liquid in layout/theme.liquid.
 *
 * @extends {DialogComponent<WagnerFeDialogRefs>}
 */
class WagnerFeDialog extends DialogComponent {
  /** @type {{ ok: boolean, iframe_url: string, launch_context: object } | null} */
  #session = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('message', this.#handleMessage);
    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);

    if (WAGNER_DEBUG()) {
      window.wagnerFeSimulateProductAdded = (rawEventData = {}) => {
        log('Simulating PRODUCT_ADDED', rawEventData);
        this.#processProductAdded(rawEventData);
      };
      console.info('[Wagner FE] Debug mode active. Use window.wagnerFeSimulateProductAdded({}) to simulate.');
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('message', this.#handleMessage);
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  /**
   * Open the dialog: create a Wagner session then show the FE iframe.
   *
   * @param {{ shop_domain: string, source: string, [key: string]: unknown }} launchContext
   */
  async open(launchContext) {
    this.#showState('loading');
    this.showDialog();

    try {
      const session = await createWagnerDesignerSession(launchContext);
      log('Session response', session);

      if (!session.ok) {
        this.#showError(session.message || 'Could not launch the designer. Please try again.');
        return;
      }

      this.#session = session;
      this.#loadIframe(session.iframe_url);
    } catch (err) {
      log('Session creation error', err);
      this.#showError('Could not launch the designer. Please try again.');
    }
  }

  /**
   * Open the dialog with an already-created session (skips Wagner session fetch).
   *
   * @param {{ ok: boolean, iframe_url: string, launch_context: object }} session
   */
  openWithSession(session) {
    this.#session = session;
    this.#loadIframe(session.iframe_url);
    this.showDialog();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  #handleDialogClose = () => {
    this.#session = null;
    const { feIframe } = this.refs;
    if (feIframe) feIframe.src = '';
    this.#showState('loading');
  };

  #handleMessage = async (event) => {
    const isFromFE = event.origin === FE_TRUSTED_ORIGIN;
    const isDebugAllowed = WAGNER_DEBUG();

    if (!isFromFE && !isDebugAllowed) return;

    let data = event.data;

    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }

    if (!data || typeof data !== 'object') return;

    const eventType = data.type || data.event || data.eventType;
    if (eventType !== 'PRODUCT_ADDED') return;

    log('PRODUCT_ADDED received from iframe', data);
    await this.#processProductAdded(data);
  };

  /** @param {object} eventData */
  async #processProductAdded(eventData) {
    const session = this.#session;
    if (!session) {
      log('No active session – ignoring PRODUCT_ADDED');
      return;
    }

    this.#showState('loading');

    try {
      const result = await handleFulfillEngineProductAdded(eventData, session);
      log('Wagner fe-product-added response', result);

      if (result.httpStatus === 409) {
        this.#showError('We could not match that decorated product to a storefront variant yet.');
        return;
      }

      if (!result.ok) {
        this.#showError(result.message || 'Something went wrong processing your design. Please try again.');
        return;
      }

      await addWagnerItemsToCart(result.cart_items);

      this.closeDialog();

      document.dispatchEvent(new CartAddEvent({}, 'wagner-fe', { source: 'wagner-fe' }));
    } catch (err) {
      log('Error handling PRODUCT_ADDED', err);
      this.#showError('Something went wrong. Please try again.');
    }
  }

  /** @param {'loading'|'error'|'iframe'} state */
  #showState(state) {
    const { loadingState, errorState, iframeContainer } = this.refs;
    loadingState?.toggleAttribute('hidden', state !== 'loading');
    errorState?.toggleAttribute('hidden', state !== 'error');
    iframeContainer?.toggleAttribute('hidden', state !== 'iframe');
  }

  /** @param {string} message */
  #showError(message) {
    this.#showState('error');
    const { errorMessage } = this.refs;
    if (errorMessage) errorMessage.textContent = message;
  }

  /** @param {string} url */
  #loadIframe(url) {
    this.#showState('iframe');
    const { feIframe } = this.refs;
    if (feIframe) feIframe.src = url;
  }
}

if (!customElements.get('wagner-fe-dialog')) {
  customElements.define('wagner-fe-dialog', WagnerFeDialog);
}

// ─── WagnerFeTrigger custom element ────────────────────────────────────────

/**
 * Wraps a trigger button that opens the FE designer dialog.
 * Tracks the currently selected product variant for product-page launches.
 *
 * @typedef {object} WagnerFeTriggerRefs
 * @property {HTMLButtonElement} triggerBtn
 *
 * @extends {Component<WagnerFeTriggerRefs>}
 */
class WagnerFeTrigger extends Component {
  /** @type {string} */
  #currentVariantId = '';

  /** @type {string} */
  #currentVariantSku = '';

  connectedCallback() {
    super.connectedCallback();
    this.#currentVariantId = this.dataset.variantId ?? '';
    this.#currentVariantSku = this.dataset.variantSku ?? '';

    if (this.dataset.source === 'product_page') {
      document.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate);
  }

  /** Called via on:click="/handleLaunch" on the trigger button. */
  handleLaunch() {
    const dialog = document.querySelector('wagner-fe-dialog');

    if (!dialog) {
      console.warn('[Wagner FE] <wagner-fe-dialog> not found in DOM.');
      return;
    }

    dialog.open(this.#buildContext());
  }

  // ── Private ─────────────────────────────────────────────────────────────

  #handleVariantUpdate = (event) => {
    const { resource, data } = event.detail ?? {};
    if (!resource) return;

    if (
      this.dataset.productId &&
      data?.productId &&
      String(data.productId) !== String(this.dataset.productId)
    ) {
      return;
    }

    this.#currentVariantId = String(resource.id ?? '');
    this.#currentVariantSku = resource.sku ?? '';
    log('Variant updated', this.#currentVariantId, this.#currentVariantSku);
  };

  /** @returns {object} */
  #buildContext() {
    const { shopDomain, source, productId } = this.dataset;

    if (source === 'product_page') {
      return {
        shop_domain: shopDomain,
        source: 'product_page',
        shopify_product_id: productId,
        shopify_variant_id: this.#currentVariantId || this.dataset.variantId,
        garment_sku: this.#currentVariantSku || this.dataset.variantSku || '',
        quantity: 1,
      };
    }

    return {
      shop_domain: shopDomain,
      source: 'global',
      quantity: 1,
    };
  }
}

if (!customElements.get('wagner-fe-trigger')) {
  customElements.define('wagner-fe-trigger', WagnerFeTrigger);
}
