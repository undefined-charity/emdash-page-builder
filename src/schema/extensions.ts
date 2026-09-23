/**
 * The document schema, shared by the on-page editor and the server renderer.
 *
 * Every node's `renderHTML` is the public markup: the server renders stored
 * content through these same definitions, so what an editor sees while typing
 * is exactly what a visitor gets. Editor-only behaviour (resize handles, the
 * preview of a server-rendered block) lives in node views in `../editor`, never
 * here.
 */
import { Extension, Node, mergeAttributes, type Extensions } from "@tiptap/core";
import TextAlign from "@tiptap/extension-text-align";
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import type { Node as PMNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";

import { defaultSectionStyle, findTextStyle, type BuilderConfig } from "./config.js";
import { GALLERY_LAYOUTS, galleryDom, videoDom, videoSource } from "./media.js";
import { blockStyleToCss, cleanBlockStyle, cleanHide, phoneStyleAttrs, safeUrl } from "./style.js";

const noDom = { rendered: false } as const;
const cls = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** Named styles on paragraphs and headings: `<p class="lead">`, `<h1 class="display">`. */
function textStyles(config: BuilderConfig) {
	return Extension.create({
		name: "pbTextStyles",
		addGlobalAttributes() {
			return [
				{
					types: ["paragraph", "heading"],
					attributes: {
						textStyle: {
							default: null,
							parseHTML: (el) => el.getAttribute("data-pb-style"),
							renderHTML: (attrs) => {
								const style = findTextStyle(config, attrs.textStyle);
								return style ? { class: style.className, "data-pb-style": style.name } : {};
							},
						},
					},
				},
			];
		},
	});
}

/** Node types that accept a style override (colours, spacing, background…). */
export const STYLABLE_TYPES = [
	"paragraph",
	"heading",
	"blockquote",
	"bulletList",
	"orderedList",
	"pbSection",
	"pbColumns",
	"pbColumn",
	"pbCards",
	"pbCard",
	"pbAccordion",
	"pbAccordionItem",
	"pbButtons",
	"pbImage",
	"pbStack",
	"pbLayer",
	"pbVideo",
	"pbGallery",
];

/** Node types that can be hidden on phones or on desktops. */
export const HIDEABLE_TYPES = [...STYLABLE_TYPES, "horizontalRule", "pbSpacer", "pbExternal", "pbReusable"];

const BlockStyles = Extension.create({
	name: "pbBlockStyles",
	addGlobalAttributes() {
		return [
			{
				types: STYLABLE_TYPES,
				attributes: {
					pbStyle: {
						default: null,
						parseHTML: () => null,
						renderHTML: (attrs) => {
							const css = blockStyleToCss(attrs.pbStyle);
							return css ? { style: css, "data-pb-styled": "" } : {};
						},
					},
					pbStylePhone: {
						default: null,
						parseHTML: () => null,
						renderHTML: (attrs) => phoneStyleAttrs(attrs.pbStylePhone),
					},
				},
			},
			{
				types: HIDEABLE_TYPES,
				attributes: {
					pbHide: {
						default: null,
						parseHTML: () => null,
						renderHTML: (attrs) => {
							const hide = cleanHide(attrs.pbHide);
							return hide ? { class: `pb-hide-${hide}` } : {};
						},
					},
				},
			},
		];
	},
});

export { cleanBlockStyle };

/** A `<div class="badge">`-style paragraph renders with the style's tag, not `<p>`. */
function styledParagraph(config: BuilderConfig) {
	return StarterKit.configure({
		heading: { levels: [1, 2, 3, 4] },
		codeBlock: false,
		code: false,
		link: {
			openOnClick: false,
			autolink: true,
			HTMLAttributes: { rel: null, target: null },
		},
		paragraph: {
			HTMLAttributes: {},
		},
	}).extend({
		addExtensions() {
			const base = this.parent?.() ?? [];
			return base.map((ext) =>
				ext.name === "paragraph"
					? ext.extend({
							renderHTML({ node, HTMLAttributes }: { node: PMNode; HTMLAttributes: Record<string, unknown> }) {
								const style = findTextStyle(config, node.attrs.textStyle);
								const tag = style && (style.tag === "div" || style.tag === "p") ? style.tag : "p";
								return [tag, HTMLAttributes, 0];
							},
						})
					: ext,
			);
		},
	});
}

const Section = (config: BuilderConfig) =>
	Node.create({
		name: "pbSection",
		group: "block",
		content: "block+",
		defining: true,
		isolating: true,
		draggable: true,
		addAttributes() {
			return {
				variant: { default: defaultSectionStyle(config)?.name ?? "default", ...noDom },
				/** A looping muted video behind the section; its background image is the still picture. */
				bgVideo: { default: "", ...noDom },
			};
		},
		parseHTML: () => [{ tag: "[data-pb-section]", getAttrs: (el) => ({ variant: (el as HTMLElement).dataset.pbSection }) }],
		renderHTML({ node, HTMLAttributes }) {
			const style = config.sectionStyles.find((s) => s.name === node.attrs.variant) ?? defaultSectionStyle(config);
			const video = safeUrl(node.attrs.bgVideo);
			const attrs = mergeAttributes(HTMLAttributes, {
				class: cls("pb-section", style?.className, video && "pb-section--video"),
				"data-pb-section": style?.name ?? "default",
			});
			if (!video) return [style?.tag ?? "section", attrs, 0];
			const poster = cleanBlockStyle(node.attrs.pbStyle)?.backgroundImage;
			return [
				style?.tag ?? "section",
				attrs,
				[
					"video",
					{ class: "pb-section__video", src: video, ...(poster ? { poster } : {}), autoplay: "", muted: "", loop: "", playsinline: "", "aria-hidden": "true", tabindex: "-1" },
					// Never an empty element: `<video/>` would swallow what follows.
					" ",
				],
				// `display: contents`, so the section lays out its blocks as before.
				["div", { class: "pb-section__body" }, 0],
			] as never;
		},
	});

const Columns = Node.create({
	name: "pbColumns",
	group: "block",
	content: "pbColumn{2,4}",
	defining: true,
	isolating: true,
	draggable: true,
	addAttributes() {
		return { ratio: { default: "equal", ...noDom } };
	},
	parseHTML: () => [{ tag: "div.pb-columns" }],
	renderHTML({ node, HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				class: cls("pb-columns", `pb-columns--${node.childCount}`, node.attrs.ratio !== "equal" && `pb-columns--${node.attrs.ratio}`),
			}),
			0,
		];
	},
});

const Column = Node.create({
	name: "pbColumn",
	content: "block+",
	isolating: true,
	parseHTML: () => [{ tag: "div.pb-column" }],
	renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "pb-column" }), 0],
});

export const IMAGE_ALIGNMENTS = ["none", "left", "right", "center", "wide"] as const;
export type ImageAlignment = (typeof IMAGE_ALIGNMENTS)[number];

const Image = Node.create({
	name: "pbImage",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return {
			src: { default: "", ...noDom },
			mediaId: { default: null, ...noDom },
			provider: { default: null, ...noDom },
			alt: { default: "", ...noDom },
			caption: { default: "", ...noDom },
			width: { default: null, ...noDom },
			height: { default: null, ...noDom },
			align: { default: "none", ...noDom },
			displayWidth: { default: null, ...noDom },
			link: { default: "", ...noDom },
		};
	},
	parseHTML: () => [
		{
			tag: "figure.pb-image",
			getAttrs: (el) => {
				const img = (el as HTMLElement).querySelector("img");
				return img ? { src: img.getAttribute("src"), alt: img.getAttribute("alt") ?? "" } : false;
			},
		},
		{ tag: "img[src]", getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute("src"), alt: (el as HTMLElement).getAttribute("alt") ?? "" }) },
	],
	renderHTML({ node, HTMLAttributes }) {
		const a = node.attrs;
		const align = IMAGE_ALIGNMENTS.includes(a.align) ? a.align : "none";
		const width = typeof a.displayWidth === "number" && a.displayWidth > 0 ? Math.round(a.displayWidth) : null;
		const img = [
			"img",
			{
				src: a.src,
				alt: a.alt ?? "",
				width: a.width ?? undefined,
				height: a.height ?? undefined,
				loading: "lazy",
				decoding: "async",
			},
		];
		const media = a.link ? ["a", { href: a.link }, img] : img;
		return [
			"figure",
			mergeAttributes(HTMLAttributes, { class: cls("pb-image", `pb-image--${align}`), style: width ? `width: ${width}px` : undefined }),
			media,
			...(a.caption ? [["figcaption", {}, a.caption]] : []),
		] as never;
	},
});

const Buttons = Node.create({
	name: "pbButtons",
	group: "block",
	content: "pbButton+",
	defining: true,
	draggable: true,
	addAttributes() {
		return { align: { default: "left", ...noDom } };
	},
	parseHTML: () => [{ tag: "div.pb-buttons" }],
	renderHTML({ node, HTMLAttributes }) {
		return ["div", mergeAttributes(HTMLAttributes, { class: cls("actions", "pb-buttons", node.attrs.align !== "left" && `pb-buttons--${node.attrs.align}`) }), 0];
	},
});

const Button = (config: BuilderConfig) =>
	Node.create({
		name: "pbButton",
		content: "text*",
		marks: "",
		defining: true,
		addAttributes() {
			return {
				href: { default: "", ...noDom },
				variant: { default: config.buttonStyles[0]?.name ?? "primary", ...noDom },
				newTab: { default: false, ...noDom },
			};
		},
		parseHTML: () => [{ tag: "a.pb-button", getAttrs: (el) => ({ href: (el as HTMLElement).getAttribute("href") ?? "" }) }],
		renderHTML({ node }) {
			const style = config.buttonStyles.find((s) => s.name === node.attrs.variant) ?? config.buttonStyles[0];
			const external = node.attrs.newTab;
			return [
				"a",
				{
					class: cls("pb-button", style?.className ?? "button"),
					href: node.attrs.href || "#",
					...(external ? { target: "_blank", rel: "noreferrer" } : {}),
				},
				0,
			];
		},
	});

const Cards = Node.create({
	name: "pbCards",
	group: "block",
	content: "pbCard+",
	defining: true,
	isolating: true,
	draggable: true,
	parseHTML: () => [{ tag: "div.pb-cards" }],
	renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "card-grid pb-cards" }), 0],
});

const Card = Node.create({
	name: "pbCard",
	content: "block+",
	isolating: true,
	parseHTML: () => [{ tag: "div.pb-card" }],
	renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "card pb-card" }), 0],
});

const Accordion = Node.create({
	name: "pbAccordion",
	group: "block",
	content: "pbAccordionItem+",
	defining: true,
	isolating: true,
	draggable: true,
	parseHTML: () => [{ tag: "div.pb-accordion" }],
	renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "pb-accordion" }), 0],
});

const AccordionItem = Node.create({
	name: "pbAccordionItem",
	content: "pbAccordionSummary pbAccordionBody",
	isolating: true,
	addAttributes() {
		return { open: { default: false, ...noDom } };
	},
	parseHTML: () => [{ tag: "details" }],
	renderHTML: ({ node, HTMLAttributes }) => [
		"details",
		mergeAttributes(HTMLAttributes, { class: "pb-accordion__item", ...(node.attrs.open ? { open: "" } : {}) }),
		0,
	],
});

const AccordionSummary = Node.create({
	name: "pbAccordionSummary",
	content: "text*",
	marks: "",
	defining: true,
	parseHTML: () => [{ tag: "summary" }],
	renderHTML: () => ["summary", {}, 0],
});

const AccordionBody = Node.create({
	name: "pbAccordionBody",
	content: "block+",
	isolating: true,
	parseHTML: () => [{ tag: "div.pb-accordion__body" }],
	renderHTML: () => ["div", { class: "pb-accordion__body" }, 0],
});

export const LAYER_V_ALIGN = ["start", "center", "end"] as const;
export const LAYER_H_ALIGN = ["stretch", "start", "center", "end"] as const;

/**
 * Layers: blocks placed on top of each other, like a headline over a photo.
 * Later layers are in front. Each layer is aligned within the stack; on
 * phones the layers can stack one after another instead (`phoneFlow`).
 */
const Stack = Node.create({
	name: "pbStack",
	group: "block",
	content: "pbLayer+",
	defining: true,
	isolating: true,
	draggable: true,
	addAttributes() {
		return { phoneFlow: { default: false, ...noDom } };
	},
	parseHTML: () => [{ tag: "div.pb-stack" }],
	renderHTML: ({ node, HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: cls("pb-stack", node.attrs.phoneFlow && "pb-stack--phone-flow") }), 0],
});

const Layer = Node.create({
	name: "pbLayer",
	content: "block+",
	isolating: true,
	addAttributes() {
		return { valign: { default: "start", ...noDom }, halign: { default: "stretch", ...noDom } };
	},
	parseHTML: () => [{ tag: "div.pb-layer" }],
	renderHTML: ({ node, HTMLAttributes }) => {
		const v = LAYER_V_ALIGN.includes(node.attrs.valign) ? node.attrs.valign : "start";
		const h = LAYER_H_ALIGN.includes(node.attrs.halign) ? node.attrs.halign : "stretch";
		return ["div", mergeAttributes(HTMLAttributes, { class: cls("pb-layer", `pb-layer--v-${v}`, `pb-layer--h-${h}`) }), 0];
	},
});

/** A video: YouTube or Vimeo by address, or an uploaded file. */
const Video = Node.create({
	name: "pbVideo",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return {
			src: { default: "", ...noDom },
			mediaId: { default: null, ...noDom },
			poster: { default: "", ...noDom },
			title: { default: "", ...noDom },
			caption: { default: "", ...noDom },
			autoplay: { default: false, ...noDom },
			loop: { default: false, ...noDom },
			controls: { default: true, ...noDom },
		};
	},
	parseHTML: () => [{ tag: "figure.pb-video" }],
	renderHTML({ node, HTMLAttributes }) {
		const player = videoDom(node.attrs);
		const embed = videoSource(node.attrs.src)?.kind !== "file";
		return [
			"figure",
			mergeAttributes(HTMLAttributes, { class: cls("pb-video", embed && "pb-video--embed") }),
			player ? ["div", { class: "pb-video__frame" }, player] : ["div", { class: "pb-video__frame pb-video__frame--empty" }],
			...(node.attrs.caption ? [["figcaption", {}, node.attrs.caption]] : []),
		] as never;
	},
});

/** Several images: a grid, a masonry wall, or a swipeable slideshow, each opening full-screen. */
const Gallery = Node.create({
	name: "pbGallery",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return {
			images: { default: [], ...noDom },
			layout: { default: "grid", ...noDom },
			columns: { default: 3, ...noDom },
			lightbox: { default: true, ...noDom },
			key: { default: "", ...noDom },
		};
	},
	parseHTML: () => [{ tag: "div.pb-gallery" }],
	renderHTML({ node, HTMLAttributes }) {
		const layout = GALLERY_LAYOUTS.includes(node.attrs.layout) ? node.attrs.layout : "grid";
		const cols = Math.min(6, Math.max(1, Number(node.attrs.columns) || 3));
		return [
			"div",
			mergeAttributes(HTMLAttributes, { class: cls("pb-gallery", `pb-gallery--${layout}`), style: `--pb-gallery-cols: ${cols}` }),
			...galleryDom(node.attrs, String(node.attrs.key || "g")),
		] as never;
	},
});

export const SPACER_SIZES = ["s", "m", "l", "xl"] as const;

const Spacer = Node.create({
	name: "pbSpacer",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return { size: { default: "m", ...noDom } };
	},
	parseHTML: () => [{ tag: "div.pb-spacer" }],
	renderHTML: ({ node }) => ["div", { class: `pb-spacer pb-spacer--${node.attrs.size}`, "aria-hidden": "true" }],
});

/** A shared block, rendered from its entry in the reusable-blocks collection. */
const Reusable = Node.create({
	name: "pbReusable",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return { ref: { default: "", ...noDom }, title: { default: "", ...noDom }, key: { default: "", ...noDom } };
	},
	parseHTML: () => [{ tag: "div[data-pb-reusable]" }],
	renderHTML: ({ node }) => ["div", { "data-pb-reusable": node.attrs.ref }],
});

/**
 * Any Portable Text block the builder doesn't own — a form, an embed, a
 * site-specific panel — kept verbatim and rendered by the site on the server.
 */
const External = Node.create({
	name: "pbExternal",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return {
			blockType: { default: "", ...noDom },
			key: { default: "", ...noDom },
			data: { default: {}, ...noDom },
		};
	},
	parseHTML: () => [{ tag: "div[data-pb-external]" }],
	renderHTML: ({ node }) => ["div", { "data-pb-external": node.attrs.blockType }],
});

export const CONTAINER_TYPES = ["pbSection", "pbColumns", "pbCards", "pbAccordion", "pbButtons", "pbStack"] as const;

/** Everything needed to parse, edit and render a builder document. */
export function builderExtensions(config: BuilderConfig): Extensions {
	return [
		styledParagraph(config),
		textStyles(config),
		BlockStyles,
		TextStyle,
		Color,
		BackgroundColor,
		FontSize,
		FontFamily,
		TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
		Section(config),
		Columns,
		Column,
		Image,
		Buttons,
		Button(config),
		Cards,
		Card,
		Accordion,
		AccordionItem,
		AccordionSummary,
		AccordionBody,
		Stack,
		Layer,
		Video,
		Gallery,
		Spacer,
		Reusable,
		External,
	];
}
