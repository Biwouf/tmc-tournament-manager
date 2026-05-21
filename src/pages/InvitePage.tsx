import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function InvitePage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    const target = email.trim();
    const redirectTo = `${window.location.origin}/accept-invite`;
    const { data, error: invokeErr } = await supabase.functions.invoke('invite-user', {
      body: { email: target, redirectTo },
    });
    setLoading(false);
    if (invokeErr) {
      setError(invokeErr.message);
      return;
    }
    const payload = data as { success?: boolean; error?: string } | null;
    if (!payload?.success) {
      setError(payload?.error ?? 'Erreur inconnue lors de l’envoi de l’invitation.');
      return;
    }
    setSuccess(`Invitation envoyée à ${target}.`);
    setEmail('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card/90 p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight text-card-foreground">
          Inviter un utilisateur
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          L’invité recevra un email pour choisir son mot de passe.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
              {success}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              required
              autoComplete="email"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60"
          >
            {loading ? '...' : 'Envoyer l’invitation'}
          </button>

          <Link
            to="/"
            className="block text-center text-sm text-muted-foreground transition hover:text-foreground"
          >
            ← Retour à l’accueil
          </Link>
        </form>
      </div>
    </div>
  );
}
