export function domainRoutes(pwaOrigin) {
  if (!pwaOrigin) return [];
  const url = new URL(pwaOrigin);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname) ||
      url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PWA_ORIGIN doit être l’origine HTTPS du projet PWA (*.vercel.app), sans chemin.');
  }
  return [{ src: '/(.*)', has: [{ type: 'host', value: '^app-[a-z0-9]+(?:-[a-z0-9]+)*\\.feelike\\.pro$' }],
    dest: `${url.origin}/$1` }];
}
