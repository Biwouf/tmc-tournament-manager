// Vitrine — résolution du tenant par sous-domaine, puis lecture de sa configuration.
//
// Même patron que `src/contexts/ClubContext.tsx` (BO) et sa copie PWA, AMPUTÉ de tout ce qui
// suppose une session : pas d'override de support (il n'y a pas de super-admin sur un site
// public), pas d'auth. La seule addition est la config, chargée dans la même passe.
//
// ⚠️ UNE SEULE lecture au montage, deux round-trips au total : `clubs` (slug → id) puis
// `club_settings` (config). Aucune page ne refait de requête en PR9 — tout passe par ce
// contexte. Les flux (actus, événements) de PR10 sont les premiers à en ajouter.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { parseClubConfig, type ClubConfig } from '../lib/clubConfig';
import { applyBrandTokens } from '../lib/tokens';

export type Club = { id: string; slug: string; name: string; sport: string; status: string };

type SiteContextValue = {
  club: Club;
  config: ClubConfig;
  /**
   * Le nom à AFFICHER. `brand.name` peut être vide (config `{}` d'un club fraîchement
   * provisionné) alors que `clubs.name` est toujours renseigné — c'est la console qui le crée.
   * Le repli est fait ici une fois pour toutes plutôt que dans chaque composant (brief §10).
   */
  clubName: string;
};

const CLUB_FIELDS = 'id, slug, name, sport, status';

const SiteContext = createContext<SiteContextValue | null>(null);

function resolveSlug(): string {
  const host = window.location.hostname;
  const match = host.match(/^([a-z0-9-]+)\.feelike\.app$/);
  if (match) return match[1];
  return (import.meta.env.VITE_DEV_CLUB_SLUG as string | undefined) ?? 'cac-tennis';
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SiteContextValue | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const resolve = async (): Promise<SiteContextValue | null> => {
      const slug = resolveSlug();
      const { data: club, error } = await supabase
        .from('clubs')
        .select(CLUB_FIELDS)
        .eq('slug', slug)
        .eq('status', 'active')
        .single();
      if (error || !club) {
        console.error(`[SiteContext] club "${slug}" indisponible`, error);
        return null;
      }

      // `maybeSingle` : un club dont la ligne `club_settings` manquerait rend le site avec la
      // config par défaut plutôt qu'un écran d'erreur. Le trigger `clubs_create_settings` (PR5)
      // la crée, mais la vitrine n'a aucune raison de tomber s'il a été contourné.
      // ⚠️ Sans la migration `2026090601_club_settings_public_read.sql`, la RLS rend ici une
      // réponse VIDE en `anon` : le site s'affiche, entièrement vide. Le symptôme est côté
      // rendu, la cause est en base.
      const { data: settings } = await supabase
        .from('club_settings')
        .select('config')
        .eq('club_id', club.id)
        .maybeSingle();

      const config = parseClubConfig(settings?.config);
      return { club: club as Club, config, clubName: config.brand.name || club.name };
    };

    resolve().then((resolved) => {
      if (resolved) {
        applyBrandTokens(document.documentElement, resolved.config.brand.color);
        document.title = resolved.clubName;
      }
      setValue(resolved);
      setLoading(false);
    });
  }, []);

  // Écran blanc pendant la résolution : le club décide des couleurs et du nom, il n'y a rien
  // d'honnête à afficher avant de les connaître.
  if (loading) return null;

  // Club introuvable ou suspendu. Écran sobre, aux tokens de la vitrine — la vraie page
  // « club inconnu » (design, slug dans l'URL) reste PR13 : ne pas l'anticiper.
  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
        <div className="card max-w-md px-6 py-5 text-center">
          <p className="text-base font-bold">Site indisponible</p>
          <p className="mt-2 text-sm text-muted">
            Aucun club ne correspond à cette adresse. Vérifiez l'adresse utilisée, ou revenez
            plus tard.
          </p>
        </div>
      </div>
    );
  }

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/** Le club et sa config. Toujours définis : le provider ne monte ses enfants qu'après. */
export function useSite(): SiteContextValue {
  const value = useContext(SiteContext);
  if (!value) throw new Error('useSite() doit être appelé sous <SiteProvider>');
  return value;
}
