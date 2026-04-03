import { Component } from '@theme/component';

/* ─────────────────────────────────────────────────────────────────────────────
   AtBrandsPanel
   Desktop mega-menu panel for the Brands nav item.
   Manages:
   - Open/close on hover or focus (with correct ARIA attributes)
   - Category switching in the sidebar
   - Brand search / filter
   - Alphabet quick-jump (used by the mobile drawer too via delegation)
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {object} AtBrandsPanelRefs
 * @property {HTMLButtonElement} trigger - The nav trigger button.
 * @property {HTMLElement} panel - The dropdown panel.
 * @property {HTMLInputElement} [searchInput] - The brand search input.
 * @property {HTMLElement} [searchClear] - The clear search button.
 * @property {HTMLElement} [countBadge] - Element displaying the brand count.
 * @property {HTMLElement[]} [catBtn] - Category sidebar buttons.
 */

/**
 * Desktop brands mega-panel custom element.
 *
 * @extends {Component<AtBrandsPanelRefs>}
 */
class AtBrandsPanel extends Component {
  requiredRefs = ['trigger', 'panel'];

  /** Desktop: primary pointer can hover (excludes most phones). */
  static #desktopFinePointerMql = window.matchMedia('(hover: hover) and (pointer: fine)');

  /** @type {ReturnType<typeof setTimeout> | null} */
  #closeTimer = null;

  /** @type {ReturnType<typeof setTimeout> | null} */
  #focusOutTimer = null;

  /** @type {HTMLElement | null} */
  #panelSearchBound = null;

  connectedCallback() {
    super.connectedCallback();
    // Add pointerenter imperatively so hover always works, regardless of
    // whether the Component base class processes on: attrs on the root element.
    this.addEventListener('pointerenter', this.#onPointerEnter);
    this.addEventListener('pointerleave', this.#onPointerLeave);
    this.addEventListener('focusout', this.#onFocusOut);
    // Brand search: capture on the dropdown so input runs even if bubbling is affected;
    // avoids duplicate handling vs host-level delegation.
    const { panel } = this.refs;
    if (panel) {
      panel.addEventListener('input', this.#onDelegatedSearchInput, true);
      panel.addEventListener('click', this.#onDelegatedSearchClearClick, true);
      // mouseenter does not bubble; declarative on:mouseenter on cat buttons is unreliable.
      // pointerover bubbles so one listener switches categories on hover (desktop only).
      panel.addEventListener('pointerover', this.#onDelegatedSidebarPointerOver);
      this.#panelSearchBound = panel;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerenter', this.#onPointerEnter);
    this.removeEventListener('pointerleave', this.#onPointerLeave);
    this.removeEventListener('focusout', this.#onFocusOut);
    if (this.#panelSearchBound) {
      this.#panelSearchBound.removeEventListener('input', this.#onDelegatedSearchInput, true);
      this.#panelSearchBound.removeEventListener('click', this.#onDelegatedSearchClearClick, true);
      this.#panelSearchBound.removeEventListener('pointerover', this.#onDelegatedSidebarPointerOver);
      this.#panelSearchBound = null;
    }
    this.#clearCloseTimer();
    this.#clearFocusOutTimer();
  }

  #onPointerEnter = () => {
    this.open();
  };

  /** @param {Event} event */
  #onDelegatedSearchInput = (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.classList.contains('at-brands-panel__search')) return;
    if (!this.contains(event.target)) return;
    const query = event.target.value.trim().toLowerCase();
    this.#applyFilter(query);
  };

  /** @param {Event} event */
  #onDelegatedSearchClearClick = (event) => {
    const t = event.target instanceof Element ? event.target.closest('.at-brands-panel__search-clear') : null;
    if (!t || !this.contains(t)) return;
    event.preventDefault();
    this.clearSearch();
  };

  /** @param {PointerEvent} event */
  #onDelegatedSidebarPointerOver = (event) => {
    if (!AtBrandsPanel.#desktopFinePointerMql.matches) return;
    if (!(event.target instanceof Element)) return;
    const btn = event.target.closest('.at-brands-panel__cat-btn');
    if (!(btn instanceof HTMLElement) || !this.refs.panel?.contains(btn)) return;
    if (btn.classList.contains('at-brands-panel__cat-btn--active')) return;
    this.#activateCategory(btn.dataset.cat ?? '');
  };

  // ─── Open / close ────────────────────────────────────────────────────────

  /**
   * Called declaratively via on:pointerenter="/open" on the host element.
   */
  open() {
    this.#clearCloseTimer();
    this.#clearFocusOutTimer();

    const { trigger, panel } = this.refs;
    if (!panel || panel.hidden === false) return;

    // Position the fixed-position panel below the header
    this.#updatePanelTop();

    panel.removeAttribute('hidden');
    this.dataset.open = '';
    trigger?.setAttribute('aria-expanded', 'true');

    // Always activate the first category when re-opening so stale state is cleared
    const firstBtn = this.querySelector('.at-brands-panel__cat-btn');
    if (firstBtn instanceof HTMLElement) {
      this.#activateCategory(firstBtn.dataset.cat ?? '');
    }
  }

  /**
   * Close the panel.
   */
  close() {
    this.#clearCloseTimer();
    this.#clearFocusOutTimer();
    this.#applyClose();
  }

  #applyClose() {
    const { trigger, panel } = this.refs;
    if (!panel || panel.hidden) return;

    panel.setAttribute('hidden', '');
    delete this.dataset.open;
    trigger?.setAttribute('aria-expanded', 'false');
  }

  #onPointerLeave = () => {
    this.#clearCloseTimer();
    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = null;
      if (this.contains(document.activeElement)) return;
      this.#applyClose();
    }, 150);
  };

  #onFocusOut = () => {
    this.#clearFocusOutTimer();
    // relatedTarget is often null on click-to-focus; defer and use activeElement instead.
    this.#focusOutTimer = setTimeout(() => {
      this.#focusOutTimer = null;
      if (!this.contains(document.activeElement)) {
        this.#applyClose();
      }
    }, 0);
  };

  #clearCloseTimer() {
    if (this.#closeTimer !== null) {
      clearTimeout(this.#closeTimer);
      this.#closeTimer = null;
    }
  }

  #clearFocusOutTimer() {
    if (this.#focusOutTimer !== null) {
      clearTimeout(this.#focusOutTimer);
      this.#focusOutTimer = null;
    }
  }

  /**
   * Sets the --at-brands-panel-top CSS variable on the panel element
   * to match the bottom edge of the nearest header element, so the
   * fixed-position dropdown always sits directly below the header.
   */
  #updatePanelTop() {
    const { panel } = this.refs;
    if (!panel) return;
    const header = document.querySelector('#header-component')
      ?? document.querySelector('.header-section')
      ?? document.querySelector('header');
    if (header instanceof HTMLElement) {
      const bottom = header.getBoundingClientRect().bottom;
      const topPx = `${bottom}px`;
      panel.style.setProperty('--at-brands-panel-top', topPx);
      panel.style.top = topPx;
      /* max-height comes from CSS (90vh / 90dvh − top) */
    }
  }

  // ─── Category switching ──────────────────────────────────────────────────

  /**
   * Called via on:click="/switchCategory" on each cat button (keyboard, touch, or mouse click).
   * @param {MouseEvent | PointerEvent} event
   */
  switchCategory(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const btn = event.target.closest('.at-brands-panel__cat-btn');
    if (!(btn instanceof HTMLElement)) return;

    this.#activateCategory(btn.dataset.cat ?? '');
  }

  /**
   * @param {string} cat - Category handle/key.
   */
  #activateCategory(cat) {
    // Update button active states
    for (const btn of this.querySelectorAll('.at-brands-panel__cat-btn')) {
      const isActive = btn.dataset.cat === cat;
      btn.classList.toggle('at-brands-panel__cat-btn--active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }

    // Show matching content panel, hide others
    for (const panel of this.querySelectorAll('.at-brands-panel__cat-content')) {
      const matches = panel.dataset.cat === cat;
      panel.hidden = !matches;
    }

    // Re-apply search to the now-visible panel (and fix stale hidden state when switching back).
    const q = this.querySelector('.at-brands-panel__search')?.value.trim().toLowerCase() ?? '';
    this.#applyFilter(q);
  }

  // ─── Brand search ────────────────────────────────────────────────────────

  /**
   * @param {string} query - Lowercase search string.
   */
  #applyFilter(query) {
    const active = this.querySelector('.at-brands-panel__cat-content:not([hidden])');
    const items = /** @type {NodeListOf<HTMLElement>} */ (
      active?.querySelectorAll('.at-brands-panel__brand-item[data-brand-name]') ?? []
    );

    let visible = 0;

    for (const item of items) {
      const name = item.dataset.brandName?.toLowerCase() ?? '';
      const show = query === '' || name.includes(query);
      item.hidden = !show;
      if (show) visible++;
    }

    if (this.refs.countBadge) {
      this.refs.countBadge.textContent = String(visible);
    }

    const clearBtn = active?.querySelector('.at-brands-panel__search-clear');
    if (clearBtn instanceof HTMLElement) {
      clearBtn.hidden = query === '';
    }
  }

  /**
   * Clear the search input and show all brands in the active panel.
   */
  clearSearch() {
    const input = this.querySelector('.at-brands-panel__search');
    if (input instanceof HTMLInputElement) {
      input.value = '';
    }

    this.#applyFilter('');
    input?.focus();
  }
}

if (!customElements.get('at-brands-panel')) {
  customElements.define('at-brands-panel', AtBrandsPanel);
}

/* ─────────────────────────────────────────────────────────────────────────────
   AtMenuDrawer
   Mobile slide-in drawer. Manages:
   - Category ↔ brands view switching
   - Brand search / filter inside the drawer
   - Alphabet quick-jump
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {object} AtMenuDrawerRefs
 * @property {HTMLElement} categoriesView - The categories view container.
 * @property {HTMLElement} brandsView - The brands drill-down view container.
 * @property {HTMLInputElement} [searchInput] - Brand search input in drawer.
 * @property {HTMLElement} [searchClear] - Clear search button in drawer.
 * @property {HTMLElement} [countBadge] - Brand count badge in drawer.
 * @property {HTMLElement} [alphaBar] - Alphabet quick-jump bar.
 */

/**
 * Mobile drawer custom element for the AT Menu.
 *
 * @extends {Component<AtMenuDrawerRefs>}
 */
class AtMenuDrawer extends Component {
  requiredRefs = ['categoriesView', 'brandsView'];

  /** @type {'categories' | 'brands'} */
  #view = 'categories';

  connectedCallback() {
    super.connectedCallback();
    this.#setView('categories');
    this.addEventListener('input', this.#onDelegatedDrawerSearchInput);
    this.addEventListener('click', this.#onDelegatedDrawerSearchClearClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('input', this.#onDelegatedDrawerSearchInput);
    this.removeEventListener('click', this.#onDelegatedDrawerSearchClearClick);
  }

  /** @param {Event} event */
  #onDelegatedDrawerSearchInput = (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.classList.contains('at-drawer__search')) return;
    if (!this.contains(event.target)) return;
    const query = event.target.value.trim().toLowerCase();
    this.#applyFilter(query);
  };

  /** @param {Event} event */
  #onDelegatedDrawerSearchClearClick = (event) => {
    const t = event.target instanceof Element ? event.target.closest('.at-drawer__search-clear') : null;
    if (!t || !this.contains(t)) return;
    event.preventDefault();
    this.clearSearch();
  };

  // ─── View switching ──────────────────────────────────────────────────────

  /**
   * Show the brands drill-down view. Called via on:click="/showBrands".
   */
  showBrands() {
    this.#setView('brands');

    // Focus search if present
    requestAnimationFrame(() => {
      this.refs.searchInput?.focus();
    });
  }

  /**
   * Show the categories view. Called via on:click="/showCategories".
   */
  showCategories() {
    this.#setView('categories');
    this.#clearFilter();
  }

  /**
   * @param {'categories' | 'brands'} view
   */
  #setView(view) {
    this.#view = view;
    this.dataset.view = view;

    const { categoriesView, brandsView } = this.refs;
    if (categoriesView) categoriesView.hidden = view !== 'categories';
    if (brandsView) brandsView.hidden = view !== 'brands';
  }

  // ─── Brand search ────────────────────────────────────────────────────────

  /**
   * @param {string} query
   */
  #applyFilter(query) {
    const { brandsView } = this.refs;
    const items = /** @type {NodeListOf<HTMLElement>} */ (
      brandsView?.querySelectorAll('.at-drawer__brand-item[data-brand-name]') ?? []
    );

    let visible = 0;

    for (const item of items) {
      const name = item.dataset.brandName?.toLowerCase() ?? '';
      const show = query === '' || name.includes(query);
      item.hidden = !show;
      if (show) visible++;
    }

    if (this.refs.countBadge) {
      this.refs.countBadge.textContent = String(visible);
    }

    const clearBtn = brandsView?.querySelector('.at-drawer__search-clear');
    if (clearBtn instanceof HTMLElement) {
      clearBtn.hidden = query === '';
    }

    for (const section of this.querySelectorAll('.at-drawer__letter-section')) {
      const hasVisible =
        section.querySelector('.at-drawer__brand-item[data-brand-name]:not([hidden])') !== null;
      if (section instanceof HTMLElement) {
        section.hidden = !hasVisible;
      }
    }

    if (this.refs.alphaBar) {
      this.refs.alphaBar.hidden = query !== '';
    }
  }

  #clearFilter() {
    const input = this.querySelector('.at-drawer__search');
    if (input instanceof HTMLInputElement) {
      input.value = '';
    }

    this.#applyFilter('');
  }

  clearSearch() {
    this.#clearFilter();
    this.querySelector('.at-drawer__search')?.focus();
  }

  // ─── Alphabet jump ───────────────────────────────────────────────────────

  /**
   * Scroll to a letter section. Called via on:click="/scrollToLetter" on alphabet buttons.
   * @param {MouseEvent} event
   */
  scrollToLetter(event) {
    if (!(event.currentTarget instanceof HTMLElement)) return;

    const letter = event.currentTarget.dataset.letter;
    if (!letter) return;

    const target = this.querySelector(`#at-letter-${letter}`);
    if (!(target instanceof HTMLElement)) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Update active alpha button state
    for (const btn of this.querySelectorAll('.at-drawer__alpha-btn')) {
      btn.classList.toggle('at-drawer__alpha-btn--active', btn.dataset.letter === letter);
    }
  }
}

if (!customElements.get('at-menu-drawer')) {
  customElements.define('at-menu-drawer', AtMenuDrawer);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Brand avatar colour helper
   Assigns a deterministic HSL background to initials badges so each brand
   gets a distinct, consistent colour without relying on the server.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Given a brand name string, returns a deterministic HSL colour string.
 * @param {string} name
 * @returns {string}
 */
function brandColor(name) {
  let hash = 0;

  for (const char of name) {
    hash += char.charCodeAt(0);
  }

  const hue = hash % 360;
  const sat = 48 + (hash % 20);
  const light = 36 + (hash % 14);

  return `hsl(${hue}deg ${sat}% ${light}%)`;
}

/**
 * Hydrate all brand initials avatars in the document with a computed background colour.
 * Called once on idle so it doesn't block the main thread.
 */
function hydrateBrandAvatars() {
  const avatars = /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll('.at-brand-avatar--initials[data-brand-name]')
  );

  for (const avatar of avatars) {
    const name = avatar.dataset.brandName ?? '';
    if (name) {
      avatar.style.setProperty('--at-brand-avatar-bg', brandColor(name));
    }
  }
}

if ('requestIdleCallback' in window) {
  requestIdleCallback(hydrateBrandAvatars);
} else {
  setTimeout(hydrateBrandAvatars, 200);
}
