/**
 * Theme presets: ready-made looks (a palette and a font pairing) the Site tab
 * previews live and applies in one click. A preset sets ordinary site-theme
 * values, so every part stays editable afterwards.
 *
 * Values are keyed by a token name (`--accent-pink`), a text style value
 * (`--pb-ts-h1-color`), or a role (`@background`), which applies to the
 * site's token with that role. The built-in presets use roles, so they fit
 * any site; a site's own presets can name its tokens directly.
 */
import type { PageTheme, ThemeRole, ThemeToken } from "./style.js";
import { textStyleVar } from "./style.js";

export interface ThemePreset {
	name: string;
	label: string;
	values: Record<string, string>;
}

const serif = "Georgia, 'Times New Roman', serif";
const sans = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const mono = "'Courier New', ui-monospace, monospace";

export const BUILT_IN_PRESETS: ThemePreset[] = [
	{
		name: "neon-night",
		label: "Neon night",
		values: { "@background": "#0b0b0b", "@text": "#66ff00", "@accent": "#ff00d2", "@heading": "#ff00d2" },
	},
	{
		name: "midnight",
		label: "Midnight",
		values: { "@background": "#0f172a", "@text": "#e2e8f0", "@accent": "#38bdf8", "@heading": "#f8fafc", "@body-font": sans },
	},
	{
		name: "clean-light",
		label: "Clean and light",
		values: { "@background": "#ffffff", "@text": "#1f2328", "@accent": "#2563eb", "@heading": "#111827", "@body-font": sans, "@heading-font": sans },
	},
	{
		name: "editorial",
		label: "Warm editorial",
		values: { "@background": "#fbf7f0", "@text": "#2b2622", "@accent": "#b4532a", "@heading": "#1f1a17", "@body-font": serif, "@heading-font": serif },
	},
	{
		name: "typewriter",
		label: "Typewriter",
		values: { "@background": "#111111", "@text": "#eaeaea", "@accent": "#ffcc00", "@heading": "#ffcc00", "@body-font": mono, "@heading-font": mono },
	},
];

const ROLE_GUESSES: Array<[ThemeRole, RegExp, ThemeToken["type"]]> = [
	["background", /(page|site|body)[-\s]?(bg|background)|^--(bg|background)$/i, "color"],
	["text", /(text|body)[-\s]?colou?r|^--(text|fg|foreground)$/i, "color"],
	["heading", /heading[-\s]?colou?r|main heading/i, "color"],
	["accent", /accent|brand|primary/i, "color"],
	["heading-font", /(display|heading)[-\s]?font|font[-\s]?(display|heading)/i, "font"],
	["body-font", /(body|text)[-\s]?font|font[-\s]?(body|text)/i, "font"],
];

/** A token's role: given, or guessed from its name and label (the first accent-like colour is the accent). */
export function tokenRoles(tokens: ThemeToken[]): Map<ThemeRole, ThemeToken> {
	const roles = new Map<ThemeRole, ThemeToken>();
	for (const t of tokens) if (t.role && !roles.has(t.role)) roles.set(t.role, t);
	for (const [role, re, type] of ROLE_GUESSES) {
		if (roles.has(role)) continue;
		const t = tokens.find((t) => t.type === type && (re.test(t.name) || re.test(t.label)) && ![...roles.values()].includes(t));
		if (t) roles.set(role, t);
	}
	return roles;
}

/**
 * The site-theme values a preset sets on this site. A role the site has no
 * token for falls back to the text styles where there is one (heading colour
 * and fonts, text colour), so a preset changes something on any site.
 */
export function presetValues(preset: ThemePreset, tokens: ThemeToken[]): PageTheme {
	const roles = tokenRoles(tokens);
	const out: PageTheme = {};
	const fallback: Partial<Record<ThemeRole, string[]>> = {
		heading: ["h1", "h2", "h3"].map((s) => textStyleVar(s, "color")),
		"heading-font": ["h1", "h2", "h3"].map((s) => textStyleVar(s, "font")),
		text: [textStyleVar("p", "color")],
		"body-font": [textStyleVar("p", "font")],
	};
	for (const [key, value] of Object.entries(preset.values)) {
		if (!key.startsWith("@")) {
			out[key] = value;
			continue;
		}
		const role = key.slice(1) as ThemeRole;
		const token = roles.get(role);
		if (token) out[token.name] = value;
		else for (const name of fallback[role] ?? []) out[name] = value;
	}
	return out;
}
