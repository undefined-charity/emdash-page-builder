import assert from "node:assert/strict";
import { test } from "node:test";

import { docToPortableText } from "../src/convert/from-doc.ts";
import { portableTextToDoc } from "../src/convert/to-doc.ts";
import { renderDocument } from "../src/render/html.ts";
import { resolveConfig } from "../src/schema/config.ts";

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
