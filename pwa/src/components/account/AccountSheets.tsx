import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ACCOUNT_COPY as T, RANK_SERIES } from '../../../../shared/accountCopy.mjs';
import PasswordInput from '../PasswordInput';
import type { Profile, Sex } from '../../lib/courses';

// Mêmes champs que l'inscription : 48 px, texte 16 px (pas de zoom iOS au focus).
const inputClass = 'min-h-12 w-full rounded-xl border border-border bg-background px-3.5 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';
const buttonClass = 'min-h-12 w-full rounded-xl bg-primary px-4 text-base font-bold text-primary-foreground disabled:opacity-60';
const labelClass = 'mb-1.5 block text-sm font-semibold';
const hintClass = 'mt-1 text-[13px] text-muted-foreground';
const errorClass = 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700';

/** Feuille du bas (dialogue modal) ; au centre sur grand écran. Rend le focus au bouton qui l'a ouverte. */
function AccountSheet({ title, onClose, busy = false, children }: {
  title: string; onClose: () => void; busy?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return createPortal(
    <dialog ref={ref} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-3xl bg-card p-5 text-foreground shadow-xl backdrop:bg-black/50 sm:inset-0 sm:m-auto sm:max-w-lg sm:rounded-2xl"
      style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-bold">{title}</h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Fermer"
          className="min-h-11 min-w-11 rounded-lg border border-border px-3">✕</button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}

/** Prénom, nom et sexe : champs texte et choix à conséquences (quotas), donc « Enregistrer ». */
export function NameSexSheet({ profile, onSave, onReload, onClose }: {
  profile: Profile | null;
  /** La révision est celle lue à l'ouverture (ou au rechargement) : un conflit n'est jamais écrasé en silence. */
  onSave: (fields: { prenom: string; nom: string; sex: Sex }, revision: number) => Promise<string | null>;
  onReload: () => Promise<Profile | null>;
  onClose: () => void;
}) {
  const [prenom, setPrenom] = useState(profile?.prenom ?? '');
  const [nom, setNom] = useState(profile?.nom ?? '');
  const [sex, setSex] = useState<Sex | ''>(profile?.sex ?? '');
  const [revision, setRevision] = useState(profile?.revision ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const conflict = error === T.conflict;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!sex || busy) return;
    setBusy(true);
    setError('');
    const failure = await onSave({ prenom, nom, sex }, revision);
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }
  async function reload() {
    const fresh = await onReload();
    setPrenom(fresh?.prenom ?? '');
    setNom(fresh?.nom ?? '');
    setSex(fresh?.sex ?? '');
    setRevision(fresh?.revision ?? 0);
    setError('');
  }
  return (
    <AccountSheet title={T.nameSheet} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="account-prenom">Prénom</label>
            <input id="account-prenom" className={inputClass} autoComplete="given-name" required maxLength={100}
              value={prenom} onChange={e => setPrenom(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="account-nom">Nom</label>
            <input id="account-nom" className={inputClass} autoComplete="family-name" required maxLength={100}
              aria-describedby="account-nom-hint" value={nom} onChange={e => setNom(e.target.value)} />
            <p id="account-nom-hint" className={hintClass}>{T.nameHint}</p>
          </div>
          <fieldset aria-describedby="account-sex-hint">
            <legend className={labelClass}>{T.sexRow}</legend>
            <div className="grid grid-cols-2 gap-3">
              {(['female', 'male'] as const).map(value => (
                <label key={value} className={`flex min-h-12 items-center gap-3 rounded-xl border px-3.5 text-base ${sex === value ? 'border-foreground font-semibold' : 'border-border'}`}>
                  <input type="radio" name="account-sex" value={value} checked={sex === value} required
                    onChange={() => setSex(value)} className="h-5 w-5 accent-foreground" />
                  {value === 'female' ? 'Femme' : 'Homme'}
                </label>
              ))}
            </div>
            <p id="account-sex-hint" className={hintClass}>{T.sexHint}</p>
          </fieldset>
        </fieldset>
        {error && (
          <div role="alert" className={errorClass}>
            {error}
            {conflict && <button type="button" onClick={() => void reload()} className="mt-1 block min-h-11 font-semibold underline">{T.reload}</button>}
          </div>
        )}
        <button className={buttonClass} disabled={busy || conflict || !prenom.trim() || !nom.trim() || !sex}>
          {busy ? T.saving : T.save}
        </button>
      </form>
    </AccountSheet>
  );
}

/** Classement : grille par série ; toucher une valeur l'enregistre (le toast propose Annuler). */
export function RankSheet({ current, canSave, onPick, onClose }: {
  current: string | null;
  canSave: boolean;
  onPick: (rank: string | null) => void;
  onClose: () => void;
}) {
  const chip = (value: string | null, label: string, wide = false) => {
    const selected = current === value;
    return (
      <button key={label} type="button" disabled={!canSave} aria-pressed={selected}
        onClick={() => selected ? onClose() : onPick(value)}
        className={`min-h-12 rounded-xl border text-base font-semibold disabled:opacity-50 ${wide ? 'w-full px-4 text-left' : ''} ${selected ? 'border-foreground bg-foreground text-background' : 'border-border bg-background'}`}>
        {label}
      </button>
    );
  };
  return (
    <AccountSheet title={T.rankRow} onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">{T.rankHint}</p>
      {!canSave && <p role="alert" className={`mb-3 ${errorClass}`}>{T.rankNeedsProfile}</p>}
      {chip(null, T.rankUnknown, true)}
      {RANK_SERIES.map(series => (
        <section key={series.label} aria-label={series.label} className="mt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{series.label}</h3>
          <div className="grid grid-cols-4 gap-2">{series.ranks.map(rank => chip(rank, rank))}</div>
        </section>
      ))}
    </AccountSheet>
  );
}

/** Mot de passe : l'actuel est vérifié avant le changement. */
export function PasswordSheet({ onSave, onClose }: {
  onSave: (current: string, next: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const failure = await onSave(current, next);
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }
  return (
    <AccountSheet title={T.passwordSheet} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="account-current-password">{T.currentPassword}</label>
            <PasswordInput id="account-current-password" className={inputClass} autoComplete="current-password" required
              value={current} onChange={e => setCurrent(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="account-new-password">{T.newPassword}</label>
            <PasswordInput id="account-new-password" className={inputClass} autoComplete="new-password" required minLength={8}
              aria-describedby="account-new-password-hint" value={next} onChange={e => setNext(e.target.value)} />
            <p id="account-new-password-hint" className={hintClass}>{T.passwordHint}</p>
          </div>
        </fieldset>
        {error && <p role="alert" className={errorClass}>{error}</p>}
        <button className={buttonClass} disabled={busy || !current || next.length < 8}>{busy ? T.saving : T.save}</button>
      </form>
    </AccountSheet>
  );
}
