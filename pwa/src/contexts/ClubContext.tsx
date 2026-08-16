// Multi-tenant — PR2 : résolution du club courant (tenant) à partir du hostname.
//
// **Copie** de src/contexts/ClubContext.tsx (BO), même patron que liveScoreRules.ts.
// À synchroniser manuellement si la logique de résolution change.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

type Club = { id: string; slug: string; name: string; sport: string; status: string };
type ClubContextValue = { clubId: string | null; club: Club | null; loading: boolean };

const ClubContext = createContext<ClubContextValue>({ clubId: null, club: null, loading: true });

function resolveSlug(): string {
  const host = window.location.hostname;
  const match = host.match(/^([a-z0-9-]+)\.feelike\.app$/);
  if (match) return match[1];
  return (import.meta.env.VITE_DEV_CLUB_SLUG as string | undefined) ?? 'cac-tennis';
}

export function ClubProvider({ children }: { children: ReactNode }) {
  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const slug = resolveSlug();
    supabase
      .from('clubs')
      .select('id, slug, name, sport, status')
      .eq('slug', slug)
      .eq('status', 'active')
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          console.error(`[ClubContext] club "${slug}" introuvable, fallback cac-tennis`, error);
          supabase
            .from('clubs')
            .select('id, slug, name, sport, status')
            .eq('slug', 'cac-tennis')
            .single()
            .then(({ data: fallback }) => {
              setClub(fallback ?? null);
              setLoading(false);
            });
          return;
        }
        setClub(data);
        setLoading(false);
      });
  }, []);

  return (
    <ClubContext.Provider value={{ clubId: club?.id ?? null, club, loading }}>
      {children}
    </ClubContext.Provider>
  );
}

export function useClub() {
  return useContext(ClubContext);
}
