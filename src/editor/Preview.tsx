/**
 * Preview: the page as a visitor will see it once published, with every
 * unpublished change (the page's, the header's and footer's, embedded
 * entries') and none of the editor. On a desktop or a phone-sized screen.
 *
 * It's the same page loaded with `?pb-preview`, which PageBuilder renders
 * without the editor. Edit mode already serves every entry's latest draft.
 */
import * as React from "react";

import { PHONE_WIDTH, type Device } from "./device.js";

/** This page's address with the preview flag. */
export function previewUrl(href = location.href): string {
	const url = new URL(href);
	url.searchParams.set("pb-preview", "");
	return url.toString().replace("pb-preview=", "pb-preview");
}

export function PreviewOverlay({ device: initial, onClose }: { device: Device; onClose: () => void }) {
	const [device, setDevice] = React.useState<Device>(initial);
	const [url, setUrl] = React.useState(() => previewUrl());
	const [loading, setLoading] = React.useState(true);

	React.useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	// Links followed inside the preview stay previews.
	const onLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
		setLoading(false);
		const frame = e.currentTarget;
		try {
			const doc = frame.contentDocument;
			if (!doc) return;
			doc.addEventListener("click", (ev) => {
				const a = (ev.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
				if (!a || a.target === "_blank" || a.origin !== location.origin || a.getAttribute("href")?.startsWith("#")) return;
				ev.preventDefault();
				setLoading(true);
				setUrl(previewUrl(a.href));
			});
		} catch {
			/* another origin: nothing to do */
		}
	};

	return (
		<div className="pb-preview" role="dialog" aria-label="Preview">
			<header className="pb-preview__bar">
				<strong>Preview</strong>
				<span className="pb-hint">As visitors will see it once published, with your unpublished changes.</span>
				<div className="pb-seg pb-device" role="radiogroup" aria-label="Screen">
					<button type="button" role="radio" aria-checked={device === "desktop"} className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")} title="Desktop">
						🖥
					</button>
					<button type="button" role="radio" aria-checked={device === "phone"} className={device === "phone" ? "on" : ""} onClick={() => setDevice("phone")} title="Phone">
						📱
					</button>
				</div>
				<a className="pb-preview__open" href={url} target="_blank" rel="noreferrer" title="Open this preview in a new tab">
					Open in a new tab ↗
				</a>
				<button type="button" className="primary" onClick={onClose} title="Back to editing (Esc)">
					Done
				</button>
			</header>
			<div className={`pb-preview__stage pb-preview__stage--${device}`}>
				<iframe key={url} src={url} title="Page preview" onLoad={onLoad} style={device === "phone" ? { width: PHONE_WIDTH } : undefined} />
				{loading && <p className="pb-preview__loading">Loading the preview…</p>}
			</div>
		</div>
	);
}
