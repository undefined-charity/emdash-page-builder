/**
 * `componentsEntry` for EmDash: the Portable Text types the builder owns,
 * mapped to a component that renders them, so builder content also displays
 * wherever a site renders the field with EmDash's stock <PortableText>.
 */
import Block from "./Block.astro";

export const blockComponents = {
	"pb.section": Block,
	"pb.columns": Block,
	"pb.cards": Block,
	"pb.accordion": Block,
	"pb.spacer": Block,
	"pb.reusable": Block,
} as const;
