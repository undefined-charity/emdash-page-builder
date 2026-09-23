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

// ── Phones ────────────────────────────────────────────────────────────────────

/** Hide a block on one kind of screen. */
export type HideOn = "phone" | "desktop";

export function cleanHide(v: unknown): HideOn | undefined {
	return v === "phone" || v === "desktop" ? v : undefined;
}

/**
 * Phone-only overrides: the block style, plus text alignment and (for images)
 * width and position. Applied below the site's phone breakpoint, over the
 * block's own style.
 */
export interface PhoneStyle extends BlockStyle {
	textAlign?: "left" | "center" | "right" | "justify";
	/** Image width. */
	width?: string;
	/** Image position. */
	align?: "none" | "left" | "right" | "center" | "wide";
}

const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
const IMAGE_ALIGNS = ["none", "left", "right", "center", "wide"] as const;

export function cleanPhoneStyle(value: unknown): PhoneStyle | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Record<string, unknown>;
	const out: PhoneStyle = { ...cleanBlockStyle(v) };
	if (TEXT_ALIGNS.includes(v.textAlign as never)) out.textAlign = v.textAlign as PhoneStyle["textAlign"];
	const width = safeLength(v.width);
	if (width) out.width = width;
	if (IMAGE_ALIGNS.includes(v.align as never)) out.align = v.align as PhoneStyle["align"];
	return Object.keys(out).length ? out : undefined;
}

/**
 * Phone overrides go on the element as custom properties plus a list of the
 * ones set (`data-pb-phone="fontSize padding"`); `responsiveCss` applies them
 * below the breakpoint. No per-block selector needed, so nothing depends on
 * block keys, which change on every save.
 */
export function phoneStyleAttrs(value: unknown): { style?: string; "data-pb-phone"?: string } {
	const s = cleanPhoneStyle(value);
	if (!s) return {};
	const vars: string[] = [];
	const names: string[] = [];
	for (const [k, raw] of Object.entries(s) as Array<[keyof PhoneStyle, string]>) {
		if (k === "align") {
			names.push(`align-${raw}`);
			continue;
		}
		names.push(k);
		vars.push(`--pbp-${k}: ${k === "backgroundImage" ? `url("${raw}")` : raw}`);
	}
	return { ...(vars.length ? { style: vars.join("; ") } : {}), "data-pb-phone": names.join(" ") };
}

const PHONE_RULES: Array<[string, string]> = [
	["color", "color: var(--pbp-color) !important; --pb-text: var(--pbp-color)"],
	["background", "background-color: var(--pbp-background) !important"],
	["backgroundImage", "background-image: var(--pbp-backgroundImage) !important; background-size: cover; background-position: center"],
	["padding", "padding: var(--pbp-padding) !important"],
	["radius", "border-radius: var(--pbp-radius) !important"],
	["maxWidth", "max-width: var(--pbp-maxWidth) !important; margin-inline: auto"],
	["minHeight", "min-height: var(--pbp-minHeight) !important"],
	["fontSize", "font-size: var(--pbp-fontSize) !important"],
	["fontFamily", "font-family: var(--pbp-fontFamily) !important"],
	["borderColor", "border-color: var(--pbp-borderColor) !important"],
	["textAlign", "text-align: var(--pbp-textAlign) !important"],
	["width", "width: var(--pbp-width) !important; max-width: 100% !important"],
	["align-none", "float: none !important; margin-inline: 0 !important"],
	["align-center", "float: none !important; margin-inline: auto !important"],
	["align-wide", "float: none !important; width: 100% !important; max-width: 100% !important; margin-inline: 0 !important"],
	["align-left", "float: left !important; max-width: 50% !important; margin: 0.25rem 1.25rem 1rem 0 !important"],
	["align-right", "float: right !important; max-width: 50% !important; margin: 0.25rem 0 1rem 1.25rem !important"],
];

/**
 * The rules that make phones different: blocks hidden on one kind of screen,
 * and phone-only style overrides. Generated because the breakpoint is a site
 * setting, and a stylesheet can't read one in a media query.
 *
 * Hidden blocks stay visible in the editor (`.pb-editor-content`), dimmed.
 */
export function responsiveCss(breakpoint: number): string {
	const bp = Number.isFinite(breakpoint) && breakpoint > 0 ? breakpoint : 640;
	const live = ":not(.pb-editor-content *)";
	const phone = PHONE_RULES.map(([name, css]) => `[data-pb-phone~="${name}"] { ${css} }`).join(" ");
	return (
		`@media (max-width: ${bp}px) { .pb-hide-phone${live} { display: none !important; } .pb-stack--phone-flow > .pb-layer { grid-area: auto; } ${phone} } ` +
		`@media (min-width: ${bp + 0.02}px) { .pb-hide-desktop${live} { display: none !important; } }`
	);
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
