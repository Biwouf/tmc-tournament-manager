import { useRef, useState } from 'react';

type Player = { prenom: string; nom: string | null; classement: string };
type SourceLine = { match_type: 'simple' | 'double'; slot: number; players_a: Player[]; players_b: Player[]; sets: { a: number; b: number }[] };
type Preview = { id: string; url: string; date: string; teams: string[]; scores: number[]; lines: SourceLine[] };
type ExistingLine = { sets?: unknown[]; match_type: string; slot: number; score: string | null; gagnant: string | null; live_match_id: string | null; confirmed_at: string | null; joueurs_club: Player[]; joueurs_adverse: Player[] };
type Result = { imported: number; preserved: number; confirmed: boolean };
export interface TenupSyncProps {
  sourceUrl?: string | null; syncedAt?: string | null; sourceSide?: number | null;
  clubName: string; opponent: string; date: string; lines: ExistingLine[];
  preview: (url: string) => Promise<Preview>;
  apply: (id: string, side: number) => Promise<Result>;
  onSynced: () => void;
}
const names = (players: Player[]) => players.map(p => `${p.prenom} ${p.nom ?? ''}`.trim()).join(' / ');
const identity = (players: Player[]) => players.map(p => `${p.prenom} ${p.nom ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')).sort().join('|');

export default function TenupSync(props: TenupSyncProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(props.sourceUrl ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [side, setSide] = useState<number | null>(props.sourceSide ?? null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const localDate = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(props.date));
  const dateMismatch = !!preview && preview.date !== localDate;
  const plan = preview?.lines.map(line => {
    const existing = props.lines.find(l => l.match_type === line.match_type && l.slot === line.slot);
    const club = side === 1 ? line.players_b : line.players_a;
    const adverse = side === 1 ? line.players_a : line.players_b;
    const compositionConflict = existing && (identity(existing.joueurs_club) !== identity(club) || identity(existing.joueurs_adverse) !== identity(adverse));
    const preserve = !!existing && (!!existing.live_match_id || existing.score !== null || !!existing.gagnant || !!existing.confirmed_at || !!existing.sets?.length || compositionConflict);
    const score = line.sets.map(s => side === 1 ? `${s.b}-${s.a}` : `${s.a}-${s.b}`).join(' ');
    return { line, club, adverse, preserve, existing, score, compositionConflict };
  }) ?? [];
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    if (!navigator.onLine) { setError('Une connexion Internet est nécessaire pour synchroniser.'); return; }
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Synchronisation impossible. Réessayez.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <section className="rounded-xl border border-border bg-card p-4" aria-label="Synchronisation Ten’Up">
    <button type="button" className="min-h-11 w-full rounded-lg border border-primary px-4 py-2 font-semibold text-primary disabled:opacity-50" disabled={busy}
      aria-expanded={open} onClick={() => { setOpen(!open); setError(''); }}>Synchroniser depuis Ten’Up</button>
    {props.syncedAt && <p className="mt-2 text-xs text-muted-foreground">Synchronisé depuis <a className="underline" href={props.sourceUrl ?? undefined} target="_blank" rel="noreferrer">Ten’Up</a> le {new Date(props.syncedAt).toLocaleString('fr-FR')}.</p>}
    {result && <p role="status" className="mt-3 text-sm">{result.imported} résultat(s) importé(s), {result.preserved} match(s) conservé(s). {result.confirmed ? 'Rencontre confirmée.' : 'Vérifiez les résultats conservés avant de confirmer la rencontre.'}</p>}
    {open && <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">Récupérez les résultats publiés après la rencontre. Les scores et les suivis déjà saisis seront conservés.</p>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run(async () => { setPreview(null); setChecked(false); setResult(null); setSide(props.sourceSide ?? null); setPreview(await props.preview(props.sourceUrl ?? url)); }); }}>
        <label className="block text-sm font-medium">Lien de la rencontre Ten’Up
          <input required type="url" maxLength={500} value={props.sourceUrl ?? url} readOnly={!!props.sourceUrl} disabled={busy}
            onChange={e => { setUrl(e.target.value); setPreview(null); setChecked(false); }} placeholder="https://tenup.fft.fr/championnat/…/rencontre/…"
            className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background p-3 text-sm" />
        </label>
        <button disabled={busy} type="submit" className="min-h-11 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Synchronisation en cours…' : preview ? 'Actualiser l’aperçu' : 'Lire les résultats'}</button>
      </form>
      {busy && <p role="status" className="text-sm text-muted-foreground">Cette opération peut prendre jusqu’à une minute.</p>}
      {preview && <div className="space-y-3">
        <h3 className="font-semibold">{preview.teams[0]} — {preview.teams[1]}</h3>
        <p className="text-sm">Ten’Up : {preview.date.split('-').reverse().join('/')} · Score {preview.scores.join(' – ')}</p>
        <p className="text-sm">Votre rencontre : {props.clubName} — {props.opponent} · {new Date(props.date).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}</p>
        {dateMismatch && <p role="alert" className="text-sm text-red-700">Les dates diffèrent. Vérifiez le lien ou corrigez la date de la rencontre avant l’import.</p>}
        <fieldset disabled={busy || props.sourceSide != null} className="space-y-2"><legend className="mb-2 text-sm font-semibold">Quelle équipe représente votre club ?</legend>
          {preview.teams.map((team, index) => <label key={index} className="flex min-h-11 items-center gap-3 rounded-lg border border-border p-3 text-sm">
            <input type="radio" name={`tenup-side-${preview.id}`} checked={side === index} onChange={() => { setSide(index); setChecked(false); }} />{team}
          </label>)}
        </fieldset>
        {side !== null && <>
          <p className="text-sm text-muted-foreground">Scores présentés dans l’ordre : votre club — adversaire.</p>
          <ul className="space-y-3">{plan.map(({ line, club, adverse, preserve, existing, score, compositionConflict }) => <li key={`${line.match_type}-${line.slot}`} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-semibold">{line.match_type === 'simple' ? 'Simple' : 'Double'} {line.slot} · {preserve ? 'Conservé' : 'À importer'}</p>
            <p>{names(club)}</p><p className="text-muted-foreground">{names(adverse)}</p>
            <p className="mt-1 font-semibold">Ten’Up : {score}</p>
            {preserve && <p className="mt-1 text-amber-800">{compositionConflict ? 'Composition différente.' : existing?.live_match_id ? 'Un suivi live existe.' : `Résultat existant : ${existing?.score ?? 'déjà validé'}.`} Aucune modification de ce match.</p>}
          </li>)}</ul>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" disabled={busy || dateMismatch} checked={checked} onChange={e => setChecked(e.target.checked)} />J’ai vérifié les équipes, la date et les résultats de cette rencontre.</label>
          <button type="button" disabled={busy || !checked || dateMismatch} className="min-h-12 w-full rounded-lg bg-primary p-3 font-semibold text-primary-foreground disabled:opacity-50"
            onClick={() => void run(async () => { const data = await props.apply(preview.id, side); setResult(data); setPreview(null); setOpen(false); props.onSynced(); })}>
            Importer les résultats manquants ({plan.filter(p => !p.preserve).length})
          </button>
        </>}
      </div>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="button" disabled={busy} onClick={() => setOpen(false)} className="min-h-11 text-sm underline">Fermer</button>
    </div>}
  </section>;
}
