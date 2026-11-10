import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Club } from '../../contexts/ClubContext';
import type { ClubConfig } from '../../lib/clubConfig';
import type { TeamCompetition } from '../../types';
import {
  createCompetition, createTeamFromPool, encounterCount, ensureSeason, errorMessage, missingFields, prepareCompetition, readPool,
  type CompetitionDraft, type PoolReading,
} from '../teamMatches/teamImport';
import { normalizeTenupPoolUrl } from '../../../shared/tenupPool.mjs';
import DraftFields from './DraftFields';

// SaaS S6 — une équipe par le lien de sa poule Ten'Up : saison, compétition, équipe, journées et
// rencontres. Deux lectures pour une compétition nouvelle (championnat, poule), une sinon.
// Depuis S6b, repli de l'import du club (équipe absente de la page du club).

type Phase = 'idle' | 'reading' | 'needs' | 'confirm' | 'creating';

const LINES = ['Poule trouvée sur TEN’UP', 'Calendrier, adversaires et lieux lus', 'Votre équipe reconnue dans la poule'];
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export default function PoolImport({ club, config, onAdded, onBusy }: {
  club: Club;
  config: ClubConfig;
  /** Une équipe vient d'être créée (ou était déjà là) : la liste et l'aperçu se relisent. */
  onAdded: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
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
  const clubNames = [config.brand.name, club.name];

  const [phase, setPhaseState] = useState<Phase>('idle');
  const setPhase = (next: Phase) => { setPhaseState(next); onBusy(next === 'reading' || next === 'creating'); };

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
      onAdded();
    } catch (err) {
      const message = errorMessage(err, 'La création n’a pas abouti. Réessayez.');
      if (/déjà ajoutée/i.test(message)) {
        setNotice(`« ${name} » est déjà dans vos équipes.`);
        setUrl(''); setReading(null); setPhase('idle');
        onAdded();
        return;
      }
      setExpired(/expiré/i.test(message));
      setError(message);
      setPhase(/expiré/i.test(message) ? 'idle' : 'confirm');
    }
  };

  const calendarCount = reading && teamId ? encounterCount(reading.preview, teamId) : 0;
  const chosen = reading?.preview.teams.find((t) => t.id === teamId);
  const imported = new Set(reading?.equipes.map((e) => e.tenup_team_id).filter(Boolean));
  const ordered = reading ? [...reading.preview.teams].sort((a, b) => Number(reading.candidates.includes(b.id)) - Number(reading.candidates.includes(a.id))) : [];

  return <>
    {notice && <p role="status" className="fs-notice">{notice}</p>}

    {phase === 'idle' && (
      <div className="fs-group">
        <label className="fs-label" htmlFor="fs-pool-url">Lien de la poule sur TEN’UP</label>
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
        <DraftFields draft={draft} asked={asked} onChange={setDraft} />
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

  </>;
}
