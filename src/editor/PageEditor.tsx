/**
 * The on-page editor: the page's own content, editable in place, with the
 * ribbon, the side panel, `/` to insert, drag handles, and autosave.
 */
import { Extension, type Editor, type JSONContent, type Range } from "@tiptap/core";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import * as React from "react";
import { createPortal } from "react-dom";

import { docToPortableText } from "../convert/from-doc.js";
import { portableTextToDoc } from "../convert/to-doc.js";
import type { PTBlock } from "../convert/types.js";
import { newKey } from "../convert/types.js";
import type { BuilderConfig } from "../schema/config.js";
import { builderExtensions } from "../schema/extensions.js";
import { anyThemeToCss, cleanAnyTheme, cleanTheme, themeToCss, type PageTheme } from "../schema/style.js";
import { ConflictError, LockedError, createPublishedEntry, fetchSlotPreviews, loadLatest, loadSiteTheme, publishEntry, saveEntry, saveSiteTheme, uploadImage } from "./api.js";
import { closedSlash, insertItems, slashExtension, type InsertContext, type InsertItem, type SlashState } from "./commands.js";
import { MediaDialog, mediaToImageAttrs, PromptDialog, ReusableDialog } from "./Dialogs.js";
import { Inspector } from "./Inspector.js";
import { withNodeViews, previewStore } from "./nodeviews.js";
import { claimIfFree, releaseIfActive, setActive, useIsActive } from "./registry.js";
import { fieldEdits, usePendingFieldEdits } from "./fields.js";
import { selectBlock, type BlockRef } from "./structure.js";
import { InsertPanel, Toolbar, type SaveState } from "./Toolbar.js";

export interface PageEditorProps {
	rootId: string;
	value: PTBlock[];
	collection: string;
	entryId: string;
	field: string;
	themeField: string;
	title: string;
	theme: unknown;
	config: BuilderConfig;
	reusableTitles: Record<string, string>;
	/** Shadow-root mount for the chrome. */
	chrome: HTMLElement;
	/**
	 * Set for a site region (header, footer…): a shared document shown on every
	 * page. Named in the ribbon so nobody edits it thinking it's one page, and
	 * it has no per-page design.
	 */
	region?: string;
}

const AUTOSAVE_MS = 1200;

type Dialog =
	| { kind: "media"; onPick: (attrs: Record<string, unknown>) => void }
	| { kind: "reusable" }
	| { kind: "saveReusable"; block: BlockRef }
	| null;

export function PageEditor(props: PageEditorProps) {
	const { config } = props;
	const isActive = useIsActive(props.rootId);
	const [dialog, setDialog] = React.useState<Dialog>(null);
	const [inspectorOpen, setInspectorOpen] = React.useState(true);
	const [save, setSave] = React.useState<{ state: SaveState; error?: string; holder?: string }>({ state: "loading" });
	const [theme, setTheme] = React.useState<PageTheme>(() => cleanTheme(props.theme, config.themeTokens) ?? {});
	const [siteTheme, setSiteTheme] = React.useState<PageTheme>({});
	/** Saved changes that aren't live yet. */
	const [unpublished, setUnpublished] = React.useState(false);
	const [publishing, setPublishing] = React.useState(false);
	const pendingFields = usePendingFieldEdits();
	const siteThemeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const [slash, setSlashState] = React.useState<SlashState>(closedSlash);
	const [plus, setPlus] = React.useState<{ x: number; y: number } | null>(null);

	const slashRef = React.useRef(slash);
	const setSlash = (s: SlashState) => {
		slashRef.current = s;
		setSlashState(s);
	};

	// Refs so long-lived closures (TipTap extensions, timers) see current values.
	const dirty = React.useRef({ body: false, theme: false });
	const themeRef = React.useRef(theme);
	const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const saving = React.useRef<Promise<void> | null>(null);
	const hovered = React.useRef<{ pos: number; size: number } | null>(null);
	// TipTap extensions and handlers are created once, before the editor exists;
	// they reach it through this ref rather than a stale closure.
	const editorRef = React.useRef<Editor | null>(null);
	/** Revision token of the version this editor last loaded or saved. */
	const rev = React.useRef<string | undefined>(undefined);
	/** Saving is held until the latest version is confirmed, and after a conflict. */
	const hold = React.useRef<"loading" | "conflict" | "locked" | null>("loading");

	// Stable, or the drag handle re-registers its plugin on every render.
	const onHandleNode = React.useCallback(({ node, pos }: { node: { nodeSize: number } | null; pos: number }) => {
		hovered.current = node ? { pos, size: node.nodeSize } : null;
	}, []);

	const ctx: InsertContext = {
		config,
		openMedia: (onPick) => setDialog({ kind: "media", onPick }),
		openReusable: () => setDialog({ kind: "reusable" }),
	};
	const ctxRef = React.useRef(ctx);
	ctxRef.current = ctx;
	const items = React.useMemo(() => insertItems(config), [config]);

	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			...withNodeViews(builderExtensions(config), { config, reusableTitles: props.reusableTitles }),
			Placeholder.configure({
				includeChildren: true,
				showOnlyCurrent: true,
				placeholder: ({ node }) => (node.type.name === "paragraph" ? "Type, or press / to add a block…" : node.type.name === "heading" ? "Heading" : ""),
			}),
			slashExtension({
				items: () => items,
				getState: () => slashRef.current,
				setState: setSlash,
				choose: (item, range) => runItem(item, range),
			}),
			Extension.create({
				name: "pbShortcuts",
				addKeyboardShortcuts: () => ({
					"Mod-s": () => {
						void flush();
						return true;
					},
				}),
			}),
		],
		content: portableTextToDoc(props.value, config),
		editorProps: {
			attributes: { class: "pb-doc pb-editor-content", "aria-label": "Page content", spellcheck: "true" },
			handleDrop: (view, event) => {
				const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
				if (!files.length) return false;
				event.preventDefault();
				const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
				void insertUploads(files, at);
				return true;
			},
			handlePaste: (view, event) => {
				const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
				if (!files.length) return false;
				void insertUploads(files, view.state.selection.from);
				return true;
			},
		},
		onUpdate: () => markDirty("body"),
		onFocus: () => setActive(props.rootId),
	});
	editorRef.current = editor;

	function runItem(item: InsertItem, range?: Range) {
		const editor = editorRef.current;
		if (!editor) return;
		if (range) editor.chain().focus().deleteRange(range).run();
		setSlash(closedSlash);
		item.run(editor, ctxRef.current);
	}

	async function insertUploads(files: File[], at: number) {
		const editor = editorRef.current;
		if (!editor) return;
		for (const file of files) {
			try {
				const item = await uploadImage(file);
				editor.chain().focus().insertContentAt(at, { type: "pbImage", attrs: mediaToImageAttrs(item) }).run();
			} catch (e) {
				alert(`Couldn't upload ${file.name}: ${e instanceof Error ? e.message : e}`);
			}
		}
	}

	// ── Saving ────────────────────────────────────────────────────────────────

	function markDirty(what: "body" | "theme") {
		dirty.current[what] = true;
		setSave({ state: "dirty" });
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
	}

	async function flush(options: { keepalive?: boolean; overrideLock?: boolean } = {}): Promise<void> {
		const editor = editorRef.current;
		if (!editor || hold.current) return;
		if (saving.current) await saving.current;
		if (!dirty.current.body && !dirty.current.theme) return;
		const data: Record<string, unknown> = {};
		if (dirty.current.body) data[props.field] = docToPortableText(editor.getJSON(), config);
		if (dirty.current.theme && props.themeField) data[props.themeField] = cleanTheme(themeRef.current, config.themeTokens) ?? null;
		dirty.current = { body: false, theme: false };
		setSave({ state: "saving" });
		document.dispatchEvent(new CustomEvent("emdash:save", { detail: { state: "saving" } }));
		saving.current = (async () => {
			try {
				rev.current = (await saveEntry(props.collection, props.entryId, data, { ...options, rev: rev.current })) ?? rev.current;
				setUnpublished(true);
				setSave({ state: dirty.current.body || dirty.current.theme ? "dirty" : "saved" });
				document.dispatchEvent(new CustomEvent("emdash:save", { detail: { state: "saved" } }));
				document.dispatchEvent(new CustomEvent("emdash:content-changed", { detail: { collection: props.collection, id: props.entryId } }));
				if (!options.keepalive) previewStore.set(await fetchSlotPreviews(props.rootId).catch(() => ({})));
			} catch (e) {
				// Put the changes back; they're still in the editor.
				if (props.field in data) dirty.current.body = true;
				if (props.themeField in data) dirty.current.theme = true;
				if (e instanceof LockedError) {
					// Someone has it open in the admin. Keep the changes; don't retry blindly.
					hold.current = "locked";
					if (timer.current) clearTimeout(timer.current);
					setSave({ state: "locked", error: e.message, holder: e.holder });
					document.dispatchEvent(new CustomEvent("emdash:save", { detail: { state: "error" } }));
					return;
				}
				if (e instanceof ConflictError) {
					// Someone else saved in between. Never overwrite silently.
					hold.current = "conflict";
					setSave({ state: "conflict", error: e.message });
					document.dispatchEvent(new CustomEvent("emdash:save", { detail: { state: "error" } }));
					return;
				}
				const message = e instanceof Error ? e.message : String(e);
				setSave({ state: "error", error: message });
				document.dispatchEvent(new CustomEvent("emdash:save", { detail: { state: "error" } }));
				if (timer.current) clearTimeout(timer.current);
				timer.current = setTimeout(() => void flush(), 5000);
			} finally {
				saving.current = null;
			}
		})();
		return saving.current;
	}

	// The page was rendered a moment ago, but this editor may be older than
	// the saved draft (a tab restored from history, a second tab). Start from
	// the latest saved version, and remember its revision so every save can
	// be refused if someone else saves in between.
	React.useEffect(() => {
		if (!editor) return;
		let cancelled = false;
		loadLatest(props.collection, props.entryId)
			.then((latest) => {
				if (cancelled) return;
				rev.current = latest.rev;
				setUnpublished(latest.unpublished);
				const serverBody = latest.data[props.field];
				if (Array.isArray(serverBody) && JSON.stringify(serverBody) !== JSON.stringify(props.value)) {
					editor.commands.setContent(portableTextToDoc(serverBody, config), { emitUpdate: false });
				}
				const serverTheme = cleanTheme(latest.data[props.themeField], config.themeTokens) ?? {};
				if (JSON.stringify(serverTheme) !== JSON.stringify(themeRef.current)) setTheme(serverTheme);
				hold.current = null;
				setSave({ state: dirty.current.body || dirty.current.theme ? "dirty" : "saved" });
				if (dirty.current.body || dirty.current.theme) void flush();
			})
			.catch((e) => {
				if (cancelled) return;
				// Can't confirm the latest version — edit, but save blind (as the admin does).
				console.warn("Page builder: couldn't load the latest version", e);
				hold.current = null;
				setSave({ state: "saved" });
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor]);

	// The page's own document takes the ribbon first; regions take it when
	// clicked into. A region mounting early waits briefly so the page wins.
	React.useEffect(() => {
		const t = setTimeout(() => claimIfFree(props.rootId), props.region ? 200 : 0);
		return () => {
			clearTimeout(t);
			releaseIfActive(props.rootId);
		};
	}, [props.rootId, props.region]);

	// Clicking into a document gives it the ribbon. Pointer events as well as
	// focus: focus doesn't fire when the window itself isn't focused.
	React.useEffect(() => {
		if (!editor) return;
		const dom = editor.view.dom;
		// Only for events that are this document's own: one inside an editor
		// embedded in a block belongs to that editor.
		const claim = (e: Event) => {
			const owner = e.target instanceof Element ? e.target.closest(".ProseMirror") : null;
			if (owner && owner !== dom) return;
			setActive(props.rootId);
		};
		dom.addEventListener("pointerdown", claim);
		dom.addEventListener("focusin", claim);
		return () => {
			dom.removeEventListener("pointerdown", claim);
			dom.removeEventListener("focusin", claim);
		};
	}, [editor, props.rootId]);

	// A page restored from the back/forward cache is a stale snapshot.
	React.useEffect(() => {
		const onShow = (e: PageTransitionEvent) => e.persisted && location.reload();
		window.addEventListener("pageshow", onShow);
		return () => window.removeEventListener("pageshow", onShow);
	}, []);

	const publish = async () => {
		setPublishing(true);
		try {
			if (timer.current) clearTimeout(timer.current);
			await flush();
			if (hold.current) return;
			await publishEntry(props.collection, props.entryId);
			fieldEdits.published(props.collection, props.entryId);
			// Fields of other entries edited on this page go live with it.
			for (const other of fieldEdits.list()) {
				await publishEntry(other.collection, other.id);
				fieldEdits.published(other.collection, other.id);
				document.dispatchEvent(new CustomEvent("emdash:content-changed", { detail: { collection: other.collection, id: other.id } }));
			}
			// Publishing changes the entry's revision; pick up the new token.
			rev.current = (await loadLatest(props.collection, props.entryId)).rev;
			setUnpublished(false);
			document.dispatchEvent(new CustomEvent("emdash:content-changed", { detail: { collection: props.collection, id: props.entryId } }));
		} catch (e) {
			setSave({
				state: "error",
				error: e instanceof LockedError ? `Not published: ${e.holder} has it open in the admin. Try again once they've closed it.` : `Publish failed: ${e instanceof Error ? e.message : e}`,
			});
		} finally {
			setPublishing(false);
		}
	};

	const resolveLock = async (override: boolean) => {
		hold.current = null;
		await flush({ overrideLock: override });
	};

	const resolveConflict = async (keep: "mine" | "theirs") => {
		if (keep === "theirs") {
			dirty.current = { body: false, theme: false };
			location.reload();
			return;
		}
		const latest = await loadLatest(props.collection, props.entryId);
		rev.current = latest.rev;
		hold.current = null;
		dirty.current = { body: true, theme: true };
		await flush();
	};

	// Leaving the page must not lose the last keystrokes.
	React.useEffect(() => {
		const onHide = () => {
			if (dirty.current.body || dirty.current.theme) void flush({ keepalive: true });
		};
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (dirty.current.body || dirty.current.theme || saving.current) e.preventDefault();
		};
		window.addEventListener("pagehide", onHide);
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			window.removeEventListener("pagehide", onHide);
			window.removeEventListener("beforeunload", onBeforeUnload);
		};
	});

	// Close the "+" menu on any click outside it (clicks in the shadow root
	// arrive retargeted to its host, so check the composed path).
	React.useEffect(() => {
		if (!plus) return;
		const onDown = (e: MouseEvent) => {
			if (!e.composedPath().some((el) => el instanceof HTMLElement && el.classList.contains("pb-floating"))) setPlus(null);
		};
		const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
		return () => {
			clearTimeout(t);
			document.removeEventListener("mousedown", onDown);
		};
	}, [plus]);

	// ── Site design: the defaults every page inherits ─────────────────────────

	React.useEffect(() => {
		loadSiteTheme()
			.then((t) => setSiteTheme(cleanAnyTheme(t) ?? {}))
			.catch(() => undefined);
	}, []);

	const changeSiteTheme = (next: PageTheme) => {
		setSiteTheme(next);
		let el = document.querySelector<HTMLStyleElement>("style[data-pb-site-theme]");
		if (!el) {
			el = document.createElement("style");
			el.setAttribute("data-pb-site-theme", "");
			// Before the page theme, so a page's own overrides still win.
			const pageTheme = document.querySelector("style[data-pb-theme]");
			if (pageTheme) pageTheme.before(el);
			else document.head.append(el);
		}
		el.textContent = anyThemeToCss(next) ?? "";
		if (siteThemeTimer.current) clearTimeout(siteThemeTimer.current);
		setSave({ state: "saving" });
		siteThemeTimer.current = setTimeout(() => {
			saveSiteTheme(next)
				.then(() => setSave({ state: dirty.current.body || dirty.current.theme ? "dirty" : "saved" }))
				.catch((e) => setSave({ state: "error", error: e instanceof Error ? e.message : String(e) }));
		}, 800);
	};

	// ── Theme: live preview on the whole page ─────────────────────────────────

	React.useEffect(() => {
		themeRef.current = theme;
		let el = document.querySelector<HTMLStyleElement>("style[data-pb-theme]");
		if (!el) {
			el = document.createElement("style");
			el.setAttribute("data-pb-theme", "");
			document.head.append(el);
		}
		el.textContent = themeToCss(theme, config.themeTokens) ?? "";
	}, [theme, config.themeTokens]);

	// ── Layout: make room for the ribbon and the side panel, Word-style ───────

	// Must match the breakpoint in chrome.css where the panel docks at the bottom.
	const [narrow, setNarrow] = React.useState(() => window.matchMedia("(max-width: 900px)").matches);
	React.useEffect(() => {
		const mq = window.matchMedia("(max-width: 900px)");
		const on = () => setNarrow(mq.matches);
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, []);

	React.useEffect(() => {
		if (!isActive) return;
		const body = document.body.style;
		const prev = { paddingTop: body.paddingTop, marginRight: body.marginRight, paddingBottom: body.paddingBottom, transition: body.transition };
		body.transition = "margin-right 160ms ease";
		body.paddingTop = "52px";
		body.marginRight = inspectorOpen && !narrow ? "340px" : "0";
		body.paddingBottom = inspectorOpen && narrow ? "45vh" : prev.paddingBottom;
		return () => {
			Object.assign(body, prev);
		};
	}, [inspectorOpen, narrow, isActive]);

	if (!editor) return null;

	const saveAsReusable = async (block: BlockRef, name: string) => {
		setDialog(null);
		try {
			const node = editor.state.doc.nodeAt(block.pos);
			if (!node) return;
			const content = docToPortableText({ type: "doc", content: [node.toJSON() as JSONContent] }, config);
			const ref = await createPublishedEntry(config.reusableCollection, { title: name, content });
			editor
				.chain()
				.focus()
				.insertContentAt({ from: block.pos, to: block.pos + node.nodeSize }, { type: "pbReusable", attrs: { ref, title: name, key: newKey() } })
				.run();
		} catch (e) {
			alert(`Couldn't save the reusable block: ${e instanceof Error ? e.message : e}`);
		}
	};

	const chrome = (
		<>
			<Toolbar
				editor={editor}
				config={config}
				title={props.region ? `${props.region} — every page` : props.title}
				save={save}
				onSaveNow={() => void flush()}
				onResolveConflict={(keep) => void resolveConflict(keep)}
				onResolveLock={(override) => void resolveLock(override)}
				publish={{ unpublished: unpublished || pendingFields.length > 0, also: pendingFields.map((p) => p.label), busy: publishing, run: () => void publish() }}
				insert={{ items, run: (item) => runItem(item) }}
				inspectorOpen={inspectorOpen}
				onToggleInspector={() => setInspectorOpen((o) => !o)}
			/>
			{inspectorOpen && (
				<Inspector
					editor={editor}
					config={config}
					theme={theme}
					onTheme={(t) => {
						setTheme(t);
						markDirty("theme");
					}}
					siteTheme={siteTheme}
					onSiteTheme={changeSiteTheme}
					pageTab={!props.region && Boolean(props.themeField)}
					onRefreshPreviews={() => void fetchSlotPreviews(props.rootId).then(previewStore.set).catch(() => undefined)}
					onPickImage={(onPick) => setDialog({ kind: "media", onPick })}
					onSaveReusable={(block) => setDialog({ kind: "saveReusable", block })}
					onClose={() => setInspectorOpen(false)}
				/>
			)}
			{slash.open && slash.rect && slash.items.length > 0 && (
				<div className="pb-floating" style={{ left: slash.rect.left, top: slash.rect.bottom + 6 }}>
					<InsertPanel items={slash.items} index={slash.index} onPick={(item) => slash.range && runItem(item, slash.range)} />
				</div>
			)}
			{plus && (
				<div className="pb-floating" style={{ left: plus.x, top: plus.y }}>
					<InsertPanel
						items={items}
						onPick={(item) => {
							setPlus(null);
							runItem(item);
						}}
						onClose={() => setPlus(null)}
					/>
				</div>
			)}
			{dialog?.kind === "media" && (
				<MediaDialog
					onClose={() => setDialog(null)}
					onPick={(item) => {
						setDialog(null);
						dialog.onPick(mediaToImageAttrs(item));
					}}
				/>
			)}
			{dialog?.kind === "reusable" && (
				<ReusableDialog
					collection={config.reusableCollection}
					onClose={() => setDialog(null)}
					onPick={(entry) => {
						setDialog(null);
						editor.chain().focus().insertContent({ type: "pbReusable", attrs: { ref: entry.id, title: entry.title, key: newKey() } }).run();
					}}
				/>
			)}
			{dialog?.kind === "saveReusable" && (
				<PromptDialog
					title="Save as a reusable block"
					label="Name"
					confirm="Save and share"
					onClose={() => setDialog(null)}
					onSubmit={(name) => void saveAsReusable(dialog.block, name)}
				/>
			)}
		</>
	);

	return (
		<>
			<DragHandle
				editor={editor}
				nested
				onNodeChange={onHandleNode}
			>
				<div className="pb-handle">
					<button
						type="button"
						className="pb-handle__add"
						title="Add a block below"
						onClick={(e) => {
							const h = hovered.current;
							if (!h) return;
							const at = h.pos + h.size;
							editor.chain().insertContentAt(at, { type: "paragraph" }).setTextSelection(at + 1).run();
							const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
							setPlus({ x: r.right + 6, y: r.top });
						}}
					>
						+
					</button>
					<span
						className="pb-handle__grip"
						title="Drag to move · click to select"
						onClick={() => {
							const h = hovered.current;
							if (!h) return;
							selectBlock(editor, h.pos);
							setInspectorOpen(true);
						}}
					>
						⠿
					</span>
				</div>
			</DragHandle>
			<EditorContent editor={editor} />
			{isActive && createPortal(<div className="pb-chrome">{chrome}</div>, props.chrome)}
		</>
	);
}
