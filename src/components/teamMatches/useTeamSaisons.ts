import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useClub } from '../../contexts/ClubContext';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import type { TeamSaison } from '../../types';

/** Saisons du club et saison retenue, mémorisée par club (`/team-matches` et `/medias` la partagent). */
export function useTeamSaisons() {
  const { clubId } = useClub();
  const [saisons, setSaisons] = useState<TeamSaison[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [storedSaisonId, setStoredSaisonId] = useLocalStorage<string>(
    `tmc:${clubId}:team-matches:saison`,
    ''
  );

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('team_saisons')
      .select('*')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        setError(err?.message ?? null);
        setSaisons((data ?? []) as TeamSaison[]);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  // Saison retenue : celle mémorisée si elle existe encore, sinon l'active.
  const saisonId = useMemo(() => {
    if (storedSaisonId && saisons.some((s) => s.id === storedSaisonId)) return storedSaisonId;
    return (saisons.find((s) => s.actif) ?? saisons[0])?.id ?? '';
  }, [saisons, storedSaisonId]);

  return { saisons, error, ready, saisonId, selectSaison: setStoredSaisonId };
}
