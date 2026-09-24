/**
 * Editing chrome for blocks that aren't just text. Each view renders the same
 * public markup as the node's `renderHTML` (so the page still looks like the
 * page) plus the handles an editor needs.
 */
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import * as React from "react";

import type { Extensions } from "@tiptap/core";

import { portableTextToDoc } from "../convert/to-doc.js";
import type { BuilderConfig } from "../schema/config.js";
import { blockStyleToCss, cleanHide, cleanPhoneStyle, phoneStyleAttrs } from "../schema/style.js";
import { getEntryField } from "./api.js";
import { getDevice } from "./device.js";
import { attachFieldEditing } from "./fields.js";
import { reactStyle } from "./ui.js";

// ── Preview store: server-rendered markup for external/reusable blocks ────────

type Listener = () => void;
let previews: Record<string, string> = {};
const listeners = new Set<Listener>();

export const previewStore = {
	set(next: Record<string, string>) {
		previews = { ...previews, ...next };
		listeners.forEach((l) => l());
	},
	subscribe(l: Listener) {
		listeners.add(l);
		return () => listeners.delete(l);
	},
	get: () => previews,
};

/**
 * Mounts the editor for a document embedded in a block's preview. Registered
 * by EditorIsland (a direct import would be circular).
 */
let mountEmbedded: ((doc: HTMLElement) => () => void) | null = null;
export function setEmbedMounter(fn: (doc: HTMLElement) => () => void) {
	mountEmbedded = fn;
}

/** The live parts of a preview: embedded documents get their own editor, and other entries' fields are editable. */
function useLivePreviewParts(container: React.RefObject<HTMLElement | null>, html: string | undefined) {
	React.useEffect(() => {
		const el = container.current;
		if (!el || !html || !mountEmbedded) return;
		const unmounts = [...el.querySelectorAll<HTMLElement>("[data-pb-embed]")].map((doc) => mountEmbedded!(doc));
		return () => unmounts.forEach((u) => u());
	}, [container, html]);
	// Another entry's plain-text fields shown in the preview (an event's name,
	// date…) are edited right there, saving to that entry.
	React.useEffect(() => {
		const el = container.current;
		if (!el || !html) return;
		return attachFieldEditing(el);
	}, [container, html]);
}

function usePreview(key: string): string | undefined {
	return React.useSyncExternalStore(previewStore.subscribe, () => previewStore.get()[key], () => undefined);
}

/** Editor-wide context the node views need but TipTap doesn't carry. */
export interface ViewContext {
	config: BuilderConfig;
	reusableTitles: Record<string, string>;
}

const cls = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(" ");

/** The hide-on-a-screen class a node's own `renderHTML` would add. */
const hideClass = (attrs: Record<string, unknown>) => {
	const hide = cleanHide(attrs.pbHide);
	return hide ? `pb-hide-${hide}` : undefined;
};

// ── Image ─────────────────────────────────────────────────────────────────────

function ImageView({ node, updateAttributes, selected, getPos, editor }: NodeViewProps) {
	// Drag-resizing is the image's width; everything else is edited in the inspector.
	const a = node.attrs;
	const figure = React.useRef<HTMLElement>(null);
	const [dragWidth, setDragWidth] = React.useState<number | null>(null);
	const width = dragWidth ?? (typeof a.displayWidth === "number" ? a.displayWidth : null);

	const startResize = (side: "left" | "right") => (e: React.PointerEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startW = figure.current?.getBoundingClientRect().width ?? 300;
		const max = (figure.current?.parentElement?.getBoundingClientRect().width ?? 1200) - 8;
		let latest = startW;
		const move = (ev: PointerEvent) => {
			const dx = side === "right" ? ev.clientX - startX : startX - ev.clientX;
			latest = Math.max(80, Math.min(max, startW + dx));
			setDragWidth(latest);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			setDragWidth(null);
			// In the phone view, resizing sets the phone's width only.
			if (getDevice() === "phone") updateAttributes({ pbStylePhone: cleanPhoneStyle({ ...(a.pbStylePhone ?? {}), width: `${Math.round(latest)}px` }) ?? null });
			else updateAttributes({ displayWidth: Math.round(latest) });
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	// Dragging in the phone view shows the phone's width as it changes.
	const phone = phoneStyleAttrs(dragWidth !== null && getDevice() === "phone" ? { ...a.pbStylePhone, width: `${Math.round(dragWidth)}px` } : a.pbStylePhone);
	const style = [blockStyleToCss(a.pbStyle), width && a.align !== "wide" ? `width: ${Math.round(width)}px` : "", phone.style].filter(Boolean).join("; ");

	return (
		<NodeViewWrapper
			as="figure"
			ref={figure}
			className={cls("pb-image", `pb-image--${a.align || "none"}`, "pb-ed-image", hideClass(a), selected && "pb-ed-selected")}
			style={reactStyle(style)}
			data-pb-phone={phone["data-pb-phone"]}
			data-drag-handle
			onClick={() => typeof getPos === "function" && editor.commands.setNodeSelection(getPos()!)}
		>
			{a.src ? <img src={a.src} alt={a.alt} draggable={false} /> : <div className="pb-ed-empty">No image chosen</div>}
			{a.align !== "wide" && (
				<>
					<span className="pb-ed-resize pb-ed-resize--l" onPointerDown={startResize("left")} contentEditable={false} />
					<span className="pb-ed-resize pb-ed-resize--r" onPointerDown={startResize("right")} contentEditable={false} />
				</>
			)}
			{(a.caption || selected) && (
				<figcaption
					contentEditable
					suppressContentEditableWarning
					className="pb-ed-caption"
					data-placeholder="Add a caption"
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Enter") {
							e.preventDefault();
							(e.target as HTMLElement).blur();
						}
					}}
					onBlur={(e) => updateAttributes({ caption: e.currentTarget.textContent ?? "" })}
				>
					{a.caption}
				</figcaption>
			)}
		</NodeViewWrapper>
	);
}

// ── External (server-rendered) blocks ─────────────────────────────────────────

function makeExternalView(ctx: ViewContext) {
	return function ExternalView({ node, selected }: NodeViewProps) {
		const def = ctx.config.externalBlocks.find((b) => b.type === node.attrs.blockType);
		const html = usePreview(node.attrs.key);
		const preview = React.useRef<HTMLDivElement>(null);
		useLivePreviewParts(preview, html);
		return (
			<NodeViewWrapper className={cls("pb-ed-atom", hideClass(node.attrs), selected && "pb-ed-selected")} data-drag-handle>
				<div className="pb-ed-atom__label" contentEditable={false}>
					{def?.icon ?? "◆"} {def?.label ?? node.attrs.blockType}
				</div>
				{html ? (
					<div ref={preview} className="pb-ed-atom__preview" contentEditable={false} dangerouslySetInnerHTML={{ __html: html }} />
				) : (
					<div className="pb-ed-atom__placeholder" contentEditable={false}>
						{def?.description ?? "Rendered by the site."} The live preview appears after it saves.
					</div>
				)}
			</NodeViewWrapper>
		);
	};
}

// ── Reusable blocks ───────────────────────────────────────────────────────────

function makeReusableView(ctx: ViewContext) {
	return function ReusableView({ node, selected, editor, getPos }: NodeViewProps) {
		const html = usePreview(node.attrs.key);
		const title = node.attrs.title || ctx.reusableTitles[node.attrs.ref] || "Shared block";
		const [busy, setBusy] = React.useState(false);

		const detach = async () => {
			if (typeof getPos !== "function") return;
			setBusy(true);
			try {
				const content = await getEntryField(ctx.config.reusableCollection, node.attrs.ref, "content");
				const doc = portableTextToDoc(content, ctx.config);
				const pos = getPos()!;
				editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, doc.content ?? []).run();
			} catch (e) {
				alert(`Couldn't detach: ${e instanceof Error ? e.message : e}`);
			} finally {
				setBusy(false);
			}
		};

		return (
			<NodeViewWrapper className={cls("pb-ed-atom", "pb-ed-atom--reusable", hideClass(node.attrs), selected && "pb-ed-selected")} data-drag-handle>
				<div className="pb-ed-atom__label" contentEditable={false}>
					♻ {title}
					<span className="pb-ed-atom__actions">
						<a href={`/?pb-block=${encodeURIComponent(node.attrs.ref)}`} target="_blank" rel="noreferrer" title="Opens the shared block on its own, to edit; every page using it changes">
							Edit everywhere ↗
						</a>
						<button type="button" onClick={detach} disabled={busy}>
							{busy ? "Detaching…" : "Detach — edit here only"}
						</button>
					</span>
				</div>
				{html ? (
					<div className="pb-ed-atom__preview" contentEditable={false} dangerouslySetInnerHTML={{ __html: html }} />
				) : (
					<div className="pb-ed-atom__placeholder" contentEditable={false}>
						Shared block “{title}”. The preview appears after it saves.
					</div>
				)}
			</NodeViewWrapper>
		);
	};
}

// ── Accordion item: always open while editing ────────────────────────────────

/**
 * A plain DOM view, not React: the question's <summary> must be a direct
 * child of <details> (as it is on the published page), which a React wrapper
 * would break — the browser then shows its own "Details" label.
 */
function accordionItemView({ node }: { node: { type: unknown; attrs: Record<string, unknown> } }) {
	const dom = document.createElement("details");
	dom.open = true;
	const apply = (attrs: Record<string, unknown>) => {
		dom.className = cls("pb-accordion__item", "pb-ed-accordion-item", hideClass(attrs));
		const phone = phoneStyleAttrs(attrs.pbStylePhone);
		dom.setAttribute("style", [blockStyleToCss(attrs.pbStyle), phone.style].filter(Boolean).join("; "));
		if (phone["data-pb-phone"]) dom.setAttribute("data-pb-phone", phone["data-pb-phone"]);
		else dom.removeAttribute("data-pb-phone");
	};
	apply(node.attrs);
	// Clicking the question places the caret; it mustn't collapse the answer.
	dom.addEventListener("click", (e) => {
		if ((e.target as HTMLElement).closest("summary")) e.preventDefault();
	});
	dom.addEventListener("toggle", () => {
		if (!dom.open) dom.open = true;
	});
	return {
		dom,
		contentDOM: dom,
		update(next: { type: unknown; attrs: Record<string, unknown> }) {
			if (next.type !== node.type) return false;
			apply(next.attrs);
			return true;
		},
	};
}

function SpacerView({ node, selected }: NodeViewProps) {
	return (
		<NodeViewWrapper className={cls("pb-spacer", `pb-spacer--${node.attrs.size}`, "pb-ed-spacer", hideClass(node.attrs), selected && "pb-ed-selected")} data-drag-handle>
			<span contentEditable={false}>spacer</span>
		</NodeViewWrapper>
	);
}

/** Attach the editing views to the shared schema. */
export function withNodeViews(extensions: Extensions, ctx: ViewContext): Extensions {
	const views: Record<string, React.ComponentType<NodeViewProps>> = {
		pbImage: ImageView,
		pbExternal: makeExternalView(ctx),
		pbReusable: makeReusableView(ctx),
		pbSpacer: SpacerView,
	};
	return extensions.map((ext) => {
		if (ext.name === "pbAccordionItem" && "extend" in ext) {
			return (ext as { extend: (o: object) => typeof ext }).extend({ addNodeView: () => accordionItemView });
		}
		const View = views[ext.name];
		return View && "extend" in ext
			? (ext as { extend: (o: object) => typeof ext }).extend({ addNodeView: () => ReactNodeViewRenderer(View as never) })
			: ext;
	});
}
