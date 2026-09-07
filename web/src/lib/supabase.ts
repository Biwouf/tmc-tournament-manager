import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const appEnv = (import.meta.env.VITE_ENV as string | undefined) ?? 'development';

// Garde-fou repris du BO et de la PWA : le serveur de dev local ne doit jamais pointer sur la
// prod.
if (import.meta.env.DEV && appEnv === 'production') {
  console.error(
    '[ENV] ⚠️ Serveur de dev local connecté à la base de PRODUCTION (VITE_ENV=production). ' +
      'Vérifie ton .env.local — il doit pointer sur le projet Supabase de dev.',
  );
} else if (import.meta.env.DEV) {
  console.info(`[ENV] Environnement applicatif : ${appEnv}`);
}

// Site PUBLIC : aucune authentification, donc aucune session à persister ni à rafraîchir.
// Tout ce que lit la vitrine passe par le rôle `anon` (`clubs`, `club_settings`, et les
// buckets publics du Storage).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
