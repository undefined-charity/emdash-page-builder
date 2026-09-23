/**
 * Server rendering: stored Portable Text → HTML through the same node
 * definitions the editor uses. Blocks the site renders itself (external blocks
 * and reusable blocks) come back as slots; the Astro component renders them
 * between the HTML parts.
 */
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";

import { portableTextToDoc } from "../convert/to-doc.js";
import type { JSONContent, PTBlock } from "../convert/types.js";
import type { BuilderConfig } from "../schema/config.js";
import { builderExtensions } from "../schema/extensions.js";

export type Slot =
	| { kind: "external"; key: string; block: PTBlock }
	| { kind: "reusable"; key: string; ref: string; title: string };

export interface RenderedDocument {
	/** HTML fragments; `slots[i]` goes between `parts[i]` and `parts[i + 1]`. */
	parts: string[];
	slots: Slot[];
}

const MARKER = (i: number) => `<!--pb-slot:${i}-->`;
const MARKER_RE = /<!--pb-slot:(\d+)-->/;

const extensionCache = new WeakMap<BuilderConfig, ReturnType<typeof builderExtensions>>();
function extensionsFor(config: BuilderConfig) {
	let ext = extensionCache.get(config);
	if (!ext) {
		ext = builderExtensions(config);
		extensionCache.set(config, ext);
	}
	return ext;
}

export function renderDocument(value: unknown, config: BuilderConfig): RenderedDocument {
	const doc = portableTextToDoc(value, config);
	const slots: Slot[] = [];

	// Collect slots in document order and swap each for a marker node the
	// renderer emits verbatim.
	const walk = (node: JSONContent): JSONContent => {
		if (node.type === "pbExternal") {
			const a = node.attrs ?? {};
			slots.push({ kind: "external", key: a.key, block: { ...(a.data ?? {}), _type: a.blockType, _key: a.key } });
			return { type: "pbSlotMarker", attrs: { index: slots.length - 1 } };
		}
		if (node.type === "pbReusable") {
			const a = node.attrs ?? {};
			slots.push({ kind: "reusable", key: a.key, ref: a.ref, title: a.title });
			return { type: "pbSlotMarker", attrs: { index: slots.length - 1 } };
		}
		return node.content ? { ...node, content: node.content.map(walk) } : node;
	};
	const withMarkers = walk(doc);

	const html = renderToHTMLString({
		content: withMarkers,
		extensions: [...extensionsFor(config), SlotMarker],
		options: {
			nodeMapping: {
				pbSlotMarker: ({ node }) => MARKER(node.attrs.index as number),
			},
		},
	});

	const parts: string[] = [];
	let rest = html;
	for (let i = 0; i < slots.length; i++) {
		const m = MARKER(i);
		const at = rest.indexOf(m);
		if (at === -1) break;
		parts.push(rest.slice(0, at));
		rest = rest.slice(at + m.length);
	}
	parts.push(rest.replace(new RegExp(MARKER_RE, "g"), ""));
	return { parts, slots };
}

import { Node } from "@tiptap/core";
const SlotMarker = Node.create({
	name: "pbSlotMarker",
	group: "block",
	atom: true,
	addAttributes: () => ({ index: { default: 0 } }),
	renderHTML: () => ["div"],
});
