/**
 * Page builder for EmDash CMS.
 *
 * Edit any page in place, like a word processor, on the live page: type,
 * format, insert blocks with `/`, drag them around, float images so text wraps,
 * build layouts from sections, columns, cards, FAQs and buttons, reuse shared
 * blocks, and override any colour or style — per block or for the whole page.
 *
 * Content is stored as ordinary Portable Text in the entry's rich-text field,
 * so the admin, search, and every other template keep working with it.
 *
 * Native format: the editor is a React island on the public page, which the
 * sandboxed plugin format can't provide.
 *
 *   // astro.config.mjs
 *   import pageBuilder from "emdash-page-builder";
 *   emdash({ plugins: [pageBuilder()] })
 *
 *   // a page template
 *   import { PageBuilder } from "emdash-page-builder/astro";
 *   <PageBuilder value={entry.data.body} entry={{ collection: "pages", id: entry.data.id }} config={…} />
 */
import type { PluginDescriptor, ResolvedPlugin, RouteContext } from "emdash";
import { definePlugin } from "emdash";
import { z } from "zod";

import { cleanSiteSettings } from "./schema/config.js";
import { cleanAnyTheme } from "./schema/style.js";

export type { BuilderConfig, ExternalBlock, ExternalField, SectionStyle, TextStyle, ButtonStyle, SiteSettings } from "./schema/config.js";
export type { ThemeToken, ThemeRole, BlockStyle, PageTheme } from "./schema/style.js";
export type { ThemePreset } from "./schema/presets.js";

const ID = "page-builder";
const VERSION = "0.6.0";
const ADMIN_PAGES = [{ path: "/", label: "Page Builder", icon: "layout" }];

export interface PageBuilderOptions {
	/**
	 * Module specifier the plugin is installed under. Only needed when the
	 * plugin is loaded from somewhere other than the `emdash-page-builder`
	 * package (e.g. a local copy aliased in Vite).
	 */
	specifier?: string;
}

export function pageBuilder(options: PageBuilderOptions = {}): PluginDescriptor {
	const spec = options.specifier ?? "emdash-page-builder";
	return {
		id: ID,
		version: VERSION,
		entrypoint: spec,
		adminEntry: `${spec}/admin`,
		// Lets EmDash's stock <PortableText> render builder blocks anywhere else
		// the content turns up.
		componentsEntry: `${spec}/blocks`,
		options: {},
		capabilities: [],
		adminPages: ADMIN_PAGES,
		// Replaces EmDash's own Portable Text editor on builder fields (set a
		// field's widget to "page-builder:editor"): that editor doesn't know
		// builder blocks and would rewrite them if it saved.
		fieldWidgets: [{ name: "editor", label: "Page builder (edit on the page)", fieldTypes: ["portableText"] }],
	};
}

/**
 * The site-wide design defaults every page inherits (KV `state:siteTheme`),
 * and site-wide page options such as the back-to-top button
 * (KV `state:siteSettings`).
 */
const SITE_THEME_KEY = "state:siteTheme";
const SITE_SETTINGS_KEY = "state:siteSettings";
const themeInput = z.object({
	theme: z.record(z.string(), z.string()).optional(),
	settings: z.record(z.string(), z.unknown()).optional(),
});

async function getSiteTheme(ctx: RouteContext) {
	return {
		theme: cleanAnyTheme(await ctx.kv.get(SITE_THEME_KEY)) ?? {},
		settings: cleanSiteSettings(await ctx.kv.get(SITE_SETTINGS_KEY)),
	};
}

async function saveSiteTheme(ctx: RouteContext<z.infer<typeof themeInput>>) {
	if (ctx.input.theme) await ctx.kv.set(SITE_THEME_KEY, cleanAnyTheme(ctx.input.theme) ?? {});
	if (ctx.input.settings) await ctx.kv.set(SITE_SETTINGS_KEY, cleanSiteSettings(ctx.input.settings));
	return getSiteTheme(ctx as RouteContext);
}

export function createPlugin(): ResolvedPlugin {
	return definePlugin({
		id: ID,
		version: VERSION,
		capabilities: [],
		routes: {
			// Public: every page renders the site's design defaults.
			"site-theme": { public: true, handler: getSiteTheme as never },
			"site-theme-save": { input: themeInput, handler: saveSiteTheme as never },
		},
		admin: { pages: ADMIN_PAGES },
	});
}

export default pageBuilder;
