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

  /** @type {ResizeObserver | null} */
  #headerResizeObserver = null;

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
    this.#unbindHeaderLayoutListeners();
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

    // Position the fixed panel flush with the *top header row* (same visual edge as Horizon mega menus).
    this.#updatePanelTop();

    panel.removeAttribute('hidden');
    this.dataset.open = '';
    trigger?.setAttribute('aria-expanded', 'true');

    this.#bindHeaderLayoutListeners();

    // Re-measure after layout / sticky transition so `top` matches paint.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.#updatePanelTop();
        // `--top-row-height` on #header-component is set in rAF in utilities.js; one more tick helps home vs other pages.
        queueMicrotask(() => this.#updatePanelTop());
      });
    });

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
    this.#unbindHeaderLayoutListeners();

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
   * Sets `top` / `--at-brands-panel-top` flush under the header seam.
   *
   * Home vs other pages: link `getBoundingClientRect()` can sit much lower than the real first-row
   * seam (e.g. ~92px vs ~66px). Horizon sets `--top-row-height` on `#header-component` (utilities.js);
   * when the trigger lives in `.header__row--top`, use `min(header.top + --top-row-height, topRow.bottom)`.
   * Menu in `.header__row--bottom` uses that row’s bottom. Otherwise fall back to min(nav, row, trigger).
   */
  #updatePanelTop() {
    const { panel, trigger } = this.refs;
    if (!panel) return;

    const headerComponent = document.querySelector('#header-component');
    const row = trigger instanceof HTMLElement ? trigger.closest('.header__row') : null;
    const nav = trigger instanceof HTMLElement ? trigger.closest('.at-menu__nav') : null;

    const bottom = this.#resolvePanelSeamBottom(trigger, headerComponent, nav, row);

    const seamRow =
      trigger instanceof HTMLElement
        ? (trigger.closest('.header__row--top') ??
            trigger.closest('.header__row--bottom') ??
            row)
        : row;

    let seamOverlap = 2;
    if (seamRow instanceof HTMLElement) {
      const borderBottom = parseFloat(getComputedStyle(seamRow).borderBottomWidth) || 0;
      seamOverlap = Math.max(2, 1 + borderBottom);
    }

    if (bottom <= 0) return;

    const topPx = `${Math.max(0, bottom - seamOverlap)}px`;
    panel.style.setProperty('--at-brands-panel-top', topPx);
    panel.style.top = topPx;
  }

  /**
   * Viewport Y of the bottom edge of the header region the mega panel should meet.
   * @param {HTMLElement | undefined} trigger
   * @param {Element | null} headerComponent
   * @param {HTMLElement | null} nav
   * @param {HTMLElement | null} row
   */
  #resolvePanelSeamBottom(trigger, headerComponent, nav, row) {
    if (!(trigger instanceof HTMLElement) || !(headerComponent instanceof HTMLElement)) {
      return this.#fallbackPanelSeamBottom(nav, row, trigger, headerComponent);
    }

    const headerRect = headerComponent.getBoundingClientRect();
    const topRowPx = parseFloat(getComputedStyle(headerComponent).getPropertyValue('--top-row-height'));

    if (trigger.closest('.header__row--top') && !Number.isNaN(topRowPx) && topRowPx > 0) {
      const fromThemeVar = headerRect.top + topRowPx;
      const topRowEl = trigger.closest('.header__row--top');
      const fromRect =
        topRowEl instanceof HTMLElement ? topRowEl.getBoundingClientRect().bottom : Number.POSITIVE_INFINITY;
      return Math.min(fromThemeVar, fromRect);
    }

    if (trigger.closest('.header__row--bottom') && row instanceof HTMLElement) {
      return row.getBoundingClientRect().bottom;
    }

    return this.#fallbackPanelSeamBottom(nav, row, trigger, headerComponent);
  }

  /**
   * @param {HTMLElement | null} nav
   * @param {HTMLElement | null} row
   * @param {HTMLElement | undefined} trigger
   * @param {Element | null} headerComponent
   */
  #fallbackPanelSeamBottom(nav, row, trigger, headerComponent) {
    /** @type {number[]} */
    const bottoms = [];
    if (nav instanceof HTMLElement) bottoms.push(nav.getBoundingClientRect().bottom);
    if (row instanceof HTMLElement) bottoms.push(row.getBoundingClientRect().bottom);
    if (trigger instanceof HTMLElement) bottoms.push(trigger.getBoundingClientRect().bottom);
    if (bottoms.length > 0) return Math.min(...bottoms);

    const fallback =
      headerComponent instanceof Element
        ? (headerComponent.querySelector('.header__row--top') ?? headerComponent)
        : null;
    const el =
      fallback instanceof HTMLElement
        ? fallback
        : (document.querySelector('.header-section') ?? document.querySelector('header'));
    return el instanceof HTMLElement ? el.getBoundingClientRect().bottom : 0;
  }

  #onHeaderLayoutChange = () => {
    if (!this.dataset.open) return;
    this.#updatePanelTop();
  };

  #bindHeaderLayoutListeners() {
    this.#unbindHeaderLayoutListeners();
    const header = document.querySelector('#header-component');
    if (header instanceof HTMLElement) {
      this.#headerResizeObserver = new ResizeObserver(this.#onHeaderLayoutChange);
      this.#headerResizeObserver.observe(header);
    }
    window.addEventListener('scroll', this.#onHeaderLayoutChange, { passive: true });
    window.addEventListener('resize', this.#onHeaderLayoutChange);
  }

  #unbindHeaderLayoutListeners() {
    this.#headerResizeObserver?.disconnect();
    this.#headerResizeObserver = null;
    window.removeEventListener('scroll', this.#onHeaderLayoutChange);
    window.removeEventListener('resize', this.#onHeaderLayoutChange);
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
   AtMenuPanel
   Mobile drawer view-stack. Manages:
   - Forward/back navigation between named views (main → categories → brands)
   - Slide animations between views
   - Brand search / filter within the brands view
   - Alphabet quick-jump
   Lives inside the <header-drawer> component; close buttons delegate to
   header-drawer/close so focus-trap teardown works correctly.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {object} AtMenuPanelRefs
 * @property {HTMLInputElement} [searchInput] - Brand search input.
 * @property {HTMLElement} [searchClear] - Clear search button.
 * @property {HTMLElement} [brandCount] - Brand count badge.
 * @property {HTMLElement} [brandsBody] - Scrollable brands container.
 * @property {HTMLElement} [alphaBar] - Alphabet quick-jump bar.
 */

/**
 * View-stack panel for the AT mobile drawer.
 *
 * @extends {Component<AtMenuPanelRefs>}
 */
class AtMenuPanel extends Component {
  /** @type {string[]} */
  #viewStack = [];

  /** @type {HTMLElement | null} */
  #activeView = null;

  /** @type {boolean} */
  #animating = false;

  /** @type {MutationObserver | null} */
  #detailsObserver = null;

  connectedCallback() {
    super.connectedCallback();

    this.#activeView = this.querySelector('.at-panel__view[data-view="main"]');
    this.#viewStack = [];

    this.addEventListener('input', this.#onSearchInput);
    this.addEventListener('click', this.#onSearchClearClick);

    // Reset to main view whenever the parent <details> drawer closes.
    const details = this.closest('details.menu-drawer-container');
    if (details) {
      this.#detailsObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.attributeName === 'open' && !details.hasAttribute('open')) {
            this.reset();
          }
        }
      });
      this.#detailsObserver.observe(details, { attributes: true });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('input', this.#onSearchInput);
    this.removeEventListener('click', this.#onSearchClearClick);
    this.#detailsObserver?.disconnect();
    this.#detailsObserver = null;
  }

  // ─── View navigation ──────────────────────────────────────────────────────

  /**
   * Navigate forward to a named view. Called via on:click="/navigate"
   * with data-target="viewName" on the trigger element.
   * @param {MouseEvent} event
   */
  navigate(event) {
    if (this.#animating) return;
    if (!(event.currentTarget instanceof HTMLElement)) return;

    const target = event.currentTarget.dataset.target;
    if (!target) return;

    const nextView = this.querySelector(`.at-panel__view[data-view="${target}"]`);
    if (!(nextView instanceof HTMLElement) || !this.#activeView) return;

    this.#transition(this.#activeView, nextView, 'forward');
  }

  /**
   * Navigate back to the previous view. Called via on:click="/back".
   */
  back() {
    if (this.#animating) return;

    const prevViewName = this.#viewStack[this.#viewStack.length - 1];
    if (!prevViewName || !this.#activeView) return;

    const prevView = this.querySelector(`.at-panel__view[data-view="${prevViewName}"]`);
    if (!(prevView instanceof HTMLElement)) return;

    this.#transition(this.#activeView, prevView, 'back');
  }

  /**
   * Reset to the main view without animation (used when the drawer closes).
   */
  reset() {
    for (const view of this.querySelectorAll('.at-panel__view')) {
      if (view instanceof HTMLElement) {
        view.hidden = view.dataset.view !== 'main';
        view.classList.remove(
          'at-panel__view--enter-right',
          'at-panel__view--exit-left',
          'at-panel__view--enter-left',
          'at-panel__view--exit-right'
        );
      }
    }
    this.#activeView = this.querySelector('.at-panel__view[data-view="main"]');
    this.#viewStack = [];
    this.#animating = false;
    this.#clearBrandFilter();
  }

  /**
   * Animate between two views.
   * @param {HTMLElement} from
   * @param {HTMLElement} to
   * @param {'forward' | 'back'} direction
   */
  #transition(from, to, direction) {
    this.#animating = true;

    if (direction === 'forward') {
      this.#viewStack.push(from.dataset.view ?? '');
    } else {
      this.#viewStack.pop();
    }

    to.hidden = false;

    const enterClass =
      direction === 'forward' ? 'at-panel__view--enter-right' : 'at-panel__view--enter-left';
    const exitClass =
      direction === 'forward' ? 'at-panel__view--exit-left' : 'at-panel__view--exit-right';

    to.classList.add(enterClass);
    from.classList.add(exitClass);

    let settled = false;
    const onEnd = () => {
      if (settled) return;
      settled = true;
      to.classList.remove(enterClass);
      from.classList.remove(exitClass);
      from.hidden = true;
      this.#activeView = to;
      this.#animating = false;
    };

    to.addEventListener('animationend', onEnd, { once: true });

    // Safety fallback if animationend doesn't fire (e.g. prefers-reduced-motion)
    setTimeout(onEnd, 350);
  }

  // ─── Brand search ────────────────────────────────────────────────────────

  /** @param {Event} event */
  #onSearchInput = (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.classList.contains('at-panel__search')) return;
    this.#applyBrandFilter(event.target.value.trim().toLowerCase());
  };

  /** @param {Event} event */
  #onSearchClearClick = (event) => {
    const btn =
      event.target instanceof Element ? event.target.closest('.at-panel__search-clear') : null;
    if (!btn || !this.contains(btn)) return;
    event.preventDefault();
    this.clearSearch();
  };

  /**
   * @param {string} query
   */
  #applyBrandFilter(query) {
    const items = /** @type {NodeListOf<HTMLElement>} */ (
      this.querySelectorAll('.at-panel__brand-item[data-brand-name]')
    );

    let visible = 0;
    for (const item of items) {
      const name = item.dataset.brandName?.toLowerCase() ?? '';
      const show = query === '' || name.includes(query);
      item.hidden = !show;
      if (show) visible++;
    }

    if (this.refs.brandCount) {
      this.refs.brandCount.textContent = String(visible);
    }
    if (this.refs.searchClear instanceof HTMLElement) {
      this.refs.searchClear.hidden = query === '';
    }

    for (const section of this.querySelectorAll('.at-panel__letter-section')) {
      if (section instanceof HTMLElement) {
        section.hidden =
          section.querySelector('.at-panel__brand-item:not([hidden])') === null;
      }
    }

    if (this.refs.alphaBar) {
      this.refs.alphaBar.hidden = query !== '';
    }
  }

  #clearBrandFilter() {
    if (this.refs.searchInput instanceof HTMLInputElement) {
      this.refs.searchInput.value = '';
    }
    this.#applyBrandFilter('');
  }

  clearSearch() {
    this.#clearBrandFilter();
    this.refs.searchInput?.focus();
  }

  // ─── Alphabet jump ───────────────────────────────────────────────────────

  /**
   * Scroll to a letter section. Called via on:click="/scrollToLetter".
   * @param {MouseEvent} event
   */
  scrollToLetter(event) {
    if (!(event.currentTarget instanceof HTMLElement)) return;

    const letter = event.currentTarget.dataset.letter;
    if (!letter) return;

    const target = this.querySelector(`#at-letter-${letter}`);
    if (!(target instanceof HTMLElement)) return;

    const scrollParent = this.refs.brandsBody;
    if (scrollParent) {
      const offset = target.offsetTop - scrollParent.offsetTop;
      scrollParent.scrollTo({ top: offset, behavior: 'smooth' });
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    for (const btn of this.querySelectorAll('.at-panel__alpha-btn')) {
      btn.classList.toggle('at-panel__alpha-btn--active', btn.dataset.letter === letter);
    }
  }
}

if (!customElements.get('at-menu-panel')) {
  customElements.define('at-menu-panel', AtMenuPanel);
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
