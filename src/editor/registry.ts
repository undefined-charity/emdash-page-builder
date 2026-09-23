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
