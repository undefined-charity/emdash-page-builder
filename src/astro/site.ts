/**
 * The site-wide design and page options saved on the editor's Site tab, read
 * through the plugin's public route. Fetched once per request, however many
 * components ask.
 */
import { cleanSiteSettings, type SiteSettings } from "../schema/config.js";

type Locals = {
	emdash?: { handlePublicPluginApiRoute?: (id: string, method: string, path: string, req: Request) => Promise<{ success: boolean; data?: unknown }> };
	pbSite?: Promise<SiteData>;
};

export interface SiteData {
	theme: unknown;
	settings: SiteSettings;
}

export function loadSite(astro: { locals: unknown; url: URL }): Promise<SiteData> {
	const locals = astro.locals as Locals;
	locals.pbSite ??= (async () => {
		try {
			const result = await locals.emdash?.handlePublicPluginApiRoute?.("page-builder", "GET", "/site-theme", new Request(new URL("/", astro.url)));
			const data = (result?.success ? result.data : undefined) as { theme?: unknown; settings?: unknown } | undefined;
			return { theme: data?.theme, settings: cleanSiteSettings(data?.settings) };
		} catch {
			return { theme: undefined, settings: {} };
		}
	})();
	return locals.pbSite;
}
