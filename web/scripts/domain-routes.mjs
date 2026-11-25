export function domainRoutes(pwaOrigin) {
  if (!pwaOrigin) return [];
  const url = new URL(pwaOrigin);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname) ||
      url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PWA_ORIGIN doit être l’origine HTTPS du projet PWA (*.vercel.app), sans chemin.');
  }
  const has = [{ type: 'host', value: '^app-[a-z0-9]+(?:-[a-z0-9]+)*\\.feelike\\.pro$' }];
  return [
    // Vercel intercepte /_vercel/insights avant ces routes : sans ce chemin dédié, les visites
    // de la PWA sont comptées dans le projet vitrine. Même chemin que pwa/src/main.tsx.
    { src: '/pwa-insights/(.*)', has, dest: `${url.origin}/_vercel/insights/$1` },
    { src: '/(.*)', has, dest: `${url.origin}/$1` },
  ];
}
