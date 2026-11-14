import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { skipFirstStep } from '../../lib/firstSteps';
import type { TeamCompetition, TeamEquipe, TeamEtape, TeamRencontre, TeamSaison } from '../../types';
import { GENRE_LABELS, formatCategorie } from '../teamMatches/teamMatchLabels';
import type { StepProps } from './FirstStepsFlow';
import { notifyTeamsChanged } from './teamsSignal';
import ClubImport from './ClubImport';
import PoolImport from './PoolImport';

// SaaS S6 — étape « Vos équipes ». Depuis S6b, le lien des rencontres du club sur Ten'Up importe
// toutes les équipes d'un coup (`ClubImport`) ; le lien d'une poule reste en repli (`PoolImport`).

type ListedTeam = { id: string; name: string; detail: string };
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Les équipes du club dans la saison active (ou la plus récente), avec leur nombre de rencontres. */
async function loadTeams(clubId: string): Promise<ListedTeam[]> {
  const { data: saisons, error } = await supabase.from('team_saisons').select('*').eq('club_id', clubId).order('created_at', { ascending: false });
  if (error) throw error;
  const saison = (saisons as TeamSaison[]).find((s) => s.actif) ?? (saisons as TeamSaison[])[0];
  if (!saison) return [];
  const { data: comps } = await supabase.from('team_competitions').select('*').eq('club_id', clubId).eq('saison_id', saison.id);
  const competitions = (comps ?? []) as TeamCompetition[];
  if (!competitions.length) return [];
  const { data: eqs } = await supabase.from('team_equipes').select('*').eq('club_id', clubId).in('competition_id', competitions.map((c) => c.id)).order('created_at', { ascending: true });
  const equipes = (eqs ?? []) as TeamEquipe[];
  if (!equipes.length) return [];
  const { data: ets } = await supabase.from('team_etapes').select('*').eq('club_id', clubId).in('equipe_id', equipes.map((e) => e.id));
  const etapes = (ets ?? []) as TeamEtape[];
  const { data: rens } = etapes.length
    ? await supabase.from('team_rencontres').select('id, etape_id').eq('club_id', clubId).in('etape_id', etapes.map((e) => e.id))
    : { data: [] };
  return equipes.map((e) => {
    const comp = competitions.find((c) => c.id === e.competition_id)!;
    const steps = new Set(etapes.filter((et) => et.equipe_id === e.id).map((et) => et.id));
    const count = ((rens ?? []) as Pick<TeamRencontre, 'etape_id'>[]).filter((r) => steps.has(r.etape_id)).length;
    return {
      id: e.id,
      name: e.tenup_team_name || `Équipe ${e.numero}`,
      detail: `${GENRE_LABELS[comp.genre]} ${formatCategorie(comp.categorie)} · ${e.division} · ${plural(count, 'rencontre')}`,
    };
  });
}

export default function EquipesStep({ club, config, eyebrow, complete, next }: StepProps) {
  const [teams, setTeams] = useState<ListedTeam[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  useEffect(() => {
    let active = true;
    loadTeams(club.id).then(
      (list) => { if (active) setTeams(list); },
      () => { if (active) setTeams((current) => current ?? []); },
    );
    return () => { active = false; };
  }, [club.id, listVersion]);
  const refresh = () => { setListVersion((v) => v + 1); notifyTeamsChanged(); };

  const goNext = async () => {
    if (!next) return;
    setLeaving(true);
    const failure = await complete();
    setLeaving(false);
    if (failure) { setError(`Vos équipes sont créées, mais l’avancement n’a pas pu être enregistré. ${failure}`); return; }
    next.go();
  };

  const skip = async () => {
    if (!next) return;
    setLeaving(true);
    const result = await skipFirstStep(club.id, 'equipes');
    setLeaving(false);
    if (result.error !== undefined) { setError(result.error); return; }
    next.go();
  };

  const hasTeams = Boolean(teams?.length);

  return <>
    <span className="fs-eyebrow">{eyebrow}</span>
    <h2 className="fs-h" tabIndex={-1}>Vos équipes, sans rien ressaisir.</h2>
    <p className="fs-lede">Collez le lien des rencontres de votre club sur TEN’UP : toutes vos équipes, leur calendrier, leurs adversaires et leurs lieux arrivent d’un coup.</p>

    {hasTeams && (
      <ul className="fs-teams" aria-label="Équipes ajoutées">
        {teams!.map((team) => (
          <li key={team.id}>
            <span aria-hidden="true" className="fs-mark ok">✓</span>
            <span className="fs-team-body"><span className="fs-team-name">{team.name}</span><span className="fs-team-detail">{team.detail}</span></span>
          </li>
        ))}
      </ul>
    )}

    <ClubImport club={club} onImported={refresh} onBusy={setBusy} />

    <details className="fs-more">
      <summary>Une équipe manque ? Ajoutez-la avec le lien de sa poule</summary>
      <div className="fs-group"><PoolImport club={club} config={config} onAdded={refresh} onBusy={setBusy} /></div>
    </details>

    {error && <p role="alert" className="fs-error">{error}</p>}

    <div className="fs-footer">
      {hasTeams && <p className="fs-ready" role="status">{teams!.length > 1 ? `Vos ${teams!.length} équipes sont prêtes.` : 'Votre équipe est prête.'}</p>}
      <button type="button" className="fs-btn fs-btn-p" disabled={!hasTeams || busy || leaving} onClick={goNext}>
        {`Suivant : ${next?.label ?? 'la suite'} →`}
      </button>
      {!hasTeams && next && <button type="button" className="fs-link" disabled={busy || leaving} onClick={skip}>Passer cette étape</button>}
    </div>
  </>;
}
