import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type Status = 'checking' | 'ready' | 'invalid';

export default function AcceptInvitePage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // detectSessionInUrl: true (default) — supabase-js parse automatiquement
    // le hash `#access_token=...&type=invite` au chargement. getSession() attend
    // cette initialisation, donc si la session existe on est prêt.
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setStatus(data.session ? 'ready' : 'invalid');
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Mot de passe trop court (6 caractères minimum).');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card/90 p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight text-card-foreground">
          Activer votre compte
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Choisissez le mot de passe que vous utiliserez pour vous connecter.
        </p>

        {status === 'checking' && (
          <p className="text-sm text-muted-foreground">Vérification du lien…</p>
        )}

        {status === 'invalid' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Lien invalide ou expiré. Demandez à un administrateur de renvoyer une invitation.
            </div>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="w-full rounded-lg border border-border bg-card py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
            >
              Aller à la page de connexion
            </button>
          </div>
        )}

        {status === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Confirmer le mot de passe
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60"
            >
              {loading ? '...' : 'Activer mon compte'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
