import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { resolveClubSlug } from '../lib/clubHost';
import ClubUnavailable from '../components/ClubUnavailable';

type Club = { id: string; slug: string; name: string; sport: string; status: string };
type ClubContextValue = { clubId: string | null; club: Club | null; loading: boolean };
const ClubContext = createContext<ClubContextValue>({ clubId: null, club: null, loading: true });

export function ClubProvider({ children }: { children: ReactNode }) {
  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);
  const [temporary, setTemporary] = useState(false);
  useEffect(() => {
    let active = true;
    const resolve = async () => {
      const slug = resolveClubSlug(window.location.hostname, 'pwa', import.meta.env);
      if (!slug) return null;
      const { data, error } = await supabase.from('clubs')
        .select('id, slug, name, sport, status').eq('slug', slug).eq('status', 'active').maybeSingle();
      if (error) throw error;
      return data;
    };
    resolve().then(data => { if (active) setClub(data); })
      .catch(() => { if (active) setTemporary(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  if (loading) return <p role="status" className="p-8 text-center">Chargement du club…</p>;
  if (!club) return <ClubUnavailable temporary={temporary} />;
  return <ClubContext.Provider value={{ clubId: club.id, club, loading: false }}>{children}</ClubContext.Provider>;
}
export function useClub() { return useContext(ClubContext); }
