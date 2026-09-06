// Multi-tenant — PR8 : comptes sociaux du club (décision D10).
// Spec : docs/specs/MULTI_TENANT.md §6.3.
//
// Écran séparé de « Configuration du site » (/admin/site) à dessein : celui-là écrit dans
// le JSONB `club_settings.config`, destiné au rendu public, avec un enregistrement par
// groupe. Ici on manipule un SECRET, dans une autre table, avec d'autres règles — les
// mélanger reviendrait à faire passer un token de Page par le tuyau de la vitrine.
//
// Le token saisi part vers l'Edge Function et ne revient jamais : la colonne n'est pas
// lisible par `authenticated`. D'où l'absence de champ pré-rempli — on ne peut pas
// afficher ce qu'on ne lit pas, et c'est le but.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useClub } from '../contexts/ClubContext';
import {
  connectFacebookPage,
  disconnectFacebookPage,
  getFacebookCredential,
  type SocialCredential,
} from '../lib/socialCredentials';

function formatExpiry(iso: string | null): string {
  if (!iso) return 'Ce token n’a pas de date d’expiration connue.';
  const date = new Date(iso);
  const expired = date.getTime() < Date.now();
  const formatted = date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return expired
    ? `Ce token a expiré le ${formatted} — la publication échouera tant qu’il n’est pas remplacé.`
    : `Ce token expire le ${formatted}.`;
}

export default function SocialAccountsPage() {
  const { clubId, club } = useClub();

  const [credential, setCredential] = useState<SocialCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [token, setToken] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<null | 'connect' | 'disconnect'>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    setLoadError(null);
    try {
      setCredential(await getFacebookCredential(clubId));
    } catch (e) {
      setLoadError(
        'Chargement du compte Facebook impossible. ' +
          (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConnect = async () => {
    if (!clubId) return;
    setError(null);
    setSuccess(null);
    setBusy('connect');
    const result = await connectFacebookPage(clubId, token.trim());
    setBusy(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    // Le token quitte l'état dès qu'il est accepté : rien ne justifie de le garder en
    // mémoire dans l'onglet une fois qu'il est en base.
    setToken('');
    setShowForm(false);
    setSuccess(`Page « ${result.page_name || result.page_id} » connectée.`);
    void load();
  };

  const handleDisconnect = async () => {
    if (!clubId) return;
    if (
      !window.confirm(
        'Déconnecter la page Facebook ? La publication automatique des actus cessera de fonctionner pour ce club.',
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    setBusy('disconnect');
    const result = await disconnectFacebookPage(clubId);
    setBusy(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setSuccess('Page Facebook déconnectée.');
    void load();
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Comptes sociaux</h1>
            <p className="mt-2 text-muted-foreground">
              La page Facebook sur laquelle{' '}
              <span className="font-medium text-foreground">{club?.name ?? 'ce club'}</span>{' '}
              publie ses actualités.
            </p>
          </div>
          <Link
            to="/"
            className="mt-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            ← Accueil
          </Link>
        </div>
      </header>

      <main className="container mx-auto flex flex-col gap-9 px-4 py-12">
        <section>
          <h2 className="mb-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
            Facebook
          </h2>

          {loadError && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {loadError}
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
              {success}
            </div>
          )}

          <div className="rounded-2xl border bg-card/90 p-6 shadow-sm">
            {loading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : credential ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-card-foreground">
                        {credential.page_name || 'Page sans nom'}
                      </h3>
                      <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        Connectée
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      ID de page {credential.page_id}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatExpiry(credential.token_expires_at)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowForm((v) => !v)}
                      disabled={busy !== null}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-60"
                    >
                      {showForm ? 'Annuler' : 'Remplacer le token'}
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      disabled={busy !== null}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
                    >
                      {busy === 'disconnect' ? '...' : 'Déconnecter'}
                    </button>
                  </div>
                </div>

                {showForm && (
                  <div className="mt-6 border-t border-border/70 pt-6">
                    <TokenForm
                      token={token}
                      onChange={setToken}
                      onSubmit={handleConnect}
                      busy={busy === 'connect'}
                      submitLabel="Remplacer le token"
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-card-foreground">
                  Aucune page connectée
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Tant qu’aucune page n’est connectée, l’option « Publier aussi sur Facebook »
                  d’une actu échouera avec un message explicite.
                </p>
                <div className="mt-6">
                  <TokenForm
                    token={token}
                    onChange={setToken}
                    onSubmit={handleConnect}
                    busy={busy === 'connect'}
                    submitLabel="Connecter la page"
                  />
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function TokenForm({
  token,
  onChange,
  onSubmit,
  busy,
  submitLabel,
}: {
  token: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  submitLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm font-medium text-foreground" htmlFor="fb-token">
        Token d’accès de la Page
      </label>
      {/* Un textarea, pas un input password : le token fait plusieurs centaines de
          caractères et se colle. Le masquer n'apporterait rien — il vient du presse-papier
          et ne sera jamais réaffiché ensuite. */}
      <textarea
        id="fb-token"
        value={token}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder="EAAG…"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p className="text-xs text-muted-foreground">
        La page derrière ce token est identifiée automatiquement — il n’y a pas d’ID à
        saisir. Le token est vérifié auprès de Facebook avant d’être enregistré, et n’est
        plus jamais réaffiché ensuite.
      </p>
      <div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || token.trim().length === 0}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Vérification…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
