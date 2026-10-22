import { defineConfig } from 'astro/config';

// Site statique : aucun adaptateur, Vercel sert `dist/` tel quel.
export default defineConfig({
  site: 'https://www.feelike.pro',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'always' },
  devToolbar: { enabled: false },
});
