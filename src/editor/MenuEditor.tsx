/**
 * Edit an EmDash menu from the side panel — the links a header nav or footer
 * block shows — so nobody has to leave the page for Admin → Menus.
 *
 * Menus have no drafts in EmDash: each change is saved, and live, at once.
 */
import * as React from "react";

import { addMenuItem, createMenu, deleteMenuItem, getMenu, listMenus, reorderMenu, updateMenuItem, type MenuItem } from "./api.js";
import { Field, Select, TextInput, Toggle } from "./ui.js";

export function MenuEditor({ menu, onMenu, onChanged }: { menu: string; onMenu: (name: string) => void; onChanged: () => void }) {
	const [menus, setMenus] = React.useState<Array<{ name: string; label: string }>>([]);
	const [items, setItems] = React.useState<MenuItem[] | null>(null);
	const [missing, setMissing] = React.useState(false);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [open, setOpen] = React.useState<string | null>(null);

	const load = React.useCallback(async () => {
		const got = await getMenu(menu);
		setMissing(!got);
		setItems(got?.items.filter((i) => !i.parentId) ?? []);
	}, [menu]);

	React.useEffect(() => {
		void load();
		listMenus()
			.then(setMenus)
			.catch(() => undefined);
	}, [load]);

	const run = async (fn: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await fn();
			await load();
			onChanged();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const move = (index: number, dir: -1 | 1) =>
		run(async () => {
			if (!items) return;
			const next = [...items];
			const [item] = next.splice(index, 1);
			next.splice(index + dir, 0, item);
			await reorderMenu(
				menu,
				next.map((it, i) => ({ id: it.id, parentId: null, sortOrder: i })),
			);
		});

	return (
		<div className="pb-menu">
			<Field label="Menu">
				<Select
					value={menu}
					onChange={onMenu}
					options={[...(menus.some((m) => m.name === menu) ? [] : [{ label: menu, value: menu }]), ...menus.map((m) => ({ label: `${m.label} (${m.name})`, value: m.name }))]}
				/>
			</Field>
			<p className="pb-hint">Changes to a menu go live straight away, everywhere it's shown.</p>
			{error && <p className="pb-error">{error}</p>}
			{missing && (
				<button type="button" disabled={busy} onClick={() => run(() => createMenu(menu, menu.replace(/[-_]/g, " ")))}>
					Create the “{menu}” menu
				</button>
			)}
			{items && (
				<ol className="pb-menu__items">
					{items.map((item, i) => (
						<li key={item.id} className={open === item.id ? "open" : ""}>
							<div className="pb-menu__row">
								<button type="button" className="pb-menu__label" onClick={() => setOpen(open === item.id ? null : item.id)} title="Edit this link">
									{item.label}
									<small>{item.linked ? "links to a page" : item.url}</small>
								</button>
								<button type="button" title="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}>
									↑
								</button>
								<button type="button" title="Move down" disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}>
									↓
								</button>
								<button
									type="button"
									title="Remove"
									className="danger"
									disabled={busy}
									onClick={() => window.confirm(`Remove “${item.label}” from the menu?`) && run(() => deleteMenuItem(menu, item.id))}
								>
									✕
								</button>
							</div>
							{open === item.id && (
								<div className="pb-menu__edit">
									<Field label="Label">
										<TextInput value={item.label} lazy onChange={(label) => label.trim() && run(() => updateMenuItem(menu, item.id, { label: label.trim() }))} />
									</Field>
									{item.linked ? (
										<p className="pb-hint">This link points at a page chosen in Admin → Menus, and follows it if the page moves.</p>
									) : (
										<Field label="Goes to">
											<TextInput value={item.url} placeholder="/page or https://…" lazy onChange={(url) => run(() => updateMenuItem(menu, item.id, { url: url.trim() }))} />
										</Field>
									)}
									<Toggle checked={item.newTab} onChange={(newTab) => run(() => updateMenuItem(menu, item.id, { newTab }))} label="Open in a new tab" />
								</div>
							)}
						</li>
					))}
				</ol>
			)}
			{items && !missing && (
				<button
					type="button"
					disabled={busy}
					onClick={() =>
						run(async () => {
							await addMenuItem(menu, { label: "New link", url: "/", sortOrder: items.length });
						})
					}
				>
					+ Add a link
				</button>
			)}
		</div>
	);
}
