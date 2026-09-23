/**
 * Video and gallery markup, shared by the server renderer and the editor's
 * previews. Everything a visitor gets works without JavaScript: videos are an
 * iframe or a <video>, slideshows scroll and snap, and the full-screen viewer
 * is a popover.
 */
import { safeUrl } from "./style.js";

// ── Video ─────────────────────────────────────────────────────────────────────

export interface VideoOptions {
	autoplay?: boolean;
	loop?: boolean;
	controls?: boolean;
}

export type VideoSource = { kind: "youtube"; id: string } | { kind: "vimeo"; id: string } | { kind: "file"; url: string };

/** What a video URL points at: YouTube, Vimeo, or a file (an upload). */
export function videoSource(url: unknown): VideoSource | null {
	if (typeof url !== "string" || !url.trim()) return null;
	const u = url.trim();
	const yt = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)([\w-]{6,20})/i.exec(u);
	if (yt) return { kind: "youtube", id: yt[1] };
	const vimeo = /^(?:https?:\/\/)?(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{5,12})/i.exec(u);
	if (vimeo) return { kind: "vimeo", id: vimeo[1] };
	const file = safeUrl(u);
	return file ? { kind: "file", url: file } : null;
}

/** The embed address for a hosted video, with its playback options. */
export function videoEmbedUrl(source: VideoSource, o: VideoOptions): string | null {
	if (source.kind === "youtube") {
		const q = new URLSearchParams({ rel: "0", playsinline: "1" });
		if (o.autoplay) q.set("autoplay", "1"), q.set("mute", "1");
		if (o.loop) q.set("loop", "1"), q.set("playlist", source.id);
		if (o.controls === false) q.set("controls", "0");
		return `https://www.youtube-nocookie.com/embed/${source.id}?${q}`;
	}
	if (source.kind === "vimeo") {
		const q = new URLSearchParams({ dnt: "1" });
		if (o.autoplay) q.set("autoplay", "1"), q.set("muted", "1");
		if (o.loop) q.set("loop", "1");
		if (o.controls === false) q.set("controls", "0");
		return `https://player.vimeo.com/video/${source.id}?${q}`;
	}
	return null;
}

type Dom = [string, Record<string, unknown>, ...unknown[]];

/** The player: an iframe for YouTube and Vimeo, a <video> for a file. */
export function videoDom(attrs: Record<string, unknown>): Dom | null {
	const source = videoSource(attrs.src);
	if (!source) return null;
	const o: VideoOptions = { autoplay: attrs.autoplay === true, loop: attrs.loop === true, controls: attrs.controls !== false };
	if (source.kind === "file") {
		const poster = safeUrl(attrs.poster);
		return [
			"video",
			{
				src: source.url,
				...(poster ? { poster } : {}),
				...(o.controls ? { controls: "" } : {}),
				// Browsers only autoplay muted video.
				...(o.autoplay ? { autoplay: "", muted: "" } : {}),
				...(o.loop ? { loop: "" } : {}),
				playsinline: "",
				preload: o.autoplay ? "auto" : "metadata",
			},
			// Fallback content, which also keeps the element from being written
			// as `<video/>`: HTML has no self-closing video, so that would swallow
			// the rest of the page.
			["a", { href: source.url }, "Download the video"],
		];
	}
	return [
		"iframe",
		{
			src: videoEmbedUrl(source, o),
			title: typeof attrs.title === "string" && attrs.title ? attrs.title : "Video",
			loading: "lazy",
			allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
			allowfullscreen: "",
			referrerpolicy: "strict-origin-when-cross-origin",
		},
	];
}

// ── Gallery ───────────────────────────────────────────────────────────────────

export interface GalleryImage {
	src: string;
	mediaId?: string | null;
	alt?: string;
	caption?: string;
	width?: number | null;
	height?: number | null;
}

export const GALLERY_LAYOUTS = ["grid", "masonry", "slideshow"] as const;
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number];

export function cleanGalleryImages(value: unknown): GalleryImage[] {
	if (!Array.isArray(value)) return [];
	const out: GalleryImage[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== "object") continue;
		const r = raw as Record<string, unknown>;
		const src = safeUrl(r.src);
		if (!src) continue;
		out.push({
			src,
			...(typeof r.mediaId === "string" && r.mediaId ? { mediaId: r.mediaId } : {}),
			...(typeof r.alt === "string" && r.alt ? { alt: r.alt } : {}),
			...(typeof r.caption === "string" && r.caption ? { caption: r.caption } : {}),
			...(typeof r.width === "number" ? { width: r.width } : {}),
			...(typeof r.height === "number" ? { height: r.height } : {}),
		});
	}
	return out;
}

/**
 * A gallery's figures. With `viewer`, each image opens full-screen in a
 * popover (no JavaScript), which `id` keeps apart from other galleries'.
 */
export function galleryDom(attrs: Record<string, unknown>, id: string): unknown[] {
	const images = cleanGalleryImages(attrs.images);
	const viewer = attrs.lightbox !== false;
	const safeId = id.replace(/[^\w-]/g, "") || "g";
	return images.map((img, i) => {
		const pic = ["img", { src: img.src, alt: img.alt ?? "", loading: "lazy", decoding: "async", ...(img.width ? { width: img.width } : {}), ...(img.height ? { height: img.height } : {}) }];
		const pop = `pb-lb-${safeId}-${i}`;
		const children: unknown[] = viewer
			? [
					["button", { type: "button", class: "pb-gallery__open", popovertarget: pop, "aria-label": `View ${img.alt || `image ${i + 1}`} full screen` }, pic],
					[
						"div",
						{ id: pop, popover: "", class: "pb-lightbox" },
						["img", { src: img.src, alt: img.alt ?? "", loading: "lazy", decoding: "async" }],
						...(img.caption ? [["p", { class: "pb-lightbox__caption" }, img.caption]] : []),
						["button", { type: "button", class: "pb-lightbox__close", popovertarget: pop, popovertargetaction: "hide", "aria-label": "Close" }, "×"],
					],
				]
			: [pic];
		if (img.caption) children.push(["figcaption", {}, img.caption]);
		return ["figure", { class: "pb-gallery__item" }, ...children];
	});
}
