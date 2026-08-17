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

  // PR3 — ne jamais monter l'app avec clubId null : sinon chaque insert écrirait
  // club_id: null (rejeté par le NOT NULL / la RLS tenant_isolation) et chaque
  // .eq('club_id', null) ne renverrait rien. La vraie page « club inconnu /
  // suspendu » (design + slug dans l'URL) reste du ressort de PR13.
  if (!loading && !club) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Club introuvable ou indisponible. Vérifiez l'adresse utilisée pour accéder à
          l'application, ou contactez votre club.
        </div>
      </div>
    );
  }

  return (
    <ClubContext.Provider value={{ clubId: club?.id ?? null, club, loading }}>
      {children}
    </ClubContext.Provider>
  );
}

export function useClub() {
  return useContext(ClubContext);
}
