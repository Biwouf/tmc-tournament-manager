import { useLayoutEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ACCOUNT_COPY as T } from '../../../../shared/accountCopy.mjs';
import { currentYear, isMinor, mousePointer } from '../../lib/avatar';
import { useModalDialog } from '../../hooks/useModalDialog';

const DESKTOP = '(min-width: 640px)';
const media = (query: string) => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

/** Sur ordinateur, la feuille devient un menu ancré sous l'élément qui l'a ouverte. */
function useAnchor(anchor: HTMLElement | null, dialog: RefObject<HTMLDialogElement | null>) {
  const [style, setStyle] = useState<CSSProperties | undefined>();
  useLayoutEffect(() => {
    function place() {
      if (!anchor || !media(DESKTOP)) return setStyle(undefined);
      const rect = anchor.getBoundingClientRect();
      const width = 320;
      const height = dialog.current?.offsetHeight ?? 0;
      const left = Math.min(window.innerWidth - width - 16, Math.max(16, rect.left + rect.width / 2 - width / 2));
      const below = rect.bottom + 8;
      const top = below + height > window.innerHeight - 16 ? Math.max(16, rect.top - 8 - height) : below;
      setStyle({ left, top, width, right: 'auto', bottom: 'auto' });
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, dialog]);
  return style;
}

const itemClass = 'flex min-h-14 w-full items-center justify-center gap-3 px-4 text-[17px] font-semibold active:bg-muted disabled:opacity-60';

function Icon({ d }: { d: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}
const CAMERA = 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z';
const IMAGE = 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 11 5-5 4 4 3-3 6 6M15.5 8.5h.01';
const TRASH = 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13';

/**
 * Feuille photo unique (§5.3), ouverte par le rond, la ligne Photo et la carte d'incitation.
 * Année inconnue : demandée d'abord. Mineur : le message `minorLater` et « Compris ».
 */
export default function PhotoSheet({ anchor, hasPhoto, birthYear, onBirthYear, onFile, onRemove, onClose }: {
  anchor: HTMLElement | null;
  hasPhoto: boolean;
  birthYear: number | null | undefined;
  /** Enregistre l'année ; renvoie un message d'erreur, ou `null`. */
  onBirthYear: (year: number) => Promise<string | null>;
  /** Ouvre la photo choisie ; renvoie un message d'erreur (trop petite, illisible), ou `null`. */
  onFile: (file: File) => Promise<string | null>;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = useModalDialog();
  const style = useAnchor(anchor, ref);
  const titleId = useId();
  const hintId = useId();
  const take = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [year, setYear] = useState('');
  // Année qui ferait de la personne un mineur : on la fait confirmer, elle ne se corrige plus ensuite.
  const [confirming, setConfirming] = useState<number | null>(null);
  const yearInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const minor = isMinor(birthYear);
  // Sur ordinateur, `capture` est ignoré : « Prendre une photo » ouvrirait le même sélecteur.
  const mouse = mousePointer();
  // Menu (souris) : pas d'« Annuler », on ferme en cliquant dehors ou avec Échap.
  const menu = mouse && minor === false;

  async function chosen(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || busy) return;
    setBusy(true);
    setError('');
    const failure = await onFile(file);
    setBusy(false);
    if (failure) setError(failure);
  }

  async function saveYear(event?: FormEvent, confirmed = false) {
    event?.preventDefault();
    if (busy) return;
    const value = Number(year);
    if (!/^\d{4}$/.test(year.trim()) || value < 1900 || value > currentYear()) return setError(T.birthYearInvalid);
    if (isMinor(value) && !confirmed) {
      setError('');
      return setConfirming(value);
    }
    setConfirming(null);
    setBusy(true);
    setError('');
    const failure = await onBirthYear(value);
    setBusy(false);
    if (failure) setError(failure);
  }

  let body: ReactNode;
  if (minor === null && confirming !== null) {
    body = (
      <div className="space-y-3 px-4 pb-4 pt-1 text-left">
        <p className="text-base">{T.birthYearConfirm(confirming)}</p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={() => { setConfirming(null); setTimeout(() => yearInput.current?.focus()); }}
            className="min-h-12 rounded-xl border border-border bg-card px-4 text-base font-semibold disabled:opacity-60">{T.birthYearFix}</button>
          <button type="button" disabled={busy} onClick={() => void saveYear(undefined, true)}
            className="min-h-12 rounded-xl bg-primary px-4 text-base font-bold text-primary-foreground disabled:opacity-60">{busy ? T.saving : T.birthYearConfirmCta}</button>
        </div>
      </div>
    );
  } else if (minor === null) {
    body = (
      <form onSubmit={saveYear} className="space-y-3 px-4 pb-4 pt-1 text-left">
        <label htmlFor="photo-birth-year" className="block text-base">{T.birthYearAsk}</label>
        <input ref={yearInput} id="photo-birth-year" inputMode="numeric" autoComplete="bday-year" maxLength={4} placeholder="AAAA"
          aria-describedby="photo-birth-year-hint" disabled={busy}
          value={year} onChange={event => setYear(event.target.value.replace(/\D/g, ''))}
          className="min-h-12 w-full rounded-xl border border-border bg-background px-3.5 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <p id="photo-birth-year-hint" className="text-[13px] text-muted-foreground">{T.birthYearHint}</p>
        <button disabled={busy || year.length !== 4} className="min-h-12 w-full rounded-xl bg-primary px-4 text-base font-bold text-primary-foreground disabled:opacity-60">
          {busy ? T.saving : T.birthYearContinue}
        </button>
      </form>
    );
  } else if (minor) {
    body = <>
      <p className="px-4 pb-4 text-base">{T.minorLater}</p>
      {hasPhoto && <button type="button" onClick={onRemove} className={`${itemClass} border-t border-border text-red-700`}><Icon d={TRASH} />{T.photoRemove}</button>}
    </>;
  } else {
    body = <>
      {!mouse && <button type="button" disabled={busy} onClick={() => take.current?.click()} className={`${itemClass} border-t border-border`}><Icon d={CAMERA} />{T.photoTake}</button>}
      <button type="button" disabled={busy} onClick={() => pick.current?.click()} className={`${itemClass} border-t border-border`}><Icon d={IMAGE} />{T.photoPick}</button>
      {hasPhoto && <button type="button" disabled={busy} onClick={onRemove} className={`${itemClass} border-t border-border text-red-700`}><Icon d={TRASH} />{T.photoRemove}</button>}
      {/* Les champs restent montés tant que la feuille l'est : rien n'est perdu si l'appareil photo est refusé. */}
      <input ref={take} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => void chosen(event.currentTarget)} />
      <input ref={pick} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => void chosen(event.currentTarget)} />
    </>;
  }

  return createPortal(
    <dialog ref={ref} aria-labelledby={titleId} aria-describedby={hintId} aria-busy={busy}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      // Toucher en dehors des cartes ferme la feuille.
      onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none bg-transparent p-2 text-foreground backdrop:bg-black/50 sm:p-0 sm:backdrop:bg-black/10"
      style={{ paddingBottom: style ? 0 : 'max(0.5rem, env(safe-area-inset-bottom))', ...style }}>
      <div className="mx-auto max-w-lg overflow-hidden rounded-2xl bg-card text-center shadow-xl">
        <div className="px-4 pb-3 pt-4">
          <h2 id={titleId} className="text-[15px] font-semibold">{T.photoSheetTitle}</h2>
          <p id={hintId} className="text-sm text-muted-foreground">{minor ? '' : `${T.photoSheetHint}. ${T.photoRemoveAnytime}`}</p>
        </div>
        {body}
        {busy && minor === false && <p role="status" className="border-t border-border px-4 py-3 text-sm text-muted-foreground">{T.photoOpening}</p>}
        {error && <p role="alert" className="border-t border-border px-4 py-3 text-left text-sm text-red-700">{error}</p>}
      </div>
      {!menu && <button type="button" disabled={busy} onClick={onClose}
        className="mx-auto mt-2 block min-h-14 w-full max-w-lg rounded-2xl bg-card text-[17px] font-bold shadow-xl active:bg-muted disabled:opacity-60">
        {minor ? T.minorLaterOk : T.cancel}
      </button>}
    </dialog>,
    document.body,
  );
}
