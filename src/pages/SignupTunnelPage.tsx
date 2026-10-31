import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { signupSlugProblem } from '../../shared/clubSlug.mjs';
import {
  BRAND_FALLBACK, COLOR_SAMPLES, cleanSlugInput, isEmail, loadDraft, saveDraft, signupConfig, slugify,
  slugMessage, submitClubSignup, suggestSlug, type SignupDraft, type SignupOutcome, type SignupStep, type SlugCheck,
} from '../lib/clubSignup';
import { dataUrlToBlob, prepareSignupImage, SIGNUP_IMAGE_TYPES } from '../lib/signupImage';
import Turnstile, { type TurnstileHandle } from '../components/signup/Turnstile';
import { AppPreview, SitePreview } from '../components/signup/SignupPreview';
import '@fontsource/instrument-sans/latin-400';
import '@fontsource/instrument-sans/latin-500';
import '@fontsource/ibm-plex-mono/latin-400';
import '@fontsource/ibm-plex-mono/latin-500';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/big-shoulders-display/latin-900';
import '@fontsource-variable/manrope';
import '../components/signup/signup.css';

// SaaS S3 — tunnel public `admin.feelike.pro/inscription` (docs/specs/SAAS_ONBOARDING.md §7).
// Monté par AdminEntry hors de toute résolution de club et de toute session. Quatre étapes,
// puis la confirmation ; tout est écrit en une fois par `club-signup` à l'étape 4.

const CONFIG = signupConfig(import.meta.env);
const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/club-signup`;
const STEP_LABELS = ['Club', 'Logo', 'Adresse', 'Compte'];

function readDraft(): SignupDraft {
  try { return loadDraft(window.sessionStorage); } catch { return loadDraft({ getItem: () => null }); }
}
function useMobile() {
  const query = '(max-width: 719px)';
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile;
}

const Logo = () => (
  <a href="https://www.feelike.pro" aria-label="Retour à feelike.pro" className="fl-brand">
    <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="0" y="34" width="38" height="30" rx="3" fill="#f3f1eb" /><rect x="26" y="0" width="38" height="30" rx="3" fill="#cf6a3e" /></svg>
    <span>feelike<span style={{ color: '#cf6a3e' }}>.</span>pro</span>
  </a>
);

export default function SignupTunnelPage() {
  useEffect(() => { document.title = 'Créer votre club — feelike.pro'; }, []);
  if (!CONFIG.open) {
    return (
      <div className="fl">
        <header className="fl-head"><div className="fl-head-row"><Logo /></div></header>
        <main className="fl-main"><section className="fl-form"><div className="fl-step">
          <h1 className="fl-h1">Les inscriptions ouvrent bientôt.</h1>
          <p className="fl-lede">L’essai de 30 jours sans carte bancaire arrive très vite. En attendant, découvrez feelike.pro.</p>
          <div className="fl-actions"><a className="fl-cta" href="https://www.feelike.pro">Découvrir feelike.pro</a></div>
        </div></section></main>
      </div>
    );
  }
  return <Tunnel />;
}

function Tunnel() {
  const [draft, setDraft] = useState<SignupDraft>(readDraft);
  const [slugCheck, setSlugCheck] = useState<SlugCheck>({ state: 'idle' });
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [preview, setPreview] = useState<{ open: boolean; tab: 'site' | 'app' }>({ open: false, tab: 'site' });
  const turnstile = useRef<TurnstileHandle>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const mobile = useMobile();
  const { step } = draft;

  useEffect(() => { try { saveDraft(window.sessionStorage, draft); } catch { /* stockage indisponible */ } }, [draft]);
  // Changement d'étape : le titre reçoit le focus (lecteurs d'écran, clavier).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  // Adresse : règle partagée tout de suite, puis disponibilité en base (≈ 300 ms après la frappe).
  useEffect(() => {
    if (step !== 3) return;
    const problem = signupSlugProblem(draft.slug);
    if (problem) { setSlugCheck({ state: 'unavailable', reason: problem }); return; }
    setSlugCheck({ state: 'checking' });
    let active = true;
    const timer = window.setTimeout(async () => {
      const { data, error: rpcError } = await supabase.rpc('slug_available', { slug: draft.slug });
      if (!active) return;
      const reason = (data as { reason?: unknown } | null)?.reason;
      if (rpcError || !data) setSlugCheck({ state: 'error' });
      else if ((data as { available?: unknown }).available === true) setSlugCheck({ state: 'available' });
      else setSlugCheck({ state: 'unavailable', reason: reason === 'taken' || reason === 'reserved' ? reason : 'format' });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [step, draft.slug]);

  const update = (patch: Partial<SignupDraft>) => { setError(''); setDraft(current => ({ ...current, ...patch })); };
  const go = (next: SignupStep) => { setError(''); setStatus(''); setDraft(current => ({ ...current, step: next })); };

  const name = draft.name.trim();
  const city = draft.city.trim();
  const step1Ready = name.length >= 2 && city.length > 0;
  const slugReady = slugCheck.state === 'available' || slugCheck.state === 'error';
  const suggestion = slugCheck.state === 'unavailable' && slugCheck.reason === 'taken' ? suggestSlug(draft.slug, city) : null;

  async function pickImage(event: ChangeEvent<HTMLInputElement>, kind: 'logo' | 'photo') {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setBusy(true);
    try {
      const { dataUrl, palette } = await prepareSignupImage(file, kind);
      if (kind === 'photo') update({ photo: dataUrl });
      else {
        const colors = palette.length ? palette : [BRAND_FALLBACK];
        update({ logo: dataUrl, palette: colors, color: colors[0], sample: null });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Image illisible : essayez un autre fichier.');
    } finally { setBusy(false); }
  }

  function applyFailure(outcome: Extract<SignupOutcome, { ok: false }>, email: string, resend: boolean) {
    if (outcome.resetTurnstile) turnstile.current?.reset();
    let message = outcome.message;
    // Nouvelle adresse e-mail, même slug : le club en attente du premier envoi le garde.
    if (outcome.slugReason === 'taken' && draft.sent?.slug === draft.slug && draft.sent.email !== email) {
      message = `L’adresse ${draft.slug}.feelike.pro reste réservée à votre première inscription (${draft.sent.email}) : elle se libère au bout de 7 jours sans clic sur le lien. Choisissez-en une autre, ou revenez à l’e-mail précédent.`;
    }
    if (outcome.slugReason) setSlugCheck({ state: 'unavailable', reason: outcome.slugReason });
    setError(message);
    // Un renvoi qui échoue reste sur la confirmation ; une création, à l'étape à corriger.
    if (!resend && outcome.step !== step) setDraft(current => ({ ...current, step: outcome.step }));
  }

  async function submit(resend: boolean) {
    if (!token || busy) return;
    const email = resend && draft.sent ? draft.sent.email : draft.email.trim().toLowerCase();
    setBusy(true); setError(''); setStatus('');
    try {
      // Le renvoi rejoue l'inscription (S2 la rend idempotente) : les images ne servent plus.
      const [logo, photo] = resend ? [null, null] : await Promise.all([
        draft.logo ? dataUrlToBlob(draft.logo) : null, draft.photo ? dataUrlToBlob(draft.photo) : null,
      ]);
      const outcome = await submitClubSignup(fetch, ENDPOINT, {
        name, city, slug: draft.slug, color: draft.color, email, turnstileToken: token, logo, photo,
      });
      if (outcome.ok) {
        if (resend) { turnstile.current?.reset(); setStatus(`Lien renvoyé à ${email}.`); }
        else setDraft(current => ({ ...current, step: 'sent', sent: { email, slug: current.slug } }));
        setToken(null);
      } else applyFailure(outcome, email, resend);
    } finally { setBusy(false); }
  }

  const kicker = (index: number, time: string) => <span className="fl-kicker">Étape {index} sur 4 · {time}</span>;
  const title = (text: ReactNode) => <h1 ref={heading} tabIndex={-1} className="fl-h1">{text}</h1>;
  const alert = <div role="alert" className="fl-alert">{error}</div>;
  const back = (to: SignupStep, label = 'Retour') => <button type="button" className="fl-ghost" onClick={() => go(to)}>{label}</button>;

  const previewData = { name: draft.name, city: draft.city, slug: draft.slug, color: draft.color, logo: draft.logo, photo: draft.photo };
  const current = step === 'sent' ? 5 : step;

  return (
    <div className="fl">
      <header className="fl-head">
        <div className="fl-head-row">
          <Logo />
          <ol className="fl-steps" aria-label="Étapes">
            {STEP_LABELS.map((label, i) => (
              <li key={label} className={i + 1 === current ? 'current' : i + 1 < current ? 'done' : ''} aria-current={i + 1 === current ? 'step' : undefined}>
                <span className="fl-step-label">0{i + 1} · {label}</span>
                <span className="fl-sr">{i + 1 < current ? ' (fait)' : ''}</span>
              </li>
            ))}
          </ol>
          <span className="fl-head-login">Déjà un compte ? <Link to="/login">Connexion</Link></span>
        </div>
      </header>

      <main className="fl-main">
        <section className="fl-form" aria-label="Inscription">
          {step === 1 && (
            <form className="fl-step" onSubmit={event => { event.preventDefault(); if (step1Ready) go(2); }}>
              {kicker(1, '15 secondes')}
              {title('Comment s’appelle votre club ?')}
              <p className="fl-lede">Votre site et votre app se construisent pendant que vous tapez.</p>
              <div className="fl-field">
                <label htmlFor="fl-club" className="fl-label">Nom du club</label>
                <input id="fl-club" className="fl-input fl-input-name" type="text" autoComplete="organization" maxLength={80} required
                  value={draft.name} placeholder="Tennis Club de Saint-Aubin"
                  onChange={event => { const value = event.target.value; update({ name: value, ...(draft.slugEdited ? {} : { slug: slugify(value) }) }); }} />
              </div>
              <div className="fl-field">
                <label htmlFor="fl-city" className="fl-label">Ville</label>
                <input id="fl-city" className="fl-input" type="text" autoComplete="address-level2" maxLength={80} required
                  value={draft.city} placeholder="Saint-Aubin" onChange={event => update({ city: event.target.value })} />
              </div>
              <div className="fl-field">
                <span className="fl-label" id="fl-sport">Sport</span>
                <div className="fl-chips" role="group" aria-labelledby="fl-sport">
                  <button type="button" className="fl-chip" aria-pressed="true">Tennis</button>
                  <button type="button" className="fl-chip" disabled>Autres sports · bientôt</button>
                </div>
              </div>
              {alert}
              <div className="fl-actions">
                <button type="submit" className="fl-cta" disabled={!step1Ready}>Continuer</button>
                <span className="fl-small">Gratuit 30 jours · sans carte bancaire</span>
              </div>
            </form>
          )}

          {step === 2 && (
            <div className="fl-step">
              {kicker(2, '20 secondes')}
              {title('Votre logo, votre photo. On s’occupe du reste.')}
              <label className="fl-drop">
                <input type="file" accept={SIGNUP_IMAGE_TYPES.join(',')} aria-describedby="fl-logo-help" disabled={busy}
                  onChange={event => void pickImage(event, 'logo')} />
                {draft.logo
                  ? <img src={draft.logo} alt="" className="fl-drop-logo" />
                  : <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>}
                <span className="fl-drop-title">{draft.logo ? 'Logo ajouté · changer' : 'Déposez votre logo'}</span>
                <span id="fl-logo-help" className="fl-small">On en tire la couleur du club · PNG, JPEG ou WebP</span>
              </label>
              <label className="fl-drop fl-drop-row">
                <input type="file" accept={SIGNUP_IMAGE_TYPES.join(',')} aria-describedby="fl-photo-help" disabled={busy}
                  onChange={event => void pickImage(event, 'photo')} />
                <span className="fl-drop-thumb" style={draft.photo ? { backgroundImage: `url(${draft.photo})` } : undefined}>
                  {!draft.photo && <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="#a8a398" strokeWidth="1.5"><path d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6" /><circle cx="16" cy="9" r="1.6" /></svg>}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="fl-drop-title" style={{ fontSize: 22 }}>{draft.photo ? 'Photo ajoutée · changer' : 'Ajoutez une photo du club'}</span>
                  <span id="fl-photo-help" className="fl-small">Facultatif · vos courts, une équipe, le club-house : elle fait toute la différence en haut du site.</span>
                </span>
              </label>
              {draft.palette.length > 0 && (
                <div className="fl-field">
                  <span className="fl-label" id="fl-palette">Couleur du club · touchez pour changer</span>
                  <div className="fl-chips" role="group" aria-labelledby="fl-palette">
                    {draft.palette.map((hex, i) => (
                      <button key={hex} type="button" className="fl-swatch" style={{ background: hex }} aria-pressed={hex === draft.color}
                        aria-label={`Couleur ${i + 1} : ${hex}`} onClick={() => update({ color: hex })} />
                    ))}
                    <OtherColor color={draft.color} onChange={color => update({ color })} />
                  </div>
                </div>
              )}
              {!draft.logo && (
                <div className="fl-field">
                  <span className="fl-label" id="fl-samples">Pas de logo sous la main ? Essayez une couleur</span>
                  <div className="fl-chips" role="group" aria-labelledby="fl-samples">
                    {COLOR_SAMPLES.map((sample, i) => (
                      <button key={sample.label} type="button" className="fl-sample" aria-pressed={draft.sample === i}
                        onClick={() => update({ sample: i, palette: [...sample.colors], color: sample.colors[0] })}>
                        <span style={{ background: sample.colors[0] }} />{sample.label}
                      </button>
                    ))}
                    {draft.palette.length === 0 && <OtherColor color={draft.color} onChange={color => update({ color, sample: null })} />}
                  </div>
                </div>
              )}
              <div aria-live="polite" className="fl-small">{busy ? 'Préparation de l’image…' : ''}</div>
              {alert}
              <div className="fl-actions">
                {back(1)}
                <button type="button" className="fl-cta" disabled={busy} onClick={() => go(3)}>
                  {draft.logo || draft.photo || draft.sample !== null || draft.palette.length ? 'Continuer' : 'Passer cette étape'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <form className="fl-step" onSubmit={event => { event.preventDefault(); if (slugReady) go(4); }}>
              {kicker(3, '10 secondes')}
              {title('Votre adresse sur le circuit.')}
              <div className="fl-field">
                <label htmlFor="fl-slug" className="fl-label">Adresse du club</label>
                <div className="fl-slug" data-invalid={slugCheck.state === 'unavailable'}>
                  <input id="fl-slug" type="text" spellCheck={false} autoCapitalize="none" autoComplete="off" maxLength={32}
                    value={draft.slug} aria-describedby="fl-slug-msg" aria-invalid={slugCheck.state === 'unavailable'}
                    onChange={event => update({ slug: cleanSlugInput(event.target.value), slugEdited: true })} />
                  <span aria-hidden="true">.feelike.pro</span>
                </div>
                <div id="fl-slug-msg" aria-live="polite"
                  className={`fl-slug-msg ${slugCheck.state === 'available' ? 'ok' : slugCheck.state === 'unavailable' ? 'bad' : ''}`}>
                  {slugMessage(slugCheck)}
                  {suggestion && <button type="button" className="fl-suggest" onClick={() => update({ slug: suggestion, slugEdited: true })}>
                    Prendre {suggestion}.feelike.pro
                  </button>}
                </div>
              </div>
              <dl className="fl-addresses" style={{ margin: 0 }}>
                <div><dt>Site</dt><dd>{(draft.slug || 'votreclub')}.feelike.pro</dd></div>
                <div><dt>App</dt><dd>app-{draft.slug || 'votreclub'}.feelike.pro</dd></div>
                <div><dt>Back-office</dt><dd>admin.feelike.pro</dd></div>
              </dl>
              <p className="fl-note">Pendant l’essai, votre site reste invisible des moteurs de recherche. Vous l’ouvrez au public quand vous êtes prêt. Votre propre nom de domaine pourra s’y brancher ensuite.</p>
              {alert}
              <div className="fl-actions">
                {back(2)}
                <button type="submit" className="fl-cta" disabled={!slugReady}>Réserver cette adresse</button>
              </div>
            </form>
          )}

          {step === 4 && (
            <form className="fl-step" onSubmit={event => { event.preventDefault(); void submit(false); }}>
              {kicker(4, 'dernière ligne droite')}
              {title('Gardez votre club.')}
              <p className="fl-lede">Tout ce que vous voyez dans l’aperçu est enregistré. Il ne manque que l’e-mail de l’administrateur du club.</p>
              <div className="fl-field">
                <label htmlFor="fl-email" className="fl-label">Votre e-mail</label>
                <input id="fl-email" className="fl-input" type="email" autoComplete="email" inputMode="email" maxLength={254} required
                  value={draft.email} placeholder="president@votreclub.fr" onChange={event => update({ email: event.target.value })} />
              </div>
              <label className="fl-check">
                <input type="checkbox" checked={consent} onChange={event => { setError(''); setConsent(event.target.checked); }} />
                <span>J’accepte les <a href={CONFIG.termsUrl} target="_blank" rel="noopener">CGU</a> et la <a href={CONFIG.privacyUrl} target="_blank" rel="noopener">politique de confidentialité</a>.</span>
              </label>
              <Turnstile ref={turnstile} siteKey={CONFIG.siteKey} onToken={setToken}
                onError={() => setError('La vérification anti-robot ne se charge pas. Vérifiez votre connexion, puis rechargez la page : votre saisie est conservée.')} />
              {alert}
              <div className="fl-actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <button type="submit" className="fl-cta fl-cta-wide" disabled={busy || !isEmail(draft.email) || !consent || !token}>
                  {busy ? 'Création en cours…' : 'Créer mon club · 30 jours offerts'}
                </button>
                <span className="fl-small">Sans carte bancaire. Un lien de connexion vous attend dans votre boîte mail.</span>
              </div>
              <button type="button" className="fl-link" onClick={() => go(3)}>← Retour</button>
            </form>
          )}

          {step === 'sent' && draft.sent && (
            <div className="fl-step">
              <span className="fl-kicker">C’est presque fini</span>
              {title('Un lien vous attend dans votre boîte mail.')}
              <p className="fl-lede">Nous l’avons envoyé à :</p>
              <div className="fl-sent-box">{draft.sent.email}</div>
              <p className="fl-note">Cliquez dessus pour garder <strong>{name || 'votre club'}</strong> : l’essai de 30 jours démarre à ce moment-là. Rien reçu d’ici quelques minutes ? Regardez dans vos courriers indésirables (spams). Sans clic sous 7 jours, l’inscription est effacée.</p>
              <Turnstile ref={turnstile} siteKey={CONFIG.siteKey} onToken={setToken}
                onError={() => setError('La vérification anti-robot ne se charge pas. Rechargez la page pour renvoyer le lien.')} />
              {alert}
              <div role="status" className="fl-status">{status}</div>
              <div className="fl-actions">
                <button type="button" className="fl-cta" disabled={busy || !token} onClick={() => void submit(true)}>
                  {busy ? 'Envoi…' : 'Renvoyer le lien'}
                </button>
                <button type="button" className="fl-ghost" onClick={() => { update({ email: draft.sent!.email }); go(4); }}>Changer d’adresse</button>
              </div>
            </div>
          )}
        </section>

        <section className={`fl-preview${preview.open ? ' open' : ''}`} data-tab={preview.tab} aria-label="Aperçu de votre club"
          style={{ backgroundImage: `radial-gradient(ellipse 60% 55% at 70% 0%, ${alpha(draft.color, 0.32)}, transparent 70%), radial-gradient(ellipse 50% 40% at 10% 100%, ${alpha(draft.color, 0.16)}, transparent 70%)` }}>
          <div className="fl-preview-top">
            <button type="button" className="fl-ghost fl-preview-toggle" aria-expanded={preview.open} aria-controls="fl-preview-body"
              onClick={() => setPreview(p => ({ ...p, open: !p.open }))}>
              {preview.open ? 'Masquer l’aperçu' : 'Voir l’aperçu'}
            </button>
            <span className="fl-pulse">Aperçu en direct · rencontres d’exemple</span>
            {preview.open && (
              <div className="fl-tabs" role="group" aria-label="Choisir l’aperçu">
                {(['site', 'app'] as const).map(tab => (
                  <button key={tab} type="button" aria-pressed={preview.tab === tab} onClick={() => setPreview(p => ({ ...p, tab }))}>
                    {tab === 'site' ? 'Site' : 'App'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div id="fl-preview-body" className="fl-preview-body">
            <div className="fl-site-slot"><SitePreview data={previewData} mobile={mobile} /></div>
            <div className="fl-app-slot"><AppPreview data={previewData} /></div>
          </div>
        </section>
      </main>
    </div>
  );
}

function OtherColor({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  return (
    <label className="fl-other">
      <input type="color" value={color} onChange={event => onChange(event.target.value.toLowerCase())} />
      Autre
    </label>
  );
}

function alpha(hex: string, value: number) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${value})`;
}
