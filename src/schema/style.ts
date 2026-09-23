/**
 * Style overrides — the "format" an editor can put on any block, and the page
 * theme. Stored as small objects of allowlisted keys and validated values, and
 * only ever emitted through `toCss`, so stored content can't smuggle arbitrary
 * CSS (or markup) into the page.
 */

export interface BlockStyle {
	color?: string;
	background?: string;
	backgroundImage?: string;
	padding?: string;
	radius?: string;
	maxWidth?: string;
	minHeight?: string;
	fontSize?: string;
	fontFamily?: string;
	borderColor?: string;
}

export const BLOCK_STYLE_KEYS: Array<keyof BlockStyle> = [
	"color",
	"background",
	"backgroundImage",
	"padding",
	"radius",
	"maxWidth",
	"minHeight",
	"fontSize",
	"fontFamily",
	"borderColor",
];

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|hsla?\(\s*[\d.\s,%deg]+\)|var\(--[a-z0-9-]+\)|transparent|currentcolor)$/i;
const LENGTH = /^(0|-?\d+(\.\d+)?(px|rem|em|%|vh|vw|ch))$/;
const LENGTHS = /^(0|-?\d+(\.\d+)?(px|rem|em|%|vh|vw|ch))(\s+(0|-?\d+(\.\d+)?(px|rem|em|%|vh|vw|ch))){0,3}$/;
const URL_OK = /^(https?:\/\/|\/)[^\s"'()<>\\]+$/;
const FONT = /^[a-z0-9 ,'"-]+$/i;

export function safeColor(v: unknown): string | undefined {
	return typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : undefined;
}

export function safeLength(v: unknown, multi = false): string | undefined {
	if (typeof v !== "string") return undefined;
	const t = v.trim();
	return (multi ? LENGTHS : LENGTH).test(t) ? t : undefined;
}

export function safeUrl(v: unknown): string | undefined {
	return typeof v === "string" && URL_OK.test(v.trim()) ? v.trim() : undefined;
}

export function safeFont(v: unknown): string | undefined {
	return typeof v === "string" && FONT.test(v.trim()) && v.length < 200 ? v.trim() : undefined;
}

/** Keep only valid keys/values; `undefined` when nothing survives. */
export function cleanBlockStyle(value: unknown): BlockStyle | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Record<string, unknown>;
	const out: BlockStyle = {};
	const color = safeColor(v.color);
	if (color) out.color = color;
	const background = safeColor(v.background);
	if (background) out.background = background;
	const bgImage = safeUrl(v.backgroundImage);
	if (bgImage) out.backgroundImage = bgImage;
	const padding = safeLength(v.padding, true);
	if (padding) out.padding = padding;
	const radius = safeLength(v.radius);
	if (radius) out.radius = radius;
	const maxWidth = safeLength(v.maxWidth);
	if (maxWidth) out.maxWidth = maxWidth;
	const minHeight = safeLength(v.minHeight);
	if (minHeight) out.minHeight = minHeight;
	const fontSize = safeLength(v.fontSize);
	if (fontSize) out.fontSize = fontSize;
	const fontFamily = safeFont(v.fontFamily);
	if (fontFamily) out.fontFamily = fontFamily;
	const borderColor = safeColor(v.borderColor);
	if (borderColor) out.borderColor = borderColor;
	return Object.keys(out).length ? out : undefined;
}

export function blockStyleToCss(value: unknown): string | undefined {
	const s = cleanBlockStyle(value);
	if (!s) return undefined;
	const rules: string[] = [];
	if (s.color) rules.push(`color: ${s.color}`, `--pb-text: ${s.color}`);
	if (s.background) rules.push(`background-color: ${s.background}`);
	if (s.backgroundImage) rules.push(`background-image: url("${s.backgroundImage}")`, "background-size: cover", "background-position: center");
	if (s.padding) rules.push(`padding: ${s.padding}`);
	if (s.radius) rules.push(`border-radius: ${s.radius}`);
	if (s.maxWidth) rules.push(`max-width: ${s.maxWidth}`, "margin-inline: auto");
	if (s.minHeight) rules.push(`min-height: ${s.minHeight}`);
	if (s.fontSize) rules.push(`font-size: ${s.fontSize}`);
	if (s.fontFamily) rules.push(`font-family: ${s.fontFamily}`);
	if (s.borderColor) rules.push(`border-color: ${s.borderColor}`);
	return rules.join("; ");
}

// ── Page theme ────────────────────────────────────────────────────────────────

/** A CSS custom property the site exposes for per-page overrides. */
export interface ThemeToken {
	/** e.g. `--accent-pink` */
	name: string;
	label: string;
	type: "color" | "font" | "length";
	/** The site's default, shown as the placeholder. */
	default?: string;
	group?: string;
	/** Quick picks for lengths (e.g. font sizes). */
	presets?: string[];
}

export type PageTheme = Record<string, string>;

export function cleanTheme(value: unknown, tokens: ThemeToken[]): PageTheme | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Record<string, unknown>;
	const out: PageTheme = {};
	for (const token of tokens) {
		const raw = v[token.name];
		const ok = token.type === "color" ? safeColor(raw) : token.type === "font" ? safeFont(raw) : safeLength(raw);
		if (ok) out[token.name] = ok;
	}
	return Object.keys(out).length ? out : undefined;
}

/*
 * Specificity, not source order, decides precedence: the site's stylesheet
 * may load after these <style> tags. Site CSS (:root) < site design
 * (:root:root) < page design (:root:root:root).
 */
const SITE_SCOPE = ":root:root";
const PAGE_SCOPE = ":root:root:root";

export function themeToCss(value: unknown, tokens: ThemeToken[]): string | undefined {
	const theme = cleanTheme(value, tokens);
	if (!theme) return undefined;
	return `${PAGE_SCOPE} { ${Object.entries(theme)
		.map(([k, v]) => `${k}: ${v};`)
		.join(" ")} }`;
}

/**
 * Validate a theme without the site's token list (the plugin's own storage
 * doesn't know it): names must be custom properties, values a colour, a font
 * stack or a length. Used for the site-wide theme.
 */
export function cleanAnyTheme(value: unknown): PageTheme | undefined {
	if (!value || typeof value !== "object") return undefined;
	const out: PageTheme = {};
	for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!/^--[a-z0-9-]{1,60}$/.test(name)) continue;
		const ok = safeColor(raw) ?? safeLength(raw) ?? safeFont(raw);
		if (ok) out[name] = ok;
	}
	return Object.keys(out).length ? out : undefined;
}

export function anyThemeToCss(value: unknown): string | undefined {
	const theme = cleanAnyTheme(value);
	if (!theme) return undefined;
	return `${SITE_SCOPE} { ${Object.entries(theme)
		.map(([k, v]) => `${k}: ${v};`)
		.join(" ")} }`;
}
