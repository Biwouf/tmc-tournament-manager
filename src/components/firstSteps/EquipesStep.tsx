import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { skipFirstStep } from '../../lib/firstSteps';
import type { LiveSet3Format, TeamCompetition, TeamEquipe, TeamEtape, TeamFormat, TeamGenre, TeamRencontre, TeamSaison } from '../../types';
import { FORMAT_LABELS, GENRE_LABELS, GENRES_BY_TYPE, formatCategorie } from '../teamMatches/teamMatchLabels';
import {
  createCompetition, createTeamFromPool, encounterCount, ensureSeason, errorMessage, missingFields, prepareCompetition, readPool,
  type CompetitionDraft, type PoolReading,
} from '../teamMatches/teamImport';
import { normalizeTenupPoolUrl } from '../../../shared/tenupPool.mjs';
import type { StepProps } from './FirstStepsFlow';
import { notifyTeamsChanged } from './teamsSignal';

// SaaS S6 — étape « Vos équipes » : un lien de poule Ten'Up → saison, compétition, équipe,
// journées et rencontres. Deux lectures Ten'Up pour une compétition nouvelle (championnat, poule),
// une seule quand le club a déjà ce championnat dans la saison.

type ListedTeam = { id: string; name: string; detail: string };
type Phase = 'idle' | 'reading' | 'needs' | 'confirm' | 'creating';

const LINES = ['Poule trouvée sur TEN’UP', 'Calendrier, adversaires et lieux lus', 'Votre équipe reconnue dans la poule'];
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
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<CompetitionDraft | null>(null);
  // Les champs que TEN'UP n'a pas permis de déduire : eux seuls sont demandés.
  const [asked, setAsked] = useState<ReturnType<typeof missingFields>>([]);
  const [saisonId, setSaisonId] = useState<string | null>(null);
  const [competition, setCompetition] = useState<TeamCompetition | null>(null);
  const [reading, setReading] = useState<PoolReading | null>(null);
  const [teamId, setTeamId] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const clubNames = [config.brand.name, club.name];

  const [listVersion, setListVersion] = useState(0);
  useEffect(() => {
    let active = true;
    loadTeams(club.id).then(
      (list) => { if (active) setTeams(list); },
      () => { if (active) setTeams((current) => current ?? []); },
    );
    return () => { active = false; };
  }, [club.id, listVersion]);
  const refresh = () => setListVersion((v) => v + 1);

  const fail = (err: unknown) => {
    const message = errorMessage(err, 'La lecture Ten’Up n’a pas abouti. Vérifiez votre connexion puis réessayez.');
    setExpired(/expiré/i.test(message));
    setError(message);
    setPhase('idle');
  };

  const changeUrl = (value: string) => {
    setUrl(value);
    setError(null); setExpired(false); setNotice(null);
    if (!value.trim()) { setUrlError(null); return; }
    try { normalizeTenupPoolUrl(value); setUrlError(null); }
    catch (err) { setUrlError(errorMessage(err, 'Lien Ten’Up invalide.')); }
  };

  const readTeams = async (comp: TeamCompetition) => {
    setProgress(1);
    const result = await readPool(supabase, club.id, comp, url, clubNames, config.brand.city);
    setProgress(2);
    setReading(result);
    setProgress(3);
    if (!result.candidates.length && result.alreadyImported.length) {
      const names = result.alreadyImported.map((e) => `« ${e.tenup_team_name ?? `Équipe ${e.numero}`} »`).join(', ');
      setNotice(`${names} ${result.alreadyImported.length > 1 ? 'sont' : 'est'} déjà dans vos équipes.`);
      setUrl('');
      setPhase('idle');
      return;
    }
    setTeamId(result.candidates.length === 1 ? result.candidates[0] : '');
    setChoosing(result.candidates.length !== 1);
    setPhase('confirm');
  };

  const start = async () => {
    try { normalizeTenupPoolUrl(url); } catch (err) { setUrlError(errorMessage(err, 'Lien Ten’Up invalide.')); return; }
    setPhase('reading'); setProgress(0); setError(null); setExpired(false); setNotice(null); setReading(null);
    try {
      const saison = await ensureSeason(supabase, club.id);
      setSaisonId(saison.id);
      const prepared = await prepareCompetition(supabase, club.id, saison.id, url);
      if ('competition' in prepared) {
        setCompetition(prepared.competition);
        await readTeams(prepared.competition);
        return;
      }
      if (missingFields(prepared.draft).length) {
        setDraft(prepared.draft);
        setAsked(missingFields(prepared.draft));
        setProgress(1);
        setPhase('needs');
        return;
      }
      const comp = await createCompetition(supabase, club.id, saison.id, prepared.draft);
      setCompetition(comp);
      await readTeams(comp);
    } catch (err) { fail(err); }
  };

  const confirmDraft = async () => {
    if (!draft || !saisonId || missingFields(draft).length) return;
    setPhase('reading');
    setError(null);
    try {
      const comp = await createCompetition(supabase, club.id, saisonId, draft);
      setCompetition(comp);
      setDraft(null);
      await readTeams(comp);
    } catch (err) { fail(err); }
  };

  const reread = async () => {
    if (!competition) return start();
    setPhase('reading'); setProgress(1); setError(null); setExpired(false);
    try { await readTeams(competition); } catch (err) { fail(err); }
  };

  const add = async () => {
    if (!reading || !competition || !teamId) return;
    setPhase('creating');
    setError(null);
    const name = reading.preview.teams.find((t) => t.id === teamId)?.name ?? 'L’équipe';
    try {
      await createTeamFromPool(supabase, club.id, competition.id, reading, teamId);
      setNotice(null);
      setUrl(''); setReading(null); setTeamId('');
      setPhase('idle');
      refresh();
      notifyTeamsChanged();
    } catch (err) {
      const message = errorMessage(err, 'La création n’a pas abouti. Réessayez.');
      if (/déjà ajoutée/i.test(message)) {
        setNotice(`« ${name} » est déjà dans vos équipes.`);
        setUrl(''); setReading(null); setPhase('idle');
        refresh();
        return;
      }
      setExpired(/expiré/i.test(message));
      setError(message);
      setPhase(/expiré/i.test(message) ? 'idle' : 'confirm');
    }
  };

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
  const busy = phase === 'reading' || phase === 'creating';
  const calendarCount = reading && teamId ? encounterCount(reading.preview, teamId) : 0;
  const chosen = reading?.preview.teams.find((t) => t.id === teamId);
  const imported = new Set(reading?.equipes.map((e) => e.tenup_team_id).filter(Boolean));
  const ordered = reading ? [...reading.preview.teams].sort((a, b) => Number(reading.candidates.includes(b.id)) - Number(reading.candidates.includes(a.id))) : [];

  return <>
    <span className="fs-eyebrow">{eyebrow}</span>
    <h2 className="fs-h" tabIndex={-1}>Vos équipes, sans rien ressaisir.</h2>
    <p className="fs-lede">Collez le lien de la poule d’une équipe sur TEN’UP : calendrier, adversaires et lieux arrivent tout seuls. Une équipe suffit pour commencer.</p>

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
    {notice && <p role="status" className="fs-notice">{notice}</p>}

    {phase === 'idle' && (
      <div className="fs-group">
        <label className="fs-label" htmlFor="fs-pool-url">{hasTeams ? 'Une autre équipe ? Lien de sa poule' : 'Lien de la poule sur TEN’UP'}</label>
        <input id="fs-pool-url" className="fs-input" type="url" inputMode="url" value={url} aria-invalid={Boolean(urlError)}
          aria-describedby={urlError ? 'fs-pool-url-error' : undefined}
          placeholder="https://tenup.fft.fr/championnat/…&poule=…"
          onChange={(e) => changeUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && url.trim() && !urlError) void start(); }} />
        {urlError && <span id="fs-pool-url-error" role="alert" className="fs-error">{urlError}</span>}
        <details className="fs-help">
          <summary>Où trouver ce lien ?</summary>
          <p>Sur TEN’UP : Compétitions › votre championnat › la poule de l’équipe. Copiez l’adresse de la page.</p>
        </details>
        <div className="fs-actions">
          <button type="button" className="fs-btn fs-btn-p" disabled={!url.trim() || Boolean(urlError)} onClick={start}>Lire la poule</button>
          {expired && <button type="button" className="fs-btn fs-btn-o" onClick={reread}>Relire la poule</button>}
        </div>
      </div>
    )}

    {(phase === 'reading' || phase === 'needs' || phase === 'confirm' || phase === 'creating') && (
      <ul className="fs-progress" role="status" aria-live="polite" aria-label="Lecture de la poule">
        {LINES.map((line, i) => {
          // Aucune (ou plusieurs) équipe du club reconnue : la dernière ligne le dit, sans coche.
          const unrecognised = i === 2 && progress > 2 && reading !== null && reading.candidates.length !== 1;
          const done = progress > i && !unrecognised;
          const waiting = phase === 'reading' && progress === i;
          return (
            <li key={line} className={done || waiting || unrecognised ? 'on' : undefined}>
              {done ? <span aria-hidden="true" className="fs-mark ok">✓</span> : waiting ? <span aria-hidden="true" className="fs-spin" /> : <span aria-hidden="true" className="fs-mark">{unrecognised ? '?' : ''}</span>}
              <span>{unrecognised ? 'Votre équipe : à choisir ci-dessous' : line}{waiting ? ' — en cours' : ''}</span>
            </li>
          );
        })}
      </ul>
    )}

    {phase === 'needs' && draft && (
      <div className="fs-group">
        <p className="fs-question">TEN’UP ne précise pas tout pour « {draft.nom} ». Complétez :</p>
        {asked.includes('genre') && (
          <fieldset className="fs-fieldset">
            <legend className="fs-label">Genre</legend>
            <div className="fs-seg">
              {GENRES_BY_TYPE[draft.type].map((genre: TeamGenre) => (
                <button key={genre} type="button" className="fs-btn fs-btn-o" aria-pressed={draft.genre === genre}
                  onClick={() => setDraft({ ...draft, genre })}>{GENRE_LABELS[genre]}</button>
              ))}
            </div>
          </fieldset>
        )}
        {asked.includes('format') && (
          <label className="fs-label">Format des rencontres
              <select className="fs-input" value={draft.format ?? ''} onChange={(e) => setDraft({ ...draft, format: (e.target.value || null) as TeamFormat | null })}>
                <option value="">Choisir…</option>
                {(Object.keys(FORMAT_LABELS) as TeamFormat[]).map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
              </select>
            </label>
        )}
        {asked.includes('singles_set3_format') && (
          <fieldset className="fs-fieldset">
            <legend className="fs-label">Troisième set des simples</legend>
            <div className="fs-seg">
              {([['normal', 'Set classique'], ['super_tiebreak', 'Super tie-break']] as [LiveSet3Format, string][]).map(([value, label]) => (
                <button key={value} type="button" className="fs-btn fs-btn-o" aria-pressed={draft.singles_set3_format === value}
                  onClick={() => setDraft({ ...draft, singles_set3_format: value })}>{label}</button>
              ))}
            </div>
          </fieldset>
        )}
        <div className="fs-actions">
          <button type="button" className="fs-btn fs-btn-p" disabled={missingFields(draft).length > 0} onClick={confirmDraft}>Continuer</button>
          <button type="button" className="fs-link" onClick={() => { setDraft(null); setPhase('idle'); }}>Annuler</button>
        </div>
      </div>
    )}

    {(phase === 'confirm' || phase === 'creating') && reading && competition && (
      <div className="fs-group">
        {chosen && !choosing
          ? <div className="fs-found">
              <span className="fs-team-name">{chosen.name}</span>
              <span className="fs-team-detail">{competition.nom} · {reading.preview.division} · {plural(calendarCount, 'rencontre')}</span>
              <button type="button" className="fs-link" onClick={() => setChoosing(true)}>Ce n’est pas la vôtre ?</button>
            </div>
          : <fieldset className="fs-fieldset">
              <legend className="fs-label">{reading.candidates.length > 1 ? 'Plusieurs équipes du club dans cette poule : laquelle ajouter ?' : 'Quelle est votre équipe dans cette poule ?'}</legend>
              <div className="fs-choices">
                {ordered.map((t) => {
                  const already = imported.has(t.id);
                  return (
                    <label key={t.id} className={`fs-choice${teamId === t.id ? ' on' : ''}${already ? ' off' : ''}`}>
                      <input type="radio" name="fs-team" value={t.id} checked={teamId === t.id} disabled={already} onChange={() => setTeamId(t.id)} />
                      <span>{t.name}{already ? ' · déjà ajoutée' : reading.candidates.includes(t.id) ? ' · votre club ?' : ''}</span>
                    </label>
                  );
                })}
              </div>
              {chosen && <span className="fs-team-detail">{competition.nom} · {reading.preview.division} · {plural(calendarCount, 'rencontre')}</span>}
            </fieldset>}
        <p className="fs-note">Les heures ne sont pas sur le calendrier TEN’UP : les rencontres sont créées à 9 h, à ajuster ensuite.</p>
        <div className="fs-actions">
          <button type="button" className="fs-btn fs-btn-p" disabled={!teamId || phase === 'creating'} onClick={add}>
            {phase === 'creating' ? 'Ajout…' : 'Ajouter l’équipe'}
          </button>
          <button type="button" className="fs-link" disabled={phase === 'creating'} onClick={() => { setReading(null); setPhase('idle'); }}>Annuler</button>
        </div>
      </div>
    )}

    {error && <p role="alert" className="fs-error">{error}</p>}

    <div className="fs-footer">
      <button type="button" className="fs-btn fs-btn-p" disabled={!hasTeams || busy || leaving} onClick={goNext}>
        {teams && teams.length > 1 ? 'C’est bon pour l’instant →' : `Suivant : ${next?.label ?? 'la suite'} →`}
      </button>
      {!hasTeams && next && <button type="button" className="fs-link" disabled={busy || leaving} onClick={skip}>Passer cette étape</button>}
    </div>
  </>;
}
