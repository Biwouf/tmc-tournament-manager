import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { LiveSet3Format, TeamEquipe, TeamFormat, TeamGenre, TeamSaison } from '../../types';
import Modal from '../dashboard/Modal';
import { FORMAT_LABELS, GENRE_LABELS, GENRES_BY_TYPE } from './teamMatchLabels';
import { errorMessage, missingFields, seasonCompetitions, type CompetitionDraft } from './teamImport';
import {
  groupClubTeams, importClubTeams, newClubTeams, prepareClubCompetitions,
  type ClubTeamRow, type ImportItem, type NewClubGroup, type PreparedGroup, type TeamOutcome,
} from './clubImport';
import { isTenupClubUrl, normalizeTenupClubUrl } from '../../../shared/tenupClub.mjs';
import { previewTenupClub } from '../../../shared/tenupClubClient';

// « Synchroniser Ten'Up » de `/team-matches/admin` : lit la page des rencontres du club sur Ten'Up et
// propose les équipes (et championnats) absents de la saison affichée. Même logique que l'import des
// premiers pas (`clubImport.ts`) ; rien n'est créé avant validation. Lien du club connu
// (`clubs.tenup_club_id`) → lecture dès le clic ; sinon demandé une fois.

type Phase = 'url' | 'reading' | 'select' | 'preparing' | 'needs' | 'importing' | 'done';
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const FIELD = 'mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
// Même fond animé que la synchro des résultats (index.css, `TenupBatchSync`).
const ROW_CLASSES: Record<TeamOutcome['status'], string> = {
  waiting: '', reading: 'tenup-row-running', done: 'tenup-row-imported', already: 'opacity-60', failed: 'tenup-row-failed',
};
/** Les messages Ten'Up partagés avec l'onboarding renvoient à l'ajout d'équipe par lien ou à la main,
 *  qui n'existe pas ici : seule cette suite est retirée. */
const advice = (message: string) =>
  message.replace(/[.,]?(?: ou| :)? (?:ajoutez|créez|saisissez)[^.]*(?:poule|manuellement)\./gi, '.');
const PRIMARY = 'min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-50';
const SECONDARY = 'min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50';

export default function TenupTeamsSync({ clubId, saisons, saisonId, onImported }: {
  clubId: string;
  saisons: TeamSaison[];
  /** Saison affichée : celle où les équipes sont ajoutées. */
  saisonId: string;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const saison = saisons.find((s) => s.id === saisonId);
  const active = saisons.find((s) => s.actif);
  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={!saison}
      title={saison ? undefined : 'Créez d’abord une saison'}
      className={PRIMARY}
    >
      Synchroniser Ten’Up
    </button>
    {open && saison && <SyncDialog clubId={clubId} saison={saison} otherActive={active && active.id !== saison.id ? active.label : null} onImported={onImported} onClose={() => setOpen(false)} />}
  </>;
}

function SyncDialog({ clubId, saison, otherActive, onImported, onClose }: {
  clubId: string;
  saison: TeamSaison;
  /** Saison active quand ce n'est pas celle affichée. */
  otherActive: string | null;
  onImported: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('reading');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tenupName, setTenupName] = useState('');
  const [found, setFound] = useState(0);
  const [groups, setGroups] = useState<NewClubGroup[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [prepared, setPrepared] = useState<PreparedGroup[]>([]);
  // Par championnat, les champs que Ten'Up n'a pas permis de déduire : eux seuls sont demandés.
  const [asked, setAsked] = useState<Record<string, ReturnType<typeof missingFields>>>({});
  const [outcomes, setOutcomes] = useState<Record<string, TeamOutcome>>({});
  const newCount = groups.reduce((n, g) => n + g.teams.length, 0);
  const busy = ['reading', 'preparing', 'importing'].includes(phase);

  const read = async (link: string) => {
    setPhase('reading');
    setError(null);
    try {
      const page = await previewTenupClub(supabase, clubId, link);
      const competitions = await seasonCompetitions(supabase, clubId, saison.id);
      const { data, error: err } = competitions.length
        ? await supabase.from('team_equipes').select('*').eq('club_id', clubId).in('competition_id', competitions.map((c) => c.id))
        : { data: [], error: null };
      if (err) throw err;
      const equipes = (data ?? []) as TeamEquipe[];
      const fresh = newClubTeams(groupClubTeams(page, competitions, equipes), equipes);
      setTenupName(page.club);
      setFound(page.teams.length);
      setGroups(fresh);
      setChecked(new Set(fresh.flatMap((g) => g.teams.filter((t) => !g.doubtful.has(t.key)).map((t) => t.key))));
      setOutcomes({});
      setPhase('select');
    } catch (err) {
      setError(errorMessage(err, 'La page du club n’a pas pu être lue. Réessayez.'));
      setPhase('url');
    }
  };

  // À l'ouverture : lecture d'office si le lien du club est connu.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const start = async () => {
      const { data } = await supabase.from('clubs').select('tenup_club_id').eq('id', clubId).maybeSingle();
      const id = (data as { tenup_club_id?: string | null } | null)?.tenup_club_id;
      if (!id) return setPhase('url');
      const link = `https://tenup.fft.fr/club/${id}/competitions/rencontres`;
      setUrl(link);
      await read(link);
    };
    start().catch(() => setPhase('url'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitUrl = () => {
    try { void read(normalizeTenupClubUrl(url)); }
    catch (err) { setError(errorMessage(err, 'Lien du club Ten’Up invalide.')); }
  };

  const selection = groups
    .map((group) => ({ group, teams: group.teams.filter((t) => checked.has(t.key)) }))
    .filter((s) => s.teams.length);
  const selectedCount = selection.reduce((n, s) => n + s.teams.length, 0);
  const reads = selectedCount + selection.filter((s) => !s.group.competition).length;

  const run = async (items: PreparedGroup[]) => {
    const start: Record<string, TeamOutcome> = {};
    for (const p of items) for (const t of p.teams) start[t.key] = p.error ? { status: 'failed', message: p.error } : { status: 'waiting' };
    setOutcomes(start);
    setPhase('importing');
    const ready = items.flatMap((p): ImportItem[] => (p.competition ? [{ teams: p.teams, competition: p.competition }] : p.draft ? [{ teams: p.teams, draft: p.draft }] : []));
    try {
      await importClubTeams(supabase, clubId, saison.id, ready, (key, outcome) => setOutcomes((o) => ({ ...o, [key]: outcome })));
    } finally {
      setPhase('done');
      onImported();
    }
  };

  const start = async () => {
    setPhase('preparing');
    setError(null);
    try {
      const items = await prepareClubCompetitions(supabase, clubId, saison.id, selection);
      const missing = Object.fromEntries(items.flatMap((p) => (p.draft && missingFields(p.draft).length ? [[p.group.key, missingFields(p.draft)]] : [])));
      setPrepared(items);
      setAsked(missing);
      if (Object.keys(missing).length) { setPhase('needs'); return; }
      await run(items);
    } catch (err) {
      setError(errorMessage(err, 'L’import n’a pas abouti. Réessayez.'));
      setPhase('select');
    }
  };

  const toggle = (team: ClubTeamRow) => setChecked((set) => {
    const next = new Set(set);
    if (next.has(team.key)) next.delete(team.key); else next.add(team.key);
    return next;
  });
  const setDraft = (index: number, draft: CompetitionDraft) =>
    setPrepared((items) => items.map((p, i) => (i === index ? { group: p.group, teams: p.teams, draft } : p)));

  const isOk = (t: ClubTeamRow) => ['done', 'already'].includes(outcomes[t.key]?.status ?? '');
  const imported = Object.values(outcomes).filter((o) => o.status === 'done').length;
  const failed = Object.values(outcomes).filter((o) => o.status === 'failed').length;
  // Les équipes créées quittent la liste ; seules celles en échec restent cochées.
  const retry = () => {
    setChecked(new Set(Object.keys(outcomes).filter((key) => outcomes[key].status === 'failed')));
    setGroups((list) => list.map((g) => ({ ...g, teams: g.teams.filter((t) => !isOk(t)) })).filter((g) => g.teams.length));
    setError(null);
    setPhase('select');
  };

  return (
    <Modal title="Synchroniser Ten’Up" onClose={() => { if (!busy) onClose(); }}>
      {otherActive && (phase === 'url' || (phase === 'select' && groups.length > 0)) && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Les équipes seront ajoutées à la saison affichée, {saison.label}, alors que la saison active est {otherActive}.
        </p>
      )}

      {phase === 'url' && (
        <div>
          <label htmlFor="tenup-club-url" className="block text-sm font-medium">Lien de votre club sur Ten’Up</label>
          <input id="tenup-club-url" type="url" value={url} placeholder="https://tenup.fft.fr/club/…/competitions/rencontres"
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) submitUrl(); }}
            className={FIELD} />
          <p className="mt-2 text-xs text-muted-foreground">
            Sur Ten’Up : Espace club › Les équipes de mon club. Copiez l’adresse de la page ; elle sera retenue pour la suite.
          </p>
        </div>
      )}

      {(phase === 'reading' || phase === 'preparing') && (
        <p role="status" className="tenup-row-running rounded-lg border border-border p-4 text-center text-sm">
          {phase === 'reading' ? 'Recherche de nouvelles équipes sur Ten’Up…' : 'Lecture des championnats sur Ten’Up…'}
        </p>
      )}

      {phase === 'select' && groups.length === 0 && (found === 0
        ? <p role="status" className="rounded-lg border border-border p-4 text-sm">
            Aucune rencontre à venir sur Ten’Up pour le moment : rien à ajouter.
          </p>
        : <p role="status" className="tenup-row-imported rounded-lg border border-border p-4 text-sm">
            <span className="block font-semibold text-score-win-fg">✓ Aucune nouvelle équipe à ajouter</span>
            <span className="mt-1 block">Vos équipes qui ont des rencontres à venir sur Ten’Up sont toutes dans la saison {saison.label}.</span>
          </p>
      )}

      {phase === 'select' && groups.length > 0 && <>
        <p className="mb-4 text-sm text-muted-foreground">
          {newCount > 1 ? `${newCount} équipes trouvées sur Ten’Up ne sont` : 'Une équipe trouvée sur Ten’Up n’est'} pas encore dans la saison {saison.label}.
          {' '}Choisissez celles à ajouter avec leur calendrier.
        </p>
        <div className="space-y-4">
          {groups.map((group) => (
            <fieldset key={group.key}>
              <legend className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
                {group.competition?.nom ?? group.name}
                {!group.competition && <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">Nouveau championnat</span>}
              </legend>
              <div className="space-y-2">
                {group.teams.map((team) => (
                  <label key={team.key} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm transition hover:bg-muted/50">
                    <input type="checkbox" checked={checked.has(team.key)} onChange={() => toggle(team)} className="mt-0.5 h-4 w-4 accent-primary" />
                    <span className="min-w-0">
                      <span className="block font-medium">{team.team}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[team.genre, team.level, `${plural(team.dates.length, 'rencontre')} à venir`].filter(Boolean).join(' · ')}
                      </span>
                      {group.doubtful.has(team.key) && <span className="mt-1 block text-xs text-amber-700">Peut-être déjà ajoutée : vérifiez avant de cocher.</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Les rencontres sont créées à 9 h, à ajuster ensuite.
          {selectedCount > 0 && ` Environ ${plural(reads, 'lecture')} Ten’Up : gardez cette page ouverte pendant l’import.`}
        </p>
      </>}

      {phase === 'needs' && (
        <div className="space-y-4">
          {prepared.map((p, i) => p.draft && asked[p.group.key]?.length ? (
            <fieldset key={p.group.key} className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold">{p.draft.nom}</legend>
              <p className="mb-2 text-xs text-muted-foreground">Ten’Up ne précise pas tout. Complétez :</p>
              <MissingFields draft={p.draft} asked={asked[p.group.key]} onChange={(draft) => setDraft(i, draft)} />
            </fieldset>
          ) : null)}
        </div>
      )}

      {(phase === 'importing' || phase === 'done') && (
        <ul className="space-y-2" aria-live="polite">
          {groups.flatMap((g) => g.teams).filter((t) => outcomes[t.key]).map((team) => {
            const o = outcomes[team.key];
            return (
              <li key={team.key} className={`rounded-lg border border-border p-3 text-sm transition-colors ${ROW_CLASSES[o.status]}`}>
                <span className="block font-medium">{team.team} · {team.competition}</span>
                <span className={`block text-xs ${o.status === 'done' ? 'text-score-win-fg' : o.status === 'failed' ? 'text-score-loss-fg' : 'text-muted-foreground'}`}>
                  {o.status === 'waiting' ? 'En attente'
                    : o.status === 'reading' ? 'Lecture du calendrier…'
                    : o.status === 'done' ? `${plural(o.count, 'rencontre')} créée${o.count > 1 ? 's' : ''}`
                    : o.status === 'already' ? 'Déjà dans vos équipes'
                    : o.status === 'failed' ? advice(o.message) : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {phase === 'done' && (
        <p role="status" className="mt-3 text-sm font-medium">
          {imported ? `${plural(imported, 'équipe')} ajoutée${imported > 1 ? 's' : ''}.` : 'Aucune équipe ajoutée.'}
          {failed ? ` ${plural(failed, 'équipe')} en échec.` : ''}
        </p>
      )}

      {phase === 'select' && (
        <p className="mt-4 text-xs text-muted-foreground">
          Club lu sur Ten’Up : {tenupName}.{' '}
          <button type="button" onClick={() => setPhase('url')} className="underline">Changer de club</button>
        </p>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{advice(error)}</p>}

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        {phase === 'needs'
          ? <button type="button" onClick={() => setPhase('select')} className={SECONDARY}>Retour</button>
          : <button type="button" onClick={onClose} disabled={busy} className={SECONDARY}>Fermer</button>}
        {phase === 'url' && <button type="button" onClick={submitUrl} disabled={!url.trim()} className={PRIMARY}>{error && isTenupClubUrl(url) ? 'Réessayer' : 'Chercher les équipes'}</button>}
        {phase === 'select' && groups.length > 0 && (
          <button type="button" onClick={() => void start()} disabled={!selectedCount} className={PRIMARY}>
            {selectedCount ? `Ajouter ${plural(selectedCount, 'équipe')}` : 'Ajouter'}
          </button>
        )}
        {phase === 'needs' && (
          <button type="button" onClick={() => void run(prepared)} disabled={prepared.some((p) => p.draft && missingFields(p.draft).length)} className={PRIMARY}>
            Continuer
          </button>
        )}
        {phase === 'done' && failed > 0 && <button type="button" onClick={retry} className={PRIMARY}>Réessayer les échecs</button>}
      </div>
    </Modal>
  );
}

function MissingFields({ draft, asked, onChange }: {
  draft: CompetitionDraft;
  asked: ReturnType<typeof missingFields>;
  onChange: (draft: CompetitionDraft) => void;
}) {
  return (
    <div className="space-y-3">
      {asked.includes('genre') && (
        <label className="block text-sm font-medium">Genre
          <select value={draft.genre ?? ''} onChange={(e) => onChange({ ...draft, genre: (e.target.value || null) as TeamGenre | null })} className={FIELD}>
            <option value="">À renseigner</option>
            {GENRES_BY_TYPE[draft.type].map((g) => <option key={g} value={g}>{GENRE_LABELS[g]}</option>)}
          </select>
        </label>
      )}
      {asked.includes('format') && (
        <label className="block text-sm font-medium">Format
          <select value={draft.format ?? ''} onChange={(e) => onChange({ ...draft, format: (e.target.value || null) as TeamFormat | null })} className={FIELD}>
            <option value="">À renseigner</option>
            {(Object.keys(FORMAT_LABELS) as TeamFormat[]).map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
          </select>
        </label>
      )}
      {asked.includes('singles_set3_format') && (
        <label className="block text-sm font-medium">Troisième set des simples
          <select value={draft.singles_set3_format ?? ''} onChange={(e) => onChange({ ...draft, singles_set3_format: (e.target.value || null) as LiveSet3Format | null })} className={FIELD}>
            <option value="">À renseigner</option>
            <option value="normal">Set classique</option>
            <option value="super_tiebreak">Super tie-break (10 points)</option>
          </select>
        </label>
      )}
    </div>
  );
}
