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
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // Registration and reload consent are managed by pwaUpdates.ts.
      injectRegister: false,
      manifest: {
        name: 'CAC Tennis',
        short_name: 'CAC Tennis',
        description: "L'application du club CAC Tennis",
        theme_color: '#e51828',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
      workbox: {
        skipWaiting: false,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
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
