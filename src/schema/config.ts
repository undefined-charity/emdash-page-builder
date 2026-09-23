/**
 * Site-supplied configuration: the named text styles, section looks and button
 * styles an editor can pick, and the "external" blocks the site renders itself
 * (a form, a next-event panel, a menu). Everything here is plain data so it can
 * be passed from Astro to the editor island as a prop.
 */

import type { ThemeToken } from "./style.js";

export type { ThemeToken };

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
	/** Collection holding reusable blocks (fields: title, content). */
	reusableCollection: string;
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
	reusableCollection: "reusable_blocks",
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
		reusableCollection: partial?.reusableCollection ?? DEFAULT_CONFIG.reusableCollection,
	};
}

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
