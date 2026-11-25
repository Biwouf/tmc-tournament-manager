import PasswordInput from '../components/PasswordInput';
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { initialLinkError, inscriptionSlug, magicLinkRedirect, MAGIC_LINK_MESSAGES, requestMagicLink } from '../lib/magicLink';
import { CODE_MESSAGES, MAX_CODE_TRIES, resendWait, sentNow, verifyEmailCode } from '../lib/emailCode';
import OtpCodeInput from '../components/OtpCodeInput';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // `?inscription` reste dans l'URL : le nouveau lien garde le gabarit « Gardez votre club ».
  const [inscription] = useState(() => inscriptionSlug(window.location.href));
  // SaaS S4 : un compte né du tunnel n'a pas de mot de passe ; un lien expiré arrive ici.
  // P0 : `?inscription` (retour du tunnel) ouvre aussi en mode lien.
  // Onboarding P2 : `code` — le même e-mail, mais le code à 6 chiffres se saisit ici (même onglet).
  const [mode, setMode] = useState<'password' | 'link' | 'code'>(initialLinkError || inscription ? 'link' : 'password');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tries, setTries] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  // Le champ du code vient d'apparaître : il reçoit le focus une fois rendu.
  const codeShown = mode === 'code' && sent;
  useEffect(() => { if (codeShown) codeInput.current?.focus(); }, [codeShown]);
  const wait = mode === 'code' && sent ? resendWait(sentAt, now) : 0;
  useEffect(() => {
    if (wait === 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [wait, now]);

  useEffect(() => {
    // Retire l'erreur du fragment ; la requête (`?inscription`) est conservée.
    if (initialLinkError && window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    if (mode === 'code' && sent) {
      await checkCode(code);
    } else if (mode === 'link' || mode === 'code') {
      const result = await requestMagicLink(supabase, email, magicLinkRedirect(window.location.origin, inscription));
      if (result === 'sent') {
        setSent(true);
        const at = sentNow();
        setSentAt(at); setNow(at); setTries(0);
      } else setError(MAGIC_LINK_MESSAGES[result]);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setLoading(false);
  };

  /** Code juste : la session s'ouvre dans l'onglet, la garde d'auth prend le relais. */
  async function checkCode(value: string) {
    if (value.length !== 6) { setError('Saisissez les 6 chiffres du code.'); codeInput.current?.focus(); return; }
    if (tries >= MAX_CODE_TRIES) { setError(CODE_MESSAGES.exhausted); setCode(''); codeInput.current?.focus(); return; }
    setLoading(true); setError(null);
    const result = await verifyEmailCode(supabase, email, value, sentAt);
    setLoading(false);
    if (result === 'ok') return;
    const refused = tries + (result === 'wrong' ? 1 : 0);
    setTries(refused);
    setError(result === 'expired' ? 'Ce code a expiré. Demandez-en un nouveau.'
      : result === 'wrong' && refused >= MAX_CODE_TRIES ? CODE_MESSAGES.exhausted : CODE_MESSAGES[result]);
    if (result !== 'failed') setCode('');
    codeInput.current?.focus();
  }
  async function resend() {
    setError(null); setLoading(true);
    const result = await requestMagicLink(supabase, email, magicLinkRedirect(window.location.origin, inscription));
    setLoading(false);
    if (result === 'sent') { const at = sentNow(); setSentAt(at); setNow(at); setCode(''); setTries(0); }
    else setError(MAGIC_LINK_MESSAGES[result]);
    codeInput.current?.focus();
  }

  const switchMode = (next: 'password' | 'link' | 'code') => { setMode(next); setError(null); setSent(false); setCode(''); };
  const linkButton = 'mt-4 block w-full text-center text-sm text-primary underline';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card/90 p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-card-foreground">
          {initialLinkError && mode === 'link' ? 'Ce lien a expiré' : 'Administration club'}
        </h1>

        {sent && mode === 'code' ? (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <p role="status" className="text-sm text-foreground">Si un compte correspond à {email.trim()}, un code à 6 chiffres arrive dans sa boîte mail. Pensez à vérifier vos spams.</p>
            {error && (
              <div id="login-code-error" role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="login-code" className="mb-1.5 block text-sm font-medium text-foreground">Code à 6 chiffres</label>
              <OtpCodeInput ref={codeInput} id="login-code" value={code} busy={loading} invalid={Boolean(error)}
                describedBy={error ? 'login-code-error' : undefined} onChange={setCode} onComplete={value => void checkCode(value)}
                boxClassName="flex h-12 items-center justify-center rounded-lg border border-input bg-background text-xl font-semibold tabular-nums text-foreground data-[active]:ring-2 data-[active]:ring-ring data-[invalid]:border-destructive" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60">
              {loading ? '...' : 'Se connecter'}
            </button>
            <button type="button" disabled={loading || wait > 0} onClick={() => void resend()} className="block min-h-11 w-full text-center text-sm text-primary underline disabled:no-underline disabled:opacity-60">
              {wait > 0 ? `Renvoyer le code dans ${wait} s` : 'Renvoyer le code'}
            </button>
          </form>
        ) : sent ? (
          <p role="status" className="text-sm text-foreground">{MAGIC_LINK_MESSAGES.sent}</p>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {initialLinkError && mode === 'link' && (
            <p className="text-sm text-muted-foreground">
              Un lien de connexion ne sert qu’une fois et expire au bout de 10 minutes. Indiquez votre adresse pour en recevoir un nouveau.
            </p>
          )}
          {error && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              required
              autoComplete="email"
            />
          </div>

          {mode === 'password' && (
          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-foreground">Mot de passe</label>
            <PasswordInput
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              required
              autoComplete="current-password"
            />
          </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60"
          >
            {loading ? '...' : mode === 'password' ? 'Se connecter' : mode === 'code' ? 'Recevoir un code' : initialLinkError ? 'Recevoir un nouveau lien' : 'Recevoir un lien de connexion'}
          </button>
        </form>
        )}
        {(!sent || mode === 'code') && <>
          {mode !== 'link' && <button type="button" onClick={() => switchMode('link')} className={linkButton}>Recevoir un lien de connexion</button>}
          {mode !== 'code' && <button type="button" onClick={() => switchMode('code')} className={linkButton}>Recevoir un code</button>}
          {mode !== 'password' && <button type="button" onClick={() => switchMode('password')} className={linkButton}>Se connecter avec un mot de passe</button>}
        </>}
        <Link to="/forgot-password" className="mt-4 block text-center text-sm text-primary underline">Mot de passe oublié ?</Link>
      </div>
    </div>
  );
}
