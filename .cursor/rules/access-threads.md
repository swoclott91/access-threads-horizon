# Access Threads – Theme Development Rules

This repository is a fork of Shopify’s Horizon theme.
The goal is to remain updateable with upstream Horizon releases
while adding Access Threads–specific UI and behavior.

## Core Principles

- Prefer adding new files over modifying existing Horizon core files.
- Keep diffs against upstream Horizon minimal and easy to rebase.
- All Access Threads customizations must be clearly identifiable.

## Custom Code Location Rules

All Access Threads–specific code must follow these conventions:

- **Sections**: `sections/at-*.liquid`
- **Snippets**: `snippets/at-*.liquid`
- **Assets**:
  - `assets/at-*.js`
  - `assets/at-*.css`
- **Templates**:
  - Custom JSON templates such as:
    - `product.access-threads.json`
    - `page.access-threads-*.json`

Do not place Access Threads logic directly inside core Horizon sections unless explicitly instructed.

## Editing Existing Horizon Files

If modification of an existing Horizon file is required:

- Keep changes minimal and localized.
- Surround custom logic with clear comments:

```liquid
{%- comment -%} AT CUSTOM: description of change {%- endcomment -%}
...
{%- comment -%} /AT CUSTOM {%- endcomment -%}
```

## Upstream Update Process

The upstream Shopify Horizon repo is configured as the `upstream` remote:

```
upstream  https://github.com/Shopify/horizon.git
```

### How to merge a new Horizon release

1. Fetch upstream: `git fetch upstream --tags`
2. Check upstream version: `git log upstream/main --oneline -5`
3. Create a backup branch: `git branch dev-backup-pre-vX.Y.Z`
4. Merge: `git merge upstream/main --no-commit`
5. Resolve conflicts in AT-modified core files (see below)
6. Commit: `git commit -m "Merge upstream Horizon vX.Y.Z"`

### Core files with AT modifications (conflict-prone)

These core Horizon files contain AT customizations and may need manual conflict resolution during upstream merges:

| File | AT Customization |
|------|-----------------|
| `blocks/_product-details.liquid` | Registers AT blocks (at-popup-link, at-variant-picker, at-buy-buttons) |

### AT Block Capabilities

| Block | Purpose |
|-------|---------|
| `blocks/at-buy-buttons.liquid` | Buy buttons with bulk form support. Enables a "Bulk Add to Cart" secondary button (`at_enable_bulk_popup`) that opens a `dialog-component` containing the AT bulk grid modal. Scripts (`dialog.js`, `at-bulk-grid.js`) and CSS are loaded conditionally. The form's `data-at-bulk-form` and `data-at-bulk-line-items` attributes are set whenever bulk popup OR bulk quantities are enabled. |
| `blocks/at-popup-link.liquid` | Standalone popup/link block. Also supports bulk grid inside the popup. May be deprecated in favour of `at-buy-buttons` bulk popup once migrated. |
| `blocks/at-variant-picker.liquid` | Variant picker that publishes bulk grid config (`script[data-at-bulk-grid-config]`) for `at-bulk-grid.js` to read. |
| `snippets/product-media.liquid` | File reference support for variant metafield gallery images |
| `snippets/product-media-gallery-content.liquid` | Variant metafield gallery logic (custom.variant_gallery_images) |
| `snippets/slideshow-controls.liquid` | File reference support for thumbnail aspect ratios and image sources |
| `templates/product.json` | Uses AT blocks in product information section |

When resolving conflicts, preserve both the upstream changes and the AT customizations.

## AT menu (`at-brands-panel`)

- **Focus-out handling:** Do not close the mega panel when `focusout` has `relatedTarget === null` (common on click-to-focus). Defer with `setTimeout(0)` and only close if `document.activeElement` is not inside the host.
- **Pointer-leave delay:** After the hover close delay, skip closing if focus is still inside the panel (keyboard users who moved the pointer away).
- **Brand search listeners:** Prefer `capture: true` on the dropdown `ref="panel"` for `input` / clear `click` so filtering still runs reliably.
- **Sidebar category hover:** `mouseenter` does not bubble, so declarative `on:mouseenter` on category buttons is unreliable. Use a bubbling `pointerover` listener on `refs.panel` gated with `(hover: hover) and (pointer: fine)`; keep `on:click` for keyboard and touch.
- **Transparent header + AT mega panel:** Solid top-row/underlay styling is tied to `#header-component:hover` / `:focus-within`. The fixed `.at-brands-panel__dropdown` can leave a vertical gap over the hero; the pointer then leaves the header while the panel stays open. Mirror hover rules with `#header-component:has(.at-brands-panel[data-open])` in `sections/header.liquid` (AT CUSTOM blocks).
- **Transparent header + popup nav items:** `.header[transparent]` defaults `--closed-underlay-height: 0px`. Only `:has(.menu-list__link:not([aria-haspopup]):hover)` set it to `100%` (plain links). Items with `aria-haspopup` matched the mega-menu `:has()` block without `--closed-underlay-height`, so the bar stayed visually transparent until Horizon’s `header-menu` JS set `--full-open-header-height` — which **AT Products** never triggers. Add `--closed-underlay-height: 100%` to that mega-menu `:has()` group in `header.liquid`.
- **AT mega panel `top`:** Do not anchor only to `.header__row--top` — **menu row** can be `.header__row--bottom` (section `menu_row`). Use **`trigger.closest('.header__row')`**. Take **`Math.min(nav.bottom, row.bottom, trigger.bottom)`** so extra row padding below the link strip does not leave a visible gap. `ResizeObserver` on `#header-component`; subtract ~2px for seam parity and subpixel gaps.
- **Products / dropdown chevron:** There is no `icon-chevron-down.svg` in Horizon assets; `snippets/icon.liquid` has no `chevron-down` case. Use **`icon-caret.svg`** with `inline_asset_content` inside **`svg-wrapper`** (same as `sections/header.liquid` localization). Open state: rotate the wrapper **`180deg`** (not 90°), matching `dropdown-localization`.
- **AT nav + `menu-list__link`:** In the header block, links use both classes. **`blocks/_header-menu.liquid`** sets `.menu-list__link { flex-direction: column }` for the mega-menu bridge; override with **`.menu-list__link.at-menu__nav-link { flex-direction: row }`** in `at-menu.css` so titles and carets stay inline.
