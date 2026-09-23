# emdash-page-builder

Edit [EmDash](https://github.com/emdash-cms/emdash) pages like a word processor — on the live page, in the site's own styles.

Switch on **Edit** in the EmDash toolbar and the page itself becomes the document: type, format, press <kbd>/</kbd> to insert a block, drag blocks by their handle, float images so text wraps around them, and change any block's colours, spacing, fonts or background from the side panel. There is no separate editing screen and no preview step — what you see while editing is the published page.

Content is stored as ordinary Portable Text in the entry's rich-text field, so the EmDash admin, search, and every other template keep working with it.

## What editors get

- **A ribbon** (Word's Home tab): undo/redo, paragraph styles, font, size, bold/italic/underline/strike, text colour, highlight, alignment, lists, quotes, links, insert.
- **`/` to insert**, the same list on the ribbon's **+ Insert** and the **+** beside every block:
  - Text: paragraphs, headings, lists, quotes, and the site's own named styles
  - Media: images from the media library or uploaded straight from the computer (dropped or pasted onto the page, too) — inline, centred, full-width, or floated left/right with text wrapping; drag the edges to resize
  - Layout: sections, 2–4 columns, cards, FAQ/accordions, buttons, dividers, spacers
  - Site blocks: anything the site renders itself — forms, a next-event panel, a ticket widget, a menu — shown as a live preview and configured in the side panel
  - Reusable blocks: save any block as shared; edit it once, it changes everywhere; detach a copy to edit it on one page only
- **Drag handles** on every block, including blocks inside sections and columns.
- **A side panel** with the selected block's settings and a breadcrumb to reach the blocks around it, plus:
  - **Style** — text/background/border colour, background image, padding, rounded corners, width, height, text size, font — per block
  - **Page** — the site's design tokens (colours, fonts, sizes) overridden for this page only
  - **Site** — the same tokens as the site-wide defaults every page inherits
- **Site regions**: the header and footer are builder documents too, edited in place from any page; the ribbon says when you're editing something shared.
- **Autosave** as a draft, a **Publish** button for whatever you're editing, and conflict protection — if the page changed in another tab or by another person, you're asked instead of silently overwriting.

Layering is the same as a word processor's: site stylesheet → **Site** design → **Page** design → block **Style** → formatting on the selection.

## Install

```bash
npm install github:undefined-charity/emdash-page-builder
```

```js
// astro.config.mjs — also needs @astrojs/react
import pageBuilder from "emdash-page-builder";

emdash({ plugins: [pageBuilder()] });
```

Open **Plugins → Page Builder** in the admin and click **Set up what's missing**: it creates the *Reusable blocks* collection and adds a `theme` field to your pages collection.

## Use it in a template

```astro
---
import { getEmDashEntry } from "emdash";
import { PageBuilder, SiteTheme } from "emdash-page-builder/astro";
import { builderConfig, builderComponents } from "../page-builder";

const { entry } = await getEmDashEntry("pages", Astro.params.slug);
---
<html>
  <head>
    <!-- after your stylesheet: the site-wide design from the Site tab -->
    <SiteTheme />
  </head>
  <body>
    <PageBuilder
      value={entry.data.body}
      entry={{ collection: "pages", id: entry.data.id, title: entry.data.title }}
      theme={entry.data.theme}
      config={builderConfig}
      components={builderComponents}
    />
  </body>
</html>
```

Visitors get server-rendered HTML with no JavaScript. Signed-in editors (role Editor and up) in edit mode also get the editor, which takes over that same markup.

`entry.field` defaults to `body`; `entry.themeField` defaults to `theme` (pass `null` for a collection without per-page design). Add `region="Site header"` to render a shared document — a header, a footer — in a layout.

## Configure it for your site

Everything site-specific is plain data passed as `config`:

```ts
import type { BuilderConfig } from "emdash-page-builder";

export const builderConfig: Partial<BuilderConfig> = {
  // Named styles in the style menu, stored as the Portable Text `style`
  textStyles: [
    { name: "lead", label: "Lead paragraph", tag: "p", className: "lead" },
    { name: "display", label: "Display heading", tag: "h1", className: "display" },
  ],
  // Looks a Section can take (the first named "default" is the default)
  sectionStyles: [
    { name: "default", label: "Panel", tag: "section" },
    { name: "hero", label: "Hero", tag: "header", className: "hero" },
  ],
  buttonStyles: [
    { name: "primary", label: "Primary", className: "button primary" },
    { name: "secondary", label: "Secondary", className: "button secondary" },
  ],
  // Swatches and fonts offered in pickers
  palette: [{ label: "Brand pink", value: "var(--accent-pink)" }],
  fonts: [{ label: "Serif", value: "Georgia, serif" }],
  // CSS custom properties editable on the Page and Site tabs
  themeTokens: [
    { name: "--accent-pink", label: "Accent", type: "color", default: "#ff00d2", group: "Colours" },
    { name: "--font-body", label: "Body font", type: "font", group: "Text" },
    { name: "--font-size-base", label: "Body text size", type: "length", default: "1rem", presets: ["1rem", "1.125rem"] },
  ],
  // Blocks your site renders on the server
  externalBlocks: [
    {
      type: "emdash-form",
      label: "Form",
      category: "Forms",
      fields: [{ name: "formId", label: "Form", type: "select", optionsUrl: "/_emdash/api/plugins/emdash-forms/forms/list" }],
    },
  ],
};

// Astro components for the external blocks, keyed by Portable Text `_type`
export const builderComponents = { "emdash-form": FormBlock };
```

Theme tokens only work if your stylesheet uses them: write `color: var(--accent-pink)`, not `color: #ff00d2`.

### Site blocks

An external block is any Portable Text type your site renders — the builder keeps its data verbatim, shows its live server-rendered output while editing, and edits its `fields` in the side panel. The component receives `node` (the block) like any EmDash Portable Text component. Blocks with no entry in `builderComponents` fall back to EmDash's stock renderer, so plugin blocks (embeds, forms) work without any wiring.

## Block types stored

| Portable Text `_type` | Block |
| --- | --- |
| `block` | Text, with `style` (`normal`, `h1`–`h6`, `blockquote`, or a named style), `textAlign`, and `pbStyle` |
| `image` | EmDash's image block, plus `alignment` (`left`, `right`, `center`, `wide`), `displayWidth`, `link` |
| `buttons` | EmDash's buttons block, plus a `variant` per button |
| `break` | Divider |
| `pb.section` | `{ variant, content: Block[] }` |
| `pb.columns` | `{ ratio, columns: [{ content: Block[] }] }` |
| `pb.cards` | `{ cards: [{ content: Block[] }] }` |
| `pb.accordion` | `{ items: [{ summary, content: Block[], open }] }` |
| `pb.spacer` | `{ size: "s" \| "m" \| "l" \| "xl" }` |
| `pb.reusable` | `{ ref }` — an entry in the reusable-blocks collection |

Inline colour, highlight, size and font are a `textStyle` mark definition. Style values are validated against an allowlist on the way in and out, so stored content can't inject CSS or markup.

## Why a native plugin

EmDash's sandboxed plugins edit blocks only through form fields in the admin, and EmDash's own on-page editor (as of 0.38) shows plugin blocks as "edit in admin" placeholders and drops image alignment. Editing a page as a document needs the editor on the page, which needs the native plugin format.

## Development

```bash
npm install
npm test          # converter round-trips, sanitising, server rendering
npm run typecheck
```

## License

MIT © Undefined
