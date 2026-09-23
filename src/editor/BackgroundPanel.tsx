/**
 * Editing a page background (the Page tab) or the site's default one (the
 * Site tab), and showing it live on the page being edited.
 */
import * as React from "react";

import { cleanPageBackground, pageBackgroundCss, pageBackgroundVideo, type PageBackground } from "../schema/background.js";
import { ColorField, Field, Group, Segmented, Toggle } from "./ui.js";

type Kind = "none" | "color" | "image" | "video";

function kindOf(bg: PageBackground | undefined): Kind {
	if (!bg) return "none";
	if (bg.video) return "video";
	if (bg.image || bg.phoneImage) return "image";
	return bg.color ? "color" : "none";
}

export function BackgroundGroup({
	title,
	value,
	onChange,
	inheritedHint,
	palette,
	onPickImage,
	onPickVideo,
	extra,
}: {
	title: string;
	value: PageBackground | undefined;
	onChange: (bg: PageBackground | undefined) => void;
	/** Said when nothing is set: what shows instead. */
	inheritedHint: string;
	palette: Array<{ label: string; value: string }>;
	onPickImage: (onPick: (attrs: Record<string, unknown>) => void) => void;
	onPickVideo: (onPick: (attrs: Record<string, unknown>) => void) => void;
	extra?: React.ReactNode;
}) {
	const bg = value ?? {};
	const [kind, setKind] = React.useState<Kind>(() => kindOf(value));
	const set = (patch: Partial<PageBackground>) => onChange(cleanPageBackground({ ...bg, ...patch }));
	const pick = (k: Kind) => {
		setKind(k);
		if (k === "none") onChange(undefined);
		// Switching away drops what the other kinds set; the colour stays under an image.
		if (k === "color") onChange(cleanPageBackground({ color: bg.color }));
		if (k === "image") onChange(cleanPageBackground({ ...bg, video: undefined }));
	};
	const image = (label: string, key: "image" | "phoneImage", hint?: string) => (
		<div className="pb-field">
			<span className="pb-field__label">
				{label}
				{bg[key] && (
					<button type="button" className="pb-link" onClick={() => set({ [key]: undefined })}>
						remove
					</button>
				)}
			</span>
			{bg[key] && <img className="pb-bg-thumb" src={bg[key]} alt="" />}
			<button type="button" onClick={() => onPickImage((img) => set({ [key]: String(img.src) }))}>
				{bg[key] ? "Change image…" : "Choose image…"}
			</button>
			{hint && <span className="pb-field__hint">{hint}</span>}
		</div>
	);
	return (
		<Group title={title} defaultOpen={Boolean(value)}>
			<Segmented
				value={kind}
				onChange={pick}
				options={[
					{ label: "None", value: "none", title: inheritedHint },
					{ label: "Colour", value: "color" },
					{ label: "Image", value: "image" },
					{ label: "Video", value: "video" },
				]}
			/>
			{kind === "none" && <p className="pb-hint">{inheritedHint}</p>}
			{kind !== "none" && <ColorField label={kind === "color" ? "Colour" : "Colour behind it"} value={bg.color} onChange={(color) => set({ color })} palette={palette} />}
			{kind === "video" && (
				<div className="pb-field">
					<span className="pb-field__label">Video</span>
					<button type="button" onClick={() => onPickVideo((v) => set({ video: String(v.src) }))}>
						{bg.video ? "Change video…" : "Choose a video…"}
					</button>
					<span className="pb-field__hint">Plays muted, on a loop, behind the page.</span>
				</div>
			)}
			{(kind === "image" || kind === "video") && (
				<>
					{image(kind === "video" ? "Still picture" : "Image", "image", kind === "video" ? "Shown before the video plays, to anyone who prefers less motion, and where a phone won't play it by itself." : undefined)}
					<Field label="Fit">
						<Segmented
							value={bg.size ?? "cover"}
							onChange={(size) => set({ size })}
							options={[
								{ label: "Fill", value: "cover", title: "Fill the window, cropping if needed" },
								{ label: "Fit", value: "contain", title: "Show the whole image" },
								{ label: "Tile", value: "tile", title: "Repeat it" },
							]}
						/>
					</Field>
					<Field label="Keep in view">
						<Segmented
							value={bg.position ?? "center"}
							onChange={(position) => set({ position })}
							options={[
								{ label: "Top", value: "top" },
								{ label: "Middle", value: "center" },
								{ label: "Bottom", value: "bottom" },
							]}
						/>
					</Field>
					{kind === "image" && <Toggle checked={bg.fixed === true} onChange={(fixed) => set({ fixed })} label="Stays put while the page scrolls" />}
					{image("On phones", "phoneImage", "Optional: a different image for phones, such as a taller crop.")}
				</>
			)}
			{extra}
		</Group>
	);
}

/** Show a page background on the page being edited (the same markup PageBuilder renders). */
export function showPageBackground(value: PageBackground | undefined, phoneBreakpoint: number) {
	let style = document.querySelector<HTMLStyleElement>("style[data-pb-page-bg-css]");
	const css = pageBackgroundCss(value, phoneBreakpoint);
	if (css) {
		if (!style) {
			style = document.createElement("style");
			style.setAttribute("data-pb-page-bg-css", "");
			document.head.append(style);
		}
		if (style.textContent !== css) style.textContent = css;
	} else style?.remove();

	let holder = document.querySelector<HTMLElement>("[data-pb-page-bg]");
	const video = pageBackgroundVideo(value);
	if (!video) {
		holder?.remove();
		return;
	}
	if (!holder) {
		holder = document.createElement("div");
		holder.className = "pb-page-bg";
		holder.setAttribute("data-pb-page-bg", "");
		holder.setAttribute("aria-hidden", "true");
		document.body.prepend(holder);
	}
	let el = holder.querySelector("video");
	if (!el) {
		el = document.createElement("video");
		Object.assign(el, { autoplay: true, muted: true, loop: true, playsInline: true });
		holder.append(el);
	}
	if (el.getAttribute("src") !== video.src) {
		el.src = video.src;
		// Set from script, `autoplay` alone doesn't always start it.
		void el.play().catch(() => undefined);
	}
	if (video.poster) el.poster = video.poster;
	else el.removeAttribute("poster");
}
