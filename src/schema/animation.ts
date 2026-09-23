/**
 * Entrance animations for blocks, and transitions between pages. Everything
 * respects `prefers-reduced-motion`, and a page stays fully visible if its
 * script never runs: blocks are only hidden once the script has marked the
 * page ready.
 */

export const ANIM_EFFECTS = ["fade", "slide-up", "slide-down", "slide-left", "slide-right", "zoom", "reveal"] as const;
export type AnimEffect = (typeof ANIM_EFFECTS)[number];

export interface BlockAnimation {
	effect: AnimEffect;
	/** Milliseconds. */
	duration?: number;
	delay?: number;
	/** Play every time it scrolls into view, not just the first. */
	repeat?: boolean;
}

export function cleanAnimation(value: unknown): BlockAnimation | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Record<string, unknown>;
	if (!ANIM_EFFECTS.includes(v.effect as AnimEffect)) return undefined;
	const ms = (n: unknown, max: number) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : undefined);
	const duration = ms(v.duration, 5000);
	const delay = ms(v.delay, 5000);
	return { effect: v.effect as AnimEffect, ...(duration !== undefined ? { duration } : {}), ...(delay !== undefined ? { delay } : {}), ...(v.repeat === true ? { repeat: true } : {}) };
}

/** The attributes an animated block carries. */
export function animationAttrs(value: unknown): Record<string, string> {
	const a = cleanAnimation(value);
	if (!a) return {};
	const style = [a.duration !== undefined ? `--pb-anim-duration: ${a.duration}ms` : "", a.delay ? `--pb-anim-delay: ${a.delay}ms` : ""].filter(Boolean).join("; ");
	return { "data-pb-anim": a.effect, ...(a.repeat ? { "data-pb-anim-repeat": "" } : {}), ...(style ? { style } : {}) };
}

/** Where each effect starts from; it ends at the block's own place. */
export const ANIM_FROM: Record<AnimEffect, Record<string, string>> = {
	fade: { opacity: "0" },
	"slide-up": { opacity: "0", translate: "0 2.5rem" },
	"slide-down": { opacity: "0", translate: "0 -2.5rem" },
	"slide-left": { opacity: "0", translate: "3rem 0" },
	"slide-right": { opacity: "0", translate: "-3rem 0" },
	zoom: { opacity: "0", scale: "0.9" },
	reveal: { "clip-path": "inset(0 0 100% 0)" },
};

/**
 * Marks animated blocks as they scroll into view (and out again, for those
 * that repeat). Only shipped on pages that have animated blocks; once per
 * page however many documents are on it.
 */
export const ANIMATION_SCRIPT = `(()=>{if(window.__pbAnim)return;window.__pbAnim=1;if(!("IntersectionObserver"in window)||matchMedia("(prefers-reduced-motion: reduce)").matches)return;document.documentElement.classList.add("pb-anim-ready");const io=new IntersectionObserver(es=>{for(const e of es){if(e.isIntersecting){e.target.classList.add("pb-in");if(!e.target.hasAttribute("data-pb-anim-repeat"))io.unobserve(e.target)}else if(e.target.hasAttribute("data-pb-anim-repeat"))e.target.classList.remove("pb-in")}},{rootMargin:"0px 0px -10% 0px"});const watch=()=>document.querySelectorAll("[data-pb-anim]:not([data-pb-watched])").forEach(el=>{if(el.closest(".pb-editor-content"))return;el.setAttribute("data-pb-watched","");io.observe(el)});watch();document.addEventListener("DOMContentLoaded",watch)})();`;

// ── Page transitions ──────────────────────────────────────────────────────────

export type PageTransition = "none" | "fade" | "slide";

/** Cross-document view transitions between the site's pages: CSS only. */
export function pageTransitionCss(kind: unknown): string | undefined {
	if (kind !== "fade" && kind !== "slide") return undefined;
	const frames =
		kind === "fade"
			? "@keyframes pb-vt-out { to { opacity: 0; } } @keyframes pb-vt-in { from { opacity: 0; } }"
			: "@keyframes pb-vt-out { to { opacity: 0; translate: -4rem 0; } } @keyframes pb-vt-in { from { opacity: 0; translate: 4rem 0; } }";
	return `@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; } ${frames} ::view-transition-old(root) { animation: 220ms ease-in both pb-vt-out; } ::view-transition-new(root) { animation: 280ms ease-out both pb-vt-in; } }`;
}
