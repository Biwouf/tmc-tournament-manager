import { supabase } from '../../lib/supabase';
import type { TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre, TeamSaison } from '../../types';
import { GENRE_LABELS, formatCategorie } from '../teamMatches/teamMatchLabels';
import type { MatchCard } from '../signup/SignupPreview';

// SaaS S6 — l'onglet « Matchs équipes » de la PWA avec les rencontres réellement créées : saison
// active (ou la plus récente, comme `MatchesEquipesPage`), puis compétitions, équipes, journées et
// rencontres du club. « À venir » = ni confirmée ni WO, jusqu'à la fin de son jour, comme la PWA.
// Sans saison encore : celle que l'étape créera (septembre → août).

export type Screen = { season: string; upcoming: MatchCard[]; past: number };

/** Aussi lu par l'aperçu compact de l'écran « Votre app est prête » (P2). */
export async function loadMatchesScreen(clubId: string): Promise<Screen | null> {
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
