/**
 * Text size by steps (bigger / smaller, like Word's A+ and A−) and "fit to
 * width": a line of text scaled to exactly fill its box.
 *
 * Fitting is worked out here, in the editor, where the site's own fonts are
 * loaded: the text's width relative to its font size gives the size, in
 * container units (`cqi`), at which it fills its box whatever that box's
 * width. So the published page stays pure CSS, and the fit holds on every
 * screen. It's measured again whenever the text changes.
 */
import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import { cleanBlockStyle, cleanPhoneStyle } from "../schema/style.js";
import { getDevice } from "./device.js";

/** Sizes the steps go through, in px (stored as rem). */
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 112, 128, 160, 192];

function nextSize(px: number, dir: 1 | -1): number {
	if (dir > 0) return SIZES.find((s) => s > px + 0.5) ?? SIZES[SIZES.length - 1];
	return [...SIZES].reverse().find((s) => s < px - 0.5) ?? SIZES[0];
}

const rem = (px: number) => `${+(px / 16).toFixed(4)}rem`;

function computedPx(view: EditorView, pos: number): number {
	const at = view.domAtPos(pos);
	const el = at.node instanceof Element ? at.node : at.node.parentElement;
	return el ? parseFloat(getComputedStyle(el).fontSize) || 16 : 16;
}

/**
 * One step bigger or smaller. A selection gets its own size; with just a
 * cursor, the whole block does (on phones only, in the phone view). A block
 * sized this way stops fitting to width.
 */
export function stepTextSize(editor: Editor, dir: 1 | -1): boolean {
	const { state, view } = editor;
	const { selection } = state;
	const $from = selection.$from;
	if (!$from.parent.isTextblock) return false;
	if (!selection.empty) {
		const px = computedPx(view, selection.from);
		editor.chain().focus().setFontSize(rem(nextSize(px, dir))).run();
		return true;
	}
	const pos = $from.before();
	const node = $from.parent;
	const dom = view.nodeDOM(pos);
	const px = dom instanceof Element ? parseFloat(getComputedStyle(dom).fontSize) || 16 : 16;
	const size = rem(nextSize(px, dir));
	const attrs: Record<string, unknown> = { ...node.attrs, pbFit: null };
	if (getDevice() === "phone") attrs.pbStylePhone = cleanPhoneStyle({ ...node.attrs.pbStylePhone, fontSize: size }) ?? null;
	else attrs.pbStyle = cleanBlockStyle({ ...node.attrs.pbStyle, fontSize: size }) ?? null;
	view.dispatch(state.tr.setNodeMarkup(pos, undefined, attrs));
	return true;
}

// ── Fit to width ──────────────────────────────────────────────────────────────

/**
 * The font size, in `cqi` of the block's container, at which a text block's
 * whole line (text, padding, any decoration the site adds around it) is
 * exactly as wide as the container. Measured on a copy, laid out inside
 * copies of the same ancestors so the site's styles apply, outside the
 * editor's own DOM.
 */
export function measureFit(view: EditorView, pos: number): number | null {
	const el = view.nodeDOM(pos);
	const root = view.dom as HTMLElement;
	const host = root.parentElement;
	if (!(el instanceof HTMLElement) || !host) return null;
	const px = parseFloat(getComputedStyle(el).fontSize);
	if (!px) return null;

	const mirror = root.cloneNode(false) as HTMLElement;
	mirror.removeAttribute("contenteditable");
	Object.assign(mirror.style, { position: "absolute", left: "0", top: "0", width: `${root.clientWidth}px`, visibility: "hidden", pointerEvents: "none" });
	let parent: HTMLElement = mirror;
	const chain: HTMLElement[] = [];
	for (let e = el.parentElement; e && e !== root; e = e.parentElement) chain.unshift(e);
	for (const a of chain) {
		const copy = a.cloneNode(false) as HTMLElement;
		parent.append(copy);
		parent = copy;
	}
	const copy = el.cloneNode(true) as HTMLElement;
	Object.assign(copy.style, { fontSize: `${px}px`, whiteSpace: "nowrap", width: "max-content", maxWidth: "none", display: "block" });
	parent.append(copy);
	host.append(mirror);
	const width = copy.getBoundingClientRect().width;
	mirror.remove();
	if (!width) return null;
	// A hair under, so rounding never tips it into overflowing.
	return +((100 * px) / width * 0.995).toFixed(3);
}

/** Turn fitting on or off for the text block at the cursor. */
export function toggleFit(editor: Editor): boolean {
	const { state, view } = editor;
	const $from = state.selection.$from;
	if (!$from.parent.isTextblock || $from.depth < 1) return false;
	const pos = $from.before();
	const node = $from.parent;
	if (node.attrs.pbFit) {
		view.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, pbFit: null }));
		return true;
	}
	const fit = measureFit(view, pos);
	if (fit) view.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, pbFit: fit }));
	return true;
}

/** Keeps fitted blocks fitted as their text changes (and once the fonts have loaded). */
export const FitText = Extension.create({
	name: "pbFitText",
	onCreate() {
		const editor = this.editor;
		void document.fonts?.ready.then(() => refit(editor));
	},
	onUpdate() {
		const editor = this.editor;
		clearTimeout((editor as unknown as { pbFitTimer?: number }).pbFitTimer);
		(editor as unknown as { pbFitTimer?: number }).pbFitTimer = window.setTimeout(() => refit(editor), 150);
	},
});

function refit(editor: Editor) {
	if (editor.isDestroyed) return;
	const { state, view } = editor;
	let tr = state.tr;
	state.doc.descendants((node: PMNode, pos: number) => {
		if (!node.isTextblock || !node.attrs.pbFit) return true;
		const fit = measureFit(view, pos);
		if (fit && Math.abs(fit - node.attrs.pbFit) / node.attrs.pbFit > 0.01) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, pbFit: fit });
		return false;
	});
	if (tr.docChanged) view.dispatch(tr.setMeta("addToHistory", false));
}
