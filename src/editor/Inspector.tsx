/**
 * The side panel: settings for the selected block (and any block around it,
 * via the breadcrumb), its style overrides, and the page's theme.
 */
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import * as React from "react";

import type { BuilderConfig, ExternalBlock, ExternalField, SiteSettings } from "../schema/config.js";
import { HIDEABLE_TYPES, SPACER_SIZES, STYLABLE_TYPES } from "../schema/extensions.js";
import { cleanBlockStyle, cleanHide, cleanPhoneStyle, type BlockStyle, type PageTheme, type PhoneStyle } from "../schema/style.js";
import { useDevice } from "./device.js";
import { loadOptions } from "./api.js";
import { MenuEditor } from "./MenuEditor.js";
import {
	ancestry,
	appendChild,
	blockLabel,
	duplicate,
	move,
	refresh,
	remove,
	removeLastChild,
	selectBlock,
	setAttrs,
	type BlockRef,
} from "./structure.js";
import { ColorField, Field, Group, LengthField, Segmented, Select, TextInput, Toggle } from "./ui.js";

export interface InspectorProps {
	editor: Editor;
	config: BuilderConfig;
	theme: PageTheme;
	onTheme: (theme: PageTheme) => void;
	/** Site-wide design defaults every page inherits. */
	siteTheme: PageTheme;
	onSiteTheme: (theme: PageTheme) => void;
	/** Site-wide page options (the back-to-top button). */
	siteSettings: SiteSettings;
	onSiteSettings: (settings: SiteSettings) => void;
	onPickImage: (onPick: (attrs: Record<string, unknown>) => void) => void;
	onSaveReusable: (ref: BlockRef) => void;
	onClose: () => void;
	/** False for site regions, which have no page of their own to design. */
	pageTab?: boolean;
	/** Re-render server-rendered blocks' previews (after a menu edit, say). */
	onRefreshPreviews: () => void;
}

export function Inspector(props: InspectorProps) {
	const { editor, config } = props;
	const [tab, setTab] = React.useState<"block" | "page" | "site">("block");
	const [, force] = React.useReducer((x: number) => x + 1, 0);
	const [focusDepth, setFocusDepth] = React.useState<number | null>(null);

	React.useEffect(() => {
		const onSel = () => {
			setFocusDepth(null);
			force();
		};
		editor.on("selectionUpdate", onSel);
		editor.on("transaction", force);
		return () => {
			editor.off("selectionUpdate", onSel);
			editor.off("transaction", force);
		};
	}, [editor]);

	const chain = ancestry(editor);
	const current = (focusDepth !== null ? chain.find((c) => c.depth === focusDepth) : undefined) ?? chain[chain.length - 1];
	const externalLabel = (type: string) => config.externalBlocks.find((b) => b.type === type)?.label;

	return (
		<aside className="pb-inspector" aria-label="Page builder inspector">
			<header className="pb-inspector__tabs">
				<Segmented
					value={tab}
					onChange={setTab}
					options={[
						{ label: "Block", value: "block" },
						...(props.pageTab === false ? [] : [{ label: "Page", value: "page" as const, title: "Design overrides for this page only" }]),
						{ label: "Site", value: "site", title: "Design defaults for every page" },
					]}
				/>
				<button type="button" className="pb-icon" onClick={props.onClose} aria-label="Hide panel" title="Hide panel">
					⇥
				</button>
			</header>

			{tab === "block" ? (
				current ? (
					<div className="pb-inspector__body">
						<nav className="pb-crumbs" aria-label="Enclosing blocks">
							{chain.map((c, i) => (
								<React.Fragment key={c.pos}>
									{i > 0 && <span aria-hidden="true">›</span>}
									<button
										type="button"
										className={c === current ? "on" : ""}
										onClick={() => {
											setFocusDepth(c.depth);
										}}
									>
										{blockLabel(c.node, externalLabel)}
									</button>
								</React.Fragment>
							))}
						</nav>
						<BlockPanel {...props} block={current} key={`${current.pos}-${current.node.type.name}`} />
						<HiddenBlocks editor={editor} externalLabel={externalLabel} />
					</div>
				) : (
					<div className="pb-inspector__body">
						<p className="pb-empty">Click into the page to edit a block.</p>
						<HiddenBlocks editor={editor} externalLabel={externalLabel} />
					</div>
				)
			) : tab === "page" ? (
				<ThemePanel
					config={config}
					theme={props.theme}
					inherited={props.siteTheme}
					onTheme={props.onTheme}
					intro="Overrides for this page only — header and footer included. Blank means the site default (the Site tab)."
					resetLabel="Reset the page to the site design"
				/>
			) : (
				<ThemePanel
					config={config}
					theme={props.siteTheme}
					inherited={{}}
					onTheme={props.onSiteTheme}
					intro="The default look of every page on the site: fonts, text sizes and colours. Pages can still override these on the Page tab, and any block or selection in the Block tab or the ribbon. Saved as you change it."
					resetLabel="Reset the whole site to its built-in design"
				>
					<Group title="Every page">
						<Toggle
							checked={props.siteSettings.backToTop === true}
							onChange={(backToTop) => props.onSiteSettings({ ...props.siteSettings, backToTop })}
							label="Back-to-top button"
						/>
						<p className="pb-hint">A button in the corner that appears once a visitor scrolls down a long page. Shows after the page reloads.</p>
					</Group>
				</ThemePanel>
			)}
		</aside>
	);
}

// ── Block settings ────────────────────────────────────────────────────────────

function BlockPanel({ editor, config, block, onPickImage, onSaveReusable, onRefreshPreviews }: InspectorProps & { block: BlockRef }) {
	const live = refresh(editor, block) ?? block;
	const node = live.node;
	const a = node.attrs as Record<string, unknown>;
	const set = (patch: Record<string, unknown>) => setAttrs(editor, live, patch);
	const type = node.type.name;
	const stylable = STYLABLE_TYPES.includes(type);
	// In the phone view, looks are set for phones only.
	const phone = useDevice() === "phone";
	const phoneStyle: PhoneStyle = cleanPhoneStyle(a.pbStylePhone) ?? {};
	const setPhone = (patch: Partial<PhoneStyle>) => set({ pbStylePhone: cleanPhoneStyle({ ...phoneStyle, ...patch }) ?? null });

	return (
		<>
			<div className="pb-actions">
				<button type="button" title="Move up" onClick={() => move(editor, live, -1)}>
					↑
				</button>
				<button type="button" title="Move down" onClick={() => move(editor, live, 1)}>
					↓
				</button>
				<button type="button" title="Duplicate" onClick={() => duplicate(editor, live)}>
					⧉
				</button>
				<button type="button" title="Save as a reusable block" onClick={() => onSaveReusable(live)}>
					♻
				</button>
				<button type="button" title="Delete" className="danger" onClick={() => remove(editor, live)}>
					🗑
				</button>
			</div>

			{(type === "paragraph" || type === "heading") && <TextSettings editor={editor} config={config} block={live} phone={phone} phoneAlign={phoneStyle.textAlign} onPhoneAlign={(textAlign) => setPhone({ textAlign })} />}

			{type === "pbSection" && (
				<Group title="Section">
					<Field label="Look">
						<Select value={String(a.variant ?? "")} onChange={(variant) => set({ variant })} options={config.sectionStyles.map((s) => ({ label: s.label, value: s.name }))} />
					</Field>
				</Group>
			)}

			{type === "pbColumns" && (
				<Group title="Columns">
					<Field label="Number of columns">
						<Segmented
							value={String(node.childCount)}
							onChange={(n) => {
								const want = Number(n);
								for (let i = node.childCount; i < want; i++) appendChild(editor, live, { type: "pbColumn", content: [{ type: "paragraph" }] });
								for (let i = node.childCount; i > want; i--) removeLastChild(editor, refresh(editor, live) ?? live, 2);
							}}
							options={["2", "3", "4"].map((v) => ({ label: v, value: v }))}
						/>
					</Field>
					{node.childCount === 2 && (
						<Field label="Widths">
							<Segmented
								value={String(a.ratio ?? "equal")}
								onChange={(ratio) => set({ ratio })}
								options={[
									{ label: "½ ½", value: "equal" },
									{ label: "⅔ ⅓", value: "wide-left" },
									{ label: "⅓ ⅔", value: "wide-right" },
								]}
							/>
						</Field>
					)}
				</Group>
			)}

			{type === "pbCards" && (
				<Group title="Cards">
					<div className="pb-row">
						<button type="button" onClick={() => appendChild(editor, live, { type: "pbCard", content: [{ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "New card" }] }, { type: "paragraph" }] })}>
							+ Add card
						</button>
						<button type="button" onClick={() => removeLastChild(editor, live, 1)}>
							− Remove last
						</button>
					</div>
				</Group>
			)}

			{type === "pbAccordion" && (
				<Group title="Questions">
					<div className="pb-row">
						<button
							type="button"
							onClick={() =>
								appendChild(editor, live, {
									type: "pbAccordionItem",
									content: [
										{ type: "pbAccordionSummary", content: [{ type: "text", text: "New question?" }] },
										{ type: "pbAccordionBody", content: [{ type: "paragraph" }] },
									],
								})
							}
						>
							+ Add question
						</button>
						<button type="button" onClick={() => removeLastChild(editor, live, 1)}>
							− Remove last
						</button>
					</div>
				</Group>
			)}

			{type === "pbAccordionItem" && (
				<Group title="Question">
					<Toggle checked={a.open === true} onChange={(open) => set({ open })} label="Open when the page loads" />
				</Group>
			)}

			{type === "pbButtons" && (
				<Group title="Buttons">
					<Field label="Alignment">
						<Segmented
							value={String(a.align ?? "left")}
							onChange={(align) => set({ align })}
							options={[
								{ label: "Left", value: "left" },
								{ label: "Centre", value: "center" },
								{ label: "Right", value: "right" },
							]}
						/>
					</Field>
					<button
						type="button"
						onClick={() => appendChild(editor, live, { type: "pbButton", attrs: { variant: config.buttonStyles[1]?.name ?? config.buttonStyles[0]?.name }, content: [{ type: "text", text: "Button" }] })}
					>
						+ Add button
					</button>
					<p className="pb-hint">Click a button's label to edit it, then set its link below.</p>
				</Group>
			)}

			{type === "pbButton" && (
				<Group title="Button">
					<Field label="Link">
						<TextInput value={String(a.href ?? "")} placeholder="/tickets or https://…" lazy onChange={(href) => set({ href })} />
					</Field>
					<Field label="Style">
						<Select value={String(a.variant ?? "")} onChange={(variant) => set({ variant })} options={config.buttonStyles.map((s) => ({ label: s.label, value: s.name }))} />
					</Field>
					<Toggle checked={a.newTab === true} onChange={(newTab) => set({ newTab })} label="Open in a new tab" />
				</Group>
			)}

			{type === "pbImage" && (
				<Group title="Image">
					<button type="button" onClick={() => onPickImage((img) => set({ ...img, align: a.align, displayWidth: a.displayWidth }))}>
						Replace image…
					</button>
					<Field label={phone ? "Position on phones" : "Position"} hint={phone ? "Phones only. Left and right wrap text only if there's room." : "Left and right let the text beside it wrap around."}>
						<Segmented
							value={String(phone ? (phoneStyle.align ?? PHONE_IMAGE_ALIGN[String(a.align ?? "none")] ?? "none") : (a.align ?? "none"))}
							onChange={(align) => (phone ? setPhone({ align: align as PhoneStyle["align"] }) : set({ align }))}
							options={[
								{ label: "Inline", value: "none" },
								{ label: "⇤ Left", value: "left", title: "Float left, text wraps on the right" },
								{ label: "Centre", value: "center" },
								{ label: "Right ⇥", value: "right", title: "Float right, text wraps on the left" },
								{ label: "Full", value: "wide" },
							]}
						/>
					</Field>
					{phone ? (
						<Field label="Width on phones (px)" hint="Or drag the image's edges. Blank means the same as desktop, up to the screen's width.">
							<TextInput
								type="number"
								value={phoneStyle.width ? String(parseFloat(phoneStyle.width)) : ""}
								placeholder={a.displayWidth ? String(a.displayWidth) : "natural"}
								lazy
								onChange={(v) => setPhone({ width: v ? `${Math.max(40, Number(v))}px` : undefined })}
							/>
						</Field>
					) : (
						<Field label="Width (px)" hint="Or drag the image's edges.">
							<TextInput
								type="number"
								value={a.displayWidth ? String(a.displayWidth) : ""}
								placeholder="natural"
								lazy
								onChange={(v) => set({ displayWidth: v ? Math.max(40, Number(v)) : null })}
							/>
						</Field>
					)}
					{phone && (phoneStyle.align || phoneStyle.width) && (
						<button type="button" className="pb-link" onClick={() => setPhone({ align: undefined, width: undefined })}>
							Same as desktop
						</button>
					)}
					<Field label="Alt text" hint="Describes the image for screen readers.">
						<TextInput value={String(a.alt ?? "")} lazy onChange={(alt) => set({ alt })} />
					</Field>
					<Field label="Caption">
						<TextInput value={String(a.caption ?? "")} lazy onChange={(caption) => set({ caption })} />
					</Field>
					<Field label="Link (optional)">
						<TextInput value={String(a.link ?? "")} placeholder="https://…" lazy onChange={(link) => set({ link })} />
					</Field>
				</Group>
			)}

			{type === "pbSpacer" && (
				<Group title="Spacer">
					<Segmented value={String(a.size ?? "m")} onChange={(size) => set({ size })} options={SPACER_SIZES.map((s) => ({ label: s.toUpperCase(), value: s }))} />
				</Group>
			)}

			{type === "pbExternal" && <ExternalSettings config={config} block={live} set={set} onRefreshPreviews={onRefreshPreviews} />}

			{type === "pbReusable" && (
				<Group title="Reusable block">
					<p className="pb-hint">This block is shared: editing it changes it everywhere it's used. Use the buttons on the block to edit the shared copy or detach this one.</p>
				</Group>
			)}

			{HIDEABLE_TYPES.includes(type) && (
				<Group title="Show on" defaultOpen={Boolean(a.pbHide)}>
					<Segmented
						value={cleanHide(a.pbHide) ?? "both"}
						onChange={(v) => set({ pbHide: v === "both" ? null : v })}
						options={[
							{ label: "All screens", value: "both" },
							{ label: "Desktop only", value: "phone", title: "Hidden on phones" },
							{ label: "Phone only", value: "desktop", title: "Hidden on desktops" },
						]}
					/>
					<p className="pb-hint">Hidden blocks stay visible here, dimmed, on the screen they're hidden on.</p>
				</Group>
			)}

			{stylable &&
				(phone ? (
					<StyleSettings
						editor={editor}
						config={config}
						phone
						value={phoneStyle}
						inherited={cleanBlockStyle(a.pbStyle) ?? {}}
						onChange={(v) => setPhone(Object.fromEntries(STYLE_KEYS.map((k) => [k, v?.[k]])))}
						onPickImage={onPickImage}
					/>
				) : (
					<StyleSettings editor={editor} config={config} value={cleanBlockStyle(a.pbStyle) ?? {}} onChange={(pbStyle) => set({ pbStyle })} onPickImage={onPickImage} />
				))}
		</>
	);
}

function TextSettings({
	editor,
	config,
	block,
	phone,
	phoneAlign,
	onPhoneAlign,
}: {
	editor: Editor;
	config: BuilderConfig;
	block: BlockRef;
	phone: boolean;
	phoneAlign?: PhoneStyle["textAlign"];
	onPhoneAlign: (v: PhoneStyle["textAlign"] | undefined) => void;
}) {
	const a = block.node.attrs;
	const current = a.textStyle ? `style:${a.textStyle}` : block.node.type.name === "heading" ? `h${a.level}` : "p";
	const options = [
		{ label: "Normal text", value: "p" },
		{ label: "Heading 1", value: "h1" },
		{ label: "Heading 2", value: "h2" },
		{ label: "Heading 3", value: "h3" },
		{ label: "Heading 4", value: "h4" },
		...config.textStyles.map((s) => ({ label: s.label, value: `style:${s.name}` })),
	];
	const apply = (v: string) => {
		selectBlock(editor, block.pos);
		applyTextStyle(editor, config, v);
	};
	return (
		<Group title="Text">
			<Field label="Style">
				<Select value={current} onChange={apply} options={options} />
			</Field>
			<Field label={phone ? "Alignment on phones" : "Alignment"}>
				<Segmented
					value={String((phone ? phoneAlign : undefined) ?? a.textAlign ?? "left")}
					onChange={(v) => (phone ? onPhoneAlign(v === (a.textAlign ?? "left") ? undefined : (v as PhoneStyle["textAlign"])) : setAttrs(editor, block, { textAlign: v === "left" ? null : v }))}
					options={[
						{ label: "⟸", value: "left", title: "Left" },
						{ label: "≡", value: "center", title: "Centre" },
						{ label: "⟹", value: "right", title: "Right" },
						{ label: "☰", value: "justify", title: "Justify" },
					]}
				/>
			</Field>
		</Group>
	);
}

/** Shared by the toolbar's style picker and the inspector. */
export function applyTextStyle(editor: Editor, config: BuilderConfig, value: string) {
	const chain = editor.chain().focus();
	if (value === "p") chain.setNode("paragraph", { textStyle: null }).run();
	else if (/^h[1-4]$/.test(value)) chain.setNode("heading", { level: Number(value.slice(1)), textStyle: null }).run();
	else if (value.startsWith("style:")) {
		const style = config.textStyles.find((s) => s.name === value.slice(6));
		if (!style) return;
		if (style.tag.startsWith("h")) chain.setNode("heading", { level: Number(style.tag.slice(1)), textStyle: style.name }).run();
		else chain.setNode("paragraph", { textStyle: style.name }).run();
	}
}

function ExternalSettings({
	config,
	block,
	set,
	onRefreshPreviews,
}: {
	config: BuilderConfig;
	block: BlockRef;
	set: (p: Record<string, unknown>) => void;
	onRefreshPreviews: () => void;
}) {
	const def: ExternalBlock | undefined = config.externalBlocks.find((b) => b.type === block.node.attrs.blockType);
	const data = (block.node.attrs.data ?? {}) as Record<string, unknown>;
	const update = (name: string, value: unknown) => set({ data: { ...data, [name]: value } });
	return (
		<Group title={def?.label ?? "Site block"}>
			{def?.description && <p className="pb-hint">{def.description}</p>}
			{(def?.fields ?? []).map((f) =>
				f.type === "menu" ? (
					<MenuEditor key={f.name} menu={String(data[f.name] ?? "primary")} onMenu={(name) => update(f.name, name)} onChanged={onRefreshPreviews} />
				) : (
					<ExternalFieldInput key={f.name} field={f} value={data[f.name]} onChange={(v) => update(f.name, v)} />
				),
			)}
			{!def?.fields?.length && <p className="pb-hint">No settings — its content comes from elsewhere on the site.</p>}
			<p className="pb-hint">The preview refreshes after each save.</p>
		</Group>
	);
}

function ExternalFieldInput({ field, value, onChange }: { field: ExternalField; value: unknown; onChange: (v: unknown) => void }) {
	const [options, setOptions] = React.useState(field.options ?? []);
	React.useEffect(() => {
		if (!field.optionsUrl) return;
		loadOptions(field.optionsUrl)
			.then(setOptions)
			.catch(() => undefined);
	}, [field.optionsUrl]);
	if (field.type === "toggle") return <Toggle checked={value === true} onChange={onChange} label={field.label} />;
	if (field.type === "select")
		return (
			<Field label={field.label} hint={field.help}>
				<Select value={String(value ?? "")} onChange={onChange} options={[{ label: "—", value: "" }, ...options]} />
			</Field>
		);
	return (
		<Field label={field.label} hint={field.help}>
			<TextInput
				value={value === undefined || value === null ? "" : String(value)}
				placeholder={field.placeholder}
				type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
				multiline={field.type === "textarea"}
				lazy
				onChange={(v) => onChange(field.type === "number" ? (v === "" ? null : Number(v)) : v)}
			/>
		</Field>
	);
}

// ── Style overrides ───────────────────────────────────────────────────────────

/** The block-style part of a phone style (which also holds alignment and image settings). */
const STYLE_KEYS: Array<keyof BlockStyle> = ["color", "background", "backgroundImage", "padding", "radius", "maxWidth", "minHeight", "fontSize", "fontFamily", "borderColor"];
const pick = (v: BlockStyle): BlockStyle => Object.fromEntries(STYLE_KEYS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]));

/** How a desktop image position looks on a phone (floats stop wrapping on narrow screens). */
const PHONE_IMAGE_ALIGN: Record<string, string> = { left: "none", right: "none" };

// ── Blocks hidden on a screen ─────────────────────────────────────────────────

function HiddenBlocks({ editor, externalLabel }: { editor: Editor; externalLabel: (type: string) => string | undefined }) {
	const hidden: Array<{ pos: number; label: string; on: string; node: PMNode }> = [];
	editor.state.doc.descendants((node, pos) => {
		const on = cleanHide(node.attrs.pbHide);
		if (on) {
			const text = node.textContent.trim();
			hidden.push({ pos, node, on, label: `${blockLabel(node, externalLabel)}${text ? ` — ${text.length > 40 ? `${text.slice(0, 40)}…` : text}` : ""}` });
		}
		return true;
	});
	if (!hidden.length) return null;
	return (
		<Group title={`Hidden blocks (${hidden.length})`} defaultOpen={false}>
			<ul className="pb-list">
				{hidden.map((h) => (
					<li key={h.pos} className="pb-row pb-hidden-row">
						<button type="button" className="pb-hidden-row__label" onClick={() => selectBlock(editor, h.pos)} title="Select this block">
							<span>{h.label}</span>
							<span className="pb-tag">{h.on === "phone" ? "on phones" : "on desktops"}</span>
						</button>
						<button type="button" title="Show it on every screen" onClick={() => setAttrs(editor, { node: h.node, pos: h.pos, depth: 0 }, { pbHide: null })}>
							Show
						</button>
					</li>
				))}
			</ul>
		</Group>
	);
}

function StyleSettings({
	config,
	value,
	onChange,
	onPickImage,
	phone = false,
	inherited = {},
}: {
	editor: Editor;
	config: BuilderConfig;
	value: BlockStyle;
	onChange: (v: BlockStyle | null) => void;
	onPickImage: InspectorProps["onPickImage"];
	/** Editing the phone-only overrides; `inherited` is the desktop style they sit on. */
	phone?: boolean;
	inherited?: BlockStyle;
}) {
	const set = (key: keyof BlockStyle, v: string | undefined) => {
		const next = { ...pick(value), [key]: v };
		if (v === undefined) delete next[key];
		onChange(cleanBlockStyle(next) ?? null);
	};
	const hasAny = Object.keys(pick(value)).length > 0;
	const was = (key: keyof BlockStyle) => (phone ? inherited[key] : undefined);
	return (
		<Group title={phone ? `Style on phones${hasAny ? " (overridden)" : ""}` : `Style${hasAny ? " (overridden)" : ""}`} defaultOpen={hasAny || phone}>
			{phone && <p className="pb-hint">Changes here apply to phones only. Blank means the same as on desktop.</p>}
			<ColorField label="Text colour" value={value.color} placeholder={was("color")} onChange={(v) => set("color", v)} palette={config.palette} />
			<ColorField label="Background colour" value={value.background} placeholder={was("background")} onChange={(v) => set("background", v)} palette={config.palette} />
			<div className="pb-field">
				<span className="pb-field__label">
					Background image
					{value.backgroundImage && (
						<button type="button" className="pb-link" onClick={() => set("backgroundImage", undefined)}>
							remove
						</button>
					)}
				</span>
				<button type="button" onClick={() => onPickImage((img) => set("backgroundImage", String(img.src)))}>
					{value.backgroundImage ? "Change image…" : "Choose image…"}
				</button>
			</div>
			<LengthField label="Padding" value={value.padding} placeholder={was("padding")} onChange={(v) => set("padding", v)} presets={phone ? ["0", "0.5rem", "1rem", "1.5rem 1rem", "2rem 1rem"] : ["0", "1rem", "2rem", "3rem 2rem", "5rem 2rem"]} />
			<LengthField label="Rounded corners" value={value.radius} placeholder={was("radius")} onChange={(v) => set("radius", v)} presets={["0", "8px", "16px", "24px", "999px"]} />
			<LengthField label="Maximum width" value={value.maxWidth} placeholder={was("maxWidth")} onChange={(v) => set("maxWidth", v)} presets={["40rem", "60rem", "80rem", "100%"]} />
			<LengthField label="Minimum height" value={value.minHeight} placeholder={was("minHeight")} onChange={(v) => set("minHeight", v)} presets={["0", "20vh", "40vh", "60vh", "100vh"]} />
			<LengthField label="Text size" value={value.fontSize} placeholder={was("fontSize")} onChange={(v) => set("fontSize", v)} presets={phone ? ["0.75rem", "0.875rem", "1rem", "1.25rem", "1.5rem", "2rem"] : ["0.875rem", "1rem", "1.25rem", "1.5rem", "2rem"]} />
			{config.fonts.length > 0 && (
				<Field label="Font">
					<Select value={value.fontFamily ?? ""} onChange={(v) => set("fontFamily", v || undefined)} options={[{ label: "Default", value: "" }, ...config.fonts]} />
				</Field>
			)}
			<ColorField label="Border colour" value={value.borderColor} placeholder={was("borderColor")} onChange={(v) => set("borderColor", v)} palette={config.palette} />
			{hasAny && (
				<button type="button" className="pb-link" onClick={() => onChange(null)}>
					{phone ? "Reset phones to the desktop style" : "Reset all style overrides"}
				</button>
			)}
		</Group>
	);
}

// ── Page theme ────────────────────────────────────────────────────────────────

function ThemePanel({
	config,
	theme,
	inherited,
	onTheme,
	intro,
	resetLabel,
	children,
}: {
	config: BuilderConfig;
	theme: PageTheme;
	/** Values this layer falls back to, shown as placeholders. */
	inherited: PageTheme;
	onTheme: (t: PageTheme) => void;
	intro: string;
	resetLabel: string;
	/** More settings after the theme's. */
	children?: React.ReactNode;
}) {
	if (config.themeTokens.length === 0)
		return (
			<div className="pb-inspector__body">
				<p className="pb-empty">This site doesn't expose any theme settings.</p>
				{children}
			</div>
		);
	const groups = new Map<string, typeof config.themeTokens>();
	for (const t of config.themeTokens) groups.set(t.group ?? "Theme", [...(groups.get(t.group ?? "Theme") ?? []), t]);
	const set = (name: string, v: string | undefined) => {
		const next = { ...theme };
		if (v === undefined) delete next[name];
		else next[name] = v;
		onTheme(next);
	};
	return (
		<div className="pb-inspector__body">
			<p className="pb-hint">{intro}</p>
			{[...groups].map(([group, tokens]) => (
				<Group key={group} title={group}>
					{tokens.map((t) =>
						t.type === "color" ? (
							<ColorField key={t.name} label={t.label} value={theme[t.name]} placeholder={inherited[t.name] ?? t.default} onChange={(v) => set(t.name, v)} palette={config.palette} />
						) : t.type === "font" ? (
							<Field key={t.name} label={t.label}>
								<Select
									value={theme[t.name] ?? ""}
									onChange={(v) => set(t.name, v || undefined)}
									options={[{ label: `Default (${fontName(inherited[t.name] ?? t.default)})`, value: "" }, ...config.fonts]}
								/>
							</Field>
						) : (
							<LengthField key={t.name} label={t.label} value={theme[t.name]} placeholder={inherited[t.name] ?? t.default} onChange={(v) => set(t.name, v)} presets={t.presets ?? []} />
						),
					)}
				</Group>
			))}
			{Object.keys(theme).length > 0 && (
				<button type="button" className="pb-link" onClick={() => onTheme({})}>
					{resetLabel}
				</button>
			)}
			{children}
		</div>
	);
}

function fontName(stack: string | undefined): string {
	return stack ? stack.split(",")[0].replace(/['"]/g, "").trim() : "site";
}
