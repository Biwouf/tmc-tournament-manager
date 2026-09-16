import PasswordInput from '../components/PasswordInput';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, passwordRecovery } from '../lib/supabase';

const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';
const buttonClass = 'w-full rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60';

export default function PasswordRecoveryPage({ reset = false }: { reset?: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>(reset ? 'checking' : 'ready');
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!reset) return;
    let active = true;
    const check = (userId?: string) => {
      if (active) setStatus(userId && passwordRecovery.isReady(userId) ? 'ready' : 'invalid');
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => check(session?.user.id));
    supabase.auth.getSession().then(({ data, error }) => check(error ? undefined : data.session?.user.id)).catch(() => check());
    return () => { active = false; subscription.unsubscribe(); };
  }, [reset]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 10000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    setError(null);
    if (reset && (password.length < 8 || password !== confirm)) {
      setError(password.length < 8 ? 'Choisissez un mot de passe d’au moins 8 caractères.' : 'Les mots de passe ne correspondent pas.');
      return;
    }
    busy.current = true;
    setSlow(false);
    setLoading(true);
    try {
      if (!reset) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) {
          // Log identifiers only: never the email, tokens or raw provider response.
          console.warn('[password-recovery] Request failed', { status: error.status, code: error.code });
          if (error.status === 429) setError('Trop de demandes. Patientez quelques minutes avant de réessayer.');
          else if (error.status === 504 || error.code === 'request_timeout') setError('Le service de récupération met trop de temps à répondre. Consultez votre boîte mail avant de réessayer dans quelques minutes.');
          else if (error.status && error.status >= 500) setError('Le service de récupération rencontre un problème. Réessayez plus tard ou contactez le club si le problème persiste.');
          else setError('La demande n’a pas pu aboutir. Réessayez dans quelques instants.');
          return;
        }
        setSent(true);
      } else {
        // An ordinary logged-in session, or an old failed recovery link, is not
        // enough to display/submit this form. Supabase validates the session too.
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !data.session || !passwordRecovery.isReady(data.session.user.id)) {
          setStatus('invalid');
          return;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          if (error.code === 'same_password') setError('Choisissez un mot de passe différent de l’ancien.');
          else if (error.code === 'weak_password') setError('Ce mot de passe est trop faible. Choisissez un mot de passe plus long et difficile à deviner.');
          else if (error.status === 401 || error.status === 403) setStatus('invalid');
          else setError('Le mot de passe n’a pas pu être modifié. Réessayez dans quelques instants.');
          return;
        }
        passwordRecovery.clear();
        setPassword('');
        setConfirm('');
        setDone(true);
        // Remove any remaining callback parameters from the address bar.
        window.history.replaceState(window.history.state, '', window.location.pathname);
      }
    } catch {
      setError('Connexion impossible. Vérifiez votre connexion internet puis réessayez.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="mb-3 text-2xl font-semibold text-foreground">{reset ? 'Nouveau mot de passe' : 'Mot de passe oublié'}</h1>
        {done ? <div role="status" className="space-y-4">
          <p>Votre mot de passe a été modifié.</p>
          <Link className="block text-primary underline" to="/cours">Continuer vers mon espace</Link>
        </div> : sent ? <div role="status" className="space-y-4">
          <p>Si un compte correspond à cette adresse, vous recevrez un email pour choisir un nouveau mot de passe.</p>
          <p className="text-sm text-muted-foreground">Pensez à vérifier vos spams. Ouvrez le lien dans votre navigateur pour poursuivre.</p>
        </div> : status === 'checking' ? <p role="status">Vérification du lien…</p>
          : status === 'invalid' ? <div className="space-y-4">
            <p role="alert">Ce lien est invalide ou a expiré. Demandez un nouvel email de récupération.</p>
            <Link className="block text-primary underline" to="/forgot-password">Demander un nouveau lien</Link>
          </div> : <form onSubmit={submit} aria-busy={loading} className="space-y-4">
            {!reset && <p className="text-sm text-muted-foreground">Indiquez l’adresse email de votre compte.</p>}
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {reset ? <>
              <div><label className="mb-1.5 block text-sm font-medium" htmlFor="recovery-password">Nouveau mot de passe</label>
                <PasswordInput id="recovery-password" className={inputClass} autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />
                <p className="mt-1 text-sm text-muted-foreground">8 caractères minimum.</p></div>
              <div><label className="mb-1.5 block text-sm font-medium" htmlFor="recovery-confirm">Confirmer le mot de passe</label>
                <PasswordInput id="recovery-confirm" className={inputClass} autoComplete="new-password" minLength={8} required value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
            </> : <div><label className="mb-1.5 block text-sm font-medium" htmlFor="recovery-email">Email</label>
              <input id="recovery-email" className={inputClass} type="email" autoComplete="email" autoCapitalize="none" required value={email} onChange={e => setEmail(e.target.value)} /></div>}
            {loading && slow && <p role="status" className="text-sm text-muted-foreground">Le service met plus de temps que prévu à répondre. Votre demande est toujours en cours.</p>}
            <button className={buttonClass} type="submit" disabled={loading}>{loading ? 'Veuillez patienter…' : reset ? 'Enregistrer le mot de passe' : 'Recevoir un lien'}</button>
          </form>}
        {!done && <Link className="mt-6 block text-center text-sm text-primary underline" to="/login">Retour à la connexion</Link>}
      </div>
    </div>
  );
}
