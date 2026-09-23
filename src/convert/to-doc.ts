/**
 * Portable Text → editor document.
 *
 * Text blocks follow EmDash's own converter (list runs, blockquote runs,
 * `textAlign`), so content written in the admin opens here unchanged. The
 * builder's containers are Portable Text types holding nested block arrays.
 * Anything else becomes an external block, kept verbatim for the server
 * renderer.
 */
import { findTextStyle, headingLevelOf, type BuilderConfig } from "../schema/config.js";
import { cleanBlockStyle, cleanHide, cleanPhoneStyle, safeColor, safeFont, safeLength } from "../schema/style.js";
import { isTextBlock, newKey, type JSONContent, type PTBlock, type PTMarkDef, type PTSpan, type PTTextBlock } from "./types.js";

const EMPTY_PARAGRAPH: JSONContent = { type: "paragraph" };

function arr(value: unknown): PTBlock[] {
	return Array.isArray(value) ? (value.filter((b) => b && typeof b === "object") as PTBlock[]) : [];
}

/** `{ pbHide }` for a block hidden on phones or desktops, or nothing. */
function hideAttr(b: Record<string, unknown> | undefined): { pbHide?: string } {
	const hide = cleanHide(b?.pbHide);
	return hide ? { pbHide: hide } : {};
}

/** Style, phone style and hiding attrs for a block, or nothing — keeps unstyled documents lean. */
function styleAttr(b: Record<string, unknown> | undefined): { pbStyle?: object; pbStylePhone?: object; pbHide?: string } {
	const style = cleanBlockStyle(b?.pbStyle);
	const phone = cleanPhoneStyle(b?.pbStylePhone);
	return { ...(style ? { pbStyle: style } : {}), ...(phone ? { pbStylePhone: phone } : {}), ...hideAttr(b) };
}

/** Lists and quotes are runs of blocks; the first one carries the whole run's style. */
function withRunStyle(node: JSONContent, first: PTBlock): JSONContent {
	const attrs = styleAttr(first);
	return Object.keys(attrs).length ? { ...node, attrs: { ...node.attrs, ...attrs } } : node;
}

function nonEmpty(nodes: JSONContent[]): JSONContent[] {
	return nodes.length > 0 ? nodes : [EMPTY_PARAGRAPH];
}

function convertMarks(marks: string[], defs: Map<string, PTMarkDef>) {
	const out: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
	for (const m of marks) {
		switch (m) {
			case "strong":
				out.push({ type: "bold" });
				break;
			case "em":
				out.push({ type: "italic" });
				break;
			case "underline":
				out.push({ type: "underline" });
				break;
			case "strike-through":
				out.push({ type: "strike" });
				break;
			default: {
				const def = defs.get(m);
				if (def?._type === "link" && typeof def.href === "string") {
					out.push({ type: "link", attrs: { href: def.href, target: def.blank ? "_blank" : null } });
				} else if (def?._type === "textStyle") {
					out.push({
						type: "textStyle",
						attrs: {
							color: safeColor(def.color) ?? null,
							backgroundColor: safeColor(def.backgroundColor) ?? null,
							fontSize: safeLength(def.fontSize) ?? null,
							fontFamily: safeFont(def.fontFamily) ?? null,
						},
					});
				}
			}
		}
	}
	return out;
}

export function spansToInline(children: PTSpan[] | undefined, markDefs: PTMarkDef[] = []): JSONContent[] {
	const defs = new Map(markDefs.map((d) => [d._key, d]));
	const nodes: JSONContent[] = [];
	for (const span of children ?? []) {
		if (span?._type !== "span" || typeof span.text !== "string") continue;
		const marks = convertMarks(span.marks ?? [], defs);
		span.text.split("\n").forEach((part, i, all) => {
			if (part) nodes.push(marks.length ? { type: "text", text: part, marks } : { type: "text", text: part });
			if (i < all.length - 1) nodes.push({ type: "hardBreak" });
		});
	}
	return nodes;
}

/** Plain-text inline content (button labels, accordion titles) — no marks. */
function plainText(text: unknown): JSONContent[] {
	const t = typeof text === "string" ? text : "";
	return t ? [{ type: "text", text: t }] : [];
}

function textBlock(block: PTTextBlock, config: BuilderConfig): JSONContent {
	const content = spansToInline(block.children, block.markDefs);
	const align = {
		...(block.textAlign && block.textAlign !== "left" ? { textAlign: block.textAlign } : {}),
		...styleAttr(block as unknown as Record<string, unknown>),
	};
	const style = block.style ?? "normal";
	const named = findTextStyle(config, style);
	if (named) {
		const level = headingLevelOf(named.tag);
		return level
			? { type: "heading", attrs: { level, textStyle: named.name, ...align }, content }
			: { type: "paragraph", attrs: { textStyle: named.name, ...align }, content };
	}
	const m = /^h([1-6])$/.exec(style);
	if (m) return { type: "heading", attrs: { level: Math.min(Number(m[1]), 4), ...align }, content };
	return { type: "paragraph", attrs: { ...align }, content };
}

function listRun(items: PTTextBlock[], type: "bullet" | "number"): JSONContent {
	const children: JSONContent[] = [];
	let i = 0;
	while (i < items.length) {
		const item = items[i];
		const nested: PTTextBlock[] = [];
		i++;
		while (i < items.length && (items[i].level ?? 1) > (item.level ?? 1)) nested.push(items[i++]);
		const content: JSONContent[] = [{ type: "paragraph", content: spansToInline(item.children, item.markDefs) }];
		if (nested.length) {
			const base = nested[0].level ?? 2;
			const adjusted = nested.map((n) => ({ ...n, level: (n.level ?? base) - (base - 1) }));
			content.push(listRun(adjusted, nested[0].listItem ?? type));
		}
		children.push({ type: "listItem", content });
	}
	return { type: type === "bullet" ? "bulletList" : "orderedList", content: children };
}

function imageNode(b: PTBlock): JSONContent {
	const asset = (b.asset ?? {}) as { _ref?: string; url?: string; provider?: string };
	const src = asset.url || (typeof b.url === "string" ? b.url : "") || (asset._ref ? `/_emdash/api/media/file/${asset._ref}` : "");
	const align = typeof b.alignment === "string" ? (b.alignment === "full" ? "wide" : b.alignment) : "none";
	return {
		type: "pbImage",
		attrs: {
			src,
			mediaId: asset._ref ?? null,
			provider: asset.provider ?? null,
			alt: typeof b.alt === "string" ? b.alt : "",
			caption: typeof b.caption === "string" ? b.caption : "",
			width: typeof b.width === "number" ? b.width : null,
			height: typeof b.height === "number" ? b.height : null,
			align,
			displayWidth: typeof b.displayWidth === "number" ? b.displayWidth : null,
			link: typeof b.link === "string" ? b.link : "",
			...styleAttr(b),
		},
	};
}

function convertOne(b: PTBlock, config: BuilderConfig): JSONContent {
	switch (b._type) {
		case "image":
			return imageNode(b);
		case "break": {
			const attrs = hideAttr(b);
			return Object.keys(attrs).length ? { type: "horizontalRule", attrs } : { type: "horizontalRule" };
		}
		case "buttons": {
			const buttons = Array.isArray(b.buttons) ? (b.buttons as Array<Record<string, unknown>>) : [];
			return {
				type: "pbButtons",
				attrs: { align: typeof b.align === "string" ? b.align : "left", ...styleAttr(b) },
				content: (buttons.length ? buttons : [{ text: "Button", url: "" }]).map((btn) => ({
					type: "pbButton",
					attrs: {
						href: typeof btn.url === "string" ? btn.url : "",
						// Core `buttons` blocks use fill/outline/default; the builder's own use style names.
						variant:
							typeof btn.variant === "string"
								? btn.variant
								: btn.style === "fill" || btn.style === "default"
									? config.buttonStyles[0]?.name
									: (config.buttonStyles[1]?.name ?? config.buttonStyles[0]?.name),
						newTab: btn.newTab === true,
					},
					content: plainText(btn.text),
				})),
			};
		}
		case "pb.section":
			return {
				type: "pbSection",
				attrs: { ...(typeof b.variant === "string" ? { variant: b.variant } : {}), ...styleAttr(b) },
				content: nonEmpty(blocksToNodes(arr(b.content), config)) };
		case "pb.columns": {
			const cols = Array.isArray(b.columns) ? (b.columns as Array<Record<string, unknown>>) : [];
			const safe = (cols.length >= 2 ? cols : [...cols, {}, {}]).slice(0, 4);
			return {
				type: "pbColumns",
				attrs: { ratio: typeof b.ratio === "string" ? b.ratio : "equal", ...styleAttr(b) },
				content: safe.map((c) => ({ type: "pbColumn", attrs: styleAttr(c), content: nonEmpty(blocksToNodes(arr(c.content), config)) })),
			};
		}
		case "pb.cards": {
			const cards = Array.isArray(b.cards) ? (b.cards as Array<Record<string, unknown>>) : [];
			return {
				type: "pbCards",
				attrs: styleAttr(b),
				content: (cards.length ? cards : [{}]).map((c) => ({ type: "pbCard", attrs: styleAttr(c), content: nonEmpty(blocksToNodes(arr(c.content), config)) })),
			};
		}
		case "pb.accordion": {
			const items = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : [];
			return {
				type: "pbAccordion",
				attrs: styleAttr(b),
				content: (items.length ? items : [{}]).map((it) => ({
					type: "pbAccordionItem",
					attrs: { open: it.open === true, ...styleAttr(it) },
					content: [
						{ type: "pbAccordionSummary", content: plainText(it.summary) },
						{ type: "pbAccordionBody", content: nonEmpty(blocksToNodes(arr(it.content), config)) },
					],
				})),
			};
		}
		case "pb.stack": {
			const layers = Array.isArray(b.layers) ? (b.layers as Array<Record<string, unknown>>) : [];
			return {
				type: "pbStack",
				attrs: { phoneFlow: b.phoneFlow === true, ...styleAttr(b) },
				content: (layers.length ? layers : [{}]).map((l) => ({
					type: "pbLayer",
					attrs: {
						valign: typeof l.valign === "string" ? l.valign : "start",
						halign: typeof l.halign === "string" ? l.halign : "stretch",
						...styleAttr(l),
					},
					content: nonEmpty(blocksToNodes(arr(l.content), config)),
				})),
			};
		}
		case "pb.spacer":
			return { type: "pbSpacer", attrs: { size: typeof b.size === "string" ? b.size : "m", ...hideAttr(b) } };
		case "pb.reusable":
			return { type: "pbReusable", attrs: { ref: b.ref ?? "", title: b.title ?? "", key: b._key ?? newKey(), ...hideAttr(b) } };
		default: {
			const { _type, _key, pbHide, ...data } = b;
			return { type: "pbExternal", attrs: { blockType: _type, key: _key ?? newKey(), data, ...hideAttr({ pbHide }) } };
		}
	}
}

export function blocksToNodes(blocks: PTBlock[], config: BuilderConfig): JSONContent[] {
	const out: JSONContent[] = [];
	let i = 0;
	while (i < blocks.length) {
		const b = blocks[i];
		if (isTextBlock(b) && b.listItem) {
			const run: PTTextBlock[] = [];
			const type = b.listItem;
			while (i < blocks.length) {
				const cur = blocks[i];
				if (!isTextBlock(cur) || !cur.listItem) break;
				if ((cur.level ?? 1) > 1 || cur.listItem === type) {
					run.push(cur);
					i++;
				} else break;
			}
			out.push(withRunStyle(listRun(run, type), run[0]));
		} else if (isTextBlock(b) && b.style === "blockquote") {
			const paragraphs: JSONContent[] = [];
			const first = b;
			while (i < blocks.length && isTextBlock(blocks[i]) && blocks[i].style === "blockquote" && !(blocks[i] as PTTextBlock).listItem) {
				const q = blocks[i++] as PTTextBlock;
				paragraphs.push({ type: "paragraph", content: spansToInline(q.children, q.markDefs) });
			}
			out.push(withRunStyle({ type: "blockquote", content: paragraphs }, first));
		} else if (isTextBlock(b)) {
			out.push(textBlock(b, config));
			i++;
		} else {
			out.push(convertOne(b, config));
			i++;
		}
	}
	return out;
}

export function portableTextToDoc(value: unknown, config: BuilderConfig): JSONContent {
	return { type: "doc", content: nonEmpty(blocksToNodes(arr(value), config)) };
}
