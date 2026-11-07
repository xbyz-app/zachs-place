import { defineCollection, z } from "astro:content";

const section = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    icon: z.string(),
    order: z.number()
  })
});

// `manual` is the house manual; `guide` is "Around here" (coffee, restaurants).
// Same frontmatter, same accordion.
export const collections = { manual: section, guide: section };
