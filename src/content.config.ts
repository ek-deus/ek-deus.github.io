import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    youtubeId: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
