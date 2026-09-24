/**
 * Plugins → Page Builder: how to use it, and one-click setup of the schema it
 * relies on (the reusable-blocks collection, and a theme field on pages).
 */
import type { PluginAdminExports } from "emdash";
import { apiFetch } from "emdash/plugin-utils";
import * as React from "react";

const REUSABLE = "reusable_blocks";
/**
 * Where "Live View" takes a reusable block: any page of the site, with this
 * marker, which PageBuilder turns into that block on its own, editable in
 * place. (Without a pattern EmDash links to /reusable_blocks/<slug>, which
 * doesn't exist.)
 */
export const REUSABLE_URL_PATTERN = "/?pb-block={slug}";

async function api<T = unknown>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
	const res = await apiFetch(`/_emdash/api${path}`, {
		...init,
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
	});
	const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
	return { ok: res.ok, status: res.status, data: json.data, error: json.error?.message };
}

interface Check {
	id: string;
	label: string;
	done: boolean;
	fix?: () => Promise<void>;
}

function PageBuilderAdmin() {
	const [checks, setChecks] = React.useState<Check[] | null>(null);
	const [pagesCollection, setPagesCollection] = React.useState("pages");
	const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
	const [busy, setBusy] = React.useState(false);

	const run = React.useCallback(async () => {
		const reusable = await api<{ item?: { fields?: Array<{ slug: string }>; urlPattern?: string | null } }>(`/schema/collections/${REUSABLE}?includeFields=true`);
		const pages = await api<{ item?: { fields?: Array<{ slug: string }> } }>(`/schema/collections/${pagesCollection}?includeFields=true`);
		const reusableFields = new Set((reusable.data?.item?.fields ?? []).map((f) => f.slug));
		const pageFields = new Set((pages.data?.item?.fields ?? []).map((f) => f.slug));
		setChecks([
			{
				id: "reusable",
				label: `A “Reusable blocks” collection (${REUSABLE}) with title and content fields`,
				done: reusable.ok && reusableFields.has("title") && reusableFields.has("content"),
				fix: async () => {
					if (!reusable.ok) {
						const r = await api("/schema/collections", {
							method: "POST",
							body: JSON.stringify({ slug: REUSABLE, label: "Reusable blocks", labelSingular: "Reusable block", description: "Blocks shared between pages. Edit one and every page using it changes." }),
						});
						if (!r.ok) throw new Error(r.error ?? "Couldn't create the collection");
					}
					for (const [slug, type, label] of [
						["title", "string", "Name"],
						["content", "portableText", "Content"],
					] as const) {
						if (reusableFields.has(slug)) continue;
						const r = await api(`/schema/collections/${REUSABLE}/fields`, { method: "POST", body: JSON.stringify({ slug, type, label }) });
						if (!r.ok) throw new Error(r.error ?? `Couldn't add the ${slug} field`);
					}
				},
			},
			{
				id: "reusable-live-view",
				label: "“Live View” on a reusable block opens it on the site, ready to edit",
				done: reusable.ok && reusable.data?.item?.urlPattern === REUSABLE_URL_PATTERN,
				fix: async () => {
					const r = await api(`/schema/collections/${REUSABLE}`, { method: "PUT", body: JSON.stringify({ urlPattern: REUSABLE_URL_PATTERN }) });
					if (!r.ok) throw new Error(r.error ?? "Couldn't set where Live View goes");
				},
			},
			{
				id: "theme",
				label: `A “theme” field on ${pagesCollection}, for per-page colours and fonts`,
				done: pages.ok && pageFields.has("theme"),
				fix: pages.ok
					? async () => {
							const r = await api(`/schema/collections/${pagesCollection}/fields`, {
								method: "POST",
								body: JSON.stringify({ slug: "theme", type: "json", label: "Page design (set in the page editor)" }),
							});
							if (!r.ok) throw new Error(r.error ?? "Couldn't add the theme field");
						}
					: undefined,
			},
		]);
	}, [pagesCollection]);

	React.useEffect(() => {
		void run();
	}, [run]);

	const fixAll = async () => {
		setBusy(true);
		setMessage(null);
		try {
			for (const c of checks ?? []) if (!c.done && c.fix) await c.fix();
			setMessage({ kind: "ok", text: "Done. Restart the dev server if you're running one, so the new fields are picked up." });
		} catch (e) {
			setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
		} finally {
			setBusy(false);
			void run();
		}
	};

	return (
		<div style={{ padding: 24, maxWidth: 760, display: "grid", gap: 16 }}>
			<h1 style={{ fontSize: 20, fontWeight: 600 }}>Page Builder</h1>
			<p>
				Pages are edited on the page itself. Open any page on the site, switch on <strong>Edit</strong> in the EmDash toolbar, and click into the page:
				type and format like a document, press <kbd>/</kbd> or use <strong>+ Insert</strong> to add sections, columns, images, FAQs, buttons, forms and
				more, drag blocks by their <strong>⠿</strong> handle, and use the side panel to change any block's settings and style — or the whole page's
				colours under <strong>Page design</strong>. Changes save automatically as a draft; publish from the EmDash toolbar.
			</p>

			<section style={{ display: "grid", gap: 8 }}>
				<h2 style={{ fontSize: 16, fontWeight: 600 }}>Setup</h2>
				<label style={{ display: "grid", gap: 4, maxWidth: 280 }}>
					<span style={{ fontSize: 12, opacity: 0.8 }}>Collection your pages live in</span>
					<input value={pagesCollection} onChange={(e) => setPagesCollection(e.target.value.trim())} style={{ padding: 6, border: "1px solid #ccc", borderRadius: 6 }} />
				</label>
				{checks === null ? (
					<p>Checking…</p>
				) : (
					<ul style={{ display: "grid", gap: 6, listStyle: "none", padding: 0 }}>
						{checks.map((c) => (
							<li key={c.id}>
								{c.done ? "✅" : "⬜️"} {c.label}
							</li>
						))}
					</ul>
				)}
				{checks?.some((c) => !c.done && c.fix) && (
					<button type="button" onClick={fixAll} disabled={busy} style={{ justifySelf: "start", padding: "6px 14px", borderRadius: 6, border: "1px solid #888" }}>
						{busy ? "Setting up…" : "Set up what's missing"}
					</button>
				)}
				{message && <p style={{ color: message.kind === "error" ? "#c00" : "#070" }}>{message.text}</p>}
			</section>
		</div>
	);
}

export const pages: PluginAdminExports["pages"] = { "/": PageBuilderAdmin };

// ── Field widget: builder content in the admin's edit form ────────────────────

/**
 * Stands in for EmDash's Portable Text editor on builder fields. That editor
 * doesn't know builder blocks: it turns ones without settings into
 * placeholder text and saves the result. This widget never changes the value;
 * it says where the content is edited and summarises it.
 */
function BuilderField({ value, label }: { value: unknown; label?: string; id?: string }) {
	const blocks = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
	const headings: string[] = [];
	const walk = (nodes: unknown) => {
		if (!Array.isArray(nodes)) return;
		for (const n of nodes as Array<Record<string, unknown>>) {
			if (n?._type === "block" && /^(h[1-3]|display)$/.test(String(n.style ?? ""))) {
				const text = ((n.children as Array<{ text?: string }>) ?? []).map((c) => c.text ?? "").join("").trim();
				if (text) headings.push(text);
			}
			walk(n?.content);
		}
	};
	walk(blocks);
	return (
		<div style={{ border: "1px solid rgba(127,127,127,0.35)", borderRadius: 8, padding: "12px 14px", lineHeight: 1.5 }}>
			<div style={{ fontWeight: 600, marginBottom: 4 }}>{label ?? "Content"}</div>
			<p style={{ margin: "0 0 8px" }}>
				Built in the page builder. Open it on the site with <strong>Live View</strong> (for a header or footer, any page), switch on{" "}
				<strong>Edit</strong> in the toolbar, and edit it there. It isn't edited here, so this form can't change or damage it.
			</p>
			<p style={{ margin: 0, opacity: 0.75, fontSize: "0.9em" }}>
				{blocks.length === 0 ? "Empty so far." : `${blocks.length} top-level block${blocks.length === 1 ? "" : "s"}${headings.length ? ` — ${headings.slice(0, 5).join(" · ")}${headings.length > 5 ? " …" : ""}` : ""}.`}
			</p>
		</div>
	);
}

export const fields: PluginAdminExports["fields"] = { editor: BuilderField };
