import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { signupSlugProblem } from '../../shared/clubSlug.mjs';
import { formatClubName, shortNameFor } from '../../shared/clubName.mjs';
import {
  accountProblem, BRAND_FALLBACK, clubProblem, COLOR_SAMPLES, cleanSlugInput, draftFromLanding, DRAFT_KEY, loadDraft, rememberTenupLink, saveDraft, signupConfig, slugify,
  slugMessage, stepPosition, submitClubSignup, suggestSlug, tenupLogo, fetchTeamsCount,
  type FieldProblem, type TeamsCount, changeSignupEmail, type LookupResult, type SignupDraft, type SignupOutcome, type SignupStep, type SlugCheck,
} from '../lib/clubSignup';
import { tidyCase } from '../lib/tenupSiteImport';
import { dataUrlToBlob, paletteFromUrl, prepareSignupImage, SIGNUP_IMAGE_TYPES } from '../lib/signupImage';
import Turnstile, { type TurnstileHandle } from '../components/signup/Turnstile';
import { AlreadyStep, ConfirmStep, FindStep, LogoChoicePanel } from '../components/signup/TenupSteps';
import OtpCodeInput from '../components/OtpCodeInput';
import { CODE_MESSAGES, MAX_CODE_TRIES, resendAnnouncement, resendWait, verifyEmailCode } from '../lib/emailCode';
import { magicLinkRedirect, requestMagicLink, MAGIC_LINK_MESSAGES } from '../lib/magicLink';
import { AppPreview, SitePreview } from '../components/signup/SignupPreview';
import '@fontsource/instrument-sans/latin-400';
import '@fontsource/instrument-sans/latin-500';
import '@fontsource/ibm-plex-mono/latin-400';
import '@fontsource/ibm-plex-mono/latin-500';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/big-shoulders-display/latin-900';
import '@fontsource-variable/manrope';
import '../components/signup/signup.css';

// SaaS S3 — tunnel public `admin.feelike.pro/inscription` (docs/specs/SAAS_ONBOARDING.md §7, §14).
// Monté par AdminEntry hors de toute résolution de club et de toute session. P1 « Ten'Up d'abord » :
// 01 lien Ten'Up → 02 « C'est bien votre club ? » → 03 e-mail ; ou 01 → M1-M3 (saisie manuelle) → 03.
// Tout est écrit en une fois par `club-signup` à l'écran 03. P2 : le code à 6 chiffres reçu par e-mail
// se saisit dans l'onglet (`verifyOtp`), puis `/?inscription=<slug>` active le club (`AdminEntry`) et
// ouvre « Votre app est prête ». Le lien de l'e-mail reste valable ; « Un lien vous attend » : repli.

const CONFIG = signupConfig(import.meta.env);
const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/club-signup`;
const LOOKUP_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tenup-lookup`;

/** Champ qui reçoit le focus pour chaque manque (Turnstile : son cadre, par ref). */
const FIELD_IDS = { name: 'fl-club', city: 'fl-city', email: 'fl-email', consent: 'fl-consent', turnstile: '' } as const;

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
  // PR-L1 : lien Ten'Up collé sur la landing (`?tenup=`), lu une seule fois à l'ouverture.
  const [landing] = useState(() => draftFromLanding(readDraft(), window.location.search));
  const [draft, setDraft] = useState<SignupDraft>(landing.draft);
  // La recherche automatique ne sert qu'une fois : l'écran 01 est remonté à chaque retour.
  const autoFind = useRef(landing.autoFind);
  const takeAutoFind = () => { const take = autoFind.current; autoFind.current = false; return take; };
  const [slugCheck, setSlugCheck] = useState<SlugCheck>({ state: 'idle' });
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  // P0 : ce qui manque à l'envoi d'une étape (les boutons ne sont jamais grisés), affiché sous le champ.
  const [missing, setMissing] = useState<FieldProblem | null>(null);
  // Étape 3 : envoyée pendant la vérification de l'adresse → on avance dès qu'elle aboutit.
  const [advance, setAdvance] = useState(false);
  const [preview, setPreview] = useState<{ open: boolean; tab: 'site' | 'app' }>({ open: false, tab: 'site' });
  // Écran 01 : message venu de la création (lecture Ten'Up expirée).
  const [findNotice, setFindNotice] = useState('');
  // P2 : code saisi, son erreur (sous le champ), l'horloge du décompte « renvoyer » et son annonce.
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [announce, setAnnounce] = useState('');
  const codeInput = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLDivElement>(null);
  // P2 : « N équipes en championnat » de la carte 02, pour CE club ; absent tant qu'inconnu.
  const [teams, setTeams] = useState<{ id: string; count: TeamsCount | null } | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const turnstileBox = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const mobile = useMobile();
  const { step } = draft;
  // I2 : clavier ouvert, il reste ~470 px — cases, erreur et renvoi au centre (rien à faire sur ordinateur).
  const revealCode = () => codeField.current?.scrollIntoView({ block: mobile ? 'center' : 'nearest' });

  useEffect(() => { try { saveDraft(window.sessionStorage, draft); } catch { /* stockage indisponible */ } }, [draft]);
  // Le lien est passé dans la saisie : on le retire de l'adresse (un rechargement ne relance rien).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('tenup')) return;
    url.searchParams.delete('tenup');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);
  // Changement d'étape : le titre reçoit le focus (lecteurs d'écran, clavier).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    // P2 : le code s'attend tout de suite (clavier numérique, suggestion iOS depuis Mail).
    if (step === 'code') codeInput.current?.focus({ preventScroll: true }); else heading.current?.focus();
    window.scrollTo({ top: 0 });
    if (step === 'code') revealCode();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // P2 : décompte du renvoi, une seconde à la fois tant qu'il court ; annonce toutes les 15 s au plus.
  const sentAt = draft.sent?.at ?? null;
  const wait = step === 'code' ? resendWait(sentAt, now) : 0;
  useEffect(() => {
    if (step !== 'code' || wait === 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [step, wait, now]);
  useEffect(() => { if (codeError) revealCode(); }, [codeError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (step !== 'code') return;
    const text = resendAnnouncement(wait);
    if (text) setAnnounce(text);
  }, [step, wait]);

  // Carte 02 : après l'identité, la page des rencontres, seulement si le worker est libre. Jamais
  // bloquant : la carte s'affiche d'abord, la ligne arrive (ou pas) ensuite.
  const tenupId = step === 'confirm' && draft.mode === 'tenup' ? draft.tenup?.tenup_club_id ?? null : null;
  const tenupToken = draft.tenup?.lookup_token ?? '';
  useEffect(() => {
    if (!tenupId || teams?.id === tenupId) return;
    setTeams({ id: tenupId, count: null });
    // Réponse tardive : gardée si c'est toujours ce club (retour sur la carte sans nouvelle lecture).
    void fetchTeamsCount(fetch, LOOKUP_ENDPOINT, tenupToken).then(count => setTeams(current => current?.id === tenupId ? { id: tenupId, count } : current));
  }, [tenupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<SignupDraft>) => { setError(''); setMissing(null); setAdvance(false); setDraft(current => ({ ...current, ...patch })); };
  const go = (next: SignupStep) => { setError(''); setStatus(''); setMissing(null); setAdvance(false); setFindNotice(''); setDraft(current => ({ ...current, step: next })); };

  /** 02 : le club lu. Même club relu (jeton expiré) → les retouches sont gardées. */
  function found(result: LookupResult) {
    const same = draft.mode === 'tenup' && draft.tenup?.tenup_club_id === result.tenup_club_id;
    const name = same ? draft.name : formatClubName(result.name);
    const sample = COLOR_SAMPLES[0].colors[0];
    update({
      mode: 'tenup', tenup: result, alreadyName: null, logo: null, photo: null, name,
      logoChoice: same ? draft.logoChoice : 'clean',
      city: same ? draft.city : tidyCase(result.city ?? ''),
      shortName: same && draft.shortNameEdited ? draft.shortName : shortNameFor(name).slice(0, 12),
      shortNameEdited: same && draft.shortNameEdited,
      ...(same ? {} : { slug: '', slugEdited: false, sample: null, palette: [], color: result.logo_url ? BRAND_FALLBACK : sample }),
    });
    go('confirm');
    // Couleur tirée du logo (copié dans notre stockage) : la première teinte est choisie. W3 : la
    // palette recalculée par le worker sur le logo détouré (sans le bruit du fond) d'abord.
    if (!same && result.logo_palette?.length && result.logo_verdict !== 'monogram') {
      const palette = result.logo_palette.slice(0, 3);
      setDraft(current => current.tenup?.tenup_club_id !== result.tenup_club_id ? current : { ...current, palette, color: palette[0] });
    } else if (!same && result.logo_url) {
      void paletteFromUrl(result.logo_url).then(palette => setDraft(current => current.tenup?.tenup_club_id !== result.tenup_club_id ? current
        : palette.length ? { ...current, palette: palette.slice(0, 3), color: palette[0] } : { ...current, color: sample }));
    }
  }
  /** 01b : rien du club existant, seulement le nom Ten'Up s'il est connu. */
  function already(tenupClubId: string, tenupName: string | null) {
    const known = draft.tenup?.tenup_club_id === tenupClubId ? draft.name : null;
    update({ mode: 'tenup', alreadyName: tenupName ? formatClubName(tenupName) : known });
    go('already');
  }
  const manual = () => { update({ mode: 'manual' }); go(1); };
  /** « Ce n'est pas mon club » (01b, 02) : retour à 01, champ vidé. */
  const notMine = () => { update({ tenupUrl: '', tenup: null, alreadyName: null }); go('find'); };

  const name = draft.name.trim();
  const city = draft.city.trim();
  const slugReady = slugCheck.state === 'available' || slugCheck.state === 'error';
  useEffect(() => {
    if (advance && step === 3 && slugReady) go('account');
    else if (advance && slugCheck.state === 'unavailable') { setAdvance(false); document.getElementById('fl-slug')?.focus(); }
  }, [advance, step, slugReady, slugCheck.state]);
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
    // P1 : club rattaché entre-temps → 01b ; jeton de lecture expiré → on relit le club (lien gardé).
    if (outcome.lookup === 'already' && !resend) { update({ alreadyName: draft.name.trim() || null }); go('already'); return; }
    if (outcome.lookup === 'expired' && !resend) { go('find'); setFindNotice(outcome.message); return; }
    let message = outcome.message;
    // Nouvelle adresse e-mail, même slug : le club en attente du premier envoi le garde.
    if (outcome.slugReason === 'taken' && draft.sent?.slug === draft.slug && draft.sent.email !== email) {
      message = `L’adresse ${draft.slug}.feelike.pro reste réservée à votre première inscription (${draft.sent.email}) : elle se libère au bout de 7 jours sans clic sur le lien. Choisissez-en une autre, ou revenez à l’e-mail précédent.`;
    }
    if (outcome.slugReason) setSlugCheck({ state: 'unavailable', reason: outcome.slugReason });
    setError(message);
    // Un renvoi qui échoue reste sur la confirmation ; une création, à l'étape à corriger
    // (en branche Ten'Up, adresse et images se corrigent sur la carte).
    const target: SignupStep = outcome.step === 4 ? 'account' : draft.mode === 'tenup' ? 'confirm' : outcome.step;
    if (!resend && target !== step) setDraft(current => ({ ...current, step: target }));
  }

  /** Le premier manque : message sous son champ, focus dessus. */
  function show(problem: FieldProblem) {
    setMissing(problem);
    if (problem.field === 'turnstile') turnstileBox.current?.focus();
    else document.getElementById(FIELD_IDS[problem.field])?.focus();
  }
  function submitClub() {
    const problem = clubProblem({ name: draft.name, city: draft.city });
    if (problem) show(problem); else go(2);
  }
  /** Étape 3 : adresse refusée → focus sur le champ (son message est dessous) ; en cours de
   *  vérification → on avance dès la réponse. */
  function submitSlug() {
    if (slugReady) go('account');
    else if (slugCheck.state === 'unavailable') document.getElementById('fl-slug')?.focus();
    else setAdvance(true);
  }
  /** Envoi de l'étape 4 : message et focus sur le premier manque, aucune requête. */
  function submitAccount() {
    if (busy) return;
    // E-mail inchangé, code envoyé il y a moins d'une minute : on y retourne, sans nouvel envoi.
    if (draft.sent?.at && draft.sent.email === draft.email.trim().toLowerCase() && draft.sent.slug === draft.slug && resendWait(draft.sent.at) > 0) { go('code'); return; }
    const problem = accountProblem({ email: draft.email, consent, token });
    if (problem) show(problem); else void submit(false);
  }
  const invalid = (field: FieldProblem['field']) => ({
    'aria-invalid': missing?.field === field,
    'aria-describedby': missing?.field === field ? `fl-${field}-error` : undefined,
  });
  const fieldError = (field: FieldProblem['field']) => missing?.field === field
    && <p id={`fl-${field}-error`} role="alert" className="fl-field-error">{missing.message}</p>;

  /** P2 : on reste dans l'onglet, le code arrive par e-mail. */
  function waitForCode(email: string, slug: string, resume?: string) {
    const at = Date.now();
    setCode(''); setCodeError(''); setNow(at);
    setStatus('Code envoyé. Il arrive en moins d’une minute.');
    setDraft(current => ({ ...current, step: 'code', sent: { email, slug, at, ...(resume ? { resume } : {}) } }));
  }
  /** Le champ n'est jamais désactivé : le focus tient, même juste après une erreur. */
  function focusCode() {
    codeInput.current?.focus({ preventScroll: true });
    revealCode();
  }

  async function submit(resend: boolean) {
    if (!token || busy) return;
    const email = resend && draft.sent ? draft.sent.email : draft.email.trim().toLowerCase();
    setBusy(true); setError(''); setStatus('');
    try {
      // B1 : le club est créé et en attente — on ne le recrée pas, on corrige son e-mail (code renvoyé).
      const created = !resend ? draft.sent : null;
      if (created?.resume) {
        const outcome = await changeSignupEmail(fetch, ENDPOINT, { resume: created.resume, email, turnstileToken: token });
        setToken(null);
        if (outcome.ok) waitForCode(email, created.slug, outcome.resume ?? created.resume);
        else { if (outcome.resetTurnstile) turnstile.current?.reset(); setError(outcome.message); }
        return;
      }
      // Le renvoi rejoue l'inscription (S2 la rend idempotente) : les images ne servent plus.
      const [logo, photo] = resend ? [null, null] : await Promise.all([
        draft.logo ? dataUrlToBlob(draft.logo) : null, draft.photo ? dataUrlToBlob(draft.photo) : null,
      ]);
      // Branche Ten'Up : jeton de lecture et nom court ; logo et bandeau sont copiés par le serveur.
      const tenup = draft.mode === 'tenup' && draft.tenup ? { lookupToken: draft.tenup.lookup_token, shortName: draft.shortName,
        ...(tenupLogo(draft.tenup, draft.logoChoice).retouched ? { logoVariant: draft.logoChoice } : {}) } : {};
      const outcome = await submitClubSignup(fetch, ENDPOINT, {
        name, city, slug: draft.slug, color: draft.color, email, turnstileToken: token, logo, photo, ...tenup,
      });
      if (outcome.ok) {
        // Branche manuelle : le lien Ten'Up collé en 01 préremplira l'étape Équipes (autre onglet).
        if (draft.mode === 'manual' && draft.tenupUrl.trim()) {
          try { rememberTenupLink(window.localStorage, draft.slug, draft.tenupUrl); } catch { /* stockage indisponible */ }
        }
        if (resend) {
          turnstile.current?.reset(); setStatus(`Lien renvoyé à ${email}.`);
          setDraft(current => current.sent ? { ...current, sent: { ...current.sent, at: Date.now(), tries: 0 } } : current);
        } else waitForCode(email, draft.slug, outcome.resume);
        setToken(null);
      } else {
        // Club créé mais e-mail non parti : le jeton est gardé, l'adresse reste corrigeable.
        if (outcome.resume) setDraft(current => ({ ...current, sent: { email, slug: current.slug, resume: outcome.resume } }));
        applyFailure(outcome, email, resend);
      }
    } finally { setBusy(false); }
  }

  /** P2 : nouveau code, sans `club-signup` (le club existe déjà) : même e-mail « Gardez votre club ». */
  async function resendCode(auto = false) {
    if (!draft.sent || busy || resendWait(sentAt) > 0) return;
    const sent = draft.sent;
    setBusy(true);
    const result = await requestMagicLink(supabase, sent.email, magicLinkRedirect(window.location.origin, sent.slug));
    setBusy(false);
    if (result === 'sent') {
      const at = Date.now();
      setNow(at);
      setDraft(current => current.sent ? { ...current, sent: { ...current.sent, at, tries: 0 } } : current);
      setStatus(auto ? '' : 'Nouveau code envoyé. Il arrive en moins d’une minute.');
      if (!auto) setCodeError('');
    } else setCodeError(MAGIC_LINK_MESSAGES[result]);
    focusCode();
  }
  /** P2 : vérification dans l'onglet ; réussie → `AdminEntry` active le club et ouvre les premiers pas. */
  async function checkCode(value: string) {
    if (!draft.sent || busy) return;
    if (value.length !== 6) { setCodeError('Saisissez les 6 chiffres du code.'); focusCode(); return; }
    // M2 : ce code a été refusé 5 fois, il en faut un nouveau.
    if ((draft.sent.tries ?? 0) >= MAX_CODE_TRIES) { setCodeError(CODE_MESSAGES.exhausted); setCode(''); focusCode(); return; }
    setBusy(true); setCodeError(''); setStatus('');
    const result = await verifyEmailCode(supabase, draft.sent.email, value, sentAt);
    if (result === 'ok') {
      const slug = draft.sent.slug;
      try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* stockage indisponible */ }
      window.location.assign(`/?inscription=${encodeURIComponent(slug)}`);
      return;
    }
    setBusy(false);
    const tries = (draft.sent.tries ?? 0) + (result === 'wrong' ? 1 : 0);
    const exhausted = result === 'wrong' && tries >= MAX_CODE_TRIES;
    const renew = (result === 'expired' || exhausted) && resendWait(sentAt) === 0;
    setDraft(current => current.sent ? { ...current, sent: { ...current.sent, tries } } : current);
    setCodeError(exhausted ? CODE_MESSAGES[renew ? 'exhaustedSent' : 'exhausted'] : CODE_MESSAGES[result]);
    if (result !== 'failed') setCode('');
    focusCode();
    if (renew) void resendCode(true);
  }

  const fromTenup = draft.mode === 'tenup' ? draft.tenup : null;
  const previewData = { name: draft.name, city: draft.city, slug: draft.slug, color: draft.color,
    logo: draft.logo ?? (fromTenup ? tenupLogo(fromTenup, draft.logoChoice).full : null), photo: draft.photo ?? fromTenup?.banner_url ?? null };
  const kicker = (time: string) => <span className="fl-kicker">{time}</span>;
  const openPreview = () => {
    setPreview({ open: true, tab: 'app' });
    window.requestAnimationFrame(() => document.getElementById('fl-preview-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  // P0 : sur mobile, l'app reste visible sous le titre ; « Voir l'aperçu » garde la version complète.
  // P1 : pas de vignette sur la carte « C'est bien votre club ? » (ses rencontres d'exemple passeraient pour le vrai calendrier).
  const mini = mobile && step !== 'code' && step !== 'find' && step !== 'already' && step !== 'confirm' && (
    <button type="button" className="fl-mini" aria-controls="fl-preview-body" onClick={openPreview}>
      <span className="fl-mini-phone" aria-hidden="true"><AppPreview data={previewData} /></span>
      <span className="fl-mini-text">
        <span className="fl-pulse">Votre app en direct</span>
        <span className="fl-mini-host">{breakable(`app-${draft.slug || 'votreclub'}.feelike.pro`)}</span>
        <span className="fl-mini-open">Voir l’aperçu en grand</span>
      </span>
    </button>
  );
  const title = (text: ReactNode) => <><h1 ref={heading} tabIndex={-1} className="fl-h1">{text}</h1>{mini}</>;
  const alert = <div role="alert" className="fl-alert">{error}</div>;
  const back = (to: SignupStep, label = 'Retour') => <button type="button" className="fl-ghost" onClick={() => go(to)}>{label}</button>;

  const position = stepPosition(draft);
  const keepTitle = `Gardez ${(draft.mode === 'tenup' && draft.shortName.trim()) || name || 'votre club'}`;
  const logoPanel = !mobile && step === 'confirm' && draft.mode === 'tenup' && draft.tenup !== null && tenupLogo(draft.tenup, draft.logoChoice).retouched;

  return (
    <div className="fl">
      <header className="fl-head">
        <div className="fl-head-row">
          <Logo />
          {position && (
            <div className="fl-progress">
              <span className="fl-count">{position.index > position.total ? 'C’est presque fini' : `Étape ${position.index} sur ${position.total}`}</span>
              <span className="fl-bar" aria-hidden="true">
                {Array.from({ length: position.total }, (_, i) => <span key={i} className={i < position.index ? 'on' : ''} />)}
              </span>
            </div>
          )}
          <span className="fl-head-login">Déjà un compte ? <Link to="/login">Connexion</Link></span>
        </div>
      </header>

      <main className="fl-main">
        <section className="fl-form" aria-label="Inscription">
          {/* I5 : région toujours présente (vide avant l'envoi) — un texte déjà là à l'insertion n'est pas annoncé. */}
          <p role="status" className="fl-sr">{step === 'code' ? status : ''}</p>
          {step === 'find' && (
            <FindStep draft={draft} update={update} title={title} siteKey={CONFIG.siteKey} endpoint={LOOKUP_ENDPOINT} notice={findNotice} takeAutoFind={takeAutoFind}
              onFound={found} onAlready={already} onManual={manual} />
          )}

          {step === 'already' && <AlreadyStep name={draft.alreadyName} title={title} onNotMine={notMine} />}

          {step === 'confirm' && draft.tenup && (
            <ConfirmStep draft={{ ...draft, tenup: draft.tenup }} update={update} title={title} error={alert}
              slugCheck={slugCheck} setSlugCheck={setSlugCheck} onConfirm={() => go('account')} onNotMine={notMine} mobile={mobile}
              teams={teams?.id === draft.tenup.tenup_club_id ? teams.count : null} />
          )}

          {step === 1 && (
            <form className="fl-step" noValidate onSubmit={event => { event.preventDefault(); submitClub(); }}>
              <button type="button" className="fl-link" onClick={() => go('find')}>← Retrouver mon club sur Ten’Up</button>
              {kicker('15 secondes')}
              {title('Comment s’appelle votre club\u00a0?')}
              <p className="fl-lede">Votre site et votre app se construisent pendant que vous tapez.</p>
              <div className="fl-field">
                <label htmlFor="fl-club" className="fl-label">Nom du club</label>
                <input id="fl-club" className="fl-input" type="text" autoComplete="organization" maxLength={80} required
                  value={draft.name} {...invalid('name')}
                  onChange={event => { const value = event.target.value; update({ name: value, ...(draft.slugEdited ? {} : { slug: slugify(value) }) }); }} />
                {fieldError('name')}
              </div>
              <div className="fl-field">
                <label htmlFor="fl-city" className="fl-label">Ville</label>
                <input id="fl-city" className="fl-input" type="text" autoComplete="address-level2" maxLength={80} required
                  value={draft.city} {...invalid('city')} onChange={event => update({ city: event.target.value })} />
                {fieldError('city')}
              </div>
              {alert}
              <div className="fl-actions">
                <button type="submit" className="fl-cta">Continuer</button>
                <span className="fl-small">Gratuit 30 jours · sans carte bancaire</span>
              </div>
            </form>
          )}

          {step === 2 && (
            <div className="fl-step">
              {kicker('20 secondes')}
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
                <button type="button" className="fl-cta" disabled={busy} onClick={() => go(3)}>Continuer</button>
              </div>
              {!(draft.logo || draft.photo || draft.sample !== null || draft.palette.length) && (
                <button type="button" className="fl-link" disabled={busy} onClick={() => go(3)}>Passer cette étape</button>
              )}
            </div>
          )}

          {step === 3 && (
            <form className="fl-step" onSubmit={event => { event.preventDefault(); submitSlug(); }}>
              {kicker('10 secondes')}
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
                <button type="submit" className="fl-cta" aria-busy={advance}>{advance ? 'Vérification…' : 'Réserver cette adresse'}</button>
              </div>
            </form>
          )}

          {step === 'account' && (
            <form className="fl-step" noValidate onSubmit={event => { event.preventDefault(); submitAccount(); }}>
              {kicker('dernière ligne droite')}
              {title(keepTitle)}
              <p className="fl-lede">Votre e-mail sert à vous reconnecter. Pas de mot de passe, pas de carte bancaire.</p>
              <div className="fl-field">
                <label htmlFor="fl-email" className="fl-label">Votre e-mail</label>
                <input id="fl-email" className="fl-input" type="email" autoComplete="email" inputMode="email" maxLength={254} required
                  value={draft.email} {...invalid('email')}
                  onChange={event => update({ email: event.target.value })} />
                {fieldError('email')}
              </div>
              <label className="fl-check">
                <input id="fl-consent" type="checkbox" checked={consent} {...invalid('consent')}
                  onChange={event => { setError(''); setMissing(null); setConsent(event.target.checked); }} />
                <span>J’accepte les <a href={CONFIG.termsUrl} target="_blank" rel="noopener">CGU</a> et la <a href={CONFIG.privacyUrl} target="_blank" rel="noopener">politique de confidentialité</a>.</span>
              </label>
              {fieldError('consent')}
              <div ref={turnstileBox} tabIndex={-1} aria-label="Vérification anti-robot">
                <Turnstile ref={turnstile} siteKey={CONFIG.siteKey} onToken={value => { setToken(value); if (value && missing?.field === 'turnstile') setMissing(null); }}
                  onError={() => setError('La vérification anti-robot ne se charge pas. Vérifiez votre connexion, puis rechargez la page : votre saisie est conservée.')} />
              </div>
              {fieldError('turnstile')}
              {alert}
              <div className="fl-actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <button type="submit" className="fl-cta fl-cta-wide" aria-busy={busy}>
                  {busy ? 'Envoi du code…' : 'Recevoir mon code'}
                </button>
                <span className="fl-small">Sans carte bancaire. Un code à 6 chiffres arrive dans votre boîte mail.</span>
              </div>
              {/* Club créé : seule l'adresse se corrige encore, la carte et le slug sont enregistrés. */}
              {draft.sent?.resume
                ? draft.sent.at && <button type="button" className="fl-link" onClick={() => go('code')}>← Revenir au code envoyé à {draft.sent.email}</button>
                : <button type="button" className="fl-link" onClick={() => go(draft.mode === 'tenup' && draft.tenup ? 'confirm' : 3)}>← Retour</button>}
            </form>
          )}

          {step === 'code' && draft.sent && (
            <form className="fl-step" noValidate onSubmit={event => { event.preventDefault(); void checkCode(code); }}>
              {title(keepTitle)}
              <div className="fl-field">
                <span className="fl-label" id="fl-sent-label">Votre e-mail</span>
                <div className="fl-sent-row" aria-labelledby="fl-sent-label">
                  <span className="fl-sent-email">{draft.sent.email}</span>
                  <button type="button" className="fl-sent-edit" aria-label="Modifier l’e-mail" disabled={busy}
                    onClick={() => { update({ email: draft.sent!.email }); go('account'); }}>Modifier</button>
                </div>
              </div>
              {status && <p className="fl-code-status" aria-hidden="true">✓ {status}</p>}
              <div className="fl-field" ref={codeField}>
                <label htmlFor="fl-code" className="fl-label">Code à 6 chiffres</label>
                <OtpCodeInput ref={codeInput} id="fl-code" value={code} busy={busy} invalid={Boolean(codeError)}
                  describedBy={['fl-code-help', codeError ? 'fl-code-error' : ''].filter(Boolean).join(' ')}
                  boxClassName="fl-otp-box" onChange={value => { setCode(value); if (codeError) setCodeError(''); }}
                  onComplete={value => void checkCode(value)} />
                {codeError && <p id="fl-code-error" role="alert" className="fl-field-error">{codeError}</p>}
                <p id="fl-code-help" className="fl-small fl-resend">Rien reçu ? Regardez les indésirables.</p>
                <button type="button" className="fl-ghost fl-resend-btn" disabled={busy || wait > 0} onClick={() => void resendCode()}>
                  Renvoyer le code{wait > 0 && <span aria-hidden="true"> dans {wait}&nbsp;s</span>}
                </button>
                <span className="fl-sr" aria-live="polite">{announce}</span>
              </div>
              <div className="fl-actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <button type="submit" className="fl-cta fl-cta-wide" aria-busy={busy}>
                  {busy ? 'Vérification…' : 'Créer mon club · 30 jours offerts'}
                </button>
                <span className="fl-small">Le lien de l’e-mail marche aussi, même sur un autre appareil.</span>
              </div>
              <button type="button" className="fl-link" onClick={() => go('sent')}>Je n’ai reçu qu’un lien</button>
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
                <button type="button" className="fl-ghost" onClick={() => { update({ email: draft.sent!.email }); go('account'); }}>Changer d’adresse</button>
              </div>
              <button type="button" className="fl-link" onClick={() => go('code')}>Saisir le code reçu</button>
            </div>
          )}
        </section>

        {/* W3 : sur ordinateur, l'écran 02 montre le logo retouché à la place de l'aperçu (maquette 07b). */}
        {logoPanel ? (
          <section className="fl-preview fl-preview-logo" aria-label="Votre logo">
            <LogoChoicePanel tenup={draft.tenup!} choice={draft.logoChoice} onChange={logoChoice => update({ logoChoice })} />
          </section>
        ) : (
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
        )}
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

/** Adresse coupable après chaque tiret et avant chaque point, jamais au milieu d'un mot. */
function breakable(host: string): ReactNode[] {
  return host.split(/(?<=-)|(?=\.)/).flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]));
}

function alpha(hex: string, value: number) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${value})`;
}
