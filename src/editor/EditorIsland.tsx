/**
 * Client entry, mounted only for editors in edit mode. Takes over the
 * server-rendered document: lifts the live previews of server-rendered blocks
 * out of it, hides it, and puts the editor in its place. The ribbon and side
 * panel go in a shadow root so the site's stylesheet can't restyle them (and
 * theirs can't leak into the page).
 */
import * as React from "react";
import { createRoot } from "react-dom/client";

import type { PTBlock } from "../convert/types.js";
import type { BuilderConfig } from "../schema/config.js";
import { harvestSlots } from "./api.js";
import chromeCss from "./chrome.css?inline";
import "./content.css";
import { previewStore, setEmbedMounter } from "./nodeviews.js";
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
	/** The server-rendered document to take over, when it isn't found by id (embedded editors). */
	root?: HTMLElement;
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
		const root = props.root ?? document.querySelector<HTMLElement>(`[data-pb-root="${CSS.escape(props.rootId)}"]`);
		if (root) {
			previewStore.set(harvestSlots(root.parentElement ?? document, props.rootId));
			// Not `hidden`: the builder's own `display` rule would beat the UA's.
			root.style.display = "none";
		}
		setReady(true);
		return () => {
			if (root) root.style.display = "";
		};
	}, [props.rootId, props.root]);

	if (!chrome || !ready) return null;
	return <PageEditor {...props} chrome={chrome} />;
}

/**
 * Mount an embedded document's editor (see PageBuilder's `embedded`) next to
 * its server-rendered markup, which it takes over. The outer editor's block
 * view calls this; the returned function unmounts it.
 */
setEmbedMounter((doc: HTMLElement) => {
	let props: Props;
	try {
		props = JSON.parse(doc.dataset.pbEmbed ?? "");
	} catch {
		return () => undefined;
	}
	const host = document.createElement("div");
	host.className = "pb-embedded-editor";
	doc.after(host);
	// Mounted and unmounted outside the outer editor's React render: TipTap
	// renders node views synchronously, and starting or stopping another root
	// in the middle of that leaves React without its hook dispatcher.
	let root: ReturnType<typeof createRoot> | null = null;
	let cancelled = false;
	queueMicrotask(() => {
		if (cancelled) return;
		root = createRoot(host);
		root.render(<EditorIsland {...props} root={doc} />);
	});
	return () => {
		cancelled = true;
		const r = root;
		setTimeout(() => {
			r?.unmount();
			host.remove();
		}, 0);
	};
});
