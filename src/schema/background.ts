/**
 * Page backgrounds: a colour, an image or a looping video behind the whole
 * page, set per page (stored in the page theme as `@background`) or as the
 * site default (the Site tab). Like everything else stored, only ever emitted
 * through these functions, from validated values.
 */
import { safeColor, safeUrl } from "./style.js";

export interface PageBackground {
	color?: string;
	image?: string;
	/** A video file, muted and looping. `image` is its still picture. */
	video?: string;
	size?: "cover" | "contain" | "tile";
	position?: "top" | "center" | "bottom";
	/** The image stays put while the page scrolls. */
	fixed?: boolean;
	/** A different image on phones. */
	phoneImage?: string;
}

/** Where a page theme keeps its background. */
export const BACKGROUND_KEY = "@background";

export function cleanPageBackground(value: unknown): PageBackground | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Record<string, unknown>;
	const out: PageBackground = {};
	const color = safeColor(v.color);
	if (color) out.color = color;
	const image = safeUrl(v.image);
	if (image) out.image = image;
	const video = safeUrl(v.video);
	if (video) out.video = video;
	if (v.size === "cover" || v.size === "contain" || v.size === "tile") out.size = v.size;
	if (v.position === "top" || v.position === "center" || v.position === "bottom") out.position = v.position;
	if (v.fixed === true) out.fixed = true;
	const phoneImage = safeUrl(v.phoneImage);
	if (phoneImage) out.phoneImage = phoneImage;
	return out.color || out.image || out.video || out.phoneImage ? out : undefined;
}

/**
 * The page background as CSS: on the root element (so it fills the window)
 * with the body see-through over it. Specific enough to beat the site's own
 * page background.
 */
export function pageBackgroundCss(value: unknown, phoneBreakpoint: number): string | undefined {
	const bg = cleanPageBackground(value);
	if (!bg) return undefined;
	const size = bg.size ?? "cover";
	const decls = [
		bg.color ? `background-color: ${bg.color}` : "",
		bg.image ? `background-image: url("${bg.image}")` : "background-image: none",
		`background-size: ${size === "tile" ? "auto" : size}`,
		`background-repeat: ${size === "tile" ? "repeat" : "no-repeat"}`,
		`background-position: center ${bg.position ?? "center"}`,
		`background-attachment: ${bg.fixed ? "fixed" : "scroll"}`,
		"min-height: 100%",
	].filter(Boolean);
	let css = `:root:root:root { ${decls.join("; ")}; } :root:root:root body { background: transparent; }`;
	if (bg.phoneImage) css += ` @media (max-width: ${phoneBreakpoint}px) { :root:root:root { background-image: url("${bg.phoneImage}"); background-attachment: scroll; } }`;
	return css;
}

/** The looping video behind the page, if there is one. */
export function pageBackgroundVideo(value: unknown): { src: string; poster?: string } | null {
	const bg = cleanPageBackground(value);
	return bg?.video ? { src: bg.video, ...(bg.image ? { poster: bg.image } : {}) } : null;
}
