import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Pas de `vite-plugin-pwa` : la vitrine est un site public, l'app installable est `pwa/`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
