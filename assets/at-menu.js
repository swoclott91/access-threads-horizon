import { Component } from '@theme/component';
import { debounce, setHeaderMenuStyle } from '@theme/utilities';

/**
 * @typedef {object} AtMenuRefs
 * @property {HTMLElement} drawer - The slide-in mobile drawer element.
 * @property {HTMLElement} overlay - The background overlay element.
 * @property {HTMLButtonElement} toggleBtn - The mobile hamburger toggle button.
 */

/**
 * Top-level AT Menu component.
 *
 * Manages the mobile drawer open/close state, scroll locking, and
 * the debounced resize handler that keeps `data-menu-style` in sync.
 *
 * @extends {Component<AtMenuRefs>}
 */
class AtMenuComponent extends Component {
  requiredRefs = ['drawer'];

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('resize', this.#resizeListener);
    this.addEventListener('keyup', this.#onKeyUp);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#resizeListener);
    this.removeEventListener('keyup', this.#onKeyUp);
  }

  #resizeListener = debounce(() => {
    setHeaderMenuStyle();
  }, 100);

  /**
   * @param {KeyboardEvent} event
   */
  #onKeyUp = (event) => {
    if (event.key === 'Escape') this.closeDrawer();
  };

  /**
   * @returns {boolean}
   */
  get isDrawerOpen() {
    return this.refs.drawer?.dataset.open === 'true';
  }

  /**
   * Open the mobile menu drawer.
   */
  openDrawer() {
    const { drawer, overlay } = this.refs;
    if (!drawer) return;

    drawer.dataset.open = 'true';
    document.documentElement.setAttribute('scroll-lock', '');

    if (overlay) {
      overlay.dataset.open = '';
    }

    // Focus the first focusable element inside the drawer
    requestAnimationFrame(() => {
      const focusable = drawer.querySelector(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable instanceof HTMLElement) {
        focusable.focus();
      }
    });
  }

  /**
   * Close the mobile menu drawer.
   */
  closeDrawer() {
    const { drawer, overlay, toggleBtn } = this.refs;
    if (!drawer) return;

    drawer.dataset.open = 'false';
    document.documentElement.removeAttribute('scroll-lock');

    if (overlay) {
      delete overlay.dataset.open;
    }

    toggleBtn?.focus();
  }

  /**
   * Toggle the mobile drawer.
   */
  toggleDrawer() {
    if (this.isDrawerOpen) {
      this.closeDrawer();
    } else {
      this.openDrawer();
    }
  }
}

if (!customElements.get('at-menu-component')) {
  customElements.define('at-menu-component', AtMenuComponent);
}

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

  /** @type {ReturnType<typeof setTimeout> | null} */
  #closeTimer = null;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerleave', this.#onPointerLeave);
    this.addEventListener('focusout', this.#onFocusOut);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerleave', this.#onPointerLeave);
    this.removeEventListener('focusout', this.#onFocusOut);
    this.#clearCloseTimer();
  }

  // ─── Open / close ────────────────────────────────────────────────────────

  /**
   * Called declaratively via on:pointerenter="/open" on the host element.
   */
  open() {
    this.#clearCloseTimer();

    const { trigger, panel } = this.refs;
    if (!panel || panel.hidden === false) return;

    panel.removeAttribute('hidden');
    this.dataset.open = '';
    trigger?.setAttribute('aria-expanded', 'true');

    // Activate the default active category (first or already active)
    const activeBtn = this.querySelector('.at-brands-panel__cat-btn--active')
      ?? this.querySelector('.at-brands-panel__cat-btn');
    if (activeBtn instanceof HTMLElement) {
      this.#activateCategory(activeBtn.dataset.cat ?? '');
    }
  }

  /**
   * Close the panel.
   */
  close() {
    this.#clearCloseTimer();
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
      this.#applyClose();
    }, 150);
  };

  /**
   * @param {FocusEvent} event
   */
  #onFocusOut = (event) => {
    if (!(event.relatedTarget instanceof Node) || !this.contains(event.relatedTarget)) {
      this.#applyClose();
    }
  };

  #clearCloseTimer() {
    if (this.#closeTimer !== null) {
      clearTimeout(this.#closeTimer);
      this.#closeTimer = null;
    }
  }

  // ─── Category switching ──────────────────────────────────────────────────

  /**
   * Called via on:click="/switchCategory" on each cat button.
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
      btn.classList.toggle('at-brands-panel__cat-btn--active', btn.dataset.cat === cat);
    }

    // Show matching content panel, hide others
    for (const panel of this.querySelectorAll('.at-brands-panel__cat-content')) {
      const matches = panel.dataset.cat === cat;
      panel.hidden = !matches;
    }
  }

  // ─── Brand search ────────────────────────────────────────────────────────

  /**
   * Called via on:input="/filterBrands" on the search input.
   */
  filterBrands() {
    const query = this.refs.searchInput?.value.trim().toLowerCase() ?? '';
    this.#applyFilter(query);
  }

  /**
   * @param {string} query - Lowercase search string.
   */
  #applyFilter(query) {
    const items = /** @type {NodeListOf<HTMLElement>} */ (
      this.querySelectorAll('[data-brand-name]')
    );

    let visible = 0;

    for (const item of items) {
      const name = item.dataset.brandName?.toLowerCase() ?? '';
      const show = query === '' || name.includes(query);
      item.hidden = !show;
      if (show) visible++;
    }

    // Update the count badge
    if (this.refs.countBadge) {
      this.refs.countBadge.textContent = String(visible);
    }

    // Show/hide the clear button
    if (this.refs.searchClear) {
      this.refs.searchClear.hidden = query === '';
    }
  }

  /**
   * Clear the search input. Called via on:click="/clearSearch".
   */
  clearSearch() {
    if (this.refs.searchInput) {
      this.refs.searchInput.value = '';
    }

    this.#applyFilter('');
    this.refs.searchInput?.focus();
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
  }

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
   * Called via on:input="/filterBrands" on the drawer search input.
   */
  filterBrands() {
    const query = this.refs.searchInput?.value.trim().toLowerCase() ?? '';
    this.#applyFilter(query);
  }

  /**
   * @param {string} query
   */
  #applyFilter(query) {
    const items = /** @type {NodeListOf<HTMLElement>} */ (
      this.querySelectorAll('[data-brand-name]')
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

    if (this.refs.searchClear) {
      this.refs.searchClear.hidden = query === '';
    }

    // Hide letter section headers when all their brands are hidden
    for (const section of this.querySelectorAll('.at-drawer__letter-section')) {
      const hasVisible = section.querySelector('[data-brand-name]:not([hidden])') !== null;
      if (section instanceof HTMLElement) {
        section.hidden = !hasVisible;
      }
    }

    // Hide alphabet bar during active search
    if (this.refs.alphaBar) {
      this.refs.alphaBar.hidden = query !== '';
    }
  }

  #clearFilter() {
    if (this.refs.searchInput) {
      this.refs.searchInput.value = '';
    }

    this.#applyFilter('');
  }

  /**
   * Clear the search input. Called via on:click="/clearSearch".
   */
  clearSearch() {
    this.#clearFilter();
    this.refs.searchInput?.focus();
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
