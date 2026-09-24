/**
 * The Pages panel: the site's pages, without leaving the editor. Open one,
 * add one (blank or a copy), change a page's title, address, search
 * description and share image, put it in a menu, unpublish it or move it to
 * the trash. Pages the site routes specially (home, 404…) can't be renamed
 * or removed here.
 */
import * as React from "react";

import { refreshAllPreviews } from "./registry.js";
import { newPageBlocks, pageUrl, type BuilderConfig } from "../schema/config.js";
import {
	addMenuItem,
	createEntry,
	deleteMenuItem,
	duplicateEntry,
	getCollectionInfo,
	getEntry,
	getMenu,
	listEntries,
	listMenus,
	menuItemsLinking,
	saveEntry,
	trashEntry,
	unpublishEntry,
	type CollectionInfo,
	type EntrySeo,
	type EntrySummary,
} from "./api.js";
import { Field, Modal, TextInput, Toggle } from "./ui.js";

export interface PageMeta {
	data: Record<string, unknown>;
	slug?: string;
	seo?: EntrySeo;
}

export interface PagesPanelProps {
	config: BuilderConfig;
	/** The page being edited, whose changes go through its own editor. */
	current: { collection: string; id: string };
	saveCurrent: (meta: PageMeta) => Promise<void>;
	/** Another page's draft changed: publish it with this one. */
	onOtherChanged: (page: { collection: string; id: string; label: string }) => void;
	onPickImage: (onPick: (attrs: Record<string, unknown>) => void) => void;
	onClose: () => void;
}

export const slugify = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);

const DESCRIPTION_FIELDS = ["meta_description", "description", "seo_description", "excerpt", "summary"];

export function PagesPanel(props: PagesPanelProps) {
	const { config } = props;
	const collection = config.pages.collection;
	const [pages, setPages] = React.useState<EntrySummary[] | null>(null);
	const [info, setInfo] = React.useState<CollectionInfo | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [query, setQuery] = React.useState("");
	const [selected, setSelected] = React.useState<string | null>(props.current.collection === collection ? props.current.id : null);
	const [adding, setAdding] = React.useState(false);

	const reload = React.useCallback(() => {
		listEntries(collection)
			.then((list) => setPages(list.sort((a, b) => a.title.localeCompare(b.title))))
			.catch((e) => setError(e instanceof Error ? e.message : String(e)));
	}, [collection]);
	React.useEffect(() => {
		reload();
		getCollectionInfo(collection)
			.then(setInfo)
			.catch(() => setInfo({ urlPattern: null, hasSeo: false, fields: [] }));
	}, [collection, reload]);

	const urlOf = (slug: string | null) => pageUrl(config.pages, slug, info?.urlPattern ?? null);
	const shown = (pages ?? []).filter((p) => !query || `${p.title} ${p.slug}`.toLowerCase().includes(query.toLowerCase()));
	const page = pages?.find((p) => p.id === selected) ?? null;

	return (
		<Modal title="Pages" onClose={props.onClose} wide>
			<div className="pb-pages">
				<div className="pb-pages__list">
					<div className="pb-row">
						<input type="search" placeholder="Search pages" value={query} onChange={(e) => setQuery(e.target.value)} />
						<button type="button" className="primary" onClick={() => setAdding(true)}>
							+ New page
						</button>
					</div>
					{error && <p className="pb-error">{error}</p>}
					{pages === null && !error && <p className="pb-hint">Loading…</p>}
					<ul className="pb-list">
						{shown.map((p) => (
							<li key={p.id}>
								<button type="button" className={p.id === selected ? "on" : ""} onClick={() => setSelected(p.id)}>
									<span className="pb-pages__name">
										{p.title}
										<small>{urlOf(p.slug) ?? "no address"}</small>
									</span>
									<span className="pb-tag">{p.id === props.current.id ? "editing" : p.status === "published" ? "" : p.status}</span>
								</button>
							</li>
						))}
					</ul>
				</div>
				<div className="pb-pages__detail">
					{adding ? (
						<NewPage
							config={config}
							collection={collection}
							urlOf={urlOf}
							onCancel={() => setAdding(false)}
							onCreated={(url) => {
								if (url) location.assign(url);
							}}
						/>
					) : page && info ? (
						<PageSettings key={page.id} {...props} page={page} info={info} urlOf={urlOf} onChanged={reload} onGone={() => setSelected(null)} />
					) : (
						<p className="pb-empty">Choose a page to change its title, address, description and menus.</p>
					)}
				</div>
			</div>
		</Modal>
	);
}

function NewPage({
	config,
	collection,
	urlOf,
	onCancel,
	onCreated,
}: {
	config: BuilderConfig;
	collection: string;
	urlOf: (slug: string | null) => string | null;
	onCancel: () => void;
	onCreated: (url: string | null) => void;
}) {
	const [title, setTitle] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const slug = slugify(title);
	const create = async () => {
		setBusy(true);
		setError(null);
		try {
			// What the site starts its pages with (a heading and an empty line by default).
			const body = newPageBlocks(config.pages, title);
			const created = await createEntry(collection, { data: { title, body }, slug });
			onCreated(urlOf(created.slug ?? slug));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setBusy(false);
		}
	};
	return (
		<form
			className="pb-pages__form"
			onSubmit={(e) => {
				e.preventDefault();
				if (title.trim()) void create();
			}}
		>
			<h3>New page</h3>
			<Field label="Title">
				<TextInput value={title} onChange={setTitle} placeholder="About us" autoFocus />
			</Field>
			<p className="pb-hint">{slug ? `Its address will be ${urlOf(slug)}. It opens here, unpublished, ready to edit.` : "It opens here, unpublished, ready to edit."}</p>
			{error && <p className="pb-error">{error}</p>}
			<div className="pb-row pb-row--end">
				<button type="button" onClick={onCancel}>
					Cancel
				</button>
				<button type="submit" className="primary" disabled={!title.trim() || busy}>
					{busy ? "Creating…" : "Create and open"}
				</button>
			</div>
		</form>
	);
}

function PageSettings(props: PagesPanelProps & { page: EntrySummary; info: CollectionInfo; urlOf: (slug: string | null) => string | null; onChanged: () => void; onGone: () => void }) {
	const { page, info, config } = props;
	const collection = config.pages.collection;
	const isCurrent = props.current.collection === collection && props.current.id === page.id;
	const locked = page.slug !== null && config.pages.protectedSlugs.includes(page.slug);
	const descField = config.pages.descriptionField ?? info.fields.find((f) => DESCRIPTION_FIELDS.includes(f.slug) && (f.type === "text" || f.type === "string"))?.slug;

	const [loaded, setLoaded] = React.useState<Awaited<ReturnType<typeof getEntry>> | null>(null);
	const [title, setTitle] = React.useState(page.title);
	const [slug, setSlug] = React.useState(page.slug ?? "");
	const [description, setDescription] = React.useState("");
	const [image, setImage] = React.useState("");
	const [noIndex, setNoIndex] = React.useState(false);
	const [busy, setBusy] = React.useState<string | null>(null);
	const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

	React.useEffect(() => {
		getEntry(collection, page.id)
			.then((e) => {
				setLoaded(e);
				setTitle(String(e.data.title ?? page.title));
				// An address change waits in the draft until it's published.
				setSlug(typeof e.data._slug === "string" ? e.data._slug : (e.slug ?? ""));
				setDescription(String((info.hasSeo ? e.seo.description : descField ? e.data[descField] : "") ?? ""));
				setImage(String(e.seo.image ?? ""));
				setNoIndex(e.seo.noIndex === true);
			})
			.catch((e) => setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) }));
	}, [collection, page.id, page.title, info.hasSeo, descField]);

	const url = props.urlOf(page.slug);
	const run = async (label: string, fn: () => Promise<void>) => {
		setBusy(label);
		setMessage(null);
		try {
			await fn();
		} catch (e) {
			setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
		} finally {
			setBusy(null);
		}
	};

	const save = () =>
		run("save", async () => {
			const data: Record<string, unknown> = { title };
			if (!info.hasSeo && descField) data[descField] = description;
			const nextSlug = !locked && slugify(slug) && slugify(slug) !== page.slug ? slugify(slug) : undefined;
			const meta: PageMeta = { data, ...(nextSlug ? { slug: nextSlug } : {}), ...(info.hasSeo ? { seo: { description: description || null, image: image || null, noIndex } } : {}) };
			if (isCurrent) await props.saveCurrent(meta);
			else {
				const latest = await getEntry(collection, page.id);
				await saveEntry(collection, page.id, meta.data, { rev: latest.rev, slug: meta.slug, seo: meta.seo });
				props.onOtherChanged({ collection, id: page.id, label: title });
			}
			// EmDash moves the page when it's published, and redirects the old
			// address, so links and menus pointing at it keep working.
			const moved = nextSlug ? `Publishing moves it to ${props.urlOf(nextSlug)}${loaded?.status === "published" ? "; the old address will redirect there" : ""}.` : "Publish to make it live.";
			setMessage({ kind: "ok", text: `Saved. ${moved}` });
			props.onChanged();
		});

	const duplicate = () =>
		run("duplicate", async () => {
			const copy = await duplicateEntry(collection, page.id);
			const to = props.urlOf(copy.slug);
			if (to) location.assign(to);
		});

	const unpublish = () => {
		if (!confirm(`Unpublish “${title}”? Visitors won't see it until it's published again, and its menu links are removed.`)) return;
		void run("unpublish", async () => {
			await dropFromMenus();
			await unpublishEntry(collection, page.id);
			setMessage({ kind: "ok", text: "Unpublished." });
			props.onChanged();
		});
	};

	// A page that's gone or hidden must not stay in the menus as a dead link.
	const dropFromMenus = async () => {
		if (!url) return;
		for (const m of await listMenus().catch(() => [])) {
			for (const id of await menuItemsLinking(m.name, url, page.id).catch(() => [])) await deleteMenuItem(m.name, id);
		}
		refreshAllPreviews();
	};

	const trash = () => {
		if (!confirm(`Move “${title}” to the trash? Its menu links are removed too. It can be restored from the admin.`)) return;
		void run("trash", async () => {
			await dropFromMenus();
			await trashEntry(collection, page.id);
			if (isCurrent) location.assign(props.urlOf(config.pages.protectedSlugs[0] ?? "home") ?? "/");
			props.onGone();
			props.onChanged();
		});
	};

	if (!loaded) return <p className="pb-hint">{message?.text ?? "Loading…"}</p>;
	return (
		<div className="pb-pages__form">
			<div className="pb-row">
				<h3>{title || "Untitled"}</h3>
				{url && !isCurrent && (
					<a className="pb-pages__open" href={url}>
						Open and edit →
					</a>
				)}
			</div>
			<Field label="Title">
				<TextInput value={title} onChange={setTitle} />
			</Field>
			<Field label="Address" hint={locked ? "The site shows this page at a fixed address, so it can't change here." : `Letters, numbers and dashes. The page is at ${props.urlOf(slugify(slug) || page.slug) ?? "…"}`}>
				<TextInput value={locked ? (url ?? slug) : slug} onChange={setSlug} placeholder="about-us" />
			</Field>
			{(info.hasSeo || descField) && (
				<Field label="Search and sharing description" hint="Shown under the page's title in search results and in link previews. About 150 characters.">
					<TextInput value={description} onChange={setDescription} multiline />
				</Field>
			)}
			{info.hasSeo && (
				<div className="pb-field">
					<span className="pb-field__label">
						Share image
						{image && (
							<button type="button" className="pb-link" onClick={() => setImage("")}>
								remove
							</button>
						)}
					</span>
					{image && <img className="pb-bg-thumb" src={image} alt="" />}
					<button type="button" onClick={() => props.onPickImage((img) => setImage(String(img.src)))}>
						{image ? "Change image…" : "Choose image…"}
					</button>
					<span className="pb-field__hint">Shown when the page is shared on social media or in messages.</span>
				</div>
			)}
			{info.hasSeo && <Toggle checked={noIndex} onChange={setNoIndex} label="Hide from search engines" />}
			<div className="pb-row pb-row--end">
				<button type="button" className="primary" onClick={save} disabled={busy !== null}>
					{busy === "save" ? "Saving…" : "Save"}
				</button>
			</div>
			{message && <p className={message.kind === "error" ? "pb-error" : "pb-hint"}>{message.text}</p>}

			{url && <MenuToggles pageId={page.id} url={url} label={title} published={loaded?.status === "published"} />}

			<h4>More</h4>
			<div className="pb-row">
				<button type="button" onClick={duplicate} disabled={busy !== null}>
					{busy === "duplicate" ? "Copying…" : "Duplicate and open"}
				</button>
				{!locked && loaded.status === "published" && (
					<button type="button" onClick={unpublish} disabled={busy !== null}>
						Unpublish
					</button>
				)}
				{!locked && (
					<button type="button" className="danger" onClick={trash} disabled={busy !== null}>
						Move to trash
					</button>
				)}
			</div>
		</div>
	);
}

/** The menus this page is in, each a checkbox. Menus change immediately; they have no drafts. */
function MenuToggles({ pageId, url, label, published }: { pageId: string; url: string; label: string; published: boolean }) {
	const [menus, setMenus] = React.useState<Array<{ name: string; label: string; items: string[] }> | null>(null);
	const [busy, setBusy] = React.useState<string | null>(null);
	const load = React.useCallback(async () => {
		const list = await listMenus();
		setMenus(await Promise.all(list.map(async (m) => ({ ...m, items: await menuItemsLinking(m.name, url, pageId).catch(() => []) }))));
	}, [url, pageId]);
	React.useEffect(() => {
		void load().catch(() => setMenus([]));
	}, [load]);
	if (!menus?.length) return null;
	const toggle = async (m: { name: string; items: string[] }) => {
		setBusy(m.name);
		try {
			if (m.items.length) for (const id of m.items) await deleteMenuItem(m.name, id);
			else {
				const menu = await getMenu(m.name);
				await addMenuItem(m.name, { label, url, sortOrder: (menu?.items.length ?? 0) + 1 });
			}
			await load();
			refreshAllPreviews();
		} catch (e) {
			alert(`Couldn't change the menu: ${e instanceof Error ? e.message : e}`);
		} finally {
			setBusy(null);
		}
	};
	return (
		<>
			<h4>Show in menus</h4>
			{published || menus.some((m) => m.items.length) ? (
				<p className="pb-hint">Menus change straight away, for everyone. Rename or reorder their links from the menu block on the page.</p>
			) : (
				<p className="pb-hint">Publish the page first (the Publish button), then it can go in a menu. Otherwise the link would lead nowhere.</p>
			)}
			{menus.map((m) => (
				<label key={m.name} className="pb-toggle">
					<input type="checkbox" checked={m.items.length > 0} disabled={busy !== null || (!published && !m.items.length)} onChange={() => void toggle(m)} />
					<span>{m.label}</span>
				</label>
			))}
		</>
	);
}
