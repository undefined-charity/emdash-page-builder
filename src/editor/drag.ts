/**
 * Dragging blocks around the page. Grab a block by its handle and the page
 * makes room for it as it moves: the blocks around the drop point part to
 * show exactly where it will land. Drop it at the left or right edge of
 * another block to put the two side by side (in columns).
 *
 * Built on pointer events rather than the browser's own drag and drop, which
 * can only show a thin line, can't animate the page, and doesn't work on
 * touch screens.
 */
import { Extension, type Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

// ── Where it will land ────────────────────────────────────────────────────────

/** A drop point: between two blocks (`gap`), or beside one (`left`/`right`). */
export type Drop = { kind: "gap"; pos: number } | { kind: "left" | "right"; pos: number };

interface DragState {
	source: { pos: number; size: number } | null;
	drop: Drop | null;
	/** Height of the gap opened for the block. */
	height: number;
}

const key = new PluginKey<DragState>("pbDrag");
const idle: DragState = { source: null, drop: null, height: 0 };

/** Draws the dragged block's empty place, the gap it will drop into, and the side-by-side marker. */
export const DragDrop = Extension.create({
	name: "pbDragDrop",
	addProseMirrorPlugins() {
		return [
			new Plugin<DragState>({
				key,
				state: {
					init: () => idle,
					apply(tr, value) {
						const next = tr.getMeta(key) as DragState | undefined;
						if (next) return next;
						if (!value.source || !tr.docChanged) return value;
						return idle;
					},
				},
				props: {
					decorations(state) {
						const s = key.getState(state);
						if (!s?.source) return null;
						const decos: Decoration[] = [];
						const { pos, size } = s.source;
						if (state.doc.nodeAt(pos)) decos.push(Decoration.node(pos, pos + size, { class: "pb-drag-source" }));
						if (s.drop?.kind === "gap") {
							decos.push(
								Decoration.widget(
									s.drop.pos,
									() => {
										const el = document.createElement("div");
										el.className = "pb-drop-gap";
										el.style.setProperty("--pb-gap", `${s.height}px`);
										el.contentEditable = "false";
										return el;
									},
									{ key: `gap-${s.drop.pos}`, side: -1, ignoreSelection: true },
								),
							);
						} else if (s.drop) {
							const node = state.doc.nodeAt(s.drop.pos);
							if (node) decos.push(Decoration.node(s.drop.pos, s.drop.pos + node.nodeSize, { class: `pb-drop-side pb-drop-side--${s.drop.kind}` }));
						}
						return DecorationSet.create(state.doc, decos);
					},
				},
			}),
		];
	},
});

function show(view: EditorView, state: DragState) {
	view.dispatch(view.state.tr.setMeta(key, state).setMeta("addToHistory", false));
}

/** Types that can go side by side in columns (anything in the "block" group). */
const isBlock = (node: PMNode) => node.type.isInGroup("block");

/**
 * Can `source` (at `srcPos`) move to index `index` of the node at `parentPos`?
 * A container that would be left empty gets an empty paragraph instead, so
 * only a container that must keep a minimum (columns) can refuse.
 */
function canMove(doc: PMNode, srcPos: number, source: PMNode, parent: PMNode, parentPos: number, index: number): boolean {
	const $src = doc.resolve(srcPos);
	if (($src.depth === 0 ? -1 : $src.before()) === parentPos) return true;
	if (!parent.canReplace(index, index, Fragment.from(source))) return false;
	const from = $src.parent;
	const i = $src.index();
	return from.canReplace(i, i + 1, Fragment.empty) || (from.childCount === 1 && !!from.contentMatchAt(0).defaultType?.createAndFill());
}

/** Where the block being dragged would land for a pointer at (x, y). */
export function dropAt(view: EditorView, source: { pos: number; size: number }, x: number, y: number, current: Drop | null): Drop | null {
	const el = document.elementFromPoint(x, y);
	if (!el) return null;
	// Over the gap already opened: stay put (the page just moved under the pointer).
	if (el.closest(".pb-drop-gap")) return current;
	if (!view.dom.contains(el)) return null;
	const doc = view.state.doc;
	const src = doc.nodeAt(source.pos);
	if (!src) return null;
	const hit = view.posAtCoords({ left: x, top: y });
	if (!hit) return null;

	// Candidates to drop beside, innermost first: the atom under the pointer,
	// then every block around the pointer's position.
	const $pos = doc.resolve(hit.pos);
	const candidates: number[] = [];
	if (hit.inside >= 0 && doc.nodeAt(hit.inside)?.isAtom) candidates.push(hit.inside);
	for (let d = $pos.depth; d >= 1; d--) candidates.push($pos.before(d));

	for (const pos of candidates) {
		const node = doc.nodeAt(pos);
		if (!node) continue;
		// Never into itself.
		if (pos >= source.pos && pos < source.pos + source.size) continue;
		const dom = view.nodeDOM(pos);
		if (!(dom instanceof HTMLElement)) continue;
		const $at = doc.resolve(pos);
		const parent = $at.parent;
		// Inside a list item, only the list item as a whole moves.
		if (parent.type.name === "listItem") continue;
		const parentPos = $at.depth === 0 ? -1 : $at.before();
		const index = $at.index();
		const rect = dom.getBoundingClientRect();
		const containsSource = source.pos > pos && source.pos < pos + node.nodeSize;

		// Side by side: near a block's left or right edge.
		const edge = Math.min(64, rect.width * 0.18);
		const side = x < rect.left + edge ? "left" : x > rect.right - edge ? "right" : null;
		if (side && !containsSource && isBlock(src) && isBlock(node) && node.type.name !== "pbColumns" && sideBySide(doc, pos, src)) return { kind: side, pos };

		const after = y > rect.top + rect.height / 2;
		const insertAt = after ? pos + node.nodeSize : pos;
		if (!canMove(doc, source.pos, src, parent, parentPos, after ? index + 1 : index)) continue;
		// Dropping it where it already is does nothing: show no gap.
		if (insertAt === source.pos || insertAt === source.pos + source.size) return null;
		return { kind: "gap", pos: insertAt };
	}
	return null;
}

/** Whether a block can be put beside the one at `pos`: in new columns, or as another column. */
function sideBySide(doc: PMNode, pos: number, source: PMNode): boolean {
	const $at = doc.resolve(pos);
	const schema = doc.type.schema;
	const column = $at.parent.type.name === "pbColumn" ? $at.depth : -1;
	if (column > 0) {
		const columns = $at.node(column - 1);
		return columns.childCount < 4 && source.type.name !== "pbColumns";
	}
	const columns = schema.nodes.pbColumns;
	return !!columns && $at.parent.canReplaceWith($at.index(), $at.index() + 1, columns);
}

/** Move the block: insert it at the drop point, then take it out of where it was. */
export function moveTo(editor: Editor, source: { pos: number; size: number }, drop: Drop): boolean {
	const { state } = editor;
	const doc = state.doc;
	const node = doc.nodeAt(source.pos);
	if (!node) return false;
	const schema = state.schema;
	let tr = state.tr;
	let landed: number;

	if (drop.kind === "gap") {
		tr = tr.insert(drop.pos, node);
		landed = drop.pos;
	} else {
		const target = doc.nodeAt(drop.pos);
		if (!target) return false;
		const $at = doc.resolve(drop.pos);
		const col = (content: PMNode) => schema.nodes.pbColumn.create(null, content);
		if ($at.parent.type.name === "pbColumn") {
			// Beside a block in a column: a new column next to that one.
			const columnPos = $at.before();
			const column = $at.parent;
			const at = drop.kind === "left" ? columnPos : columnPos + column.nodeSize;
			tr = tr.insert(at, col(node));
			landed = at + 1;
		} else {
			const cols = schema.nodes.pbColumns.create(null, drop.kind === "left" ? [col(node), col(target)] : [col(target), col(node)]);
			tr = tr.replaceWith(drop.pos, drop.pos + target.nodeSize, cols);
			landed = drop.kind === "left" ? drop.pos + 2 : drop.pos + 2 + target.nodeSize + 2;
		}
	}

	// Take it out of its old place; an emptied container keeps an empty paragraph.
	const from = tr.mapping.map(source.pos);
	const to = tr.mapping.map(source.pos + source.size);
	const $from = tr.doc.resolve(from);
	const emptied = $from.parent.childCount === 1 && !$from.parent.canReplace($from.index(), $from.index() + 1, Fragment.empty);
	const filler = emptied ? $from.parent.contentMatchAt(0).defaultType?.createAndFill() : null;
	const before = tr.steps.length;
	if (filler) tr = tr.replaceWith(from, to, filler);
	else tr = tr.delete(from, to);
	landed = tr.mapping.slice(before).map(landed);

	const moved = tr.doc.nodeAt(landed);
	if (moved?.isTextblock) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(landed + 1)));
	else if (moved) tr = tr.setSelection(NodeSelection.create(tr.doc, landed));
	editor.view.dispatch(tr.scrollIntoView());
	editor.view.focus();
	return true;
}

// ── The drag itself ───────────────────────────────────────────────────────────

/** The colour behind an element, so its picture reads while dragged over other blocks. */
function backdrop(el: Element | null): string {
	for (let e = el; e; e = e.parentElement) {
		const c = getComputedStyle(e).backgroundColor;
		if (!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c)) return c;
	}
	return "#fff";
}

/**
 * Start dragging the block at `pos` from a pointerdown on its handle. A press
 * that doesn't move is a click (`onClick`).
 */
export function startBlockDrag(editor: Editor, pos: number, down: PointerEvent, onClick: () => void) {
	const view = editor.view;
	const node = view.state.doc.nodeAt(pos);
	if (!node) return;
	down.preventDefault();
	const source = { pos, size: node.nodeSize };
	const startX = down.clientX;
	const startY = down.clientY;
	let dragging = false;
	let ghost: HTMLElement | null = null;
	let drop: Drop | null = null;
	let height = 0;
	let x = startX;
	let y = startY;
	let scroll = 0;

	const begin = () => {
		dragging = true;
		const dom = view.nodeDOM(pos);
		const rect = dom instanceof HTMLElement ? dom.getBoundingClientRect() : new DOMRect(startX, startY, 300, 40);
		height = Math.max(28, Math.min(rect.height, 140));
		// A picture of the block that follows the pointer.
		ghost = document.createElement("div");
		ghost.className = "pb-drag-ghost";
		ghost.style.width = `${Math.min(rect.width, 560)}px`;
		ghost.style.background = backdrop(dom instanceof HTMLElement ? dom : null);
		ghost.style.setProperty("--pb-grab-x", `${Math.max(0, Math.min(startX - rect.left, 560))}px`);
		ghost.style.setProperty("--pb-grab-y", `${Math.max(0, Math.min(startY - rect.top, height))}px`);
		if (dom instanceof HTMLElement) ghost.append(dom.cloneNode(true));
		const label = document.createElement("span");
		label.className = "pb-drag-ghost__label";
		ghost.append(label);
		// Inside the page so it keeps the site's styles.
		(view.dom.parentElement ?? document.body).append(ghost);
		document.documentElement.classList.add("pb-dragging");
		show(view, { source, drop: null, height });
		tick();
	};

	const place = () => {
		if (!ghost) return;
		ghost.style.transform = `translate(${x}px, ${y}px)`;
		const next = dropAt(view, source, x, y, drop);
		const same = next === drop || (next && drop && next.kind === drop.kind && next.pos === drop.pos);
		if (!same) {
			drop = next;
			show(view, { source, drop, height });
		}
		ghost.dataset.side = drop && drop.kind !== "gap" ? "true" : "";
		const label = ghost.querySelector(".pb-drag-ghost__label");
		if (label) label.textContent = drop && drop.kind !== "gap" ? "Side by side" : "";
	};

	// Scroll when the pointer is held near the top or bottom of the window.
	const tick = () => {
		if (!dragging) return;
		const top = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pb-ribbon-h")) || 52) + 18;
		const bottom = window.innerHeight - 50;
		scroll = y < top ? -Math.ceil((top - y) / 4) : y > bottom ? Math.ceil((y - bottom) / 4) : 0;
		if (scroll) {
			window.scrollBy(0, scroll);
			place();
		}
		requestAnimationFrame(tick);
	};

	const onMove = (e: PointerEvent) => {
		x = e.clientX;
		y = e.clientY;
		if (!dragging && Math.hypot(x - startX, y - startY) > 4) begin();
		if (dragging) place();
	};

	const end = (commit: boolean) => {
		window.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", onUp);
		window.removeEventListener("keydown", onKey, true);
		if (!dragging) {
			if (commit) onClick();
			return;
		}
		dragging = false;
		ghost?.remove();
		document.documentElement.classList.remove("pb-dragging");
		show(view, idle);
		if (commit && drop) moveTo(editor, source, drop);
	};
	const onUp = () => end(true);
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		e.preventDefault();
		e.stopPropagation();
		end(false);
	};

	window.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", onUp);
	window.addEventListener("keydown", onKey, true);
}
