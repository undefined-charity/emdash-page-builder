/**
 * The phone view: the editable page shown at phone width, as a phone lays it
 * out, while it stays the same live, editable document.
 *
 * Narrowing the page isn't enough on its own, because the site's stylesheets
 * ask the browser window, not the page, how wide the screen is. So while the
 * phone view is on, every width condition in the page's stylesheets
 * (`@media (max-width: 640px)` and the like) is answered for a phone-sized
 * screen instead, and so is every length in window widths (`6vw`). Both are
 * put back afterwards.
 */
import * as React from "react";

export type Device = "desktop" | "phone";

/** Width of the phone view, in CSS pixels (an average current phone). */
export const PHONE_WIDTH = 390;

let device: Device = "desktop";
const listeners = new Set<() => void>();

export function getDevice(): Device {
	return device;
}

export function setDevice(next: Device) {
	if (next === device) return;
	device = next;
	const root = document.documentElement;
	if (next === "phone") {
		// The phone gets the page's background; around it goes the editor's.
		// A page background usually belongs to <html> (or to <body>, which
		// then paints the whole window), so move it onto <body> first.
		const html = getComputedStyle(root);
		const body = getComputedStyle(document.body);
		const own = (s: CSSStyleDeclaration) => s.backgroundImage !== "none" || !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(s.backgroundColor);
		root.style.setProperty("--pb-phone-bg", own(body) ? body.background : own(html) ? html.background : "#fff");
	}
	root.toggleAttribute("data-pb-phone-view", next === "phone");
	if (next === "phone") emulate();
	else restore();
	listeners.forEach((l) => l());
}

export function useDevice(): Device {
	return React.useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		() => device,
		() => "desktop" as Device,
	);
}

// ── Media queries ─────────────────────────────────────────────────────────────

/** Each rewritten rule's own condition, to put back. */
const originals = new Map<CSSMediaRule, string>();
let observer: MutationObserver | null = null;

const ALWAYS = "(min-width: 0px)";
const NEVER = "(max-width: 0px)";

function px(value: string, unit: string): number {
	const n = parseFloat(value);
	return unit === "em" || unit === "rem" ? n * 16 : n;
}

/**
 * One media condition, answered for a screen `width` pixels wide: every width
 * test becomes one that is always or never true, and everything else (print,
 * reduced motion, hover…) is left to the browser.
 */
export function answerWidth(media: string, width: number): string {
	const n = String.raw`(\d*\.?\d+)(px|em|rem)`;
	return (
		media
			// (max-width: 640px), (min-width: 40em)
			.replace(new RegExp(String.raw`\(\s*(min|max)-width\s*:\s*${n}\s*\)`, "gi"), (_m, which: string, v: string, u: string) => {
				const bound = px(v, u.toLowerCase());
				return (which.toLowerCase() === "min" ? width >= bound : width <= bound) ? ALWAYS : NEVER;
			})
			// (width <= 640px), (width > 40em)
			.replace(new RegExp(String.raw`\(\s*width\s*(<=|>=|<|>)\s*${n}\s*\)`, "gi"), (_m, op: string, v: string, u: string) => {
				const b = px(v, u.toLowerCase());
				const ok = op === "<=" ? width <= b : op === ">=" ? width >= b : op === "<" ? width < b : width > b;
				return ok ? ALWAYS : NEVER;
			})
			// (640px >= width)
			.replace(new RegExp(String.raw`\(\s*${n}\s*(<=|>=|<|>)\s*width\s*\)`, "gi"), (_m, v: string, u: string, op: string) => {
				const b = px(v, u.toLowerCase());
				const ok = op === "<=" ? b <= width : op === ">=" ? b >= width : op === "<" ? b < width : b > width;
				return ok ? ALWAYS : NEVER;
			})
	);
}

/** `6vw` as pixels on a screen `width` wide (`clamp(2rem, 6vw, 4rem)` → `clamp(2rem, 23.4px, 4rem)`). */
export function answerVw(value: string, width: number): string {
	return value.replace(/(^|[^\w.-])(\d*\.?\d+)[dsl]?vw\b/g, (_m, before: string, n: string) => `${before}${+((parseFloat(n) * width) / 100).toFixed(2)}px`);
}

function eachRule(rules: CSSRuleList, visit: (rule: CSSRule) => void) {
	for (const rule of rules) {
		visit(rule);
		// Rules inside @media, @supports, @layer, or nested style rules.
		if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) eachRule((rule as CSSGroupingRule).cssRules, visit);
	}
}

/** Declarations rewritten for `vw`: their original values, by property. */
const vwOriginals = new Map<CSSStyleDeclaration, Map<string, [string, string]>>();

function answerDeclarations(style: CSSStyleDeclaration) {
	if (vwOriginals.has(style)) return;
	const changed = new Map<string, [string, string]>();
	for (let i = 0; i < style.length; i++) {
		const name = style[i];
		const value = style.getPropertyValue(name);
		if (!/vw\b/.test(value)) continue;
		const answered = answerVw(value, PHONE_WIDTH);
		if (answered === value) continue;
		const priority = style.getPropertyPriority(name);
		changed.set(name, [value, priority]);
		style.setProperty(name, answered, priority);
	}
	if (changed.size) vwOriginals.set(style, changed);
}

function sheetRules(sheet: CSSStyleSheet): CSSRuleList | null {
	try {
		return sheet.cssRules;
	} catch {
		// Another origin's stylesheet (web fonts): unreadable, and not layout.
		return null;
	}
}

function emulateSheets() {
	for (const sheet of document.styleSheets) {
		const rules = sheetRules(sheet);
		if (!rules) continue;
		eachRule(rules, (rule) => {
			if (rule instanceof CSSStyleRule) {
				answerDeclarations(rule.style);
				return;
			}
			if (!(rule instanceof CSSMediaRule)) return;
			const original = originals.get(rule) ?? rule.media.mediaText;
			const answered = answerWidth(original, PHONE_WIDTH);
			if (answered === original) return;
			originals.set(rule, original);
			if (rule.media.mediaText !== answered) rule.media.mediaText = answered;
		});
	}
}

/**
 * Run `fn` with the page's styles laid out for `layout` (a phone's, or the
 * desktop's), whatever the editor is showing, then put them back. It all
 * happens before the browser paints, so nothing flickers.
 */
export function withLayout<T>(layout: Device, fn: () => T): T {
	if (layout === device) return fn();
	if (layout === "phone") emulateSheets();
	else restoreSheets();
	try {
		return fn();
	} finally {
		if (device === "phone") emulateSheets();
		else restoreSheets();
	}
}

function emulate() {
	emulateSheets();
	// Stylesheets added later (a lazily loaded component, or the dev server
	// swapping one) need answering too.
	observer ??= new MutationObserver(() => device === "phone" && emulateSheets());
	observer.observe(document.head, { childList: true, subtree: true, characterData: true });
	observer.observe(document.body, { childList: true });
}

function restore() {
	observer?.disconnect();
	restoreSheets();
}

function restoreSheets() {
	for (const [rule, media] of originals) {
		try {
			rule.media.mediaText = media;
		} catch {
			/* the stylesheet is gone */
		}
	}
	originals.clear();
	for (const [style, changed] of vwOriginals) {
		for (const [name, [value, priority]] of changed) style.setProperty(name, value, priority);
	}
	vwOriginals.clear();
}
