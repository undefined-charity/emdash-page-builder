/**
 * Everything the editor asks of the server, through EmDash's own admin API
 * (same session cookie as the admin; `X-EmDash-Request` satisfies CSRF).
 */

const API = "/_emdash/api";

/** The entry changed since this editor loaded it (another tab, another person). */
export class ConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConflictError";
	}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set("X-EmDash-Request", "1");
	if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
	const res = await fetch(path.startsWith("/") ? path : `${API}/${path}`, { credentials: "same-origin", ...init, headers });
	const text = await res.text();
	let json: { success?: boolean; data?: T; error?: { message?: string } } | undefined;
	try {
		json = text ? JSON.parse(text) : undefined;
	} catch {
		/* not JSON */
	}
	if (!res.ok || json?.success === false) {
		const message = json?.error?.message ?? `${res.status} ${res.statusText}`.trim();
		if (res.status === 409) throw new ConflictError(message);
		throw new Error(message);
	}
	return (json && "data" in json ? json.data : json) as T;
}

// ── Content ───────────────────────────────────────────────────────────────────

/**
 * Save fields on an entry. With `rev`, the server refuses (ConflictError) if
 * the entry changed since that revision; returns the entry's new `rev`.
 */
export async function saveEntry(
	collection: string,
	id: string,
	data: Record<string, unknown>,
	options: { keepalive?: boolean; rev?: string } = {},
): Promise<string | undefined> {
	const result = await request<{ _rev?: string }>(`${API}/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
		method: "PUT",
		body: JSON.stringify({ data, ...(options.rev ? { _rev: options.rev } : {}) }),
		keepalive: options.keepalive,
	});
	return result?._rev;
}

/**
 * The entry as it is now: its revision token and the working copy of its
 * fields — the unpublished draft if there is one, otherwise what's live.
 */
export async function loadLatest(
	collection: string,
	id: string,
): Promise<{ rev?: string; data: Record<string, unknown>; unpublished: boolean }> {
	const got = await request<{
		item?: { data?: Record<string, unknown>; draftRevisionId?: string | null; liveRevisionId?: string | null; status?: string };
		_rev?: string;
	}>(`${API}/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`);
	let data = got.item?.data ?? {};
	const draftId = got.item?.draftRevisionId;
	const unpublished = got.item?.status !== "published" || (!!draftId && draftId !== got.item?.liveRevisionId);
	if (draftId) {
		const rev = await request<{ item?: { data?: Record<string, unknown> }; data?: Record<string, unknown> }>(`${API}/revisions/${encodeURIComponent(draftId)}`);
		data = rev.item?.data ?? rev.data ?? data;
	}
	return { rev: got._rev, data, unpublished };
}

export interface EntrySummary {
	id: string;
	slug: string | null;
	title: string;
	status: string;
}

export async function listEntries(collection: string): Promise<EntrySummary[]> {
	const data = await request<{ items?: Array<Record<string, unknown>> }>(`${API}/content/${encodeURIComponent(collection)}?limit=100`);
	return (data.items ?? []).map((it) => ({
		id: String(it.id),
		slug: (it.slug as string | null) ?? null,
		title: String(it.title ?? (it.data as Record<string, unknown> | undefined)?.title ?? it.slug ?? it.id),
		status: String(it.status ?? ""),
	}));
}

export async function getEntryField(collection: string, id: string, field: string): Promise<unknown> {
	const data = await request<{ item?: { data?: Record<string, unknown> } }>(`${API}/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`);
	return data.item?.data?.[field];
}

/** Create and publish an entry — reusable blocks must be live to render. */
export async function createPublishedEntry(collection: string, data: Record<string, unknown>): Promise<string> {
	const created = await request<{ item?: { id?: string } }>(`${API}/content/${encodeURIComponent(collection)}`, {
		method: "POST",
		body: JSON.stringify({ data }),
	});
	const id = created.item?.id;
	if (!id) throw new Error("The server did not return the new entry");
	await request(`${API}/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/publish`, { method: "POST", body: "{}" });
	return id;
}

export async function publishEntry(collection: string, id: string): Promise<void> {
	await request(`${API}/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/publish`, { method: "POST", body: "{}" });
}

// ── Media ─────────────────────────────────────────────────────────────────────

export interface MediaItem {
	id: string;
	url: string;
	filename: string;
	alt: string;
	width: number | null;
	height: number | null;
}

function toMediaItem(raw: Record<string, unknown>): MediaItem {
	const storageKey = typeof raw.storageKey === "string" ? raw.storageKey : "";
	return {
		id: String(raw.id),
		url: (raw.url as string) || (storageKey ? `${API}/media/file/${storageKey}` : `${API}/media/file/${raw.id}`),
		filename: String(raw.filename ?? ""),
		alt: String(raw.alt ?? ""),
		width: typeof raw.width === "number" ? raw.width : null,
		height: typeof raw.height === "number" ? raw.height : null,
	};
}

export async function listImages(cursor?: string): Promise<{ items: MediaItem[]; nextCursor?: string }> {
	const q = new URLSearchParams({ limit: "60", mimeType: "image/" });
	if (cursor) q.set("cursor", cursor);
	const data = await request<{ items?: Array<Record<string, unknown>>; nextCursor?: string }>(`${API}/media?${q}`);
	return { items: (data.items ?? []).map(toMediaItem), nextCursor: data.nextCursor };
}

function imageSize(file: File): Promise<{ width?: number; height?: number }> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
			URL.revokeObjectURL(img.src);
		};
		img.onerror = () => resolve({});
		img.src = URL.createObjectURL(file);
	});
}

export async function uploadImage(file: File): Promise<MediaItem> {
	const dims = await imageSize(file);
	const form = new FormData();
	form.append("file", file);
	if (dims.width) form.append("width", String(dims.width));
	if (dims.height) form.append("height", String(dims.height));
	const data = await request<{ item?: Record<string, unknown> }>(`${API}/media`, { method: "POST", body: form });
	if (!data.item) throw new Error("Upload failed");
	const item = toMediaItem(data.item);
	return { ...item, width: item.width ?? dims.width ?? null, height: item.height ?? dims.height ?? null };
}

// ── Previews of server-rendered blocks ────────────────────────────────────────

/**
 * Re-fetch the current page and lift out the rendered markup of every
 * server-rendered block, keyed by block key. Used after a save, so a block
 * inserted or re-configured in the editor shows its real output.
 */
export async function fetchSlotPreviews(rootId: string): Promise<Record<string, string>> {
	const res = await fetch(location.href, { credentials: "same-origin", cache: "no-store" });
	const html = await res.text();
	const doc = new DOMParser().parseFromString(html, "text/html");
	return harvestSlots(doc, rootId);
}

export function harvestSlots(doc: Document | Element, rootId: string): Record<string, string> {
	const root = doc.querySelector(`[data-pb-root="${CSS.escape(rootId)}"]`);
	const out: Record<string, string> = {};
	root?.querySelectorAll<HTMLElement>("[data-pb-slot]").forEach((el) => {
		// Only this document's own slots, not ones inside a nested reusable block.
		if (el.parentElement?.closest("[data-pb-slot]")) return;
		out[el.dataset.pbSlot!] = el.innerHTML;
	});
	return out;
}

export async function loadOptions(url: string): Promise<Array<{ label: string; value: string }>> {
	const data = await request<{ options?: Array<{ label: string; value: string }>; items?: Array<Record<string, unknown>> } | Array<{ label: string; value: string }>>(url);
	if (Array.isArray(data)) return data;
	if (data.options) return data.options;
	return (data.items ?? []).map((it) => ({ label: String(it.name ?? it.title ?? it.label ?? it.id), value: String(it.id ?? it.value) }));
}

// ── Site design ───────────────────────────────────────────────────────────────

const PLUGIN = `${API}/plugins/page-builder`;

export async function loadSiteTheme(): Promise<Record<string, string>> {
	const data = await request<{ theme?: Record<string, string> }>(`${PLUGIN}/site-theme`);
	return data.theme ?? {};
}

export async function saveSiteTheme(theme: Record<string, string>): Promise<void> {
	await request(`${PLUGIN}/site-theme-save`, { method: "POST", body: JSON.stringify({ theme }) });
}
