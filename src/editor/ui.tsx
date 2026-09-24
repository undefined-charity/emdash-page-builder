/** Small form controls for the editor chrome (rendered inside a shadow root). */
import * as React from "react";

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
	return (
		<label className="pb-field">
			<span className="pb-field__label">{label}</span>
			{children}
			{hint && <span className="pb-field__hint">{hint}</span>}
		</label>
	);
}

export function TextInput(props: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	type?: string;
	multiline?: boolean;
	/** Commit on blur/Enter instead of every keystroke. */
	lazy?: boolean;
	autoFocus?: boolean;
}) {
	const [draft, setDraft] = React.useState(props.value);
	React.useEffect(() => {
		setDraft(props.value);
	}, [props.value]);
	const commit = () => draft !== props.value && props.onChange(draft);
	const common = {
		autoFocus: props.autoFocus,
		value: draft,
		placeholder: props.placeholder,
		onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			setDraft(e.target.value);
			if (!props.lazy) props.onChange(e.target.value);
		},
		onBlur: props.lazy ? commit : undefined,
		onKeyDown: (e: React.KeyboardEvent) => {
			if (props.lazy && e.key === "Enter" && !props.multiline) commit();
		},
	};
	return props.multiline ? <textarea rows={4} {...common} /> : <input type={props.type ?? "text"} {...common} />;
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ label: string; value: string }> }) {
	return (
		<select value={value} onChange={(e) => onChange(e.target.value)}>
			{options.map((o) => (
				<option key={o.value} value={o.value}>
					{o.label}
				</option>
			))}
		</select>
	);
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<{ label: string; value: T; title?: string }> }) {
	return (
		<div className="pb-seg" role="radiogroup">
			{options.map((o) => (
				<button key={o.value} type="button" title={o.title ?? o.label} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)} role="radio" aria-checked={o.value === value}>
					{o.label}
				</button>
			))}
		</div>
	);
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
	return (
		<label className="pb-toggle">
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
			<span>{label}</span>
		</label>
	);
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Colour: swatches from the site palette, a native picker, and free text (e.g. `var(--accent-pink)`). */
export function ColorField({
	label,
	value,
	onChange,
	palette,
	placeholder,
}: {
	label: string;
	value: string | undefined;
	onChange: (v: string | undefined) => void;
	palette: Array<{ label: string; value: string }>;
	placeholder?: string;
}) {
	return (
		<div className="pb-field">
			<span className="pb-field__label">
				{label}
				{value && (
					<button type="button" className="pb-link" onClick={() => onChange(undefined)}>
						reset
					</button>
				)}
			</span>
			<div className="pb-color">
				<input type="color" value={value && HEX.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} aria-label={`${label} picker`} />
				<TextInput value={value ?? ""} placeholder={placeholder ?? "default"} lazy onChange={(v) => onChange(v.trim() || undefined)} />
			</div>
			{palette.length > 0 && (
				<div className="pb-swatches">
					{palette.map((sw) => (
						<button key={sw.value} type="button" title={sw.label} style={{ background: sw.value }} className={value === sw.value ? "on" : ""} onClick={() => onChange(sw.value)} />
					))}
				</div>
			)}
		</div>
	);
}

/** A CSS length with quick presets; free text accepted (validated on save). */
export function LengthField({
	label,
	value,
	onChange,
	presets,
	placeholder,
}: {
	label: string;
	value: string | undefined;
	onChange: (v: string | undefined) => void;
	/** Quick picks: a value, or a value with the label to show for it (e.g. "20px" for "1.25rem"). */
	presets: Array<string | { value: string; label: string }>;
	placeholder?: string;
}) {
	return (
		<div className="pb-field">
			<span className="pb-field__label">
				{label}
				{value && (
					<button type="button" className="pb-link" onClick={() => onChange(undefined)}>
						reset
					</button>
				)}
			</span>
			<TextInput value={value ?? ""} placeholder={placeholder ?? "default"} lazy onChange={(v) => onChange(v.trim() || undefined)} />
			<div className="pb-chips">
				{presets.map((p) => {
					const { value: v, label: l } = typeof p === "string" ? { value: p, label: p } : p;
					return (
						<button key={v} type="button" className={value === v ? "on" : ""} onClick={() => onChange(v)} title={l === v ? undefined : v}>
							{l}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function Group({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
	return (
		<details className="pb-group" open={defaultOpen}>
			<summary>{title}</summary>
			<div className="pb-group__body">{children}</div>
		</details>
	);
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
	const panel = React.useRef<HTMLDivElement>(null);
	React.useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	// Take the focus from the page: while a dialog is open, typing must not
	// land in the document behind it. The first field, if any, gets it.
	React.useEffect(() => {
		const el = panel.current;
		if (!el) return;
		const first = el.querySelector<HTMLElement>("input:not([type=hidden]):not([type=file]), textarea, select");
		(first ?? el).focus({ preventScroll: true });
	}, []);
	return (
		<div className="pb-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div ref={panel} tabIndex={-1} className={`pb-modal__panel${wide ? " pb-modal__panel--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
				<header>
					<h2>{title}</h2>
					<button type="button" className="pb-icon" onClick={onClose} aria-label="Close">
						✕
					</button>
				</header>
				<div className="pb-modal__body">{children}</div>
			</div>
		</div>
	);
}

/** Convert `a: b; c-d: e` to a React style object. */
export function reactStyle(css: string | undefined): React.CSSProperties | undefined {
	if (!css) return undefined;
	const out: Record<string, string> = {};
	for (const rule of css.split(";")) {
		const i = rule.indexOf(":");
		if (i < 0) continue;
		const key = rule.slice(0, i).trim();
		const value = rule.slice(i + 1).trim();
		if (!key) continue;
		out[key.startsWith("--") ? key : key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
	}
	return out as React.CSSProperties;
}
