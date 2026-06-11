import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const appEnv = (import.meta.env.VITE_ENV as string | undefined) ?? 'development';

// Garde-fou : le serveur de dev local ne doit jamais pointer sur la prod.
if (import.meta.env.DEV && appEnv === 'production') {
  console.error(
    '[ENV] ⚠️ Serveur de dev local connecté à la base de PRODUCTION (VITE_ENV=production). ' +
      'Vérifie ton .env.local — il doit pointer sur le projet Supabase de dev.',
  );
} else if (import.meta.env.DEV) {
  console.info(`[ENV] Environnement applicatif : ${appEnv}`);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
