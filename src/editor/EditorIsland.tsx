/**
 * Client entry, mounted only for editors in edit mode. Takes over the
 * server-rendered document: lifts the live previews of server-rendered blocks
 * out of it, hides it, and puts the editor in its place. The ribbon and side
 * panel go in a shadow root so the site's stylesheet can't restyle them (and
 * theirs can't leak into the page).
 */
import * as React from "react";

import type { PTBlock } from "../convert/types.js";
import type { BuilderConfig } from "../schema/config.js";
import { harvestSlots } from "./api.js";
import chromeCss from "./chrome.css?inline";
import "./content.css";
import { previewStore } from "./nodeviews.js";
import { PageEditor } from "./PageEditor.js";

interface Props {
	rootId: string;
	value: PTBlock[];
	collection: string;
	entryId: string;
	field: string;
	themeField: string;
	title: string;
	theme: unknown;
	config: BuilderConfig;
	reusableTitles: Record<string, string>;
	region?: string;
}

/** One shadow root for the whole page, shared by every editable document. */
let sharedChrome: HTMLElement | null = null;
let users = 0;

function useChromeRoot(): HTMLElement | null {
	const [mount, setMount] = React.useState<HTMLElement | null>(null);
	React.useEffect(() => {
		if (!sharedChrome) {
			const host = document.createElement("div");
			host.setAttribute("data-pb-chrome", "");
			document.body.append(host);
			const shadow = host.attachShadow({ mode: "open" });
			const style = document.createElement("style");
			style.textContent = chromeCss;
			sharedChrome = document.createElement("div");
			shadow.append(style, sharedChrome);
		}
		users++;
		setMount(sharedChrome);
		return () => {
			users--;
			if (users === 0 && sharedChrome) {
				const root = sharedChrome.getRootNode();
				if (root instanceof ShadowRoot) root.host.remove();
				sharedChrome = null;
			}
		};
	}, []);
	return mount;
}

export default function EditorIsland(props: Props) {
	const chrome = useChromeRoot();
	const [ready, setReady] = React.useState(false);

	React.useEffect(() => {
		const root = document.querySelector<HTMLElement>(`[data-pb-root="${CSS.escape(props.rootId)}"]`);
		if (root) {
			previewStore.set(harvestSlots(document, props.rootId));
			// Not `hidden`: the builder's own `display` rule would beat the UA's.
			root.style.display = "none";
		}
		setReady(true);
		return () => {
			if (root) root.style.display = "";
		};
	}, [props.rootId]);

	if (!chrome || !ready) return null;
	return <PageEditor {...props} chrome={chrome} />;
}
