import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Club } from '../../contexts/ClubContext';
import type { TeamEquipe } from '../../types';
import { ensureSeason, errorMessage, missingFields, seasonCompetitions, type CompetitionDraft } from '../teamMatches/teamImport';
import {
  groupClubTeams, importClubTeams, prepareClubCompetitions,
  type ClubGroup, type ClubTeamRow, type ImportItem, type PreparedGroup, type TeamOutcome,
} from '../teamMatches/clubImport';
import { isTenupClubUrl, normalizeTenupClubUrl } from '../../../shared/tenupClub.mjs';
import { previewTenupClub } from '../../../shared/tenupClubClient';
import DraftFields from './DraftFields';

// SaaS S6b — toutes les équipes du club depuis la page Ten'Up de ses rencontres : lecture de la
// page (1 lecture), choix (tout coché), compétitions (1 lecture par championnat nouveau, champs
// manquants demandés), puis une lecture et une création par poule. Logique : `clubImport.ts`.

type Phase = 'idle' | 'reading' | 'select' | 'preparing' | 'needs' | 'importing' | 'done';
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export default function ClubImport({ club, onImported, onBusy }: {
  club: Club;
  /** Une équipe vient d'être créée : la liste et l'aperçu se relisent. */
  onImported: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [saisonId, setSaisonId] = useState<string | null>(null);
  const [groups, setGroups] = useState<ClubGroup[]>([]);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [prepared, setPrepared] = useState<PreparedGroup[]>([]);
  // Par championnat, les champs que TEN'UP n'a pas permis de déduire : eux seuls sont demandés.
  const [asked, setAsked] = useState<Record<string, ReturnType<typeof missingFields>>>({});
  const [outcomes, setOutcomes] = useState<Record<string, TeamOutcome>>({});
  const setPhase = (next: Phase) => { setPhaseState(next); onBusy(['reading', 'preparing', 'importing'].includes(next)); };

  const changeUrl = (value: string) => {
    setUrl(value); setError(null);
    if (!value.trim()) { setUrlError(null); return; }
    try { normalizeTenupClubUrl(value); setUrlError(null); } catch (err) { setUrlError(errorMessage(err, 'Lien du club Ten’Up invalide.')); }
  };

  const read = async () => {
    if (!isTenupClubUrl(url)) return;
    setPhase('reading'); setError(null);
    try {
      const saison = await ensureSeason(supabase, club.id);
      setSaisonId(saison.id);
      const page = await previewTenupClub(supabase, club.id, url);
      const competitions = await seasonCompetitions(supabase, club.id, saison.id);
      const { data, error: err } = competitions.length
        ? await supabase.from('team_equipes').select('*').eq('club_id', club.id).in('competition_id', competitions.map((c) => c.id))
        : { data: [], error: null };
      if (err) throw err;
      setGroups(groupClubTeams(page, competitions, (data ?? []) as TeamEquipe[]));
      setUnchecked(new Set());
      setOutcomes({});
      setPhase('select');
    } catch (err) {
      setError(errorMessage(err, 'La page du club n’a pas pu être lue. Réessayez, ou ajoutez vos équipes avec le lien de leur poule.'));
      setPhase('idle');
    }
  };

  const selection = groups
    .map((group) => ({ group, teams: group.teams.filter((t) => !t.imported && !unchecked.has(t.key)) }))
    .filter((s) => s.teams.length);
  const selectedCount = selection.reduce((n, s) => n + s.teams.length, 0);
  const newChampionships = selection.filter((s) => !s.group.competition).length;

  const run = async (items: PreparedGroup[]) => {
    if (!saisonId) return;
    setOutcomes(Object.fromEntries(items.flatMap((p) => p.teams.map((t) => [t.key, { status: 'waiting' } as TeamOutcome]))));
    setPhase('importing');
    const ready = items.flatMap((p): ImportItem[] => (p.competition ? [{ teams: p.teams, competition: p.competition }] : p.draft ? [{ teams: p.teams, draft: p.draft }] : []));
    for (const p of items) if (p.error) p.teams.forEach((t) => setOutcomes((o) => ({ ...o, [t.key]: { status: 'failed', message: p.error! } })));
    await importClubTeams(supabase, club.id, saisonId, ready, (key, outcome) => {
      setOutcomes((o) => ({ ...o, [key]: outcome }));
      if (outcome.status === 'done') onImported();
    });
    onImported();
    setPhase('done');
  };

  const start = async () => {
    if (!saisonId || !selectedCount) return;
    setPhase('preparing'); setError(null);
    try {
      const items = await prepareClubCompetitions(supabase, club.id, saisonId, selection);
      setPrepared(items);
      const missing = Object.fromEntries(items.flatMap((p) => (p.draft && missingFields(p.draft).length ? [[p.group.key, missingFields(p.draft)]] : [])));
      setAsked(missing);
      if (Object.keys(missing).length) { setPhase('needs'); return; }
      await run(items);
    } catch (err) {
      setError(errorMessage(err, 'L’import n’a pas abouti. Réessayez.'));
      setPhase('select');
    }
  };

  const setDraft = (index: number, draft: CompetitionDraft) =>
    setPrepared((items) => items.map((p, i) => (i === index ? { group: p.group, teams: p.teams, draft } : p)));
  const toggle = (team: ClubTeamRow) => setUnchecked((set) => {
    const next = new Set(set);
    if (next.has(team.key)) next.delete(team.key); else next.add(team.key);
    return next;
  });
  const imported = Object.values(outcomes).filter((o) => o.status === 'done').length;
  const failed = Object.entries(outcomes).filter(([, o]) => o.status === 'failed').map(([key]) => key);
  // En fin d'import, les équipes créées sont dans la liste du haut : ne restent ici que les échecs.
  const importedTeams = groups.flatMap((g) => g.teams).filter((t) => outcomes[t.key] && (phase !== 'done' || outcomes[t.key].status === 'failed'));

  return <>
    {phase === 'idle' && (
      <div className="fs-group">
        <label className="fs-label" htmlFor="fs-club-url">Lien des rencontres de votre club sur TEN’UP</label>
        <input id="fs-club-url" className="fs-input" type="url" inputMode="url" value={url} aria-invalid={Boolean(urlError)}
          aria-describedby={urlError ? 'fs-club-url-error' : undefined}
          placeholder="https://tenup.fft.fr/club/…/competitions/rencontres"
          onChange={(e) => changeUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && url.trim() && !urlError) void read(); }} />
        {urlError && <span id="fs-club-url-error" role="alert" className="fs-error">{urlError}</span>}
        <details className="fs-help">
          <summary>Où trouver ce lien ?</summary>
          <p>Sur TEN’UP : Espace club › Les équipes de mon club. Copiez l’adresse de la page.</p>
        </details>
        <div className="fs-actions">
          <button type="button" className="fs-btn fs-btn-p" disabled={!url.trim() || Boolean(urlError)} onClick={read}>Trouver mes équipes</button>
        </div>
      </div>
    )}

    {(phase === 'reading' || phase === 'preparing') && (
      <ul className="fs-progress" role="status" aria-live="polite">
        <li className="on"><span aria-hidden="true" className="fs-spin" />
          <span>{phase === 'reading' ? 'Lecture de la page du club sur TEN’UP — en cours' : `Lecture des championnats — en cours`}</span></li>
      </ul>
    )}

    {phase === 'select' && (
      groups.length === 0
        ? <p role="status" className="fs-notice">Aucune rencontre à venir sur la page du club. Ajoutez vos équipes avec le lien de leur poule, ci-dessous.</p>
        : <div className="fs-group">
            <p className="fs-question">{plural(groups.reduce((n, g) => n + g.teams.length, 0), 'équipe')} trouvée{groups.reduce((n, g) => n + g.teams.length, 0) > 1 ? 's' : ''} sur TEN’UP. Décochez celles à laisser de côté :</p>
            {groups.map((group) => (
              <fieldset key={group.key} className="fs-fieldset">
                <legend className="fs-label">{group.name}</legend>
                <div className="fs-choices">
                  {group.teams.map((team) => (
                    <label key={team.key} className={`fs-choice${team.imported ? ' off' : !unchecked.has(team.key) ? ' on' : ''}`}>
                      <input type="checkbox" checked={team.imported || !unchecked.has(team.key)} disabled={team.imported} onChange={() => toggle(team)} />
                      <span className="fs-team-body">
                        <span>{team.team}{team.imported ? ' · déjà ajoutée' : ''}</span>
                        <span className="fs-team-detail">{[team.genre, team.level].filter(Boolean).join(' · ')} · {plural(team.dates.length, 'rencontre')} à venir</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <p className="fs-note">Les équipes sans rencontre à venir n’apparaissent pas sur cette page : ajoutez-les avec le lien de leur poule. Les rencontres sont créées à 9 h, à ajuster ensuite.</p>
            <div className="fs-actions">
              <button type="button" className="fs-btn fs-btn-p" disabled={!selectedCount} onClick={start}>
                {selectedCount ? `Importer ${plural(selectedCount, 'équipe')}` : 'Importer'}
              </button>
              <button type="button" className="fs-link" onClick={() => setPhase('idle')}>Annuler</button>
            </div>
            {selectedCount > 0 && <p className="fs-note">Environ {plural(selectedCount + newChampionships, 'lecture')} TEN’UP, une à deux minutes.</p>}
          </div>
    )}

    {phase === 'needs' && (
      <div className="fs-group">
        {prepared.map((p, i) => p.draft && asked[p.group.key]?.length ? (
          <div key={p.group.key} className="fs-group">
            <p className="fs-question">TEN’UP ne précise pas tout pour « {p.draft.nom} ». Complétez :</p>
            <DraftFields draft={p.draft} asked={asked[p.group.key]} onChange={(draft) => setDraft(i, draft)} />
          </div>
        ) : null)}
        <div className="fs-actions">
          <button type="button" className="fs-btn fs-btn-p" disabled={prepared.some((p) => p.draft && missingFields(p.draft).length)} onClick={() => run(prepared)}>Continuer l’import</button>
          <button type="button" className="fs-link" onClick={() => setPhase('select')}>Annuler</button>
        </div>
      </div>
    )}

    {(phase === 'importing' || phase === 'done') && (
      <div className="fs-group">
        {importedTeams.length > 0 && <ul className="fs-progress" role="status" aria-live="polite" aria-label="Import des équipes">
          {importedTeams.map((team) => {
            const o = outcomes[team.key];
            return (
              <li key={team.key} className={o.status === 'waiting' ? undefined : 'on'}>
                {o.status === 'reading' ? <span aria-hidden="true" className="fs-spin" />
                  : <span aria-hidden="true" className={`fs-mark${o.status === 'done' || o.status === 'already' ? ' ok' : ''}`}>{o.status === 'done' || o.status === 'already' ? '✓' : o.status === 'failed' ? '!' : ''}</span>}
                <span className="fs-team-body">
                  <span>{team.team} · {team.competition}</span>
                  <span className="fs-team-detail">
                    {o.status === 'waiting' ? 'en attente' : o.status === 'reading' ? 'calendrier en cours de lecture' : o.status === 'done' ? `${plural(o.count, 'rencontre')} créée${o.count > 1 ? 's' : ''}` : o.status === 'already' ? 'déjà dans vos équipes' : o.status === 'failed' ? o.message : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>}
        {phase === 'done' && <>
          <p role="status" className="fs-notice">{imported ? `${plural(imported, 'équipe')} importée${imported > 1 ? 's' : ''}.` : 'Aucune nouvelle équipe importée.'}{failed.length ? ` ${plural(failed.length, 'équipe')} en échec.` : ''}</p>
          {failed.length > 0 && (
            <div className="fs-actions">
              <button type="button" className="fs-btn fs-btn-o" onClick={() => {
                // Les équipes créées ou déjà là passent « déjà ajoutées » ; seules les autres restent à cocher.
                const ok = (t: ClubTeamRow) => outcomes[t.key]?.status === 'done' || outcomes[t.key]?.status === 'already';
                setGroups((list) => list.map((g) => ({ ...g, teams: g.teams.map((t) => (ok(t) ? { ...t, imported: true } : t)) })));
                setUnchecked(new Set(groups.flatMap((g) => g.teams).filter((t) => !ok(t) && !failed.includes(t.key)).map((t) => t.key)));
                setPhase('select');
              }}>Réessayer les équipes en échec</button>
            </div>
          )}
        </>}
      </div>
    )}

    {error && <p role="alert" className="fs-error">{error}</p>}
  </>;
}
