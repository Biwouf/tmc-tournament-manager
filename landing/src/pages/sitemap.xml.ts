import type { APIRoute } from 'astro';

// Seules les pages indexables : les pages légales (contenu à fournir) et la 404 en sont exclues.
const pages = ['/'];

export const GET: APIRoute = ({ site }) => {
  const urls = pages.map(path => `  <url><loc>${new URL(path, site).href}</loc></url>`).join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
