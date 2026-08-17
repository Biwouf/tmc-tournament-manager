// Multi-tenant — PR2 : résolution du club courant (tenant) à partir du hostname.
//
// Duplication assumée avec pwa/src/contexts/ClubContext.tsx (même patron que
// liveScoreRules.ts) : garder les deux synchronisés si la logique change.
// ⚠️ PR5 : l'override de support ci-dessous est **BO uniquement** — c'est la seule
// divergence volontaire entre les deux copies.
//
// PR2 pose la logique de résolution par slug uniquement. Le volet custom_domain,
// le préfixe `app-` PWA et la page « club inconnu / suspendu » sont hors périmètre
// (fallback silencieux sur CAC en attendant PR13).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

type Club = { id: string; slug: string; name: string; sport: string; status: string };
type ClubContextValue = {
  clubId: string | null;
  club: Club | null;
  loading: boolean;
  /** Le club courant vient de l'override de support, pas du hostname (PR5 §7). */
  isSupport: boolean;
};

const ClubContext = createContext<ClubContextValue>({
  clubId: null,
  club: null,
  loading: true,
  isSupport: false,
});

const CLUB_FIELDS = 'id, slug, name, sport, status';

// PR5 §7 — accès support. Le BO résout son club par hostname et il n'y a pas encore de
// wildcard `*.feelike.app` (PR13) : sans cet override, un club créé depuis la console
// n'est joignable par personne, et PR5 n'est pas vérifiable.
//
// Ce n'est pas une faille : un utilisateur lambda qui poserait la clé à la main tomberait
// sur l'écran « Accès refusé » de PR4 (non-membre, non super-admin) et la RLS
// `tenant_isolation` ne lui rendrait de toute façon aucune donnée. L'override change le
// club AFFICHÉ, pas les droits — ne pas le sur-protéger côté front.
export const SUPPORT_CLUB_KEY = 'feelike_support_club';

/** Entre dans un club en support (console super-admin). Recharge l'app. */
export function enterSupportClub(clubId: string) {
  localStorage.setItem(SUPPORT_CLUB_KEY, clubId);
  window.location.assign('/');
}

/** Quitte le mode support et revient au club du hostname. Recharge l'app. */
export function exitSupportClub() {
  localStorage.removeItem(SUPPORT_CLUB_KEY);
  window.location.assign('/');
}

function resolveSlug(): string {
  const host = window.location.hostname;
  const match = host.match(/^([a-z0-9-]+)\.feelike\.app$/);
  if (match) return match[1];
  return (import.meta.env.VITE_DEV_CLUB_SLUG as string | undefined) ?? 'cac-tennis';
}

export function ClubProvider({ children }: { children: ReactNode }) {
  const [club, setClub] = useState<Club | null>(null);
  const [isSupport, setIsSupport] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Ordre de résolution (PR5 §7) : override de support → hostname → fallback dev.
    const resolve = async () => {
      const override = localStorage.getItem(SUPPORT_CLUB_KEY);
      if (override) {
        // Volontairement SANS filtre `status = 'active'` : entrer dans un club suspendu
        // pour le diagnostiquer est précisément l'usage support. Le bandeau le signale.
        const { data } = await supabase
          .from('clubs')
          .select(CLUB_FIELDS)
          .eq('id', override)
          .maybeSingle();
        if (data) return { club: data as Club, isSupport: true };
        // Club supprimé, ou clé posée à la main sur un id inexistant : on nettoie et on
        // repart sur la résolution normale plutôt que de bloquer le BO.
        console.error(`[ClubContext] club de support "${override}" introuvable, override levé`);
        localStorage.removeItem(SUPPORT_CLUB_KEY);
      }

      const slug = resolveSlug();
      const { data, error } = await supabase
        .from('clubs')
        .select(CLUB_FIELDS)
        .eq('slug', slug)
        .eq('status', 'active')
        .single();
      if (!error && data) return { club: data as Club, isSupport: false };

      console.error(`[ClubContext] club "${slug}" introuvable, fallback cac-tennis`, error);
      const { data: fallback } = await supabase
        .from('clubs')
        .select(CLUB_FIELDS)
        .eq('slug', 'cac-tennis')
        .single();
      return { club: (fallback as Club | null) ?? null, isSupport: false };
    };

    resolve().then((resolved) => {
      setClub(resolved.club);
      setIsSupport(resolved.isSupport);
      setLoading(false);
    });
  }, []);

  // PR3 — ne jamais monter l'app avec clubId null : sinon chaque insert écrirait
  // club_id: null (rejeté par le NOT NULL / la RLS tenant_isolation) et chaque
  // .eq('club_id', null) ne renverrait rien. La vraie page « club inconnu /
  // suspendu » (design + slug dans l'URL) reste du ressort de PR13.
  if (!loading && !club) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Club introuvable ou indisponible. Vérifiez l'adresse utilisée pour accéder au
          back-office, ou contactez l'administrateur de la plateforme.
        </div>
      </div>
    );
  }

  return (
    <ClubContext.Provider value={{ clubId: club?.id ?? null, club, loading, isSupport }}>
      {children}
    </ClubContext.Provider>
  );
}

export function useClub() {
  return useContext(ClubContext);
}
