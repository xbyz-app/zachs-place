import { defineCollection, z } from "astro:content";

const manual = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    icon: z.string(),
    order: z.number()
  })
});

export const collections = { manual };
