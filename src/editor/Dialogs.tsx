/** Media library picker (with upload), reusable-block picker, and a text prompt. */
import * as React from "react";

import { listEntries, listFolders, listImages, uploadImage, type EntrySummary, type MediaFolder, type MediaItem } from "./api.js";
import { Field, Modal, TextInput } from "./ui.js";

export function mediaToImageAttrs(item: MediaItem): Record<string, unknown> {
	return { src: item.url, mediaId: item.id, alt: item.alt, width: item.width, height: item.height };
}

/** "unfiled" = the main library; "" = everything; otherwise a folder id. Remembered for the session. */
const FOLDER_KEY = "pb-media-folder";
function rememberedFolder(): string {
	try {
		return sessionStorage.getItem(FOLDER_KEY) ?? "unfiled";
	} catch {
		return "unfiled";
	}
}

export function MediaDialog({
	onPick,
	onClose,
	kind = "image",
	onPickMany,
}: {
	onPick: (item: MediaItem) => void;
	onClose: () => void;
	/** Images (the default) or videos. */
	kind?: "image" | "video";
	/** Pick several: clicking selects, and a button adds them all. */
	onPickMany?: (items: MediaItem[]) => void;
}) {
	const [picked, setPicked] = React.useState<MediaItem[]>([]);
	const choose = (item: MediaItem) => {
		if (!onPickMany) return onPick(item);
		setPicked((prev) => (prev.some((p) => p.id === item.id) ? prev.filter((p) => p.id !== item.id) : [...prev, item]));
	};
	const noun = kind === "video" ? "video" : "image";
	const [items, setItems] = React.useState<MediaItem[]>([]);
	const [cursor, setCursor] = React.useState<string | undefined>();
	const [loading, setLoading] = React.useState(true);
	const [uploading, setUploading] = React.useState(0);
	const [error, setError] = React.useState<string | null>(null);
	const [query, setQuery] = React.useState("");
	const [search, setSearch] = React.useState("");
	// null until known; an empty list means folders exist but none were made yet.
	const [folders, setFolders] = React.useState<MediaFolder[] | null | undefined>(undefined);
	const [folder, setFolder] = React.useState<string>(rememberedFolder);
	const fileInput = React.useRef<HTMLInputElement>(null);

	React.useEffect(() => {
		listFolders().then((list) => {
			setFolders(list);
			// Without folder support there is only "everything".
			if (list === null) setFolder("");
			else if (folder && folder !== "unfiled" && !list.some((f) => f.id === folder)) setFolder("unfiled");
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Search the whole library on the server, a moment after typing stops.
	React.useEffect(() => {
		const t = setTimeout(() => setSearch(query.trim()), 300);
		return () => clearTimeout(t);
	}, [query]);

	const scope = search ? undefined : folder || undefined;
	const load = React.useCallback(
		async (next?: string) => {
			setLoading(true);
			try {
				const page = await listImages(next, { folderId: scope, search, kind });
				setItems((prev) => (next ? [...prev, ...page.items] : page.items));
				setCursor(page.nextCursor);
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				setLoading(false);
			}
		},
		[scope, search, kind],
	);
	React.useEffect(() => {
		if (folders === undefined) return;
		void load();
	}, [load, folders]);

	const chooseFolder = (id: string) => {
		setFolder(id);
		setQuery("");
		try {
			sessionStorage.setItem(FOLDER_KEY, id);
		} catch {
			/* private mode */
		}
	};

	const upload = async (files: FileList | File[]) => {
		const list = [...files].filter((f) => f.type.startsWith(`${kind}/`));
		if (!list.length) return;
		setError(null);
		setUploading((n) => n + list.length);
		let last: MediaItem | undefined;
		for (const file of list) {
			try {
				last = await uploadImage(file, folder || undefined);
				setItems((prev) => [last!, ...prev]);
				if (onPickMany) setPicked((prev) => [...prev, last!]);
			} catch (e) {
				setError(`${file.name}: ${e instanceof Error ? e.message : e}`);
			} finally {
				setUploading((n) => n - 1);
			}
		}
		// One file uploaded: use it straight away, like dropping it on the page.
		if (list.length === 1 && last && !onPickMany) onPick(last);
	};

	const folderName = folder === "unfiled" ? "the main library" : folders?.find((f) => f.id === folder)?.name ?? "the media library";

	return (
		<Modal title={onPickMany ? "Choose images" : `Choose ${kind === "video" ? "a video" : "an image"}`} onClose={onClose} wide>
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
					<input ref={fileInput} type="file" accept={`${kind}/*`} multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
					{folders && (
						<select value={folder} onChange={(e) => chooseFolder(e.target.value)} aria-label="Folder" disabled={!!search}>
							<option value="unfiled">Main library</option>
							{folders.map((f) => (
								<option key={f.id} value={f.id}>
									{f.name}
								</option>
							))}
							<option value="">All media</option>
						</select>
					)}
					<input type="search" placeholder="Search the whole media library" value={query} onChange={(e) => setQuery(e.target.value)} />
				</div>
				<p className="pb-hint">
					{search ? `Results for “${search}” from every folder.` : `Uploads go to ${folderName}. You can also drop ${noun} files here.`}
					{onPickMany && " Click images to select them, in the order you want."}
				</p>
				{uploading > 0 && <p className="pb-hint">Uploading {uploading}…</p>}
				{error && <p className="pb-error">{error}</p>}
				<div className="pb-media__grid">
					{items.map((item) => {
						const n = picked.findIndex((p) => p.id === item.id);
						return (
							<button key={item.id} type="button" className={`pb-media__item${n >= 0 ? " on" : ""}`} onClick={() => choose(item)} title={item.filename}>
								{kind === "video" ? <video src={item.url} preload="metadata" muted /> : <img src={item.url} alt={item.alt} loading="lazy" />}
								{n >= 0 && <span className="pb-media__badge">{n + 1}</span>}
							</button>
						);
					})}
				</div>
				{loading && <p className="pb-hint">Loading…</p>}
				{!loading && items.length === 0 && <p className="pb-empty">{search ? "Nothing matches that search." : `No ${noun}s here yet — upload one.`}</p>}
				{cursor && !loading && (
					<button type="button" onClick={() => load(cursor)}>
						Load more
					</button>
				)}
				{onPickMany && (
					<div className="pb-row pb-row--end pb-media__done">
						<button type="button" onClick={onClose}>
							Cancel
						</button>
						<button type="button" className="primary" disabled={!picked.length} onClick={() => onPickMany(picked)}>
							Add {picked.length || ""} {picked.length === 1 ? "image" : "images"}
						</button>
					</div>
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

/** Choose some of a collection's entries (pages), with checkboxes. */
export function PagesDialog({
	title,
	collection,
	exclude,
	confirm,
	hint,
	onConfirm,
	onClose,
}: {
	title: string;
	collection: string;
	exclude?: string;
	confirm: string;
	hint?: string;
	onConfirm: (entries: EntrySummary[]) => void;
	onClose: () => void;
}) {
	const [entries, setEntries] = React.useState<EntrySummary[] | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [chosen, setChosen] = React.useState<Set<string>>(new Set());
	const [query, setQuery] = React.useState("");
	React.useEffect(() => {
		listEntries(collection)
			.then((list) => setEntries(list.filter((e) => e.id !== exclude)))
			.catch((e) => setError(e instanceof Error ? e.message : String(e)));
	}, [collection, exclude]);
	const shown = (entries ?? []).filter((e) => !query || e.title.toLowerCase().includes(query.toLowerCase()));
	const toggle = (id: string) =>
		setChosen((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	return (
		<Modal title={title} onClose={onClose}>
			{hint && <p className="pb-hint">{hint}</p>}
			<input type="search" placeholder="Search pages" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
			{error && <p className="pb-error">{error}</p>}
			{entries === null && !error && <p className="pb-hint">Loading…</p>}
			<ul className="pb-list pb-checklist">
				{shown.map((e) => (
					<li key={e.id}>
						<label className="pb-toggle">
							<input type="checkbox" checked={chosen.has(e.id)} onChange={() => toggle(e.id)} />
							<span>{e.title}</span>
							{e.status !== "published" && <span className="pb-tag">{e.status}</span>}
						</label>
					</li>
				))}
			</ul>
			<div className="pb-row pb-row--end">
				<button type="button" onClick={onClose}>
					Cancel
				</button>
				<button type="button" className="primary" disabled={!chosen.size} onClick={() => onConfirm((entries ?? []).filter((e) => chosen.has(e.id)))}>
					{confirm}
					{chosen.size ? ` (${chosen.size})` : ""}
				</button>
			</div>
		</Modal>
	);
}
