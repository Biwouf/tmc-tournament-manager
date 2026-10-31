import PasswordInput from '../components/PasswordInput';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { initialLinkError, inscriptionSlug, magicLinkRedirect, MAGIC_LINK_MESSAGES, requestMagicLink } from '../lib/magicLink';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // SaaS S4 : un compte né du tunnel n'a pas de mot de passe ; un lien expiré arrive ici.
  const [mode, setMode] = useState<'password' | 'link'>(initialLinkError ? 'link' : 'password');
  const [sent, setSent] = useState(false);
  // `?inscription` reste dans l'URL : le nouveau lien garde le gabarit « Gardez votre club ».
  const [inscription] = useState(() => inscriptionSlug(window.location.href));

  useEffect(() => {
    // Retire l'erreur du fragment ; la requête (`?inscription`) est conservée.
    if (initialLinkError && window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    if (mode === 'link') {
      const result = await requestMagicLink(supabase, email, magicLinkRedirect(window.location.origin, inscription));
      if (result === 'sent') setSent(true);
      else setError(MAGIC_LINK_MESSAGES[result]);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setLoading(false);
  };

  const switchMode = (next: 'password' | 'link') => { setMode(next); setError(null); };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card/90 p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-card-foreground">
          {initialLinkError && mode === 'link' ? 'Ce lien a expiré' : 'Administration club'}
        </h1>

        {sent ? (
          <p role="status" className="text-sm text-foreground">{MAGIC_LINK_MESSAGES.sent}</p>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {initialLinkError && mode === 'link' && (
            <p className="text-sm text-muted-foreground">
              Un lien de connexion ne sert qu’une fois et expire au bout d’une heure. Indiquez votre adresse pour en recevoir un nouveau.
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
            {loading ? '...' : mode === 'password' ? 'Se connecter' : initialLinkError ? 'Recevoir un nouveau lien' : 'Recevoir un lien de connexion'}
          </button>
        </form>
        )}
        {!sent && (mode === 'password'
          ? <button type="button" onClick={() => switchMode('link')} className="mt-4 block w-full text-center text-sm text-primary underline">Recevoir un lien de connexion</button>
          : <button type="button" onClick={() => switchMode('password')} className="mt-4 block w-full text-center text-sm text-primary underline">Se connecter avec un mot de passe</button>)}
        <Link to="/forgot-password" className="mt-4 block text-center text-sm text-primary underline">Mot de passe oublié ?</Link>
      </div>
    </div>
  );
}
