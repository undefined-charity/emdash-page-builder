import assert from "node:assert/strict";
import { test } from "node:test";

import { docToPortableText } from "../src/convert/from-doc.ts";
import { portableTextToDoc } from "../src/convert/to-doc.ts";
import { renderDocument } from "../src/render/html.ts";
import { resolveConfig } from "../src/schema/config.ts";
import { responsiveCss } from "../src/schema/style.ts";
import { answerVw, answerWidth } from "../src/editor/device.ts";

const config = resolveConfig({
	textStyles: [
		{ name: "lead", label: "Lead", tag: "p", className: "lead" },
		{ name: "display", label: "Display", tag: "h1", className: "pupifer-heading" },
		{ name: "badge", label: "Badge", tag: "div", className: "badge" },
	],
	sectionStyles: [
		{ name: "hero", label: "Hero", tag: "header", className: "hero" },
		{ name: "default", label: "Plain", tag: "section" },
	],
});

/** Replace generated keys with stable ones, rewriting mark references to match. */
function normalize(blocks: unknown): unknown {
	let n = 0;
	const map = new Map<string, string>();
	const key = (k: string) => {
		if (!map.has(k)) map.set(k, `k${n++}`);
		return map.get(k)!;
	};
	const walk = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === "object") {
			const o = v as Record<string, unknown>;
			const out: Record<string, unknown> = {};
			for (const [k, val] of Object.entries(o)) {
				if (k === "_key") out[k] = "*";
				else if (k === "marks" && Array.isArray(val)) out[k] = val.map((m) => (["strong", "em", "underline", "strike-through"].includes(m) ? m : key(m)));
				else if (k === "markDefs" && Array.isArray(val)) out[k] = val.map((d) => ({ ...walk(d) as object, _key: key((d as { _key: string })._key) }));
				else out[k] = walk(val);
			}
			return out;
		}
		return v;
	};
	return walk(blocks);
}

const span = (text: string, marks: string[] = []) => ({ _type: "span", _key: "s", text, marks });

const SAMPLE = [
	{
		_type: "pb.section",
		_key: "a",
		variant: "hero",
		pbStyle: { background: "#111111", padding: "2rem 1rem" },
		content: [
			{ _type: "block", _key: "b", style: "badge", markDefs: [], children: [span("Nov 13")] },
			{ _type: "block", _key: "c", style: "display", textAlign: "center", markDefs: [], children: [span("BAD DOG")] },
			{
				_type: "block",
				_key: "d",
				style: "lead",
				markDefs: [
					{ _type: "link", _key: "l1", href: "https://x.test" },
					{ _type: "textStyle", _key: "t1", color: "#ff00d2", fontSize: "1.5rem" },
				],
				children: [span("A "), span("kinky", ["strong", "l1"]), span(" pink", ["t1"])],
			},
			{ _type: "site.nextEvent", _key: "ne1", showTime: true },
			{ _type: "buttons", _key: "e", buttons: [{ _key: "x", text: "Tickets", url: "/tickets", variant: "primary", style: "fill" }] },
		],
	},
	{
		_type: "pb.section",
		_key: "f",
		content: [
			{ _type: "image", _key: "g", asset: { _ref: "m1", url: "/_emdash/api/media/file/a.jpg" }, alt: "pup", alignment: "right", displayWidth: 300 },
			{ _type: "block", _key: "h", style: "normal", listItem: "bullet", level: 1, markDefs: [], children: [span("one")] },
			{ _type: "block", _key: "i", style: "normal", listItem: "bullet", level: 2, markDefs: [], children: [span("nested")] },
			{ _type: "pb.accordion", _key: "j", items: [{ _key: "y", summary: "Dress code?", content: [{ _type: "block", _key: "z", style: "normal", markDefs: [], children: [span("Gear up.")] }] }] },
			{ _type: "pb.columns", _key: "k", columns: [{ _key: "c1", content: [{ _type: "block", _key: "p", style: "normal", markDefs: [], children: [span("L")] }] }, { _key: "c2", pbStyle: { color: "#66ff00" }, content: [{ _type: "block", _key: "q", style: "normal", markDefs: [], children: [span("R")] }] }] },
			{ _type: "pb.reusable", _key: "r1", ref: "abc", title: "CTA" },
			{ _type: "emdash-form", _key: "f1", formId: "F1" },
		],
	},
];

test("Portable Text round-trips through the editor document", () => {
	const once = docToPortableText(portableTextToDoc(SAMPLE, config), config);
	const twice = docToPortableText(portableTextToDoc(once, config), config);
	assert.deepEqual(normalize(twice), normalize(once));
	// And nothing the editor doesn't own is lost.
	assert.deepEqual(normalize(once), normalize(SAMPLE));
});

test("a section with no style uses the default look, not the first one", () => {
	const { parts } = renderDocument([{ _type: "pb.section", content: [] }], config);
	assert.match(parts.join(""), /^<section class="pb-section" data-pb-section="default">/);
});

test("text is escaped and hostile style values are dropped", () => {
	const { parts } = renderDocument(
		[
			{
				_type: "block",
				style: "normal",
				pbStyle: { color: "red; background:url(javascript:x)", background: "#000", backgroundImage: "javascript:alert(1)" },
				markDefs: [{ _type: "textStyle", _key: "t", color: "expression(x)" }],
				children: [span("<img src=x onerror=alert(1)>", ["t"])],
			},
		],
		config,
	);
	const html = parts.join("");
	assert.ok(!html.includes("<img"), html);
	assert.ok(!html.includes("javascript"), html);
	assert.ok(!html.includes("expression"), html);
	assert.match(html, /background-color: #000/);
});

test("external and reusable blocks become slots in document order", () => {
	const { parts, slots } = renderDocument(SAMPLE, config);
	assert.deepEqual(
		slots.map((s) => (s.kind === "external" ? s.block._type : `reusable:${s.ref}`)),
		["site.nextEvent", "reusable:abc", "emdash-form"],
	);
	assert.equal(parts.length, slots.length + 1);
	assert.match(parts[0], /^<header [^>]*class="pb-section hero"/);
	assert.match(parts[0], /^<header [^>]*style="background-color: #111111; padding: 2rem 1rem"/);
});

test("trailing empty lines are never saved", () => {
	const doc = {
		type: "doc",
		content: [
			{ type: "paragraph", content: [{ type: "text", text: "Hi" }] },
			{ type: "paragraph" },
			{ type: "paragraph" },
		],
	};
	const blocks = docToPortableText(doc, config);
	assert.equal(blocks.length, 1);
});

test("blocks without settings survive EmDash's admin editor, which adds empty ids", () => {
	const saved = docToPortableText(
		portableTextToDoc(
			[
				{ _type: "site.eventContent", _key: "a" },
				{ _type: "site.menu", _key: "b", menu: "primary", id: "" },
			],
			config,
		),
		config,
	);
	// A setting-less block gets a marker the admin editor counts as a setting.
	assert.deepEqual(saved[0], { _type: "site.eventContent", _key: "a", pbBlock: true });
	// The admin's empty id is dropped; real settings stay.
	assert.deepEqual(saved[1], { _type: "site.menu", _key: "b", menu: "primary" });
});

test("phone overrides and hidden blocks round-trip, lists and quotes included", () => {
	const blocks = [
		{ _type: "block", _key: "a", style: "h2", pbHide: "phone", pbStylePhone: { fontSize: "1.5rem", textAlign: "center" }, markDefs: [], children: [span("Big")] },
		{ _type: "block", _key: "b", style: "normal", listItem: "bullet", level: 1, pbHide: "desktop", markDefs: [], children: [span("one")] },
		{ _type: "block", _key: "c", style: "normal", listItem: "bullet", level: 1, pbHide: "desktop", markDefs: [], children: [span("two")] },
		{ _type: "block", _key: "d", style: "blockquote", pbStyle: { color: "#ff00d2" }, markDefs: [], children: [span("Quote")] },
		{ _type: "image", _key: "e", asset: { _ref: "m", url: "/x.jpg" }, alt: "", pbStylePhone: { width: "200px", align: "center" } },
		{ _type: "break", _key: "f", style: "lineBreak", pbHide: "phone" },
		{ _type: "pb.spacer", _key: "g", size: "l", pbHide: "desktop" },
		{ _type: "site.nextEvent", _key: "h", pbHide: "phone", showTime: true },
	];
	const once = docToPortableText(portableTextToDoc(blocks, config), config);
	assert.deepEqual(normalize(once), normalize(blocks));
});

test("hostile phone overrides are dropped", () => {
	const doc = portableTextToDoc([{ _type: "block", style: "normal", pbHide: "sometimes", pbStylePhone: { fontSize: "1rem; color: red", textAlign: "sideways", width: "10px" }, children: [span("x")] }], config);
	assert.deepEqual(doc.content?.[0].attrs, { pbStylePhone: { width: "10px" } });
});

test("hidden blocks and phone styles render as classes and custom properties", () => {
	const { parts, slots } = renderDocument(
		[
			{ _type: "block", style: "normal", pbHide: "phone", pbStylePhone: { fontSize: "0.875rem", align: "wide" }, markDefs: [], children: [span("x")] },
			{ _type: "site.nextEvent", _key: "n", pbHide: "desktop" },
		],
		config,
	);
	assert.match(parts[0], /<p [^>]*data-pb-phone="fontSize align-wide"/);
	assert.match(parts[0], /<p [^>]*class="pb-hide-phone"/);
	assert.match(parts[0], /style="--pbp-fontSize: 0.875rem"/);
	assert.equal(slots[0].hide, "desktop");
});

test("the responsive rules use the configured breakpoint and spare the editor", () => {
	const css = responsiveCss(700);
	assert.match(css, /@media \(max-width: 700px\) \{ \.pb-hide-phone:not\(\.pb-editor-content \*\)/);
	assert.match(css, /@media \(min-width: 700\.02px\)/);
	assert.match(css, /\[data-pb-phone~="fontSize"\] \{ font-size: var\(--pbp-fontSize\) !important/);
});

test("the phone view answers width queries and vw lengths for a phone", () => {
	assert.equal(answerWidth("(max-width: 640px)", 390), "(min-width: 0px)");
	assert.equal(answerWidth("screen and (min-width: 48em)", 390), "screen and (max-width: 0px)");
	assert.equal(answerWidth("(width <= 700px) and (prefers-reduced-motion: reduce)", 390), "(min-width: 0px) and (prefers-reduced-motion: reduce)");
	assert.equal(answerWidth("print", 390), "print");
	assert.equal(answerVw("clamp(2.8rem, 6vw, 4.5rem)", 390), "clamp(2.8rem, 23.4px, 4.5rem)");
	assert.equal(answerVw("calc(100vw - 2rem)", 390), "calc(390px - 2rem)");
});

test("layers round-trip and render in one grid cell, front layer last", () => {
	const blocks = [
		{
			_type: "pb.stack",
			_key: "s",
			phoneFlow: true,
			pbStyle: { minHeight: "60vh" },
			layers: [
				{ _key: "l1", content: [{ _type: "image", _key: "i", asset: { _ref: "m", url: "/x.jpg" }, alt: "", alignment: "wide" }] },
				{ _key: "l2", valign: "center", halign: "center", pbStyle: { padding: "2rem" }, content: [{ _type: "block", _key: "h", style: "h2", markDefs: [], children: [span("Over")] }] },
			],
		},
	];
	const once = docToPortableText(portableTextToDoc(blocks, config), config);
	assert.deepEqual(normalize(once), normalize(blocks));
	const html = renderDocument(blocks, config).parts.join("");
	assert.match(html, /<div [^>]*class="pb-stack pb-stack--phone-flow"/);
	assert.match(html, /class="pb-layer pb-layer--v-center pb-layer--h-center"/);
});

test("videos: YouTube, Vimeo and files round-trip and render without JavaScript", () => {
	const blocks = [
		{ _type: "pb.video", _key: "a", url: "https://youtu.be/dQw4w9WgXcQ", autoplay: true, loop: true },
		{ _type: "pb.video", _key: "b", url: "https://vimeo.com/76979871", controls: false, caption: "Teaser" },
		{ _type: "pb.video", _key: "c", url: "/_emdash/api/media/file/x.mp4", mediaId: "m1", poster: "/_emdash/api/media/file/p.jpg" },
	];
	const once = docToPortableText(portableTextToDoc(blocks, config), config);
	assert.deepEqual(normalize(once), normalize(blocks));
	const html = renderDocument(blocks, config).parts.join("");
	assert.match(html, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?rel=0&amp;playsinline=1&amp;autoplay=1&amp;mute=1&amp;loop=1&amp;playlist=dQw4w9WgXcQ"/);
	assert.match(html, /player\.vimeo\.com\/video\/76979871\?dnt=1&amp;controls=0/);
	assert.match(html, /<video src="\/_emdash\/api\/media\/file\/x\.mp4" poster="\/_emdash\/api\/media\/file\/p\.jpg" controls="" playsinline="" preload="metadata"><a href="\/_emdash\/api\/media\/file\/x\.mp4">Download the video<\/a><\/video>/);
});

test("a hostile video address renders nothing playable", () => {
	const html = renderDocument([{ _type: "pb.video", url: "javascript:alert(1)" }], config).parts.join("");
	assert.ok(!html.includes("javascript"), html);
	assert.match(html, /pb-video__frame--empty/);
});

test("galleries round-trip, keep their key, and open images in popovers", () => {
	const blocks = [
		{
			_type: "pb.gallery",
			_key: "gal1",
			layout: "slideshow",
			images: [
				{ _key: "i1", src: "/a.jpg", mediaId: "m1", alt: "A" },
				{ _key: "i2", src: "/b.jpg", caption: "Bee" },
			],
		},
	];
	const once = docToPortableText(portableTextToDoc(blocks, config), config);
	assert.deepEqual(normalize(once), normalize(blocks));
	assert.equal(once[0]._key, "gal1");
	const html = renderDocument(blocks, config).parts.join("");
	assert.match(html, /class="pb-gallery pb-gallery--slideshow"/);
	assert.match(html, /popovertarget="pb-lb-gal1-0"/);
	assert.match(html, /<div id="pb-lb-gal1-1" popover="" class="pb-lightbox">/);
	assert.match(html, /<figcaption>Bee<\/figcaption>/);
});
