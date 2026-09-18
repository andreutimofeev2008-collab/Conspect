import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const notatki = defineCollection({
  loader: glob({
    pattern: "**/*.{md,mdx}",
    base: "./src/content/notatki",
  }),
  schema: z.object({
    tytul: z.string(),
    przedmiot: z.string(),
    temat: z.string(),
    data: z.coerce.date(),
  }),
});

export const collections = {
  notatki,
};
