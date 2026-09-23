/**
 * Version history: every saved version of the document being edited, shown
 * as it looked, optionally side by side with the current draft, and
 * restorable as the new draft (publishing stays a separate step). Versions
 * can be named and starred, and the ones that were published are marked.
 *
 * EmDash saves a version on every autosave, so versions saved close together
 * by the same person are grouped into one editing session; the session's
 * last version stands for it.
 */
import * as React from "react";

import { entryRevisions, getVersionMarks, listRevisions, markVersion, restoreRevision, userNames, type Revision, type VersionMark } from "./api.js";
import { previewUrl } from "./Preview.js";

/** Saves further apart than this start a new editing session. */
const SESSION_GAP_MS = 10 * 60 * 1000;

interface Group {
	head: Revision;
	count: number;
	from: Date;
}

const when = (s: string) => new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);

export function HistoryPanel({
	collection,
	entryId,
	title,
	beforeRestore,
	onClose,
}: {
	collection: string;
	entryId: string;
	title: string;
	/** Save anything pending first, so nothing is lost behind the restored version. */
	beforeRestore: () => Promise<void>;
	onClose: () => void;
}) {
	const [revisions, setRevisions] = React.useState<Revision[] | null>(null);
	const [ids, setIds] = React.useState<{ live: string | null; draft: string | null }>({ live: null, draft: null });
	const [marks, setMarks] = React.useState<Record<string, VersionMark>>({});
	const [people, setPeople] = React.useState<{ me: string | null; names: Record<string, string> }>({ me: null, names: {} });
	const [error, setError] = React.useState<string | null>(null);
	const [selected, setSelected] = React.useState<string | null>(null);
	const [onlyMarked, setOnlyMarked] = React.useState(false);
	const [compare, setCompare] = React.useState(false);
	const [naming, setNaming] = React.useState(false);
	const [busy, setBusy] = React.useState(false);

	React.useEffect(() => {
		Promise.all([listRevisions(collection, entryId), entryRevisions(collection, entryId), getVersionMarks(collection, entryId).catch(() => ({})), userNames()])
			.then(([revs, current, m, who]) => {
				setRevisions(revs);
				setIds(current);
				setMarks(m);
				setPeople(who);
				setSelected(revs.find((r) => r.id !== current.draft)?.id ?? revs[0]?.id ?? null);
			})
			.catch((e) => setError(e instanceof Error ? e.message : String(e)));
	}, [collection, entryId]);

	React.useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const special = (r: Revision) => r.id === ids.live || r.id === ids.draft || Boolean(marks[r.id]);
	const groups: Group[] = [];
	for (const r of revisions ?? []) {
		const last = groups[groups.length - 1];
		const joins =
			last &&
			!special(r) &&
			!special(last.head) &&
			last.head.authorId === r.authorId &&
			last.from.getTime() - when(r.createdAt).getTime() < SESSION_GAP_MS;
		if (joins) {
			last.count++;
			last.from = when(r.createdAt);
		} else groups.push({ head: r, count: 1, from: when(r.createdAt) });
	}
	const shown = onlyMarked ? groups.filter((g) => g.head.id === ids.live || marks[g.head.id]) : groups;
	const who = (id: string | null) => (id && id === people.me ? "You" : (id && people.names[id]) || "Someone");
	const fmt = (d: Date) => d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

	const mark = async (revisionId: string, patch: { name?: string | null; starred?: boolean }) => {
		try {
			setMarks(await markVersion(collection, entryId, revisionId, patch));
		} catch (e) {
			alert(`Couldn't save that: ${e instanceof Error ? e.message : e}`);
		}
	};

	const restore = async (revisionId: string) => {
		if (!confirm("Make this version the draft? The current draft stays in the history, and nothing changes for visitors until you publish.")) return;
		setBusy(true);
		try {
			await beforeRestore();
			await restoreRevision(revisionId);
			location.reload();
		} catch (e) {
			setBusy(false);
			alert(`Couldn't restore it: ${e instanceof Error ? e.message : e}`);
		}
	};

	const current = selected ? (revisions ?? []).find((r) => r.id === selected) : undefined;
	const versionUrl = (id: string) => `${previewUrl()}&pb-revision=${encodeURIComponent(id)}`;

	return (
		<div className="pb-preview pb-history" role="dialog" aria-label="Version history">
			<header className="pb-preview__bar">
				<strong>History</strong>
				<span className="pb-hint">{title}: every saved version. Restoring one makes it the draft; publish to make it live.</span>
				<label className="pb-toggle">
					<input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with now
				</label>
				<button type="button" className="primary" onClick={onClose} title="Back to editing (Esc)">
					Done
				</button>
			</header>
			<div className="pb-history__body">
				<aside className="pb-history__list">
					<label className="pb-toggle">
						<input type="checkbox" checked={onlyMarked} onChange={(e) => setOnlyMarked(e.target.checked)} /> Only named and published
					</label>
					{error && <p className="pb-error">{error}</p>}
					{revisions === null && !error && <p className="pb-hint">Loading…</p>}
					{revisions?.length === 0 && <p className="pb-empty">No saved versions yet.</p>}
					<ul className="pb-list">
						{shown.map((g) => {
							const m = marks[g.head.id] ?? {};
							const to = when(g.head.createdAt);
							return (
								<li key={g.head.id}>
									<button type="button" className={`pb-version${g.head.id === selected ? " on" : ""}`} onClick={() => setSelected(g.head.id)}>
										<span className="pb-version__name">
											{m.starred && "★ "}
											{m.name ?? fmt(to)}
										</span>
										<small>
											{m.name ? `${fmt(to)} · ` : ""}
											{who(g.head.authorId)}
											{g.count > 1 ? ` · ${g.count} saves since ${g.from.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
										</small>
										<span className="pb-version__tags">
											{g.head.id === ids.draft && <span className="pb-tag">current draft</span>}
											{g.head.id === ids.live && <span className="pb-tag pb-tag--live">live now</span>}
											{m.published && g.head.id !== ids.live && <span className="pb-tag">published {new Date(m.published).toLocaleDateString()}</span>}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</aside>
				<section className="pb-history__stage">
					{current ? (
						<>
							<div className="pb-history__tools">
								{naming ? (
									<form
										className="pb-row"
										onSubmit={(e) => {
											e.preventDefault();
											const name = String(new FormData(e.currentTarget).get("name") ?? "");
											void mark(current.id, { name: name || null });
											setNaming(false);
										}}
									>
										<input name="name" autoFocus defaultValue={marks[current.id]?.name ?? ""} placeholder="Before the November redesign" maxLength={80} />
										<button type="submit">Save name</button>
									</form>
								) : (
									<button type="button" onClick={() => setNaming(true)}>
										{marks[current.id]?.name ? "Rename…" : "Name this version…"}
									</button>
								)}
								<button type="button" onClick={() => void mark(current.id, { starred: !marks[current.id]?.starred })} title="Star it to find it again">
									{marks[current.id]?.starred ? "★ Starred" : "☆ Star"}
								</button>
								<button type="button" className="primary" disabled={busy || current.id === ids.draft} onClick={() => void restore(current.id)}>
									{current.id === ids.draft ? "This is the current draft" : busy ? "Restoring…" : "Restore this version"}
								</button>
							</div>
							<div className={`pb-history__frames${compare ? " pb-history__frames--compare" : ""}`}>
								<figure>
									{compare && <figcaption>This version</figcaption>}
									<iframe key={current.id} src={versionUrl(current.id)} title="This version" />
								</figure>
								{compare && (
									<figure>
										<figcaption>Now (the current draft)</figcaption>
										<iframe src={previewUrl()} title="The current draft" />
									</figure>
								)}
							</div>
						</>
					) : (
						<p className="pb-empty">Choose a version to see it.</p>
					)}
				</section>
			</div>
		</div>
	);
}
