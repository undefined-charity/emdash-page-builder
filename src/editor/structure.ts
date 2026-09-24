/**
 * Working with the block tree: which blocks enclose the cursor, and moving,
 * duplicating, deleting and restyling one of them.
 */
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface BlockRef {
	node: PMNode;
	pos: number;
	depth: number;
}

const LABELS: Record<string, string> = {
	paragraph: "Text",
	heading: "Heading",
	blockquote: "Quote",
	bulletList: "Bulleted list",
	orderedList: "Numbered list",
	listItem: "List item",
	horizontalRule: "Divider",
	pbSection: "Section",
	pbColumns: "Columns",
	pbColumn: "Column",
	pbImage: "Image",
	pbButtons: "Buttons",
	pbButton: "Button",
	pbCards: "Cards",
	pbCard: "Card",
	pbAccordion: "FAQ / accordion",
	pbAccordionItem: "Question",
	pbAccordionSummary: "Question title",
	pbAccordionBody: "Answer",
	pbSpacer: "Spacer",
	pbStack: "Layers",
	pbVideo: "Video",
	pbGallery: "Gallery",
	pbMap: "Map",
	pbEmbed: "Embed",
	pbShape: "Shape",
	pbLayer: "Layer",
	pbReusable: "Shared block",
	pbExternal: "Site block",
};

export function blockLabel(node: PMNode, externalLabel?: (type: string) => string | undefined): string {
	if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
	if (node.type.name === "pbExternal") return externalLabel?.(node.attrs.blockType) ?? node.attrs.blockType;
	return LABELS[node.type.name] ?? node.type.name;
}

/** Enclosing blocks from outermost to innermost (plus a selected atom). */
export function ancestry(editor: Editor): BlockRef[] {
	const { selection } = editor.state;
	const $from = selection.$from;
	const out: BlockRef[] = [];
	for (let d = 1; d <= $from.depth; d++) {
		const node = $from.node(d);
		// Skip the invisible wrappers that are never worth selecting on their own.
		if (node.type.name === "listItem" || node.type.name === "pbAccordionBody") continue;
		out.push({ node, pos: $from.before(d), depth: d });
	}
	if (selection instanceof NodeSelection) {
		out.push({ node: selection.node, pos: selection.from, depth: $from.depth + 1 });
	}
	return out;
}

/** Re-read a block after the document changed, by position. */
export function refresh(editor: Editor, ref: BlockRef): BlockRef | null {
	const node = editor.state.doc.nodeAt(ref.pos);
	return node && node.type === ref.node.type ? { ...ref, node } : null;
}

export function setAttrs(editor: Editor, ref: BlockRef, patch: Record<string, unknown>) {
	const node = editor.state.doc.nodeAt(ref.pos);
	if (!node) return;
	editor.view.dispatch(editor.state.tr.setNodeMarkup(ref.pos, undefined, { ...node.attrs, ...patch }));
}

export function move(editor: Editor, ref: BlockRef, dir: -1 | 1): number | null {
	const { state } = editor;
	const $pos = state.doc.resolve(ref.pos);
	const parent = $pos.parent;
	const index = $pos.index();
	const target = index + dir;
	if (target < 0 || target >= parent.childCount) return null;
	const node = parent.child(index);
	const sibling = parent.child(target);
	let tr = state.tr;
	if (dir === -1) {
		const siblingPos = ref.pos - sibling.nodeSize;
		tr = tr.delete(ref.pos, ref.pos + node.nodeSize).insert(siblingPos, node);
		editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, siblingPos)));
		return siblingPos;
	}
	const after = ref.pos + node.nodeSize + sibling.nodeSize;
	tr = tr.insert(after, node).delete(ref.pos, ref.pos + node.nodeSize);
	const newPos = ref.pos + sibling.nodeSize;
	editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, newPos)));
	return newPos;
}

export function duplicate(editor: Editor, ref: BlockRef) {
	const node = editor.state.doc.nodeAt(ref.pos);
	if (!node) return;
	const at = ref.pos + node.nodeSize;
	const copy = node.type.create(
		// External/reusable blocks are keyed; a copy needs its own key.
		"key" in node.attrs ? { ...node.attrs, key: Math.random().toString(36).slice(2, 14) } : node.attrs,
		node.content,
		node.marks,
	);
	const tr = editor.state.tr.insert(at, copy);
	editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)));
}

export function remove(editor: Editor, ref: BlockRef) {
	const node = editor.state.doc.nodeAt(ref.pos);
	if (!node) return;
	editor.chain().focus().deleteRange({ from: ref.pos, to: ref.pos + node.nodeSize }).run();
}

export function selectBlock(editor: Editor, pos: number) {
	const node = editor.state.doc.nodeAt(pos);
	if (!node) return;
	if (node.isTextblock) editor.chain().focus().setTextSelection(pos + 1).run();
	else editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
}

/** Append a child built from JSON to a container block. */
export function appendChild(editor: Editor, ref: BlockRef, json: Record<string, unknown>) {
	const node = editor.state.doc.nodeAt(ref.pos);
	if (!node) return;
	const child = editor.schema.nodeFromJSON(json);
	editor.view.dispatch(editor.state.tr.insert(ref.pos + node.nodeSize - 1, child));
}

/** Remove the last child of a container, keeping at least `min`. */
export function removeLastChild(editor: Editor, ref: BlockRef, min: number) {
	const node = editor.state.doc.nodeAt(ref.pos);
	if (!node || node.childCount <= min) return;
	const last = node.lastChild!;
	const end = ref.pos + node.nodeSize - 1;
	editor.view.dispatch(editor.state.tr.delete(end - last.nodeSize, end));
}
