import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre, TeamSaison } from '../../types';
import { GENRE_LABELS, formatCategorie, seasonLabel } from '../teamMatches/teamMatchLabels';
import { MatchesScreen, type MatchCard } from '../signup/SignupPreview';
import type { StepPreviewProps } from './FirstStepsFlow';
import { useTeamsVersion } from './teamsSignal';

// SaaS S6 — l'onglet « Matchs équipes » de la PWA avec les rencontres réellement créées : saison
// active (ou la plus récente, comme `MatchesEquipesPage`), puis compétitions, équipes, journées et
// rencontres du club. « À venir » = ni confirmée ni WO, jusqu'à la fin de son jour, comme la PWA.
// Sans saison encore : celle que l'étape créera (septembre → août).

type Screen = { season: string; upcoming: MatchCard[]; past: number };

async function load(clubId: string): Promise<Screen | null> {
  const { data: saisons } = await supabase.from('team_saisons').select('*').eq('club_id', clubId).order('created_at', { ascending: false });
  const saison = (saisons as TeamSaison[] | null)?.find((s) => s.actif) ?? (saisons as TeamSaison[] | null)?.[0];
  if (!saison) return null;
  const empty = { season: saison.label, upcoming: [], past: 0 };
  const { data: comps } = await supabase.from('team_competitions').select('*').eq('club_id', clubId).eq('saison_id', saison.id);
  const competitions = (comps ?? []) as TeamCompetition[];
  if (!competitions.length) return empty;
  const { data: eqs } = await supabase.from('team_equipes').select('*').eq('club_id', clubId).in('competition_id', competitions.map((c) => c.id));
  const equipes = (eqs ?? []) as TeamEquipe[];
  if (!equipes.length) return empty;
  const { data: ets } = await supabase.from('team_etapes').select('*').eq('club_id', clubId).in('equipe_id', equipes.map((e) => e.id));
  const etapes = (ets ?? []) as TeamEtape[];
  if (!etapes.length) return empty;
  const { data: rens } = await supabase.from('team_rencontres').select('*').eq('club_id', clubId).in('etape_id', etapes.map((e) => e.id)).order('date_heure', { ascending: true });
  const now = new Date();
  let past = 0;
  const upcoming: MatchCard[] = [];
  for (const r of (rens ?? []) as (TeamRencontre & { confirmed_at?: string | null })[]) {
    const date = new Date(r.date_heure);
    const endOfDay = new Date(date); endOfDay.setHours(24, 0, 0, 0);
    if (r.wo || r.confirmed_at || now >= endOfDay) { past += 1; continue; }
    const etape = etapes.find((e) => e.id === r.etape_id);
    const equipe = etape && equipes.find((e) => e.id === etape.equipe_id);
    const comp = equipe && competitions.find((c) => c.id === equipe.competition_id);
    if (!etape || !equipe || !comp) continue;
    upcoming.push({
      key: r.id, date, equipe: equipe.numero, journee: etape.numero_journee ?? 0, vs: r.club_adverse, home: r.domicile,
      comp: `${comp.nom} · ${GENRE_LABELS[comp.genre]} ${formatCategorie(comp.categorie)}`,
    });
  }
  return { season: saison.label, upcoming, past };
}

export default function EquipesPreview({ club, data, version }: StepPreviewProps) {
  const teams = useTeamsVersion();
  const [screen, setScreen] = useState<Screen | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    load(club.id).then((result) => { if (active) setScreen(result); }, () => { if (active) setScreen(null); });
    return () => { active = false; };
  }, [club.id, version, teams]);

  return (
    <MatchesScreen
      data={data}
      season={screen?.season ?? seasonLabel(new Date())}
      matches={screen?.upcoming ?? []}
      past={screen?.past ?? 0}
      empty={screen === undefined
        ? <div className="h-32 animate-pulse rounded-xl bg-muted" />
        : <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="text-base font-bold text-foreground">{screen && screen.past ? 'Aucune rencontre à venir' : 'Vos rencontres arrivent ici'}</span>
            <span className="h-3 w-2/3 rounded-md bg-muted" />
          </div>}
    />
  );
}
