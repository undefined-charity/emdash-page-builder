/**
 * Several builder documents can be editable on one page — the page itself plus
 * site regions like the header and footer. They share one ribbon and one side
 * panel, which belong to whichever document was last clicked into (the page's
 * own document to begin with).
 */
import * as React from "react";

let active: string | null = null;
const listeners = new Set<() => void>();

export function setActive(id: string) {
	if (active === id) return;
	active = id;
	listeners.forEach((l) => l());
}

/** Claim the chrome only if nobody has it yet (the page document mounts first in intent). */
export function claimIfFree(id: string) {
	if (active === null) setActive(id);
}

export function releaseIfActive(id: string) {
	if (active !== id) return;
	active = null;
	listeners.forEach((l) => l());
}

export function useIsActive(id: string): boolean {
	return React.useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		() => active === id,
		() => false,
	);
}

// ── Publishing everything on the page ─────────────────────────────────────────

/** An editable document on this page, as the ribbon's Publish sees it. */
export interface PublishableDocument {
	id: string;
	/** What it is, for Publish's tooltip ("This page", "Site header"). */
	label: string;
	unpublished: boolean;
	/** Save anything pending, then make it live. Throws if it can't. */
	publish: () => Promise<void>;
}

let documents = new Map<string, PublishableDocument>();
const documentListeners = new Set<() => void>();
const documentsChanged = () => documentListeners.forEach((l) => l());

export const publishable = {
	set(doc: PublishableDocument) {
		documents = new Map(documents).set(doc.id, doc);
		documentsChanged();
	},
	remove(id: string) {
		if (!documents.has(id)) return;
		documents = new Map(documents);
		documents.delete(id);
		documentsChanged();
	},
	list: () => [...documents.values()],
};

/** Every editable document on the page, updated as they change. */
export function usePublishable(): Map<string, PublishableDocument> {
	return React.useSyncExternalStore(
		(l) => {
			documentListeners.add(l);
			return () => documentListeners.delete(l);
		},
		() => documents,
		() => documents,
	);
}

// ── Refreshing every document's block previews ────────────────────────────────

/**
 * Site blocks render on the server, and their previews are fetched per
 * document. A change that shows in another document's blocks (a menu edited
 * from the Pages panel shows in the header's menu block) refreshes them all.
 */
const refreshListeners = new Set<() => void>();
export function onRefreshPreviews(l: () => void): () => void {
	refreshListeners.add(l);
	return () => refreshListeners.delete(l);
}
export function refreshAllPreviews(): void {
	refreshListeners.forEach((l) => l());
}
