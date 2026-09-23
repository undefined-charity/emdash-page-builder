/** Media library picker (with upload), reusable-block picker, and a text prompt. */
import * as React from "react";

import { listEntries, listImages, uploadImage, type EntrySummary, type MediaItem } from "./api.js";
import { Field, Modal, TextInput } from "./ui.js";

export function mediaToImageAttrs(item: MediaItem): Record<string, unknown> {
	return { src: item.url, mediaId: item.id, alt: item.alt, width: item.width, height: item.height };
}

export function MediaDialog({ onPick, onClose }: { onPick: (item: MediaItem) => void; onClose: () => void }) {
	const [items, setItems] = React.useState<MediaItem[]>([]);
	const [cursor, setCursor] = React.useState<string | undefined>();
	const [loading, setLoading] = React.useState(true);
	const [uploading, setUploading] = React.useState(0);
	const [error, setError] = React.useState<string | null>(null);
	const [query, setQuery] = React.useState("");
	const fileInput = React.useRef<HTMLInputElement>(null);

	const load = React.useCallback(async (next?: string) => {
		setLoading(true);
		try {
			const page = await listImages(next);
			setItems((prev) => (next ? [...prev, ...page.items] : page.items));
			setCursor(page.nextCursor);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);
	React.useEffect(() => {
		void load();
	}, [load]);

	const upload = async (files: FileList | File[]) => {
		const list = [...files].filter((f) => f.type.startsWith("image/"));
		if (!list.length) return;
		setError(null);
		setUploading((n) => n + list.length);
		let last: MediaItem | undefined;
		for (const file of list) {
			try {
				last = await uploadImage(file);
				setItems((prev) => [last!, ...prev]);
			} catch (e) {
				setError(`${file.name}: ${e instanceof Error ? e.message : e}`);
			} finally {
				setUploading((n) => n - 1);
			}
		}
		// One file uploaded: use it straight away, like dropping it on the page.
		if (list.length === 1 && last) onPick(last);
	};

	const shown = query ? items.filter((i) => `${i.filename} ${i.alt}`.toLowerCase().includes(query.toLowerCase())) : items;

	return (
		<Modal title="Choose an image" onClose={onClose} wide>
			<div
				className="pb-media"
				onDragOver={(e) => e.preventDefault()}
				onDrop={(e) => {
					e.preventDefault();
					void upload(e.dataTransfer.files);
				}}
			>
				<div className="pb-media__bar">
					<button type="button" className="primary" onClick={() => fileInput.current?.click()}>
						⤒ Upload from this computer
					</button>
					<input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
					<input type="search" placeholder="Search the media library" value={query} onChange={(e) => setQuery(e.target.value)} />
				</div>
				<p className="pb-hint">Uploads are added to the site's media library. You can also drop image files here.</p>
				{uploading > 0 && <p className="pb-hint">Uploading {uploading}…</p>}
				{error && <p className="pb-error">{error}</p>}
				<div className="pb-media__grid">
					{shown.map((item) => (
						<button key={item.id} type="button" className="pb-media__item" onClick={() => onPick(item)} title={item.filename}>
							<img src={item.url} alt={item.alt} loading="lazy" />
						</button>
					))}
				</div>
				{loading && <p className="pb-hint">Loading…</p>}
				{!loading && shown.length === 0 && <p className="pb-empty">No images yet — upload one.</p>}
				{cursor && !loading && (
					<button type="button" onClick={() => load(cursor)}>
						Load more
					</button>
				)}
			</div>
		</Modal>
	);
}

export function ReusableDialog({ collection, onPick, onClose }: { collection: string; onPick: (e: EntrySummary) => void; onClose: () => void }) {
	const [entries, setEntries] = React.useState<EntrySummary[] | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [query, setQuery] = React.useState("");
	React.useEffect(() => {
		listEntries(collection)
			.then(setEntries)
			.catch((e) => setError(e instanceof Error ? e.message : String(e)));
	}, [collection]);
	// `site-*` entries are regions (the header, the footer), not snippets to drop into a page.
	const shown = (entries ?? []).filter((e) => !e.slug?.startsWith("site-") && (!query || e.title.toLowerCase().includes(query.toLowerCase())));
	return (
		<Modal title="Insert a reusable block" onClose={onClose}>
			<p className="pb-hint">A reusable block is shared: change it once and every page using it updates. Make one by selecting any block and choosing ♻ in the side panel.</p>
			<input type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
			{error && <p className="pb-error">{error}</p>}
			{entries === null && !error && <p className="pb-hint">Loading…</p>}
			<ul className="pb-list">
				{shown.map((e) => (
					<li key={e.id}>
						<button type="button" onClick={() => onPick(e)}>
							<strong>{e.title}</strong>
							{e.status !== "published" && <span className="pb-tag">{e.status}</span>}
						</button>
					</li>
				))}
			</ul>
			{entries?.length === 0 && <p className="pb-empty">No reusable blocks yet.</p>}
		</Modal>
	);
}

export function PromptDialog({
	title,
	label,
	initial = "",
	confirm,
	onSubmit,
	onClose,
}: {
	title: string;
	label: string;
	initial?: string;
	confirm: string;
	onSubmit: (value: string) => void;
	onClose: () => void;
}) {
	const [value, setValue] = React.useState(initial);
	return (
		<Modal title={title} onClose={onClose}>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					if (value.trim()) onSubmit(value.trim());
				}}
			>
				<Field label={label}>
					<TextInput value={value} onChange={setValue} />
				</Field>
				<div className="pb-row pb-row--end">
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button type="submit" className="primary" disabled={!value.trim()}>
						{confirm}
					</button>
				</div>
			</form>
		</Modal>
	);
}
