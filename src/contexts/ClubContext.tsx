// Résolution BO : sélection centrale validée ou alias technique explicite.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { resolveClubSlug } from '../lib/clubHost';
import ClubUnavailable from '../components/ClubUnavailable';

export type Club = { id: string; slug: string; name: string; sport: string; status: string };
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

// Accès support : diagnostic explicite d’un club, y compris suspendu.
// Sur admin.feelike.pro, AdminEntry vérifie le statut super-admin avant la résolution.
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

export function ClubProvider({ children, initialClub, support = false }: { children: ReactNode; initialClub?: Club; support?: boolean }) {
  const [club, setClub] = useState<Club | null>(null);
  const [isSupport, setIsSupport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [temporary, setTemporary] = useState(false);

  useEffect(() => {
    let active = true;
    // Ordre de résolution : override de support → hostname (ou slug de développement).
    const resolve = async () => {
      if (initialClub) return { club: initialClub, isSupport: support };
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

      const slug = resolveClubSlug(window.location.hostname, 'bo', import.meta.env);
      if (!slug) return { club: null, isSupport: false };
      const { data, error } = await supabase
        .from('clubs')
        .select(CLUB_FIELDS)
        .eq('slug', slug)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      if (data) return { club: data as Club, isSupport: false };

      console.error(`[ClubContext] club "${slug}" indisponible`, error);
      return { club: null, isSupport: false };
    };

    resolve().then((resolved) => {
      if (!active) return;
      setClub(resolved.club);
      setIsSupport(resolved.isSupport);
    }).catch(() => { if (active) setTemporary(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [initialClub, support]);

  if (loading) return <p role="status" className="p-8 text-center">Chargement du club…</p>;
  if (!club) return <ClubUnavailable temporary={temporary} />;

  return (
    <ClubContext.Provider value={{ clubId: club?.id ?? null, club, loading, isSupport }}>
      {children}
    </ClubContext.Provider>
  );
}

export function useClub() {
  return useContext(ClubContext);
}
