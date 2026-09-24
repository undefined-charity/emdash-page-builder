/**
 * Site-supplied configuration: the named text styles, section looks and button
 * styles an editor can pick, and the "external" blocks the site renders itself
 * (a form, a next-event panel, a menu). Everything here is plain data so it can
 * be passed from Astro to the editor island as a prop.
 */

import { cleanPageBackground, type PageBackground } from "./background.js";
import type { ThemePreset } from "./presets.js";
import type { ThemeToken } from "./style.js";

export type { ThemePreset, ThemeToken };

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** A named paragraph or heading look, like a Word style. */
export interface TextStyle {
	/** Stored as the Portable Text `style`, so keep it stable. */
	name: string;
	label: string;
	/** `p`/`div` makes a paragraph style; `h1`–`h6` a heading style. */
	tag: "p" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
	className?: string;
}

/** A look for a Section block (background, spacing, the hero treatment…). */
export interface SectionStyle {
	name: string;
	label: string;
	tag?: "section" | "header" | "div" | "aside";
	className?: string;
}

export interface ButtonStyle {
	name: string;
	label: string;
	className: string;
}

/** A setting on an external block, edited in the inspector. */
export interface ExternalField {
	name: string;
	label: string;
	/**
	 * `menu`: the value is an EmDash menu name, and the side panel edits that
	 * menu's links in place (rename, re-link, add, remove, reorder).
	 */
	type: "text" | "textarea" | "url" | "number" | "toggle" | "select" | "menu";
	options?: Array<{ label: string; value: string }>;
	/** GET endpoint returning `{ data: { options: [{label, value}] } }` or `{ options }`. */
	optionsUrl?: string;
	placeholder?: string;
	help?: string;
}

/**
 * A block the site renders on the server — a form, a list pulled from a
 * collection, anything with data or logic. The editor shows a live preview and
 * edits its settings; the Portable Text type is whatever the site renderer
 * expects (e.g. the Forms plugin's `emdash-form`).
 */
export interface ExternalBlock {
	type: string;
	label: string;
	description?: string;
	category?: string;
	/** Emoji or short glyph for menus. */
	icon?: string;
	/** Fields stored on the block when it is inserted. */
	initial?: Record<string, unknown>;
	fields?: ExternalField[];
}

export interface BuilderConfig {
	textStyles: TextStyle[];
	/** CSS custom properties editable per page (the page theme). */
	themeTokens: ThemeToken[];
	/** Swatches offered in every colour picker (any colour can still be typed). */
	palette: Array<{ label: string; value: string }>;
	/** Font stacks offered for text and theme fonts. */
	fonts: Array<{ label: string; value: string }>;
	sectionStyles: SectionStyle[];
	buttonStyles: ButtonStyle[];
	externalBlocks: ExternalBlock[];
	/** The site's pages, managed from the editor's Pages panel. */
	pages: PagesConfig;
	/** Ready-made looks offered on the Site tab, before the built-in ones. */
	themePresets: ThemePreset[];
	/** Collection holding reusable blocks (fields: title, content). */
	reusableCollection: string;
	/**
	 * Screens this wide (px) or narrower are phones: blocks hidden on phones
	 * disappear and phone-only styles apply. Match your stylesheet's own
	 * breakpoint.
	 */
	phoneBreakpoint: number;
}

export const DEFAULT_CONFIG: BuilderConfig = {
	textStyles: [{ name: "lead", label: "Lead", tag: "p", className: "lead" }],
	themeTokens: [],
	palette: [],
	fonts: [],
	sectionStyles: [{ name: "default", label: "Plain", tag: "section" }],
	buttonStyles: [
		{ name: "primary", label: "Primary", className: "button primary" },
		{ name: "secondary", label: "Secondary", className: "button secondary" },
	],
	externalBlocks: [],
	themePresets: [],
	pages: { collection: "pages", protectedSlugs: ["home"], urls: { home: "/" } },
	reusableCollection: "reusable_blocks",
	phoneBreakpoint: 640,
};

export function resolveConfig(partial?: Partial<BuilderConfig>): BuilderConfig {
	return {
		textStyles: partial?.textStyles ?? DEFAULT_CONFIG.textStyles,
		themeTokens: partial?.themeTokens ?? [],
		palette: partial?.palette ?? [],
		fonts: partial?.fonts ?? [],
		sectionStyles: partial?.sectionStyles?.length ? partial.sectionStyles : DEFAULT_CONFIG.sectionStyles,
		buttonStyles: partial?.buttonStyles?.length ? partial.buttonStyles : DEFAULT_CONFIG.buttonStyles,
		externalBlocks: partial?.externalBlocks ?? [],
		themePresets: partial?.themePresets ?? [],
		pages: { ...DEFAULT_CONFIG.pages, ...partial?.pages, urls: { ...DEFAULT_CONFIG.pages.urls, ...partial?.pages?.urls } },
		reusableCollection: partial?.reusableCollection ?? DEFAULT_CONFIG.reusableCollection,
		phoneBreakpoint: partial?.phoneBreakpoint && partial.phoneBreakpoint > 0 ? partial.phoneBreakpoint : DEFAULT_CONFIG.phoneBreakpoint,
	};
}

export interface PagesConfig {
	/** The collection holding the site's pages. */
	collection: string;
	/** Pages the site routes specially (home, 404…): they can't be renamed, unpublished or trashed from the editor. */
	protectedSlugs: string[];
	/** Addresses of pages that aren't at the collection's URL pattern, by slug (`home` → `/`). */
	urls: Record<string, string>;
	/** A text field holding the page's search description, for a collection without EmDash's SEO settings (default: found by name). */
	descriptionField?: string;
	/**
	 * The blocks a new page starts with (Portable Text). `{{title}}` in any
	 * text is replaced by the title typed; keys are added where missing.
	 * Default: a Heading 1 with the title, then an empty paragraph.
	 */
	newPage?: Array<Record<string, unknown>>;
}

/** The blocks a new page titled `title` starts with. */
export function newPageBlocks(pages: PagesConfig, title: string): Array<Record<string, unknown>> {
	const template = pages.newPage?.length
		? pages.newPage
		: [
				{ _type: "block", style: "h1", children: [{ _type: "span", text: "{{title}}" }] },
				{ _type: "block", style: "normal", children: [{ _type: "span", text: "" }] },
			];
	let n = 0;
	const key = () => `k${Date.now().toString(36)}${(n++).toString(36)}`;
	const fill = (v: unknown, inArray: boolean): unknown => {
		if (typeof v === "string") return v.split("{{title}}").join(title);
		if (Array.isArray(v)) return v.map((x) => fill(x, true));
		if (v && typeof v === "object") {
			const out: Record<string, unknown> = {};
			for (const [k, x] of Object.entries(v)) out[k] = fill(x, false);
			// Items of arrays (blocks, spans, columns…) need keys; text blocks need markDefs.
			if (inArray && !out._key) out._key = key();
			if (out._type === "block" && !Array.isArray(out.markDefs)) out.markDefs = [];
			if (out._type === "span" && !Array.isArray(out.marks)) out.marks = [];
			return out;
		}
		return v;
	};
	return fill(template, false) as Array<Record<string, unknown>>;
}

/** A page's address. */
export function pageUrl(pages: PagesConfig, slug: string | null, urlPattern: string | null): string | null {
	if (!slug) return null;
	if (pages.urls[slug]) return pages.urls[slug];
	return urlPattern ? urlPattern.replace("{slug}", slug) : `/${slug}`;
}

/** Site-wide page options, set on the Site tab. */
export interface SiteSettings {
	/** A back-to-top button on every page, shown once the visitor scrolls down. */
	backToTop?: boolean;
	/**
	 * The site's own named colours, offered first in every colour picker. Each
	 * colour's value is the site-theme token `--pb-color-<slug>`, so a block
	 * using it follows when it changes.
	 */
	palette?: Array<{ slug: string; label: string }>;
	/** The page background of every page that doesn't set its own. */
	background?: PageBackground;
	/** How one page gives way to the next. */
	transition?: "fade" | "slide";
}

export function cleanSiteSettings(value: unknown): SiteSettings {
	const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
	const palette = Array.isArray(v.palette)
		? v.palette
				.filter((c): c is { slug: string; label: string } => !!c && typeof c.slug === "string" && /^[a-z0-9-]{1,40}$/.test(c.slug) && typeof c.label === "string")
				.map((c) => ({ slug: c.slug, label: c.label.slice(0, 60) }))
		: [];
	const background = cleanPageBackground(v.background);
	return {
		...(v.backToTop === true ? { backToTop: true } : {}),
		...(palette.length ? { palette } : {}),
		...(background ? { background } : {}),
		...(v.transition === "fade" || v.transition === "slide" ? { transition: v.transition } : {}),
	};
}

/** A site colour's token. */
export const paletteVar = (slug: string) => `--pb-color-${slug}`;

export function findTextStyle(config: BuilderConfig, name: unknown): TextStyle | undefined {
	return typeof name === "string" ? config.textStyles.find((s) => s.name === name) : undefined;
}

export function headingLevelOf(tag: TextStyle["tag"]): HeadingLevel | null {
	return tag.startsWith("h") ? (Number(tag.slice(1)) as HeadingLevel) : null;
}

/** The section style used when a section names none (or an unknown one). */
export function defaultSectionStyle(config: BuilderConfig): SectionStyle | undefined {
	return config.sectionStyles.find((s) => s.name === "default") ?? config.sectionStyles[0];
}
