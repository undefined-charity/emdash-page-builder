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

import { cleanAnyTheme } from "./schema/style.js";

export type { BuilderConfig, ExternalBlock, ExternalField, SectionStyle, TextStyle, ButtonStyle } from "./schema/config.js";
export type { ThemeToken, BlockStyle, PageTheme } from "./schema/style.js";

const ID = "page-builder";
const VERSION = "0.1.0";
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
	};
}

/** The site-wide design defaults every page inherits (KV `state:siteTheme`). */
const SITE_THEME_KEY = "state:siteTheme";
const themeInput = z.object({ theme: z.record(z.string(), z.string()) });

async function getSiteTheme(ctx: RouteContext) {
	return { theme: cleanAnyTheme(await ctx.kv.get(SITE_THEME_KEY)) ?? {} };
}

async function saveSiteTheme(ctx: RouteContext<z.infer<typeof themeInput>>) {
	const theme = cleanAnyTheme(ctx.input.theme) ?? {};
	await ctx.kv.set(SITE_THEME_KEY, theme);
	return { theme };
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
