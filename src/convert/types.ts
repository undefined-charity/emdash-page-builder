import type { JSONContent } from "@tiptap/core";

export type { JSONContent };

export interface PTSpan {
	_type: "span";
	_key?: string;
	text: string;
	marks?: string[];
}

export interface PTMarkDef {
	_type: string;
	_key: string;
	href?: string;
	blank?: boolean;
	[key: string]: unknown;
}

export interface PTBlock {
	_type: string;
	_key?: string;
	[key: string]: unknown;
}

export interface PTTextBlock extends PTBlock {
	_type: "block";
	_key?: string;
	style?: string;
	listItem?: "bullet" | "number";
	level?: number;
	textAlign?: string;
	children: PTSpan[];
	markDefs?: PTMarkDef[];
}

export function isTextBlock(b: PTBlock): b is PTTextBlock {
	return b?._type === "block";
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newKey(): string {
	let out = "";
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
	return out;
}

/** Block types owned by the builder (plus the core ones it edits natively). */
export const BUILDER_TYPES = new Set([
	"block",
	"image",
	"break",
	"buttons",
	"pb.section",
	"pb.columns",
	"pb.cards",
	"pb.accordion",
	"pb.stack",
	"pb.video",
	"pb.gallery",
	"pb.spacer",
	"pb.reusable",
]);
