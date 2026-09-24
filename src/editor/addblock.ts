/**
 * Adding blocks without hunting for a handle: an "Add block" row at the end
 * of every container (a section, a column, a card, an answer, a layer) and
 * of the page. Clicking one adds an empty line there and opens the insert
 * menu on it.
 */
import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** Containers of free-form blocks, which get an "Add block" row at their end. */
export const BLOCK_CONTAINERS = ["pbSection", "pbColumn", "pbCard", "pbAccordionBody", "pbLayer"];

const key = new PluginKey("pbAddBlock");

function addRow(pos: number, onAdd: (pos: number, at: DOMRect) => void, label: string) {
	return Decoration.widget(
		pos,
		() => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "pb-add-row";
			button.contentEditable = "false";
			button.textContent = `+ ${label}`;
			button.title = "Add a block here";
			button.addEventListener("mousedown", (e) => e.preventDefault());
			button.addEventListener("click", (e) => {
				e.preventDefault();
				onAdd(pos, button.getBoundingClientRect());
			});
			return button;
		},
		{ side: 1, key: `add-${pos}-${label}`, ignoreSelection: true, stopEvent: () => true },
	);
}

export function addBlockRows(onAdd: (pos: number, at: DOMRect) => void) {
	return Extension.create({
		name: "pbAddBlockRows",
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key,
					props: {
						decorations(state) {
							const decos: Decoration[] = [];
							state.doc.descendants((node: PMNode, pos: number) => {
								if (BLOCK_CONTAINERS.includes(node.type.name)) decos.push(addRow(pos + node.nodeSize - 1, onAdd, "Add block"));
								return true;
							});
							decos.push(addRow(state.doc.content.size, onAdd, "Add block to the page"));
							return DecorationSet.create(state.doc, decos);
						},
					},
				}),
			];
		},
	});
}

/**
 * Put an empty line at `pos` (between blocks, or at a container's end) with
 * the cursor in it, and return where it is on screen, for the insert menu.
 * A container that already ends in an empty line gets the cursor there.
 */
export function openLineAt(editor: Editor, pos: number): DOMRect | null {
	const { state, view } = editor;
	const $pos = state.doc.resolve(pos);
	const before = $pos.nodeBefore;
	let at: number;
	if (before?.type.name === "paragraph" && before.content.size === 0 && $pos.index() === $pos.parent.childCount) {
		at = pos - before.nodeSize;
		view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, at + 1)).scrollIntoView());
	} else {
		const paragraph = state.schema.nodes.paragraph.create();
		if (!$pos.parent.canReplaceWith($pos.index(), $pos.index(), paragraph.type)) return null;
		const tr = state.tr.insert(pos, paragraph);
		at = pos;
		view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
	}
	view.focus();
	const dom = view.nodeDOM(at);
	return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
}
