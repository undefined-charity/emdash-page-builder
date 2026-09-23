/**
 * Plain-text fields inside a block's preview, edited in place.
 *
 * Site blocks that show another entry's fields (an event's name, date, venue)
 * mark them with EmDash's own edit annotation, `data-emdash-ref` =
 * {"collection","id","field"}. Inside the builder those previews are static
 * copies, so EmDash's inline editing can't reach them; this makes each marked
 * text field editable right there and saves it to its entry as a draft.
 * Drafts saved this way are published with the page (see `fieldEdits`).
 */
import * as React from "react";

import { ConflictError, LockedError, loadLatest, saveEntry } from "./api.js";

interface Ref {
	collection: string;
	id: string;
	field: string;
}

// ── Entries with unpublished field edits ──────────────────────────────────────

interface Pending {
	collection: string;
	id: string;
	label: string;
}

let pending = new Map<string, Pending>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const fieldEdits = {
	add(p: Pending) {
		pending = new Map(pending).set(`${p.collection}/${p.id}`, p);
		emit();
	},
	/** Forget an entry once it has been published (by the page, or its own editor). */
	published(collection: string, id: string) {
		if (!pending.has(`${collection}/${id}`)) return;
		pending = new Map(pending);
		pending.delete(`${collection}/${id}`);
		emit();
	},
	list: () => [...pending.values()],
	subscribe(l: () => void) {
		listeners.add(l);
		return () => listeners.delete(l);
	},
};

let snapshot: Pending[] = [];
let snapshotOf: Map<string, Pending> | null = null;
export function usePendingFieldEdits(): Pending[] {
	return React.useSyncExternalStore(
		fieldEdits.subscribe,
		() => {
			if (snapshotOf !== pending) {
				snapshotOf = pending;
				snapshot = [...pending.values()];
			}
			return snapshot;
		},
		() => snapshot,
	);
}

// ── Saving ────────────────────────────────────────────────────────────────────

async function saveField(ref: Ref, value: string): Promise<void> {
	let overrideLock = false;
	for (let attempt = 0; attempt < 3; attempt++) {
		const { rev } = await loadLatest(ref.collection, ref.id);
		try {
			await saveEntry(ref.collection, ref.id, { [ref.field]: value }, { rev, overrideLock });
			return;
		} catch (e) {
			// Someone has the entry open in the admin: ask before writing over it.
			if (e instanceof LockedError && !overrideLock) {
				if (!window.confirm(`${e.holder} has this entry open in the admin. Save your change anyway?`)) throw e;
				overrideLock = true;
				continue;
			}
			// Someone saved in between: re-read and try once more.
			if (!(e instanceof ConflictError) || attempt === 2) throw e;
		}
	}
}

function parseRef(el: HTMLElement): Ref | null {
	try {
		const ref = JSON.parse(el.dataset.emdashRef ?? el.dataset.pbFieldRef ?? "") as Partial<Ref>;
		return ref.collection && ref.id && ref.field ? { collection: ref.collection, id: ref.id, field: ref.field } : null;
	} catch {
		return null;
	}
}

/** Rich-text fields are rendered as blocks; only plain text is edited here. */
const BLOCK_CHILDREN = "p,div,section,article,figure,ul,ol,li,table,h1,h2,h3,h4,h5,h6,img,picture,video,iframe";

/** A name for the entry, for the Publish button: its title or name as shown in the same preview. */
function entryLabel(container: HTMLElement, ref: Ref): string {
	for (const el of container.querySelectorAll<HTMLElement>("[data-emdash-ref], [data-pb-field-ref]")) {
		const other = parseRef(el);
		if (other?.id === ref.id && (other.field === "name" || other.field === "title") && el.textContent?.trim()) return el.textContent.trim();
	}
	return `an entry in ${ref.collection}`;
}

/**
 * Make the marked fields in `container` editable. Returns a cleanup that
 * restores them. Fields inside an embedded editor are left to that editor.
 */
export function attachFieldEditing(container: HTMLElement): () => void {
	const cleanups: Array<() => void> = [];
	for (const el of container.querySelectorAll<HTMLElement>("[data-emdash-ref]")) {
		if (el.closest(".pb-embedded-editor, [data-pb-embed]")) continue;
		if (el.querySelector(BLOCK_CHILDREN)) continue;
		const ref = parseRef(el);
		if (!ref) continue;

		let original = el.textContent ?? "";
		let saving = false;
		// EmDash's own visual editing opens its admin form when an annotated
		// element is clicked; move the annotation aside while it's edited here.
		const annotation = el.dataset.emdashRef!;
		delete el.dataset.emdashRef;
		el.dataset.pbFieldRef = annotation;
		el.contentEditable = "plaintext-only";
		el.spellcheck = true;
		el.classList.add("pb-ed-field");
		el.title = "Click to edit. Saves to its own entry; publishes with the page.";

		const onFocus = () => {
			original = el.textContent ?? "";
		};
		const onKey = (e: KeyboardEvent) => {
			e.stopPropagation();
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				el.blur();
			} else if (e.key === "Escape") {
				e.preventDefault();
				el.textContent = original;
				el.blur();
			}
		};
		const onBlur = async () => {
			const value = (el.textContent ?? "").replace(/\s+/g, " ").trim();
			if (saving || value === original.replace(/\s+/g, " ").trim()) return;
			saving = true;
			el.classList.remove("pb-ed-field--error");
			el.classList.add("pb-ed-field--saving");
			try {
				await saveField(ref, value);
				original = value;
				el.textContent = value;
				fieldEdits.add({ collection: ref.collection, id: ref.id, label: entryLabel(container, ref) });
				el.classList.add("pb-ed-field--saved");
				setTimeout(() => el.classList.remove("pb-ed-field--saved"), 1500);
			} catch (e) {
				el.textContent = original;
				el.classList.add("pb-ed-field--error");
				el.title = `Couldn't save: ${e instanceof Error ? e.message : e}`;
			} finally {
				el.classList.remove("pb-ed-field--saving");
				saving = false;
			}
		};
		el.addEventListener("focus", onFocus);
		el.addEventListener("keydown", onKey);
		el.addEventListener("blur", onBlur);
		cleanups.push(() => {
			el.removeEventListener("focus", onFocus);
			el.removeEventListener("keydown", onKey);
			el.removeEventListener("blur", onBlur);
			el.removeAttribute("contenteditable");
			delete el.dataset.pbFieldRef;
			el.dataset.emdashRef = annotation;
			el.classList.remove("pb-ed-field", "pb-ed-field--saving", "pb-ed-field--saved", "pb-ed-field--error");
		});
	}
	return () => cleanups.forEach((c) => c());
}
