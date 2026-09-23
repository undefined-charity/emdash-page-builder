/// <reference types="astro/client" />

// For plain `tsc`: .astro components are typed by `astro check` in the site.
declare module "*.astro" {
	const Component: (props: Record<string, unknown>) => unknown;
	export default Component;
}
