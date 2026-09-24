/**
 * The ribbon across the top of the page — Word's Home tab, more or less: undo,
 * paragraph style, font, character formatting, alignment, lists, link, insert.
 */
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import * as React from "react";

import type { BuilderConfig } from "../schema/config.js";
import type { InsertItem } from "./commands.js";
import { pageUrl } from "../schema/config.js";
import { getCollectionInfo, listEntries } from "./api.js";
import { setDevice, useDevice } from "./device.js";
import { applyTextStyle } from "./Inspector.js";
import { stepTextSize, toggleFit } from "./textsize.js";

export type SaveState = "loading" | "saved" | "dirty" | "saving" | "error" | "conflict" | "locked";

const STATUS: Record<SaveState, string> = {
	loading: "Loading…",
	saved: "All changes saved",
	dirty: "Unsaved changes",
	saving: "Saving…",
	error: "Save failed — retrying",
	conflict: "Changed elsewhere — not saved",
	locked: "Open in the admin — not saved",
};

export function Toolbar({
	editor,
	config,
	title,
	save,
	onSaveNow,
	onResolveConflict,
	onResolveLock,
	publish,
	insert,
	inspectorOpen,
	onToggleInspector,
	onPreview,
	onPages,
	onHistory,
}: {
	editor: Editor;
	config: BuilderConfig;
	title: string;
	save: { state: SaveState; error?: string; holder?: string };
	onSaveNow: () => void;
	onResolveConflict: (keep: "mine" | "theirs") => void;
	/** Retry a save refused by an admin edit lock, optionally overriding it. */
	onResolveLock: (override: boolean) => void;
	publish: { unpublished: boolean; also?: string[]; busy: boolean; run: () => void };
	insert: { items: InsertItem[]; run: (item: InsertItem) => void };
	inspectorOpen: boolean;
	onToggleInspector: () => void;
	onPreview: () => void;
	onPages: () => void;
	onHistory: () => void;
}) {
	const s = useEditorState({
		editor,
		selector: ({ editor: e }) => {
			const para = e.state.selection.$from.parent;
			const ts = e.getAttributes("textStyle");
			return {
				style: para.attrs.textStyle ? `style:${para.attrs.textStyle}` : para.type.name === "heading" ? `h${para.attrs.level}` : para.isTextblock ? "p" : "",
				bold: e.isActive("bold"),
				italic: e.isActive("italic"),
				underline: e.isActive("underline"),
				strike: e.isActive("strike"),
				link: e.isActive("link"),
				bullet: e.isActive("bulletList"),
				ordered: e.isActive("orderedList"),
				quote: e.isActive("blockquote"),
				align: (para.attrs.textAlign as string | undefined) ?? "left",
				color: (ts.color as string | undefined) ?? "",
				highlight: (ts.backgroundColor as string | undefined) ?? "",
				fontSize: (ts.fontSize as string | undefined) ?? "",
				fontFamily: (ts.fontFamily as string | undefined) ?? "",
				canUndo: e.can().undo(),
				canRedo: e.can().redo(),
				textblock: para.isTextblock,
				fit: Boolean(para.attrs.pbFit),
			};
		},
	});

	// The ribbon wraps onto more rows in a narrow window; everything below it
	// (the page, the side panel, the popovers) makes room for its real height.
	const ribbon = React.useRef<HTMLDivElement>(null);
	React.useEffect(() => {
		const el = ribbon.current;
		if (!el) return;
		const root = document.documentElement.style;
		const sized = new ResizeObserver(() => root.setProperty("--pb-ribbon-h", `${Math.ceil(el.getBoundingClientRect().height)}px`));
		sized.observe(el);
		return () => {
			sized.disconnect();
			root.removeProperty("--pb-ribbon-h");
		};
	}, []);

	const [menu, setMenu] = React.useState<null | "insert" | "link" | "color" | "highlight">(null);
	const c = () => editor.chain().focus();

	const styleOptions = [
		{ label: "Normal text", value: "p" },
		{ label: "Heading 1", value: "h1" },
		{ label: "Heading 2", value: "h2" },
		{ label: "Heading 3", value: "h3" },
		{ label: "Heading 4", value: "h4" },
		...config.textStyles.map((t) => ({ label: t.label, value: `style:${t.name}` })),
	];

	return (
		<div className="pb-toolbar" role="toolbar" aria-label="Formatting" ref={ribbon}>
			<div className="pb-toolbar__doc">
				<strong title={title}>{title || "Page"}</strong>
				<button type="button" className={`pb-status pb-status--${save.state}`} onClick={onSaveNow} title={save.error ?? "Save now (⌘S)"}>
					{STATUS[save.state]}
				</button>
			</div>

			{save.state === "locked" && (
				<div className="pb-toolbar__group pb-conflict" role="alert">
					<span>{save.holder ?? "Someone"} has this open in the admin, so your changes aren't saved yet. They're kept here.</span>
					<button type="button" onClick={() => onResolveLock(false)} title="Save once they've closed it">
						Try again
					</button>
					<button type="button" onClick={() => onResolveLock(true)} title="Save over their lock. Changes they then save in the admin may replace yours.">
						Save anyway
					</button>
				</div>
			)}

			{save.state === "conflict" && (
				<div className="pb-toolbar__group pb-conflict" role="alert">
					<span>This page was changed in another tab or by someone else.</span>
					<button type="button" onClick={() => onResolveConflict("theirs")} title="Discard your unsaved changes and load the latest version">
						Load latest
					</button>
					<button type="button" onClick={() => onResolveConflict("mine")} title="Replace the other version with yours">
						Keep mine
					</button>
				</div>
			)}

			<div className="pb-toolbar__group">
				<button type="button" title="Undo (⌘Z)" disabled={!s.canUndo} onClick={() => c().undo().run()}>
					↶
				</button>
				<button type="button" title="Redo (⇧⌘Z)" disabled={!s.canRedo} onClick={() => c().redo().run()}>
					↷
				</button>
			</div>

			<div className="pb-toolbar__group">
				<select title="Paragraph style" value={s.style} disabled={!s.textblock} onChange={(e) => applyTextStyle(editor, config, e.target.value)}>
					{s.style === "" && <option value="">—</option>}
					{styleOptions.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
				{config.fonts.length > 0 && (
					<select
						title="Font"
						value={s.fontFamily}
						onChange={(e) => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())}
					>
						<option value="">Default font</option>
						{config.fonts.map((f) => (
							<option key={f.value} value={f.value}>
								{f.label}
							</option>
						))}
					</select>
				)}
				<select title="Text size" value={s.fontSize} onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}>
					<option value="">Size</option>
					{["0.75rem", "0.875rem", "1rem", "1.125rem", "1.25rem", "1.5rem", "2rem", "2.5rem", "3rem", "4rem"].map((v) => (
						<option key={v} value={v}>
							{Math.round(parseFloat(v) * 16)}
						</option>
					))}
				</select>
				<button type="button" title="Smaller text (⌘⇧,). With nothing selected, the whole block (on phones only, in the phone view)." disabled={!s.textblock} onClick={() => stepTextSize(editor, -1)}>
					A−
				</button>
				<button type="button" title="Bigger text (⌘⇧.). With nothing selected, the whole block (on phones only, in the phone view)." disabled={!s.textblock} onClick={() => stepTextSize(editor, 1)}>
					A+
				</button>
				<button type="button" title="Fit to width: the line exactly fills its box, on every screen" className={s.fit ? "on" : ""} disabled={!s.textblock} onClick={() => toggleFit(editor)}>
					↔
				</button>
			</div>

			<div className="pb-toolbar__group">
				<button type="button" title="Bold (⌘B)" className={s.bold ? "on" : ""} onClick={() => c().toggleBold().run()}>
					<b>B</b>
				</button>
				<button type="button" title="Italic (⌘I)" className={s.italic ? "on" : ""} onClick={() => c().toggleItalic().run()}>
					<i>I</i>
				</button>
				<button type="button" title="Underline (⌘U)" className={s.underline ? "on" : ""} onClick={() => c().toggleUnderline().run()}>
					<u>U</u>
				</button>
				<button type="button" title="Strikethrough" className={s.strike ? "on" : ""} onClick={() => c().toggleStrike().run()}>
					<s>S</s>
				</button>
				<ColorButton
					title="Text colour"
					glyph="A"
					value={s.color}
					open={menu === "color"}
					onOpen={() => setMenu(menu === "color" ? null : "color")}
					palette={config.palette}
					onPick={(v) => {
						(v ? c().setColor(v) : c().unsetColor()).run();
						setMenu(null);
					}}
				/>
				<ColorButton
					title="Highlight"
					glyph="▰"
					value={s.highlight}
					open={menu === "highlight"}
					onOpen={() => setMenu(menu === "highlight" ? null : "highlight")}
					palette={config.palette}
					onPick={(v) => {
						(v ? c().setBackgroundColor(v) : c().unsetBackgroundColor()).run();
						setMenu(null);
					}}
				/>
				<button type="button" title="Clear formatting" onClick={() => c().unsetAllMarks().run()}>
					⌫
				</button>
			</div>

			<div className="pb-toolbar__group">
				{(
					[
						["left", "⟸", "Align left"],
						["center", "≡", "Centre"],
						["right", "⟹", "Align right"],
						["justify", "☰", "Justify"],
					] as const
				).map(([v, g, t]) => (
					<button key={v} type="button" title={t} className={s.align === v ? "on" : ""} onClick={() => c().setTextAlign(v).run()}>
						{g}
					</button>
				))}
			</div>

			<div className="pb-toolbar__group">
				<button type="button" title="Bulleted list" className={s.bullet ? "on" : ""} onClick={() => c().toggleBulletList().run()}>
					•≡
				</button>
				<button type="button" title="Numbered list" className={s.ordered ? "on" : ""} onClick={() => c().toggleOrderedList().run()}>
					1≡
				</button>
				<button type="button" title="Quote" className={s.quote ? "on" : ""} onClick={() => c().toggleBlockquote().run()}>
					❝
				</button>
				<div className="pb-pop-anchor">
					<button type="button" title="Link (⌘K)" className={s.link ? "on" : ""} onClick={() => setMenu(menu === "link" ? null : "link")}>
						🔗
					</button>
					{menu === "link" && <LinkPopover editor={editor} config={config} onClose={() => setMenu(null)} />}
				</div>
			</div>

			<div className="pb-toolbar__group">
				<div className="pb-pop-anchor">
					<button type="button" className="primary" onClick={() => setMenu(menu === "insert" ? null : "insert")}>
						+ Insert
					</button>
					{menu === "insert" && (
						<InsertPanel
							items={insert.items}
							onPick={(item) => {
								setMenu(null);
								insert.run(item);
							}}
							onClose={() => setMenu(null)}
						/>
					)}
				</div>
			</div>

			<div className="pb-toolbar__end">
				<button type="button" onClick={onPages} title="The site's pages: add, open, rename, menus, unpublish">
					📄 Pages
				</button>
				<button type="button" onClick={onHistory} title="Earlier versions of what you're editing: see, compare and restore them">
					🕘 History
				</button>
				<DeviceSwitch />
				<button type="button" onClick={onPreview} title="See the page as visitors will, with your unpublished changes and without the editor">
					👁 Preview
				</button>
				<button type="button" className={inspectorOpen ? "on" : ""} onClick={onToggleInspector} title="Show or hide the side panel">
					⚙ Panel
				</button>
				<button
					type="button"
					className="primary pb-publish"
					disabled={!publish.unpublished || publish.busy || save.state === "conflict"}
					onClick={publish.run}
					title={publish.unpublished ? `Make your saved changes live${publish.also?.length ? `, including ${publish.also.join(", ")}` : ""}` : "Everything here is live"}
				>
					{publish.busy ? "Publishing…" : publish.unpublished ? "Publish" : "Published ✓"}
				</button>
			</div>
		</div>
	);
}

/** Desktop or phone: which screen the page is shown, and styled, for. */
function DeviceSwitch() {
	const device = useDevice();
	const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌥⌘P" : "Ctrl+Alt+P";
	return (
		<div className="pb-seg pb-device" role="radiogroup" aria-label="Screen">
			<button type="button" role="radio" aria-checked={device === "desktop"} className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")} title={`Desktop (${shortcut})`}>
				🖥
			</button>
			<button
				type="button"
				role="radio"
				aria-checked={device === "phone"}
				className={device === "phone" ? "on" : ""}
				onClick={() => setDevice("phone")}
				title={`Phone: see and style the page as a phone shows it (${shortcut})`}
			>
				📱
			</button>
		</div>
	);
}

function ColorButton(props: {
	title: string;
	glyph: string;
	value: string;
	open: boolean;
	onOpen: () => void;
	palette: Array<{ label: string; value: string }>;
	onPick: (v: string | null) => void;
}) {
	const [custom, setCustom] = React.useState("#ff00d2");
	return (
		<div className="pb-pop-anchor">
			<button type="button" title={props.title} onClick={props.onOpen}>
				<span className="pb-colorglyph" style={{ borderBottomColor: props.value || "currentColor" }}>
					{props.glyph}
				</span>
			</button>
			{props.open && (
				<div className="pb-pop pb-pop--colors">
					<div className="pb-swatches">
						{props.palette.map((sw) => (
							<button key={sw.value} type="button" title={sw.label} style={{ background: sw.value }} onClick={() => props.onPick(sw.value)} />
						))}
					</div>
					<div className="pb-row">
						<input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} />
						<button type="button" onClick={() => props.onPick(custom)}>
							Use
						</button>
						<button type="button" onClick={() => props.onPick(null)}>
							None
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

/** The site's pages and their addresses, fetched once per page load (for linking to them). */
let sitePages: Promise<Array<{ title: string; url: string }>> | null = null;
function loadSitePages(config: BuilderConfig) {
	sitePages ??= Promise.all([listEntries(config.pages.collection), getCollectionInfo(config.pages.collection)])
		.then(([pages, info]) =>
			pages
				.filter((p) => p.status === "published" || p.status === "draft")
				.map((p) => ({ title: p.title, url: pageUrl(config.pages, p.slug, info.urlPattern) ?? "" }))
				.filter((p) => p.url)
				.sort((a, b) => a.title.localeCompare(b.title)),
		)
		.catch(() => []);
	return sitePages;
}

function LinkPopover({ editor, config, onClose }: { editor: Editor; config: BuilderConfig; onClose: () => void }) {
	const current = editor.getAttributes("link");
	const [href, setHref] = React.useState<string>(current.href ?? "");
	const [blank, setBlank] = React.useState(current.target === "_blank");
	const [pages, setPages] = React.useState<Array<{ title: string; url: string }>>([]);
	React.useEffect(() => {
		void loadSitePages(config).then(setPages);
	}, [config]);
	// Typing a word (not an address) suggests the site's pages.
	const q = href.trim().toLowerCase();
	const suggestions = /^(https?:|mailto:|tel:|#)/.test(q) ? [] : pages.filter((p) => !q || p.title.toLowerCase().includes(q.replace(/^\//, "")) || p.url.includes(q)).slice(0, 6);
	const apply = () => {
		const chain = editor.chain().focus().extendMarkRange("link");
		if (!href.trim()) chain.unsetLink().run();
		else chain.setLink({ href: href.trim(), target: blank ? "_blank" : null }).run();
		onClose();
	};
	return (
		<form
			className="pb-pop pb-pop--link"
			onSubmit={(e) => {
				e.preventDefault();
				apply();
			}}
		>
			<input autoFocus placeholder="Search pages, or paste https://…" value={href} onChange={(e) => setHref(e.target.value)} />
			{suggestions.length > 0 && !suggestions.some((s) => s.url === href) && (
				<ul className="pb-link-pages">
					{suggestions.map((s) => (
						<li key={s.url}>
							<button type="button" onClick={() => setHref(s.url)}>
								{s.title}
								<small>{s.url}</small>
							</button>
						</li>
					))}
				</ul>
			)}
			<label className="pb-toggle">
				<input type="checkbox" checked={blank} onChange={(e) => setBlank(e.target.checked)} /> New tab
			</label>
			<div className="pb-row">
				<button type="submit" className="primary">
					Apply
				</button>
				{current.href && (
					<button
						type="button"
						onClick={() => {
							editor.chain().focus().extendMarkRange("link").unsetLink().run();
							onClose();
						}}
					>
						Remove link
					</button>
				)}
			</div>
		</form>
	);
}

/** Categorised, searchable list of everything insertable — shared with the `/` menu. */
export function InsertPanel({ items, onPick, onClose, index, style }: { items: InsertItem[]; onPick: (i: InsertItem) => void; onClose?: () => void; index?: number; style?: React.CSSProperties }) {
	const [q, setQ] = React.useState("");
	const searchable = index === undefined;
	const shown = searchable && q ? items.filter((i) => `${i.label} ${i.category} ${(i.keywords ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase())) : items;
	const cats = [...new Set(shown.map((i) => i.category))];
	const activeRef = React.useRef<HTMLButtonElement>(null);
	// Braces matter: scrollIntoView returns a Promise in newer browsers, and an
	// effect that returns one crashes React.
	React.useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" });
	}, [index]);
	return (
		<div className="pb-pop pb-pop--insert" style={style} onKeyDown={(e) => e.key === "Escape" && onClose?.()}>
			{searchable && <input autoFocus type="search" placeholder="Search blocks" value={q} onChange={(e) => setQ(e.target.value)} />}
			<div className="pb-insert__list">
				{cats.map((cat) => (
					<div key={cat}>
						<div className="pb-insert__cat">{cat}</div>
						{shown
							.filter((i) => i.category === cat)
							.map((item) => {
								const active = index !== undefined && shown[index] === item;
								return (
									<button
										key={item.id}
										ref={active ? activeRef : undefined}
										type="button"
										className={`pb-insert__item${active ? " on" : ""}`}
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => onPick(item)}
									>
										<span className="pb-insert__icon">{item.icon}</span>
										<span>
											<strong>{item.label}</strong>
											{item.description && <small>{item.description}</small>}
										</span>
									</button>
								);
							})}
					</div>
				))}
				{shown.length === 0 && <p className="pb-empty">Nothing matches.</p>}
			</div>
		</div>
	);
}
