/**
 * Text size by steps (bigger / smaller, like Word's A+ and A−) and "fit to
 * width": a line of text scaled to exactly fill its box.
 *
 * Fitting is worked out here, in the editor, where the site's own fonts are
 * loaded: how the line's width grows with its font size gives the size, in
 * container units (`cqi`), at which it fills its box whatever that box's
 * width. So the published page stays pure CSS, and the fit holds on every
 * screen. It's measured again when a fitted block changes.
 */
import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import { cleanBlockStyle, cleanFit, cleanPhoneStyle, type FitLine } from "../schema/style.js";
import { getDevice, withLayout } from "./device.js";

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
 * How wide a text block's whole line is (text, padding, whatever the site
 * draws around it) as `k × font size + c`, measured at two sizes on a copy
 * laid out in copies of its ancestors (so the site's styles apply), outside
 * the editor's own DOM.
 */
function measureLine(view: EditorView, pos: number): { k: number; c: number } | null {
	const el = view.nodeDOM(pos);
	const root = view.dom as HTMLElement;
	const host = root.parentElement;
	if (!(el instanceof HTMLElement) || !host) return null;
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
	// One line, at its natural width; its own layout (block, flex…) as the site has it.
	Object.assign(copy.style, { whiteSpace: "nowrap", flexWrap: "nowrap", width: "max-content", maxWidth: "none" });
	parent.append(copy);
	host.append(mirror);
	const at = (px: number) => {
		copy.style.fontSize = `${px}px`;
		return copy.getBoundingClientRect().width;
	};
	const w1 = at(20);
	const w2 = at(40);
	mirror.remove();
	const k = (w2 - w1) / 20;
	if (!(k > 0)) return null;
	return { k: +k.toFixed(4), c: +(w1 - 20 * k).toFixed(2) };
}

/**
 * The fit, measured with the site laid out for desktops and for phones,
 * whatever the editor is showing, so it's the same from either view. The
 * phone measurement is kept only where the site lays the block out
 * differently on phones.
 */
export function measureFit(view: EditorView, pos: number): FitLine | null {
	const desktop = withLayout("desktop", () => measureLine(view, pos));
	if (!desktop) return null;
	const phone = withLayout("phone", () => measureLine(view, pos));
	const same = !phone || (Math.abs(phone.k - desktop.k) / desktop.k < 0.01 && Math.abs(phone.c - desktop.c) < 1);
	return same ? desktop : { ...desktop, pk: phone.k, pc: phone.c };
}

const sameFit = (a: FitLine | undefined, b: FitLine) =>
	!!a && Math.abs(a.k - b.k) / b.k < 0.005 && Math.abs(a.c - b.c) < 0.5 && (a.pk === undefined) === (b.pk === undefined) && (b.pk === undefined || (Math.abs(a.pk! - b.pk) / b.pk < 0.005 && Math.abs(a.pc! - b.pc!) < 0.5));

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

/** Fitted blocks already measured as they are (nodes are immutable, so an edit makes a new one). */
let measured = new WeakSet<PMNode>();

/** Keeps fitted blocks fitted as their text changes (and once the fonts have loaded). */
export const FitText = Extension.create({
	name: "pbFitText",
	onCreate() {
		const editor = this.editor;
		void document.fonts?.ready.then(() => {
			measured = new WeakSet();
			refit(editor);
		});
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
		if (measured.has(node)) return false;
		const fit = measureFit(view, pos);
		if (fit && !sameFit(cleanFit(node.attrs.pbFit), fit)) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, pbFit: fit });
		else measured.add(node);
		return false;
	});
	if (tr.docChanged) view.dispatch(tr.setMeta("addToHistory", false));
}
