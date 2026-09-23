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
- **Phones**: the ribbon's 🖥 / 📱 switch (<kbd>⌥⌘P</kbd> / <kbd>Ctrl+Alt+P</kbd>) shows the page at phone width, laid out as a phone lays it out, and it stays editable. In the phone view the **Style** group, text alignment and image size and position are saved for phones only; the desktop look is untouched. **Show on** hides any block on phones or on desktops; hidden blocks stay visible but dimmed while editing, and **Hidden blocks** in the side panel lists them.
- **Back-to-top button**: a Site tab option that adds a button to every page once a visitor scrolls down (no JavaScript).
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

### Editing inside another document

Pass `embedded` when a site block renders a builder document inside another editable document. For example, an event template can show the event's own content. The outer editor then mounts a second editor inside that block, and edits save to the embedded entry.

```astro
<PageBuilder value={event.data.content} entry={{ collection: "events", id: event.data.id, field: "content", themeField: null }} embedded config={builderConfig} components={builderComponents} />
```

### Other entries' fields inside a block

A site block that shows another entry's fields, such as an event's name, date and venue, can make them editable in the builder. Mark each element with EmDash's standard edit annotation (`{...entry.edit.venue}`, or `createEditable()` for collection reads). In the editor, those plain-text fields become editable inside the block's preview. They save to their own entry as a draft, and the ribbon's **Publish** button publishes those entries along with the page, naming them in its tooltip. Rich-text fields are skipped here. Use `embedded` for those.

### Keep EmDash's admin form away from builder fields

EmDash's own Portable Text editor doesn't know builder blocks. If it saves, it rewrites them, and it replaces a block with no settings with placeholder text. Give every builder field the plugin's widget. The field then shows a short note pointing to on-page editing, and the admin form never changes its value.

```sh
curl -X PUT …/_emdash/api/schema/collections/pages/fields/body -d '{"widget":"page-builder:editor"}'
```

Blocks the builder saves always carry at least one setting (`pbBlock: true` when they have none), so they survive the admin editor even without the widget.

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
  // Screens this wide (px) or narrower get phone-only styles and hide "desktop only" blocks.
  // Match your stylesheet's own phone breakpoint. Default 640.
  phoneBreakpoint: 640,
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

Any block can also carry `pbHide` (`"phone"` or `"desktop"`), and styled blocks `pbStylePhone`: the same keys as `pbStyle` plus `textAlign`, and for images `width` and `align`. Lists and quotes store these on each of their blocks.

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
