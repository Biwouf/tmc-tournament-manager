import { useState } from 'react';
import { Link } from 'react-router-dom';
import { invokeInvite } from '../lib/invite';
import { useClub } from '../contexts/ClubContext';
import type { ClubRole } from '../contexts/ClubRoleContext';

// Défaut = le rôle le moins privilégié (brief PR4 §9.3).
const ROLE_OPTIONS: { value: ClubRole; label: string }[] = [
  { value: 'member', label: 'Membre — Live Score uniquement' },
  { value: 'manager', label: 'Gestionnaire — contenus et outils du club' },
  { value: 'admin', label: 'Administrateur — tout, y compris les invitations' },
];

export default function InvitePage() {
  const { clubId, club } = useClub();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ClubRole>('member');
  const [loading, setLoading] = useState<null | 'send' | 'generate-link'>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setError(null);
    setSuccess(null);
    setActionLink(null);
    setCopied(false);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    setLoading('send');
    const target = email.trim();
    const redirectTo = `${window.location.origin}/accept-invite`;
    const result = await invokeInvite({
      email: target,
      redirectTo,
      action: 'send',
      club_id: clubId,
      role,
    });
    setLoading(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setSuccess(
      result.already_existed
        ? `Un compte existait déjà pour ${target} : il a été rattaché au club (aucun email envoyé).`
        : `Invitation envoyée à ${target}.`,
    );
    setEmail('');
  };

  const handleGenerateLink = async () => {
    reset();
    setLoading('generate-link');
    const target = email.trim();
    const redirectTo = `${window.location.origin}/accept-invite`;
    const result = await invokeInvite({
      email: target,
      redirectTo,
      action: 'generate-link',
      club_id: clubId,
      role,
    });
    setLoading(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    if (result.already_existed) {
      // Compte existant : pas de lien d'activation à transmettre, le rattachement suffit.
      setSuccess(
        `Un compte existait déjà pour ${target} : il a été rattaché au club. Il peut se connecter avec son mot de passe habituel.`,
      );
      return;
    }
    if (!result.action_link) {
      setError('Le lien d’invitation n’a pas pu être récupéré.');
      return;
    }
    setActionLink(result.action_link);
  };

  const handleCopy = async () => {
    if (!actionLink) return;
    try {
      await navigator.clipboard.writeText(actionLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const busy = loading !== null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card/90 p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight text-card-foreground">
          Inviter un utilisateur
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          L’invité recevra un email pour choisir son mot de passe. Il sera rattaché à{' '}
          <span className="font-medium text-foreground">{club?.name ?? 'ce club'}</span> avec
          le rôle choisi.
        </p>

        <form onSubmit={handleSend} className="space-y-4">
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

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Rôle</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ClubRole)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60"
          >
            {loading === 'send' ? '...' : 'Envoyer l’invitation'}
          </button>

          <button
            type="button"
            onClick={handleGenerateLink}
            disabled={busy || !email.trim()}
            className="w-full rounded-lg border border-border bg-card py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-60"
          >
            {loading === 'generate-link' ? '...' : 'Générer un lien à copier (sans email)'}
          </button>

          {actionLink && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                Lien d’invitation — à transmettre à la personne par un autre canal.
              </p>
              <textarea
                readOnly
                value={actionLink}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-none break-all rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="w-full rounded-md bg-primary py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95"
              >
                {copied ? 'Copié ✓' : 'Copier le lien'}
              </button>
            </div>
          )}

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
