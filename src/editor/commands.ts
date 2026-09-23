/**
 * Everything an editor can insert — one list drives the `/` menu, the Insert
 * menu on the toolbar and the "+" between blocks, so they can't drift apart.
 */
import { Extension, type Editor, type Range } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";

import { newKey } from "../convert/types.js";
import type { BuilderConfig, ExternalBlock } from "../schema/config.js";
import { defaultSectionStyle } from "../schema/config.js";

export interface InsertContext {
	config: BuilderConfig;
	openMedia: (onPick: (media: JSONContent["attrs"]) => void, accept?: "image" | "video") => void;
	openMediaMany: (onPick: (images: Array<Record<string, unknown>>) => void) => void;
	openReusable: () => void;
}

export interface InsertItem {
	id: string;
	label: string;
	category: string;
	icon: string;
	description?: string;
	keywords?: string[];
	run: (editor: Editor, ctx: InsertContext) => void;
}

const p = (text = ""): JSONContent => (text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" });
const h = (level: number, text: string): JSONContent => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

/** Insert a block at the cursor, or after the selected block (never replacing it). */
function insertBlock(editor: Editor, node: JSONContent) {
	const { selection } = editor.state;
	if (selection instanceof NodeSelection) editor.chain().focus().insertContentAt(selection.to, node).run();
	else editor.chain().focus().insertContent(node).run();
}

/** Insert a block and select it, so the side panel shows its settings. */
function insertAndSelect(editor: Editor, node: JSONContent) {
	const { selection } = editor.state;
	if (selection instanceof NodeSelection) {
		const at = selection.to;
		editor.chain().focus().insertContentAt(at, node).setNodeSelection(at).run();
		return;
	}
	insertBlock(editor, node);
	const { $from } = editor.state.selection;
	const before = $from.nodeBefore;
	if (before && before.type.name === node.type) editor.commands.setNodeSelection($from.pos - before.nodeSize);
}

export function externalNode(block: ExternalBlock): JSONContent {
	return { type: "pbExternal", attrs: { blockType: block.type, key: newKey(), data: { ...(block.initial ?? {}) } } };
}

export function insertItems(config: BuilderConfig): InsertItem[] {
	const textStyleItems: InsertItem[] = config.textStyles.map((style) => ({
		id: `style:${style.name}`,
		label: style.label,
		category: "Text",
		icon: style.tag.startsWith("h") ? "H" : "¶",
		description: `${style.label} text style`,
		run: (editor) => {
			const level = style.tag.startsWith("h") ? Number(style.tag.slice(1)) : null;
			const chain = editor.chain().focus();
			(level ? chain.setNode("heading", { level, textStyle: style.name }) : chain.setNode("paragraph", { textStyle: style.name })).run();
		},
	}));

	const items: InsertItem[] = [
		{
			id: "paragraph",
			label: "Text",
			category: "Text",
			icon: "¶",
			description: "Plain paragraph",
			keywords: ["paragraph", "body", "normal"],
			run: (e) => e.chain().focus().setNode("paragraph", { textStyle: null }).run(),
		},
		...[1, 2, 3].map(
			(level): InsertItem => ({
				id: `h${level}`,
				label: `Heading ${level}`,
				category: "Text",
				icon: `H${level}`,
				keywords: ["title", "heading"],
				run: (e) => e.chain().focus().setNode("heading", { level, textStyle: null }).run(),
			}),
		),
		...textStyleItems,
		{
			id: "bullets",
			label: "Bulleted list",
			category: "Text",
			icon: "•",
			keywords: ["list", "ul"],
			run: (e) => e.chain().focus().toggleBulletList().run(),
		},
		{
			id: "numbers",
			label: "Numbered list",
			category: "Text",
			icon: "1.",
			keywords: ["list", "ol", "ordered"],
			run: (e) => e.chain().focus().toggleOrderedList().run(),
		},
		{
			id: "quote",
			label: "Quote",
			category: "Text",
			icon: "❝",
			keywords: ["blockquote", "pullquote"],
			run: (e) => e.chain().focus().toggleBlockquote().run(),
		},
		{
			id: "image",
			label: "Image",
			category: "Media",
			icon: "🖼",
			description: "Upload or pick from the media library; float left or right to wrap text",
			keywords: ["photo", "picture", "media"],
			run: (e, ctx) => ctx.openMedia((attrs) => insertBlock(e, { type: "pbImage", attrs })),
		},
		{
			id: "image-left",
			label: "Image with text wrapping (left)",
			category: "Media",
			icon: "⇤",
			keywords: ["float", "wrap", "photo"],
			run: (e, ctx) => ctx.openMedia((attrs) => insertBlock(e, { type: "pbImage", attrs: { ...attrs, align: "left", displayWidth: 320 } })),
		},
		{
			id: "image-right",
			label: "Image with text wrapping (right)",
			category: "Media",
			icon: "⇥",
			keywords: ["float", "wrap", "photo"],
			run: (e, ctx) => ctx.openMedia((attrs) => insertBlock(e, { type: "pbImage", attrs: { ...attrs, align: "right", displayWidth: 320 } })),
		},
		{
			id: "video",
			label: "Video",
			category: "Media",
			icon: "▶",
			description: "A YouTube or Vimeo link, or an uploaded video",
			keywords: ["youtube", "vimeo", "movie", "clip", "film", "mp4"],
			run: (e) => insertAndSelect(e, { type: "pbVideo", attrs: { src: "" } }),
		},
		{
			id: "gallery",
			label: "Gallery or slideshow",
			category: "Media",
			icon: "▦",
			description: "Several images as a grid, a masonry wall or a swipeable slideshow",
			keywords: ["photos", "images", "carousel", "slider", "lightbox", "masonry", "grid"],
			run: (e, ctx) =>
				ctx.openMediaMany((images) =>
					insertAndSelect(e, {
						type: "pbGallery",
						attrs: { images: images.map((i) => ({ src: i.src, mediaId: i.mediaId, alt: i.alt, width: i.width, height: i.height })), layout: "grid", columns: 3, key: newKey() },
					}),
				),
		},
		{
			id: "section",
			label: "Section",
			category: "Layout",
			icon: "▭",
			description: "A band of the page with its own look — background, spacing, colours",
			keywords: ["container", "band", "strip", "background"],
			run: (e) =>
				insertBlock(e, {
					type: "pbSection",
					attrs: { variant: defaultSectionStyle(config)?.name },
					content: [h(2, "Section heading"), p("Write something…")],
				}),
		},
		...[2, 3].map(
			(n): InsertItem => ({
				id: `columns-${n}`,
				label: `${n} columns`,
				category: "Layout",
				icon: n === 2 ? "▥" : "▦",
				keywords: ["columns", "grid", "side by side"],
				run: (e) => insertBlock(e, { type: "pbColumns", content: Array.from({ length: n }, () => ({ type: "pbColumn", content: [p()] })) }),
			}),
		),
		{
			id: "cards",
			label: "Cards",
			category: "Layout",
			icon: "▤",
			description: "A grid of boxes, each with its own heading and text",
			keywords: ["tiles", "features", "grid", "highlights"],
			run: (e) =>
				insertBlock(e, {
					type: "pbCards",
					content: [1, 2, 3].map((i) => ({ type: "pbCard", content: [h(3, `Card ${i}`), p("Describe it.")] })),
				}),
		},
		{
			id: "layers",
			label: "Layers (text over an image)",
			category: "Layout",
			icon: "◰",
			description: "Blocks on top of each other: pick a background image, then write over it",
			keywords: ["stack", "overlay", "overlap", "hero", "banner", "text over image", "layer"],
			run: (e, ctx) =>
				ctx.openMedia((attrs) =>
					insertBlock(e, {
						type: "pbStack",
						attrs: { phoneFlow: false },
						content: [
							{ type: "pbLayer", content: [{ type: "pbImage", attrs: { ...attrs, align: "wide" } }] },
							{ type: "pbLayer", attrs: { valign: "center", halign: "center" }, content: [h(2, "Headline"), p("Write over the image.")] },
						],
					}),
				),
		},
		{
			id: "accordion",
			label: "FAQ / accordion",
			category: "Layout",
			icon: "☰",
			description: "Questions that expand to show their answer",
			keywords: ["faq", "questions", "collapse", "details", "toggle"],
			run: (e) =>
				insertBlock(e, {
					type: "pbAccordion",
					content: [1, 2].map((i) => ({
						type: "pbAccordionItem",
						content: [
							{ type: "pbAccordionSummary", content: [{ type: "text", text: `Question ${i}?` }] },
							{ type: "pbAccordionBody", content: [p("The answer.")] },
						],
					})),
				}),
		},
		{
			id: "buttons",
			label: "Buttons",
			category: "Layout",
			icon: "⬭",
			keywords: ["cta", "link", "call to action"],
			run: (e) =>
				insertBlock(e, {
					type: "pbButtons",
					content: [{ type: "pbButton", attrs: { href: "", variant: config.buttonStyles[0]?.name }, content: [{ type: "text", text: "Button" }] }],
				}),
		},
		{
			id: "divider",
			label: "Divider",
			category: "Layout",
			icon: "—",
			keywords: ["hr", "line", "rule", "separator"],
			run: (e) => e.chain().focus().setHorizontalRule().run(),
		},
		{
			id: "spacer",
			label: "Spacer",
			category: "Layout",
			icon: "↕",
			keywords: ["space", "gap", "padding"],
			run: (e) => insertBlock(e, { type: "pbSpacer", attrs: { size: "m" } }),
		},
		...config.externalBlocks.map(
			(block): InsertItem => ({
				id: `external:${block.type}`,
				label: block.label,
				category: block.category ?? "Site",
				icon: block.icon ?? "◆",
				description: block.description,
				keywords: [block.type],
				run: (e) => insertBlock(e, externalNode(block)),
			}),
		),
		{
			id: "reusable",
			label: "Reusable block…",
			category: "Reusable",
			icon: "♻",
			description: "Insert a shared block — edit it once, it changes everywhere",
			keywords: ["shared", "global", "snippet", "synced", "template"],
			run: (_e, ctx) => ctx.openReusable(),
		},
	];
	return items;
}

export function filterItems(items: InsertItem[], query: string): InsertItem[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter((it) => [it.label, it.category, ...(it.keywords ?? [])].some((s) => s.toLowerCase().includes(q)));
}

// ── Slash menu ────────────────────────────────────────────────────────────────

export interface SlashState {
	open: boolean;
	items: InsertItem[];
	index: number;
	rect: DOMRect | null;
	range: Range | null;
}

export const closedSlash: SlashState = { open: false, items: [], index: 0, rect: null, range: null };

export function slashExtension(options: {
	items: () => InsertItem[];
	getState: () => SlashState;
	setState: (s: SlashState) => void;
	choose: (item: InsertItem, range: Range) => void;
}) {
	return Extension.create({
		name: "pbSlash",
		addProseMirrorPlugins() {
			return [
				Suggestion<InsertItem>({
					editor: this.editor,
					char: "/",
					startOfLine: true,
					items: ({ query }) => filterItems(options.items(), query).slice(0, 40),
					command: ({ range, props }) => options.choose(props, range),
					render: () => ({
						// Filter here rather than trusting props.items, which TipTap 3
						// resolves separately and can hand onStart empty.
						onStart: (props: SuggestionProps<InsertItem>) =>
							options.setState({
								open: true,
								items: filterItems(options.items(), props.query).slice(0, 40),
								index: 0,
								rect: props.clientRect?.() ?? null,
								range: props.range,
							}),
						onUpdate: (props: SuggestionProps<InsertItem>) =>
							options.setState({
								...options.getState(),
								open: true,
								items: filterItems(options.items(), props.query).slice(0, 40),
								index: 0,
								rect: props.clientRect?.() ?? null,
								range: props.range,
							}),
						onExit: () => options.setState(closedSlash),
						onKeyDown: ({ event }) => {
							const s = options.getState();
							if (!s.open || s.items.length === 0) return false;
							if (event.key === "ArrowDown") {
								options.setState({ ...s, index: (s.index + 1) % s.items.length });
								return true;
							}
							if (event.key === "ArrowUp") {
								options.setState({ ...s, index: (s.index - 1 + s.items.length) % s.items.length });
								return true;
							}
							if (event.key === "Enter" || event.key === "Tab") {
								const item = s.items[s.index];
								if (item && s.range) options.choose(item, s.range);
								return true;
							}
							if (event.key === "Escape") {
								options.setState(closedSlash);
								return true;
							}
							return false;
						},
					}),
				}),
			];
		},
	});
}
