/**
 * Editor document → Portable Text. The inverse of `to-doc.ts`; the two must
 * round-trip (see tests/convert.test.ts).
 */
import { findTextStyle, type BuilderConfig } from "../schema/config.js";
import { cleanBlockStyle } from "../schema/style.js";
import { newKey, type JSONContent, type PTBlock, type PTMarkDef, type PTSpan, type PTTextBlock } from "./types.js";

function styleOf(attrs: Record<string, unknown> | undefined): { pbStyle?: object } {
	const style = cleanBlockStyle(attrs?.pbStyle);
	return style ? { pbStyle: style } : {};
}

const MARKS: Record<string, string> = { bold: "strong", italic: "em", underline: "underline", strike: "strike-through" };

function inlineToSpans(content: JSONContent[] | undefined): { children: PTSpan[]; markDefs: PTMarkDef[] } {
	const children: PTSpan[] = [];
	const markDefs: PTMarkDef[] = [];
	const defKeys = new Map<string, string>();
	const defKey = (id: string, make: (key: string) => PTMarkDef) => {
		let key = defKeys.get(id);
		if (!key) {
			key = newKey();
			defKeys.set(id, key);
			markDefs.push(make(key));
		}
		return key;
	};

	const push = (text: string, marks: string[]) => {
		const last = children[children.length - 1];
		// Merge adjacent spans with identical marks — keeps stored content tidy.
		if (last && last.marks?.join("|") === marks.join("|")) last.text += text;
		else children.push({ _type: "span", _key: newKey(), text, marks });
	};

	for (const node of content ?? []) {
		if (node.type === "hardBreak") {
			push("\n", children[children.length - 1]?.marks ?? []);
			continue;
		}
		if (node.type !== "text" || !node.text) continue;
		const marks: string[] = [];
		for (const mark of node.marks ?? []) {
			if (MARKS[mark.type]) marks.push(MARKS[mark.type]);
			else if (mark.type === "link" && typeof mark.attrs?.href === "string") {
				const href = mark.attrs.href as string;
				const blank = mark.attrs?.target === "_blank";
				marks.push(defKey(`link|${href}|${blank}`, (_key) => ({ _type: "link", _key, href, ...(blank ? { blank: true } : {}) })));
			} else if (mark.type === "textStyle") {
				const a = mark.attrs ?? {};
				const props: Record<string, string> = {};
				for (const k of ["color", "backgroundColor", "fontSize", "fontFamily"]) if (typeof a[k] === "string" && a[k]) props[k] = a[k];
				if (Object.keys(props).length) marks.push(defKey(`ts|${JSON.stringify(props)}`, (_key) => ({ _type: "textStyle", _key, ...props })));
			}
		}
		push(node.text, marks);
	}
	if (children.length === 0) children.push({ _type: "span", _key: newKey(), text: "", marks: [] });
	return { children, markDefs };
}

function plain(content: JSONContent[] | undefined): string {
	return (content ?? []).map((n) => (n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? "\n" : "")).join("");
}

function textBlock(node: JSONContent, config: BuilderConfig, extra: Partial<PTTextBlock> = {}): PTTextBlock {
	const { children, markDefs } = inlineToSpans(node.content);
	const attrs = node.attrs ?? {};
	const named = findTextStyle(config, attrs.textStyle);
	const style = named ? named.name : node.type === "heading" ? `h${attrs.level ?? 2}` : "normal";
	return {
		_type: "block",
		_key: newKey(),
		style,
		...(attrs.textAlign && attrs.textAlign !== "left" ? { textAlign: attrs.textAlign as string } : {}),
		...styleOf(attrs),
		markDefs,
		children,
		...extra,
	};
}

function listToBlocks(list: JSONContent, level: number, config: BuilderConfig, out: PTBlock[]) {
	const listItem = list.type === "bulletList" ? "bullet" : "number";
	for (const item of list.content ?? []) {
		for (const child of item.content ?? []) {
			if (child.type === "bulletList" || child.type === "orderedList") listToBlocks(child, level + 1, config, out);
			else if (child.type === "paragraph" || child.type === "heading")
				out.push({ ...textBlock(child, config), style: "normal", listItem, level } as PTBlock);
		}
	}
}

function nested(content: JSONContent[] | undefined, config: BuilderConfig): PTBlock[] {
	return nodesToBlocks(content ?? [], config);
}

function convertNode(node: JSONContent, config: BuilderConfig, out: PTBlock[]) {
	const a = node.attrs ?? {};
	switch (node.type) {
		case "paragraph":
		case "heading":
			out.push(textBlock(node, config) as PTBlock);
			return;
		case "bulletList":
		case "orderedList":
			listToBlocks(node, 1, config, out);
			return;
		case "blockquote":
			for (const p of node.content ?? []) out.push({ ...textBlock(p, config), style: "blockquote" } as PTBlock);
			return;
		case "horizontalRule":
			out.push({ _type: "break", _key: newKey(), style: "lineBreak" });
			return;
		case "pbImage":
			out.push({
				_type: "image",
				_key: newKey(),
				asset: {
					_ref: a.mediaId ?? "",
					url: a.src ?? "",
					...(a.provider && a.provider !== "local" ? { provider: a.provider } : {}),
				},
				alt: a.alt ?? "",
				...(a.caption ? { caption: a.caption } : {}),
				...(typeof a.width === "number" ? { width: a.width } : {}),
				...(typeof a.height === "number" ? { height: a.height } : {}),
				...(typeof a.displayWidth === "number" ? { displayWidth: Math.round(a.displayWidth) } : {}),
				...(a.align && a.align !== "none" ? { alignment: a.align } : {}),
				...(a.link ? { link: a.link } : {}),
				...styleOf(a),
			});
			return;
		case "pbButtons":
			out.push({
				_type: "buttons",
				_key: newKey(),
				...(a.align && a.align !== "left" ? { align: a.align } : {}),
				...styleOf(a),
				buttons: (node.content ?? []).map((btn) => ({
					_key: newKey(),
					text: plain(btn.content),
					url: btn.attrs?.href ?? "",
					variant: btn.attrs?.variant ?? null,
					// Keep the core `style` too so the stock renderer and admin still read it.
					style: btn.attrs?.variant === config.buttonStyles[0]?.name ? "fill" : "outline",
					...(btn.attrs?.newTab ? { newTab: true } : {}),
				})),
			});
			return;
		case "pbSection":
			out.push({ _type: "pb.section", _key: newKey(), ...(a.variant ? { variant: a.variant } : {}), ...styleOf(a), content: nested(node.content, config) });
			return;
		case "pbColumns":
			out.push({
				_type: "pb.columns",
				_key: newKey(),
				...(a.ratio && a.ratio !== "equal" ? { ratio: a.ratio } : {}),
				...styleOf(a),
				columns: (node.content ?? []).map((c) => ({ _key: newKey(), ...styleOf(c.attrs), content: nested(c.content, config) })),
			});
			return;
		case "pbCards":
			out.push({
				_type: "pb.cards",
				_key: newKey(),
				...styleOf(a),
				cards: (node.content ?? []).map((c) => ({ _key: newKey(), ...styleOf(c.attrs), content: nested(c.content, config) })),
			});
			return;
		case "pbAccordion":
			out.push({
				_type: "pb.accordion",
				_key: newKey(),
				...styleOf(a),
				items: (node.content ?? []).map((item) => {
					const [summary, body] = item.content ?? [];
					return {
						_key: newKey(),
						summary: plain(summary?.content),
						content: nested(body?.content, config),
						...(item.attrs?.open ? { open: true } : {}),
						...styleOf(item.attrs),
					};
				}),
			});
			return;
		case "pbSpacer":
			out.push({ _type: "pb.spacer", _key: newKey(), size: a.size ?? "m" });
			return;
		case "pbReusable":
			out.push({ _type: "pb.reusable", _key: a.key || newKey(), ref: a.ref ?? "", ...(a.title ? { title: a.title } : {}) });
			return;
		case "pbExternal": {
			// EmDash's admin editor adds an empty `id` to blocks it passes through.
			const { id, ...data } = (a.data ?? {}) as Record<string, unknown>;
			if (id !== "" && id !== undefined) data.id = id;
			// The admin editor keeps a block it doesn't know only if it has a
			// setting; one without any would be replaced by placeholder text.
			if (!Object.keys(data).some((k) => !k.startsWith("_"))) data.pbBlock = true;
			out.push({ ...data, _type: a.blockType, _key: a.key || newKey() });
			return;
		}
		default:
			// Unknown node from a paste the schema somehow accepted — keep its text.
			if (node.content) out.push(...nodesToBlocks(node.content, config));
	}
}

export function nodesToBlocks(nodes: JSONContent[], config: BuilderConfig): PTBlock[] {
	const out: PTBlock[] = [];
	for (const node of nodes) convertNode(node, config, out);
	return out;
}

/** Drop a trailing empty paragraph, which the editor always keeps for typing into. */
export function docToPortableText(doc: JSONContent, config: BuilderConfig): PTBlock[] {
	const blocks = nodesToBlocks(doc.content ?? [], config);
	const isEmpty = (b: PTBlock | undefined) => {
		const t = b as PTTextBlock | undefined;
		return t?._type === "block" && t.style === "normal" && !t.listItem && !t.pbStyle && t.children.every((c) => !c.text);
	};
	while (blocks.length && isEmpty(blocks[blocks.length - 1])) blocks.pop();
	return blocks;
}
