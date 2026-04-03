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
