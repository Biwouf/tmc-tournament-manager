import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { signupSlugProblem } from '../../../shared/clubSlug.mjs';
import { formatClubName, shortNameFor, shortSlugCandidates } from '../../../shared/clubName.mjs';
import {
  cleanSlugInput, clubAddress, clubInitials, COLOR_SAMPLES, findProblem, firstFreeSlug, lookupSource, lookupTenupClub,
  MAX_SHORT_NAME, shortNameProblem, slugMessage, suggestSlug,
  type LookupOutcome, type LookupResult, type SignupDraft, type SlugCheck,
} from '../../lib/clubSignup';
import Turnstile, { type TurnstileHandle } from './Turnstile';

// Onboarding « Ten'Up d'abord », P1-front (brief SAAS_11 §3.1-§3.3, SAAS_ONBOARDING.md §14.6) :
// 01 « Retrouvons votre club » (lien collé, `tenup-lookup`), 01b « déjà sur feelike », 02 « C'est
// bien votre club ? ». La page (`SignupTunnelPage`) tient le brouillon et l'envoi à `club-signup`.

type Title = (text: ReactNode) => ReactNode;
type Update = (patch: Partial<SignupDraft>) => void;

/** Au-delà de 3 s de lecture, une ligne `role="status"` rassure (brief §3.1). */
const SLOW_MS = 3000;

async function slugFree(slug: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('slug_available', { slug });
  if (error || !data) return null;
  return (data as { available?: unknown }).available === true;
}

// ── 01 · Retrouvons votre club ───────────────────────────────────────────────

type Failure = Exclude<LookupOutcome, { kind: 'found' | 'already' | 'bad_link' }>;

export function FindStep({ draft, update, title, siteKey, endpoint, notice, onFound, onAlready, onManual }: {
  draft: SignupDraft; update: Update; title: Title; siteKey: string; endpoint: string;
  /** Message venu d'ailleurs (jeton de lecture expiré à la création). */
  notice: string;
  onFound: (result: LookupResult) => void;
  onAlready: (tenupClubId: string, name: string | null) => void;
  onManual: () => void;
}) {
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reading, setReading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  // Envoyé avant que le jeton (invisible) n'arrive : la lecture part dès qu'il est là.
  const [waiting, setWaiting] = useState(false);
  const waitingRef = useRef(false);
  const [widgetError, setWidgetError] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);
  const pasted = useRef(false);
  const value = draft.tenupUrl;

  const focusField = () => document.getElementById('fl-tenup-url')?.focus();

  async function read(withToken: string) {
    waitingRef.current = false;
    setWaiting(false); setReading(true); setFailure(null); setFieldError(null);
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    const outcome = await lookupTenupClub(fetch, endpoint, value, withToken, navigator.onLine !== false);
    window.clearTimeout(timer);
    setSlow(false); setReading(false);
    // Le jeton ne sert qu'une fois : relancé après toute requête partie (pas hors ligne).
    if (outcome.kind !== 'offline') turnstile.current?.reset();
    if (outcome.kind === 'found') onFound(outcome.result);
    else if (outcome.kind === 'already') onAlready(outcome.tenupClubId, outcome.name);
    else if (outcome.kind === 'bad_link') { setFieldError(outcome.message); focusField(); }
    else { setFailure(outcome); focusField(); }
  }

  function submit() {
    if (reading || waiting) return;
    const problem = findProblem(value);
    if (problem) { setFieldError(problem); setFailure(null); focusField(); return; }
    if (widgetError) { setFailure({ kind: 'turnstile', message: 'La vérification anti-robot ne se charge pas. Vérifiez votre connexion, puis rechargez la page : votre saisie est conservée.' }); return; }
    if (token) void read(token);
    else { setFailure(null); setFieldError(null); waitingRef.current = true; setWaiting(true); }
  }

  const busy = reading || waiting;
  const message = fieldError ?? failure?.message ?? null;
  const manualOffer = failure && ['not_found', 'unavailable', 'throttled', 'error'].includes(failure.kind);
  const retry = failure?.kind === 'unavailable' || failure?.kind === 'offline';

  return (
    <form className="fl-step" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
      {title('Retrouvons votre club')}
      <p className="fl-lede">Nom, logo, adresse et équipes viennent de Ten’Up. Vous n’aurez presque rien à saisir.</p>
      {notice && <div role="alert" className="fl-alert">{notice}</div>}
      <div className="fl-field">
        <label htmlFor="fl-tenup-url" className="fl-label">Lien de votre club sur Ten’Up</label>
        <input id="fl-tenup-url" className="fl-input" type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
          maxLength={500} value={value} readOnly={busy}
          aria-invalid={Boolean(message)} aria-describedby={message ? 'fl-tenup-help fl-tenup-error' : 'fl-tenup-help'}
          onPaste={() => { pasted.current = true; }}
          onChange={event => {
            const next = event.target.value;
            update({ tenupUrl: next });
            setFailure(null);
            // Coller valide le lien, sans lancer la lecture (l'utilisateur appuie sur le bouton).
            if (pasted.current) { pasted.current = false; setFieldError(next.trim() ? findProblem(next) : null); }
            else if (fieldError) setFieldError(null);
          }}
          onBlur={() => { if (value.trim()) setFieldError(findProblem(value)); }} />
        <span id="fl-tenup-help" className="fl-small">N’importe quelle page de votre club sur tenup.fft.fr fait l’affaire.</span>
        {message && <p id="fl-tenup-error" role="alert" className="fl-field-error">{message}</p>}
        {manualOffer && !retry && (
          <button type="button" className="fl-ghost fl-ghost-inline" onClick={onManual}>Saisir à la main</button>
        )}
      </div>
      <details className="fl-help">
        <summary>Où trouver ce lien ?</summary>
        <p>Sur tenup.fft.fr, cherchez votre club (Rechercher › Un club), ouvrez sa page, puis copiez l’adresse.</p>
      </details>
      <Turnstile ref={turnstile} siteKey={siteKey}
        onToken={next => { setToken(next); if (next && waitingRef.current) void read(next); }}
        onError={() => { setWidgetError(true); if (waitingRef.current) { waitingRef.current = false; setWaiting(false); setFailure({ kind: 'turnstile', message: 'La vérification anti-robot ne se charge pas. Vérifiez votre connexion, puis rechargez la page : votre saisie est conservée.' }); } }} />
      <p role="status" className="fl-small fl-slow">{slow ? 'Ten’Up met un peu de temps à répondre…' : ''}</p>
      <div className="fl-actions fl-sticky">
        <button type="submit" className="fl-cta fl-cta-wide" aria-busy={busy}>
          {busy ? <><span className="fl-spin" aria-hidden="true" />Recherche de votre club…</> : retry ? 'Réessayer' : 'Trouver mon club'}
        </button>
        {retry && failure?.kind === 'unavailable' && (
          <button type="button" className="fl-ghost fl-cta-wide" onClick={onManual}>Continuer à la main</button>
        )}
      </div>
      <p className="fl-foot">Club non affilié à la FFT ? <button type="button" className="fl-text-link" onClick={onManual}>Saisir à la main</button></p>
    </form>
  );
}

// ── 01b · Déjà sur feelike ───────────────────────────────────────────────────

export function AlreadyStep({ name, title, onNotMine }: { name: string | null; title: Title; onNotMine: () => void }) {
  return (
    <div className="fl-step">
      {title(`${name || 'Votre club'} a déjà son espace feelike`)}
      <p className="fl-lede">Un responsable de votre club l’a déjà créé. Demandez-lui de vous inviter depuis le back-office (Membres › Inviter), ou connectez-vous si c’est vous.</p>
      <div className="fl-actions fl-sticky">
        <Link className="fl-cta fl-cta-wide" to="/login">Se connecter</Link>
      </div>
      <button type="button" className="fl-link" onClick={onNotMine}>Ce n’est pas mon club</button>
    </div>
  );
}

// ── 02 · C'est bien votre club ? ─────────────────────────────────────────────

type Missing = { field: 'name' | 'city' | 'short'; message: string } | null;

export function ConfirmStep({ draft, update, title, error, slugCheck, setSlugCheck, onConfirm, onNotMine }: {
  draft: SignupDraft & { tenup: LookupResult }; update: Update; title: Title; error: ReactNode;
  slugCheck: SlugCheck; setSlugCheck: (check: SlugCheck) => void;
  onConfirm: () => void; onNotMine: () => void;
}) {
  const { tenup } = draft;
  const [editing, setEditing] = useState({ name: false, short: false, slug: false });
  const [missing, setMissing] = useState<Missing>(null);
  // Envoyé pendant la vérification de l'adresse : on avance (ou on montre la ligne) à la réponse.
  const [advance, setAdvanceState] = useState(false);
  const advanceRef = useRef(false);
  const setAdvance = (value: boolean) => { advanceRef.current = value; setAdvanceState(value); };
  const [images, setImages] = useState({ logo: tenup.logo_url ? 'loading' : 'none', banner: tenup.banner_url ? 'loading' : 'none' });
  const open = (field: keyof typeof editing) => setEditing(e => ({ ...e, [field]: true }));

  const focusLater = (id: string) => window.requestAnimationFrame(() => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
  });
  function showSlug() { open('slug'); focusLater('fl-slug'); }
  /** Réponse de la vérification d'adresse ; envoi en attente → on avance, ou la ligne en erreur. */
  function settle(check: SlugCheck) {
    setSlugCheck(check);
    if (!advanceRef.current) return;
    if (check.state === 'available' || check.state === 'error') { setAdvance(false); onConfirm(); }
    else if (check.state === 'unavailable') { setAdvance(false); showSlug(); }
  }

  // Adresse web : proposée depuis le nom court tant qu'elle n'a pas été modifiée (3 essais) ;
  // modifiée : la vérification de l'étape 3 (règle partagée, puis `slug_available`).
  useEffect(() => {
    let active = true;
    if (!draft.slugEdited) {
      setSlugCheck({ state: 'checking' });
      const timer = window.setTimeout(async () => {
        const picked = await firstFreeSlug(shortSlugCandidates(draft.shortName, draft.city), slugFree);
        if (!active) return;
        if (picked.slug !== draft.slug) update({ slug: picked.slug });
        if (picked.check.state === 'unavailable') open('slug');
        settle(picked.check);
      }, 300);
      return () => { active = false; window.clearTimeout(timer); };
    }
    const problem = signupSlugProblem(draft.slug);
    if (problem) { setSlugCheck({ state: 'unavailable', reason: problem }); return; }
    setSlugCheck({ state: 'checking' });
    const timer = window.setTimeout(async () => {
      const free = await slugFree(draft.slug);
      if (active) settle(free === null ? { state: 'error' } : free ? { state: 'available' } : { state: 'unavailable', reason: 'taken' });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
    // Proposée : suit le nom court et la ville, pas le slug qu'elle vient d'écrire.
  }, [draft.slugEdited, draft.slugEdited ? draft.slug : '', draft.slugEdited ? '' : draft.shortName, draft.city]); // eslint-disable-line react-hooks/exhaustive-deps

  const slugReady = slugCheck.state === 'available' || slugCheck.state === 'error';


  /** « Oui, c'est mon club » : jamais grisé ; il manque quelque chose → la ligne, son message, le focus. */
  function submit() {
    const name = draft.name.trim();
    if (name.length < 2) {
      open('name'); setMissing({ field: 'name', message: name ? 'Le nom du club compte au moins 2 caractères.' : 'Indiquez le nom du club.' });
      focusLater('fl-club'); return;
    }
    if (!draft.city.trim()) { setMissing({ field: 'city', message: 'Indiquez la ville du club.' }); focusLater('fl-city'); return; }
    const short = shortNameProblem(draft.shortName);
    if (short) { open('short'); setMissing({ field: 'short', message: short }); focusLater('fl-short'); return; }
    if (slugReady) onConfirm();
    else if (slugCheck.state === 'unavailable') showSlug();
    else setAdvance(true);
  }
  const edit = (patch: Partial<SignupDraft>) => { setMissing(null); setAdvance(false); update(patch); };
  const invalid = (field: NonNullable<Missing>['field']) => ({
    'aria-invalid': missing?.field === field,
    'aria-describedby': [field === 'short' ? 'fl-short-count' : '', missing?.field === field ? `fl-${field}-error` : ''].filter(Boolean).join(' ') || undefined,
  });
  const fieldError = (field: NonNullable<Missing>['field']) => missing?.field === field
    && <p id={`fl-${field}-error`} role="alert" className="fl-field-error">{missing.message}</p>;

  const suggestion = slugCheck.state === 'unavailable' && slugCheck.reason === 'taken' ? suggestSlug(draft.slug, draft.city) : null;
  const address = clubAddress(tenup.street, tenup.postal_code, draft.city);

  return (
    <form className="fl-step" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
      {title('C’est bien votre club\u00a0?')}
      <section className="fl-card" aria-labelledby="fl-card-name">
        <div className="fl-card-banner" style={{ background: draft.color }}>
          {tenup.banner_url && images.banner !== 'error' && (
            <img src={tenup.banner_url} alt="" data-loaded={images.banner === 'ok'}
              onLoad={() => setImages(i => ({ ...i, banner: 'ok' }))} onError={() => setImages(i => ({ ...i, banner: 'error' }))} />
          )}
          {images.banner === 'loading' && <span className="fl-skeleton" aria-hidden="true" />}
          <span className="fl-card-logo" style={{ background: draft.color }}>
            {tenup.logo_url && images.logo !== 'error' && (
              <img src={tenup.logo_url} alt="" data-loaded={images.logo === 'ok'}
                onLoad={() => setImages(i => ({ ...i, logo: 'ok' }))} onError={() => setImages(i => ({ ...i, logo: 'error' }))} />
            )}
            {images.logo === 'loading' ? <span className="fl-skeleton" aria-hidden="true" /> : images.logo !== 'ok' && <b aria-hidden="true">{clubInitials(draft.name)}</b>}
          </span>
        </div>
        <div className="fl-card-body">
          <h2 id="fl-card-name" className="fl-card-name">{draft.name.trim() || formatClubName(tenup.name)}</h2>
          {address && <p className="fl-card-addr">{address}</p>}
          {tenup.sports.length > 0 && <ul className="fl-card-chips" aria-label="Sports">{tenup.sports.map(sport => <li key={sport}>{sport}</li>)}</ul>}
          {tenup.courts ? <p className="fl-card-facts">{tenup.courts} terrain{tenup.courts > 1 ? 's' : ''}</p> : null}
        </div>
        <p className="fl-card-src">{lookupSource(tenup)}</p>
      </section>
      {editing.name
        ? <div className="fl-field">
            <label htmlFor="fl-club" className="fl-label">Nom du club</label>
            <input id="fl-club" className="fl-input" type="text" autoComplete="organization" maxLength={80} value={draft.name} {...invalid('name')}
              onChange={event => { const name = event.target.value; edit({ name, ...(draft.shortNameEdited ? {} : { shortName: shortNameFor(name) }) }); }} />
            {fieldError('name')}
          </div>
        : <button type="button" className="fl-link" onClick={() => { open('name'); focusLater('fl-club'); }}>Modifier le nom</button>}

      <div className="fl-rows">
        {(!tenup.city || missing?.field === 'city') && (
          <div className="fl-row fl-row-stack">
            <label htmlFor="fl-city" className="fl-label">Ville</label>
            <input id="fl-city" className="fl-input" type="text" autoComplete="address-level2" maxLength={80} value={draft.city} {...invalid('city')}
              onChange={event => edit({ city: event.target.value })} />
            {fieldError('city')}
          </div>
        )}
        <ColorRow draft={draft} onChange={color => edit({ color })} />
        <div className="fl-row">
          <div className="fl-row-main">
            <span className="fl-label" id="fl-short-label">Nom court · écran d’accueil</span>
            {editing.short
              ? <>
                  <input id="fl-short" className="fl-input" type="text" maxLength={MAX_SHORT_NAME} value={draft.shortName}
                    aria-labelledby="fl-short-label" {...invalid('short')}
                    onChange={event => edit({ shortName: event.target.value, shortNameEdited: true })} />
                  <span id="fl-short-count" className="fl-small">{[...draft.shortName].length} / {MAX_SHORT_NAME} caractères</span>
                  {fieldError('short')}
                </>
              : <span className="fl-row-value">{draft.shortName}</span>}
          </div>
          {!editing.short && <button type="button" className="fl-edit" aria-label="Modifier le nom court" onClick={() => { open('short'); focusLater('fl-short'); }}>Modifier</button>}
        </div>
        <div className="fl-row">
          <div className="fl-row-main">
            <span className="fl-label" id="fl-slug-label">Adresse web</span>
            {editing.slug
              ? <>
                  <div className="fl-slug" data-invalid={slugCheck.state === 'unavailable'}>
                    <input id="fl-slug" type="text" spellCheck={false} autoCapitalize="none" autoComplete="off" maxLength={32}
                      value={draft.slug} aria-labelledby="fl-slug-label" aria-describedby="fl-slug-msg fl-slug-app" aria-invalid={slugCheck.state === 'unavailable'}
                      onChange={event => edit({ slug: cleanSlugInput(event.target.value), slugEdited: true })} />
                    <span aria-hidden="true">.feelike.pro</span>
                  </div>
                  <div id="fl-slug-msg" aria-live="polite"
                    className={`fl-slug-msg ${slugCheck.state === 'available' ? 'ok' : slugCheck.state === 'unavailable' ? 'bad' : ''}`}>
                    {slugMessage(slugCheck)}
                    {suggestion && <button type="button" className="fl-suggest" onClick={() => edit({ slug: suggestion, slugEdited: true })}>
                      Prendre {suggestion}.feelike.pro
                    </button>}
                  </div>
                  <span id="fl-slug-app" className="fl-small">Votre app : app-{draft.slug || 'votreclub'}.feelike.pro</span>
                </>
              : <span className="fl-row-value">{draft.slug ? `${draft.slug}.feelike.pro` : '…'}</span>}
          </div>
          {!editing.slug && (slugCheck.state === 'checking'
            ? <span className="fl-edit" role="status">Vérification…</span>
            : <button type="button" className="fl-edit" aria-label="Modifier l’adresse web" onClick={showSlug}>Modifier</button>)}
        </div>
      </div>
      {error}
      <div className="fl-actions fl-sticky">
        <button type="submit" className="fl-cta fl-cta-wide" aria-busy={advance}>{advance ? 'Vérification…' : 'Oui, c’est mon club'}</button>
      </div>
      <button type="button" className="fl-link fl-link-center" onClick={onNotMine}>Ce n’est pas le bon club</button>
    </form>
  );
}

/** Couleur : 3 teintes du logo (sinon les échantillons), groupe de boutons radio au clavier, « Autre ». */
function ColorRow({ draft, onChange }: { draft: SignupDraft; onChange: (color: string) => void }) {
  const options = draft.palette.length
    ? draft.palette.slice(0, 3).map((hex, i) => ({ hex, label: `Couleur ${i + 1} : ${hex}` }))
    : COLOR_SAMPLES.map(sample => ({ hex: sample.colors[0] as string, label: `${sample.label} : ${sample.colors[0]}` }));
  const checked = options.findIndex(o => o.hex === draft.color);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].hex);
    refs.current[next]?.focus();
  };
  return (
    <div className="fl-row">
      <span className="fl-label" id="fl-color-label">Couleur</span>
      <div className="fl-swatches" role="radiogroup" aria-labelledby="fl-color-label">
        {options.map((option, i) => (
          <button key={option.hex} ref={el => { refs.current[i] = el; }} type="button" role="radio" className="fl-dot"
            style={{ background: option.hex }} aria-checked={i === checked} aria-label={option.label}
            tabIndex={i === (checked < 0 ? 0 : checked) ? 0 : -1}
            onClick={() => onChange(option.hex)} onKeyDown={event => onKey(event, i)} />
        ))}
      </div>
      <label className="fl-other fl-edit">
        <input type="color" value={draft.color} aria-label="Autre couleur" onChange={event => onChange(event.target.value.toLowerCase())} />
        Autre
      </label>
    </div>
  );
}
