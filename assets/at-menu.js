import { Component } from '@theme/component';
import { calculateHeaderGroupHeight } from '@theme/utilities';

/* ─────────────────────────────────────────────────────────────────────────────
   MenuDataFetcher
   ----------------
   Singleton that fetches `sections/at-menu-data.liquid` exactly once per
   page load via the Shopify Section Rendering API. The section renders
   nothing on the initial page load (intentional, see its docs); only when
   we explicitly hit `?section_id=at-menu-data` does the server emit the
   heavy menu views (~100-brand grid + every per-category subnav, both
   mobile drawer views and desktop mega-panel content).

   Both <at-brands-panel> (desktop) and <at-menu-panel> (mobile) subscribe
   to the same instance — fetch happens at most once per page, and each
   consumer clones the bits it needs into its own DOM. Subsequent
   subscribers after resolution receive the cached document immediately
   (via a microtask).

   Trigger policy: fetch is started ONLY on real user intent — hamburger
   pointerdown on mobile, nav pointerenter/focus on desktop. Crawlers
   that never interact never trigger the fetch, so the heavy section
   never burdens TTFB for Google's product-feed crawler / soft-error
   detectors that have been tripping GMC disapprovals.
   ───────────────────────────────────────────────────────────────────────────── */

class MenuDataFetcher {
  /** @type {MenuDataFetcher | null} */
  static #instance = null;

  static get() {
    if (!MenuDataFetcher.#instance) {
      MenuDataFetcher.#instance = new MenuDataFetcher();
    }
    return MenuDataFetcher.#instance;
  }

  /** @type {Document | null} */
  #doc = null;

  /** @type {Promise<Document | null> | null} */
  #promise = null;

  /** @type {Set<(doc: Document) => void>} */
  #consumers = new Set();

  /**
   * Subscribe to the fetched menu-data document. Callback fires once
   * (immediately via microtask if already resolved). Subscribing does
   * NOT trigger the fetch — call request() to start it.
   *
   * @param {(doc: Document) => void} cb
   */
  subscribe(cb) {
    if (this.#doc) {
      queueMicrotask(() => cb(/** @type {Document} */ (this.#doc)));
      return;
    }
    this.#consumers.add(cb);
  }

  /**
   * Kick off the fetch (idempotent). Returns the in-flight promise.
   *
   * @returns {Promise<Document | null>}
   */
  request() {
    if (this.#promise) return this.#promise;

    const url = new URL(window.location.href);
    url.searchParams.delete('page');
    url.searchParams.set('section_id', 'at-menu-data');

    console.log('[at-menu] fetching', url.toString());
    this.#promise = fetch(url.toString(), {
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
    })
      .then(async (resp) => {
        if (!resp.ok) {
          console.warn('[at-menu] data fetch returned', resp.status, resp.statusText);
          return null;
        }
        const html = await resp.text();
        console.log('[at-menu] response length', html.length, 'bytes');
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const root = doc.querySelector('at-menu-data');
        if (!root) {
          console.warn(
            '[at-menu] no <at-menu-data> in response. First 300 chars:',
            html.slice(0, 300)
          );
          return null;
        }
        const mobileMounts = root.querySelectorAll('[data-at-mount="mobile-view"]').length;
        const desktopMounts = root.querySelectorAll('[data-at-mount="desktop-cat-content"]').length;
        console.log('[at-menu] parsed', { mobileMounts, desktopMounts });
        this.#doc = doc;
        for (const cb of this.#consumers) {
          try {
            cb(doc);
          } catch (err) {
            console.error('[at-menu] consumer threw', err);
          }
        }
        this.#consumers.clear();
        return doc;
      })
      .catch((err) => {
        console.warn('[at-menu] data fetch failed', err);
        this.#promise = null;
        return null;
      });

    return this.#promise;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   AtBrandsPanel
   Desktop mega-menu panel for the Brands nav item.
   Manages:
   - Open/close on hover or focus (with correct ARIA attributes)
   - Category switching in the sidebar
   - Brand search / filter
   - Alphabet quick-jump (used by the mobile drawer too via delegation)
   - Adopting heavy view content from at-menu-data on first interaction
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

  /** @type {ResizeObserver | null} */
  #headerResizeObserver = null;

  /** @type {MutationObserver | null} */
  #avatarObserver = null;

  /**
   * Whether we've already requested at-menu-data for this panel.
   * @type {boolean}
   */
  #dataRequested = false;

  /**
   * Whether we've already adopted heavy views into the panel.
   * @type {boolean}
   */
  #dataAdopted = false;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerenter', this.#onPointerEnter);
    this.addEventListener('pointerleave', this.#onPointerLeave);
    this.addEventListener('focusout', this.#onFocusOut);
    this.addEventListener('input', this.#onDelegatedSearchInput);
    this.addEventListener('click', this.#onDelegatedSearchClearClick);
    this.addEventListener('pointerover', this.#onDelegatedSidebarPointerOver);
    // Trigger menu-data fetch on first focus too (keyboard users).
    this.addEventListener('focusin', this.#onFirstInteraction, { once: true });

    AtBrandsPanel.#fixHeaderGroupHeight();

    // Initials avatars compute their colors client-side; rehydrate as
    // new brand items arrive (either from at-menu-data adoption below,
    // or from any future SRA morph that may touch the panel).
    hydrateAvatarsIn(this);
    this.#avatarObserver = new MutationObserver(() => hydrateAvatarsIn(this));
    this.#avatarObserver.observe(this, { childList: true, subtree: true });

    // Subscribe to the menu-data fetcher. We don't request the fetch
    // here — that happens on first interaction (#onFirstInteraction).
    // But if the mobile drawer already requested it (which can happen
    // on tablets that have both pointer types), we'll get the doc as
    // soon as it resolves and adopt the desktop views.
    MenuDataFetcher.get().subscribe((doc) => this.#adoptDesktopViews(doc));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerenter', this.#onPointerEnter);
    this.removeEventListener('pointerleave', this.#onPointerLeave);
    this.removeEventListener('focusout', this.#onFocusOut);
    this.removeEventListener('input', this.#onDelegatedSearchInput);
    this.removeEventListener('click', this.#onDelegatedSearchClearClick);
    this.removeEventListener('pointerover', this.#onDelegatedSidebarPointerOver);
    this.removeEventListener('focusin', this.#onFirstInteraction);
    this.#clearCloseTimer();
    this.#clearFocusOutTimer();
    this.#unbindHeaderLayoutListeners();
    this.#avatarObserver?.disconnect();
    this.#avatarObserver = null;
  }

  #onPointerEnter = () => {
    this.#onFirstInteraction();
    this.open();
  };

  /**
   * First user signal that the desktop nav is engaged. Triggers the
   * one-time at-menu-data fetch so the heavy views are adopted before
   * the user activates a category. Safe to call multiple times — both
   * the request() and the adopt step are idempotent.
   */
  #onFirstInteraction = () => {
    if (this.#dataRequested) return;
    if (!AtBrandsPanel.#desktopFinePointerMql.matches) {
      // On tablets / hybrid devices we still want to support desktop
      // hover-style menus, so allow the request even without fine
      // pointer. This is just an early-warmup.
    }
    this.#dataRequested = true;
    MenuDataFetcher.get().request();
  };

  /**
   * Clone heavy desktop views from the fetched at-menu-data document
   * into the live panel. Each `[data-at-mount="desktop-cat-content"]`
   * container in the source document holds the body for one category
   * (matched by `data-cat`), and we append its children into the
   * matching `.at-brands-panel__cat-content[data-cat="…"]` element
   * in the live DOM (before the existing footer if any).
   *
   * Idempotent — guarded by `#dataAdopted` so re-firing observer
   * callbacks won't duplicate views.
   *
   * @param {Document} doc
   */
  #adoptDesktopViews(doc) {
    if (this.#dataAdopted) return;

    const data = doc.querySelector('at-menu-data');
    if (!data) return;

    const mounts = data.querySelectorAll('[data-at-mount="desktop-cat-content"]');
    if (!mounts.length) return;

    let adoptedAny = false;

    for (const mount of mounts) {
      const cat = mount.getAttribute('data-cat');
      if (!cat) continue;

      const target = this.querySelector(
        `.at-brands-panel__cat-content[data-cat="${CSS.escape(cat)}"]`
      );
      if (!(target instanceof HTMLElement)) continue;

      const footer = target.querySelector('.at-brands-panel__footer');

      for (const child of Array.from(mount.children)) {
        const clone = child.cloneNode(true);
        if (footer) {
          target.insertBefore(clone, footer);
        } else {
          target.appendChild(clone);
        }
      }
      adoptedAny = true;
    }

    if (adoptedAny) {
      this.#dataAdopted = true;
      hydrateAvatarsIn(this);
      // If the panel is currently open and showing a category whose
      // grid we just inserted, re-apply any active search filter.
      if (this.dataset.open !== undefined) {
        const q = this.querySelector('.at-brands-panel__search')?.value.trim().toLowerCase() ?? '';
        this.#applyFilter(q);
      }
    }
  }

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
    if (!(btn instanceof HTMLElement) || !this.contains(btn)) return;
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

    this.#updatePanelTop();

    panel.removeAttribute('hidden');
    this.dataset.open = '';
    trigger?.setAttribute('aria-expanded', 'true');

    this.#bindHeaderLayoutListeners();
    AtBrandsPanel.#fixHeaderGroupHeight();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.#updatePanelTop();
        queueMicrotask(() => this.#updatePanelTop());
      });
    });

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

    AtBrandsPanel.#fixHeaderGroupHeight();
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

  /**
   * Recalculate `--header-group-height` after a double-rAF delay.
   *
   * This waits for header/menu layout to settle, then reapplies the shared
   * header-group span calculation so transparent-header offsets stay correct.
   */
  static #fixHeaderGroupHeight() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const headerGroup = document.querySelector('#header-group');
        const header = document.querySelector('#header-component');
        if (!headerGroup || !(header instanceof HTMLElement)) return;

        const height = calculateHeaderGroupHeight(header, headerGroup);
        document.body.style.setProperty('--header-group-height', `${Math.round(height)}px`);
      });
    });
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

    // Show matching content panel, hide others. Grid content inside each
    // cat-content is either present (eager_loading=true on the Section
    // Rendering API re-fetch, morphed in via data-hydration-key) or absent
    // (eager_loading=false on initial page render). Both states are valid —
    // no on-demand parsing here.
    for (const panel of this.querySelectorAll('.at-brands-panel__cat-content')) {
      panel.hidden = panel.dataset.cat !== cat;
    }

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

  /** @type {MutationObserver | null} */
  #avatarObserver = null;

  /**
   * When the user taps a nav button (e.g. "Brands") before SRA hydration
   * has inserted the target view, we queue the navigation here so it can
   * resolve the moment the view appears in the DOM. See `navigate()` and
   * `#tryResolvePendingNavigation()`.
   * @type {string | null}
   */
  #pendingTarget = null;

  /** @type {HTMLElement | null} */
  #pendingButton = null;

  /**
   * Whether we've already requested at-menu-data for this drawer.
   * @type {boolean}
   */
  #dataRequested = false;

  /**
   * Whether we've already adopted heavy mobile views into the panel.
   * @type {boolean}
   */
  #dataAdopted = false;

  /** @type {HTMLElement | null} */
  #drawerSummary = null;

  /** @type {HTMLDetailsElement | null} */
  #drawerDetails = null;

  connectedCallback() {
    super.connectedCallback();

    this.#activeView = this.querySelector('.at-panel__view[data-view="main"]');
    this.#viewStack = [];

    this.addEventListener('input', this.#onSearchInput);
    this.addEventListener('click', this.#onSearchClearClick);

    // Reset to main view whenever the parent <details> drawer closes,
    // and use the same details element to drive the at-menu-data fetch.
    const details = this.closest('details.menu-drawer-container');
    if (details instanceof HTMLDetailsElement) {
      this.#drawerDetails = details;
      this.#detailsObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.attributeName === 'open' && !details.hasAttribute('open')) {
            this.reset();
          }
        }
      });
      this.#detailsObserver.observe(details, { attributes: true });

      // Hydration triggers — fire as early as we reasonably can so the
      // heavy views are most likely to be present by the time the user
      // taps a nav button:
      //   1. pointerdown on the hamburger <summary>: ~100-200ms before
      //      the details `toggle` event. Primary trigger for touch.
      //   2. toggle: catches keyboard activation and any programmatic
      //      opens that skip pointer events.
      const summary = details.querySelector('summary');
      if (summary instanceof HTMLElement) {
        this.#drawerSummary = summary;
        summary.addEventListener('pointerdown', this.#onFirstInteraction, { once: true });
      }
      details.addEventListener('toggle', this.#onDrawerToggle);
    }

    // Watch for brand items + sub-views arriving via at-menu-data
    // adoption. When new nodes appear we do two things:
    //   1. Apply computed avatar colors to any initials avatars.
    //   2. Resolve a pending navigation if the user tapped "Brands" or
    //      a category before its view was in the DOM.
    hydrateAvatarsIn(this);
    this.#avatarObserver = new MutationObserver(() => {
      hydrateAvatarsIn(this);
      this.#tryResolvePendingNavigation();
    });
    this.#avatarObserver.observe(this, { childList: true, subtree: true });

    // Subscribe to the menu-data fetcher. The fetch itself is started
    // via #onFirstInteraction (hamburger pointerdown / toggle).
    MenuDataFetcher.get().subscribe((doc) => this.#adoptMobileViews(doc));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('input', this.#onSearchInput);
    this.removeEventListener('click', this.#onSearchClearClick);
    this.#detailsObserver?.disconnect();
    this.#detailsObserver = null;
    if (this.#drawerSummary) {
      this.#drawerSummary.removeEventListener('pointerdown', this.#onFirstInteraction);
    }
    if (this.#drawerDetails) {
      this.#drawerDetails.removeEventListener('toggle', this.#onDrawerToggle);
    }
    this.#avatarObserver?.disconnect();
    this.#avatarObserver = null;
  }

  /**
   * Drawer `toggle` listener — fires on every open/close. We use this
   * as a fallback hydration trigger if pointerdown was skipped.
   *
   * @param {Event} event
   */
  #onDrawerToggle = (event) => {
    const details = event.currentTarget;
    if (details instanceof HTMLDetailsElement && details.open) {
      this.#onFirstInteraction();
    }
  };

  /**
   * Trigger the one-time at-menu-data fetch. Idempotent.
   */
  #onFirstInteraction = () => {
    if (this.#dataRequested) return;
    this.#dataRequested = true;
    MenuDataFetcher.get().request();
  };

  /**
   * Clone heavy mobile views from the fetched at-menu-data document
   * and append them into this panel as siblings of the main view.
   * The MutationObserver above will then resolve any pending
   * navigation (a tap on "Brands" or a category that arrived before
   * the views were here).
   *
   * Idempotent — guarded by `#dataAdopted`.
   *
   * @param {Document} doc
   */
  #adoptMobileViews(doc) {
    if (this.#dataAdopted) return;

    const data = doc.querySelector('at-menu-data');
    if (!data) {
      console.warn('[at-menu mobile] no <at-menu-data> in fetched doc');
      return;
    }

    const mounts = data.querySelectorAll('[data-at-mount="mobile-view"]');
    console.log('[at-menu mobile] adopting', mounts.length, 'mounts');
    if (!mounts.length) return;

    const fragment = document.createDocumentFragment();
    const adoptedViews = [];
    for (const mount of mounts) {
      for (const child of Array.from(mount.children)) {
        const clone = child.cloneNode(true);
        fragment.appendChild(clone);
        if (clone instanceof HTMLElement) {
          adoptedViews.push(clone.dataset.view ?? '(no data-view)');
        }
      }
    }

    if (!fragment.childNodes.length) {
      console.warn('[at-menu mobile] mounts had no children');
      return;
    }

    this.appendChild(fragment);
    this.#dataAdopted = true;
    console.log('[at-menu mobile] views adopted:', adoptedViews);
  }

  // ─── View navigation ──────────────────────────────────────────────────────

  /**
   * Navigate forward to a named view. Called via on:click="/navigate"
   * with data-target="viewName" on the trigger element.
   *
   * Views other than "main" are rendered only during the Section Rendering
   * API re-fetch (eager_loading=true in blocks/_at-menu.liquid). On mobile
   * that fetch is kicked off when the drawer opens (see header.liquid), so
   * there's a brief window where the user might tap "Brands" or a category
   * before its view exists in the DOM. In that window we queue the
   * navigation, show a loading state on the tapped button, and complete
   * the navigation the moment the view is morphed in (see the
   * MutationObserver in connectedCallback).
   *
   * @param {MouseEvent} event
   */
  navigate(event) {
    if (this.#animating) return;
    if (!(event.target instanceof Element)) return;

    const btn = event.target.closest('[data-target]');
    if (!(btn instanceof HTMLElement)) return;

    const target = btn.dataset.target;
    if (!target || !this.#activeView) return;

    const nextView = this.querySelector(`.at-panel__view[data-view="${target}"]`);
    if (!(nextView instanceof HTMLElement)) {
      this.#setPendingNavigation(target, btn);
      return;
    }

    this.#clearPendingNavigation();
    this.#transition(this.#activeView, nextView, 'forward');
  }

  /**
   * Queue a navigation that couldn't resolve because the target view isn't
   * in the DOM yet. Applies a loading indicator + aria-busy to the tapped
   * button so the tap feels acknowledged during the SRA wait.
   *
   * @param {string} target
   * @param {HTMLElement} btn
   */
  #setPendingNavigation(target, btn) {
    // Replace any prior pending nav (user tapped a different item).
    this.#clearPendingNavigation();
    this.#pendingTarget = target;
    this.#pendingButton = btn;
    btn.classList.add('at-panel__nav-btn--loading');
    btn.setAttribute('aria-busy', 'true');
  }

  #clearPendingNavigation() {
    if (this.#pendingButton) {
      this.#pendingButton.classList.remove('at-panel__nav-btn--loading');
      this.#pendingButton.removeAttribute('aria-busy');
    }
    this.#pendingTarget = null;
    this.#pendingButton = null;
  }

  /**
   * Called from the DOM MutationObserver after each morph batch. If the
   * user previously tapped a nav button whose target view didn't exist
   * yet, check whether it's now present and complete the navigation.
   */
  #tryResolvePendingNavigation() {
    if (!this.#pendingTarget || !this.#activeView) return;
    const target = this.#pendingTarget;
    const nextView = this.querySelector(`.at-panel__view[data-view="${target}"]`);
    if (!(nextView instanceof HTMLElement)) return;
    this.#clearPendingNavigation();
    // If an animation is already in flight (unlikely during hydration but
    // possible), defer one frame so the current animation can settle.
    if (this.#animating) {
      requestAnimationFrame(() => {
        if (this.#activeView) this.#transition(this.#activeView, nextView, 'forward');
      });
    } else {
      this.#transition(this.#activeView, nextView, 'forward');
    }
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
    this.#clearPendingNavigation();
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
    if (!(event.target instanceof Element)) return;

    const btn = event.target.closest('[data-letter]');
    if (!(btn instanceof HTMLElement)) return;

    const letter = btn.dataset.letter;
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
 * Apply computed background colors to any initials avatars inside `root`
 * that don't already have one. Cheap to call repeatedly — the early-exit
 * on already-hydrated avatars keeps the cost proportional to *new* avatars.
 *
 * Used by both custom elements' MutationObservers so avatars coming in via
 * Section Rendering API morph pick up colors automatically.
 *
 * @param {ParentNode} root
 */
function hydrateAvatarsIn(root) {
  const avatars = /** @type {NodeListOf<HTMLElement>} */ (
    root.querySelectorAll('.at-brand-avatar--initials[data-brand-name]')
  );

  for (const avatar of avatars) {
    if (avatar.style.getPropertyValue('--at-brand-avatar-bg')) continue;
    const name = avatar.dataset.brandName ?? '';
    if (name) {
      avatar.style.setProperty('--at-brand-avatar-bg', brandColor(name));
    }
  }
}
