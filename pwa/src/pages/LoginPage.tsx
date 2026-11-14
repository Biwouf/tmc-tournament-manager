import PasswordInput from '../components/PasswordInput';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { returnPath } from '../components/layout/headerConfig';
import { useClub } from '../contexts/ClubContext';
import { useClubConfig } from '../hooks/useClubConfig';
import { loginError } from '../lib/signup';
import { formatClubName } from '../../../shared/formatClubName';

// Champs de 48 px, texte 16 px : pas de zoom automatique d'iOS au focus.
const inputClass = 'min-h-12 w-full rounded-xl border border-border bg-background px-3.5 text-base text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20';

interface LocationState {
  from?: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { club } = useClub();
  const { config } = useClubConfig();
  const requested = (location.state as LocationState | undefined)?.from;
  const fromPath = returnPath(requested) ?? '/actu';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(loginError(error));
      return;
    }
    navigate(fromPath, { replace: true });
  };

  return (
    <div className="flex flex-col items-center px-4 pb-8 pt-6">
      {config.brand.logo && <img src={config.brand.logo} alt="" className="h-20 w-20 object-contain" />}
      {club?.name && <p className="mt-2 text-[15px] font-bold">{formatClubName(club.name)}</p>}
      <div className="mt-5 w-full max-w-sm rounded-2xl border bg-card p-5 shadow-sm">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-foreground">
          Connexion
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {fromPath.startsWith('/cours') || fromPath.startsWith('/profil') ? 'Retrouvez les cours et vos inscriptions avec votre compte membre.' : 'Retrouvez les actualités, les scores et les cours de votre club.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-sm font-semibold text-foreground">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              required
              autoComplete="email"
              autoCapitalize="none"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-sm font-semibold text-foreground">Mot de passe</label>
            <PasswordInput
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="min-h-12 w-full rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60"
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
        <Link to="/forgot-password" className="mt-3 flex min-h-11 items-center justify-center text-sm font-semibold text-primary underline underline-offset-2">Mot de passe oublié ?</Link>
        <Link to={`/inscription${/^\/cours(?:\?|$)/.test(fromPath) ? `?returnTo=${encodeURIComponent(fromPath)}` : ''}`} className="flex min-h-11 items-center justify-center text-center text-sm font-semibold text-primary underline underline-offset-2">Pas encore de compte ? Créer un compte</Link>
      </div>
    </div>
  );
}
