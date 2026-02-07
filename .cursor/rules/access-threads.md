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
