import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = [env.VITE_ALLOWED_HOSTS, env.VERCEL_URL, env.VERCEL_BRANCH_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).join(',');
  return {
  define: { 'import.meta.env.VITE_ALLOWED_HOSTS': JSON.stringify(allowedHosts) },
  resolve: { dedupe: ['react', 'react-dom'] },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // Registration and reload consent are managed by pwaUpdates.ts.
      injectRegister: false,
      // Manifest NEUTRE : il ne sert qu'avant le chargement du club. App.tsx le remplace aussitôt
      // par celui du club courant (nom, nom court, couleurs, icônes tirées du logo).
      manifest: {
        id: '/',
        name: 'Application du club',
        short_name: 'Club',
        description: "L'application de votre club",
        lang: 'fr',
        theme_color: '#e51828',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [{ src: '/icons/club.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        // Keep installed workers independent of hashed files from older deployments.
        inlineWorkboxRuntime: true,
        importScripts: ['/course-push-sw.js'],
        skipWaiting: false,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Décodeur HEIC (3 Mo) chargé seulement pour lire une photo d'iPhone hors Safari, en ligne.
        globIgnores: ['**/heic-to-*.js'],
        cleanupOutdatedCaches: true,
        // Hors ligne, toute route de l'app rouvre la coquille en cache. Un chemin de fichier
        // (extension) n'est jamais servi par index.html, comme sur Vercel (vercel.json).
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/[^/?]+\.[^/?]+$/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('supabase.co') &&
              url.pathname.startsWith('/storage/v1/object/public/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-storage',
              expiration: { maxAgeSeconds: 60 * 5 },
            },
          },
        ],
      },
    }),
  ],
};
});
