/**
 * The Site tab's design tools beyond the site's own tokens: ready-made looks
 * (theme presets), the site's named colours, and the text styles every page
 * uses. All of it is saved in the site theme, so pages and blocks can still
 * override any of it.
 */
import * as React from "react";

import { paletteVar, type BuilderConfig, type SiteSettings } from "../schema/config.js";
import { BUILT_IN_PRESETS, presetValues, tokenRoles, type ThemePreset } from "../schema/presets.js";
import { textStyleVar, type PageTheme, type TextStyleProp } from "../schema/style.js";
import { ColorField, Field, Group, LengthField, Select, TextInput } from "./ui.js";

export interface SiteDesignProps {
	config: BuilderConfig;
	theme: PageTheme;
	onTheme: (theme: PageTheme) => void;
	settings: SiteSettings;
	onSettings: (settings: SiteSettings) => void;
	/** Show a look on the page without saving it (null: stop). */
	onPreview: (theme: PageTheme | null) => void;
	/** Colours offered in pickers: the site's own, then the config's. */
	palette: Array<{ label: string; value: string }>;
}

// ── Looks ─────────────────────────────────────────────────────────────────────

export function PresetsGroup({ config, theme, onTheme, onPreview }: SiteDesignProps) {
	const presets: ThemePreset[] = [...config.themePresets, ...BUILT_IN_PRESETS];
	const roles = tokenRoles(config.themeTokens);
	const swatch = (p: ThemePreset, role: string, fallback: string) => {
		const v = p.values[`@${role}`];
		if (v) return v;
		const token = roles.get(role as never);
		return (token && p.values[token.name]) ?? fallback;
	};
	return (
		<Group title="Looks">
			<p className="pb-hint">Point at a look to try it on this page; click to use it on the whole site. You can still change any colour or font afterwards.</p>
			<div className="pb-presets" onMouseLeave={() => onPreview(null)}>
				{presets.map((p) => {
					const values = presetValues(p, config.themeTokens);
					return (
						<button
							key={p.name}
							type="button"
							className="pb-preset"
							onMouseEnter={() => onPreview({ ...theme, ...values })}
							onFocus={() => onPreview({ ...theme, ...values })}
							onBlur={() => onPreview(null)}
							onClick={() => {
								onPreview(null);
								onTheme({ ...theme, ...values });
							}}
							title={`Use “${p.label}” on the whole site`}
						>
							<span className="pb-preset__sample" style={{ background: swatch(p, "background", "#222"), color: swatch(p, "heading", "#fff"), fontFamily: swatch(p, "heading-font", "inherit") }}>
								Aa
								<i style={{ background: swatch(p, "accent", "#888") }} />
								<i style={{ background: swatch(p, "text", "#aaa") }} />
							</span>
							<span>{p.label}</span>
						</button>
					);
				})}
			</div>
		</Group>
	);
}

// ── Colours ───────────────────────────────────────────────────────────────────

export function PaletteGroup({ theme, onTheme, settings, onSettings }: SiteDesignProps) {
	const colours = settings.palette ?? [];
	const setValue = (slug: string, v: string | undefined) => {
		const next = { ...theme };
		if (v) next[paletteVar(slug)] = v;
		else delete next[paletteVar(slug)];
		onTheme(next);
	};
	const add = () => {
		let n = colours.length + 1;
		while (colours.some((c) => c.slug === `colour-${n}`)) n++;
		const slug = `colour-${n}`;
		onSettings({ ...settings, palette: [...colours, { slug, label: `Colour ${n}` }] });
		setValue(slug, "#ff00d2");
	};
	const remove = (slug: string) => {
		if (!confirm("Remove this colour? Blocks using it go back to their default colour.")) return;
		onSettings({ ...settings, palette: colours.filter((c) => c.slug !== slug) });
		setValue(slug, undefined);
	};
	return (
		<Group title={`Site colours${colours.length ? ` (${colours.length})` : ""}`} defaultOpen={colours.length > 0}>
			<p className="pb-hint">Named colours offered first in every colour picker. Change one here and everything using it changes with it.</p>
			{colours.map((c) => (
				<div key={c.slug} className="pb-palette-row">
					<input type="color" value={/^#[0-9a-f]{6}$/i.test(theme[paletteVar(c.slug)] ?? "") ? theme[paletteVar(c.slug)] : "#000000"} onChange={(e) => setValue(c.slug, e.target.value)} aria-label={`${c.label} colour`} />
					<TextInput value={c.label} lazy onChange={(label) => onSettings({ ...settings, palette: colours.map((x) => (x.slug === c.slug ? { ...x, label: label.trim() || x.label } : x)) })} />
					<button type="button" className="danger" title="Remove" onClick={() => remove(c.slug)}>
						✕
					</button>
				</div>
			))}
			<button type="button" onClick={add}>
				+ Add a colour
			</button>
		</Group>
	);
}

// ── Text styles ───────────────────────────────────────────────────────────────

const WEIGHTS = [
	{ label: "Default", value: "" },
	{ label: "Light (300)", value: "300" },
	{ label: "Regular (400)", value: "400" },
	{ label: "Medium (500)", value: "500" },
	{ label: "Semibold (600)", value: "600" },
	{ label: "Bold (700)", value: "700" },
	{ label: "Black (900)", value: "900" },
];

const CASES = [
	{ label: "As typed", value: "" },
	{ label: "UPPERCASE", value: "uppercase" },
	{ label: "lowercase", value: "lowercase" },
	{ label: "Capitalised", value: "capitalize" },
];

export function TextStylesGroup({ config, theme, onTheme, palette }: SiteDesignProps) {
	const styles = [
		{ key: "h1", label: "Heading 1" },
		{ key: "h2", label: "Heading 2" },
		{ key: "h3", label: "Heading 3" },
		{ key: "h4", label: "Heading 4" },
		{ key: "p", label: "Normal text" },
		...config.textStyles.map((s) => ({ key: `s-${s.name}`, label: s.label })),
		{ key: "quote", label: "Quote" },
		{ key: "button", label: "Button text" },
	];
	const [key, setKey] = React.useState("h1");
	const get = (prop: TextStyleProp) => theme[textStyleVar(key, prop)];
	const set = (prop: TextStyleProp, v: string | undefined) => {
		const next = { ...theme };
		if (v) next[textStyleVar(key, prop)] = v;
		else delete next[textStyleVar(key, prop)];
		onTheme(next);
	};
	const styled = (k: string) => Object.keys(theme).some((n) => n.startsWith(`--pb-ts-${k}-`));
	const reset = () => onTheme(Object.fromEntries(Object.entries(theme).filter(([n]) => !n.startsWith(`--pb-ts-${key}-`))));
	return (
		<Group title="Text styles">
			<p className="pb-hint">Change a style here and all text in that style changes, on every page. A block's own style still wins.</p>
			<Field label="Style">
				<Select value={key} onChange={setKey} options={styles.map((s) => ({ label: `${s.label}${styled(s.key) ? " •" : ""}`, value: s.key }))} />
			</Field>
			{config.fonts.length > 0 && (
				<Field label="Font">
					<Select value={get("font") ?? ""} onChange={(v) => set("font", v || undefined)} options={[{ label: "Default", value: "" }, ...config.fonts]} />
				</Field>
			)}
			<LengthField label="Size" value={get("size")} onChange={(v) => set("size", v)} presets={key.startsWith("h") ? ["1.25rem", "1.5rem", "2rem", "2.5rem", "3.5rem"] : ["0.875rem", "1rem", "1.125rem", "1.25rem"]} />
			<Field label="Weight">
				<Select value={get("weight") ?? ""} onChange={(v) => set("weight", v || undefined)} options={WEIGHTS} />
			</Field>
			<LengthField label="Line height" value={get("leading")} onChange={(v) => set("leading", v)} presets={["1", "1.2", "1.4", "1.6", "1.8"]} />
			<LengthField label="Letter spacing" value={get("tracking")} onChange={(v) => set("tracking", v)} presets={["-0.02em", "0", "0.02em", "0.05em", "0.1em"]} />
			<ColorField label="Colour" value={get("color")} onChange={(v) => set("color", v)} palette={palette} />
			<Field label="Case">
				<Select value={get("case") ?? ""} onChange={(v) => set("case", v || undefined)} options={CASES} />
			</Field>
			{styled(key) && (
				<button type="button" className="pb-link" onClick={reset}>
					Reset this style
				</button>
			)}
		</Group>
	);
}

/** The site's colours first, then the config's swatches. */
export function sitePalette(settings: SiteSettings, config: BuilderConfig): Array<{ label: string; value: string }> {
	return [...(settings.palette ?? []).map((c) => ({ label: c.label, value: `var(${paletteVar(c.slug)})` })), ...config.palette];
}
