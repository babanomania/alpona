// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// GitHub Pages project site: https://<owner>.github.io/alpona
const site = process.env.SITE ?? 'https://babanomania.github.io';
const base = process.env.BASE_PATH ?? '/alpona';

// https://astro.build/config
export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      title: 'Alpona',
      tagline: 'Describe it — Alpona draws the pattern.',
      description:
        'A schema-driven generative UI engine for dashboards. The LLM decides what to show; a deterministic engine decides how it renders.',
      social: { github: 'https://github.com/babanomania/alpona' },
      customCss: ['./src/styles/docs.css'],
      // The marketing landing (src/pages/index.astro) owns "/"; docs live
      // under their category paths below.
      sidebar: [
        {
          label: 'Getting started',
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'Concepts',
          autogenerate: { directory: 'concepts' },
        },
        {
          label: 'Datasets',
          autogenerate: { directory: 'datasets' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
        {
          label: 'Extending',
          autogenerate: { directory: 'extending' },
        },
        {
          label: 'Operations',
          autogenerate: { directory: 'operations' },
        },
        { label: 'Roadmap', link: '/roadmap' },
      ],
    }),
  ],
});
