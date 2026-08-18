// Multi-tenant — PR5 : console super-admin (provisioning des clubs).
// Spec : docs/specs/MULTI_TENANT.md §5 (D4, D9).
//
// Surface PLATEFORME, pas module club : la route est gardée par `isSuperAdmin` seul
// (App.tsx), pas par le rôle de club — le super-admin n'est pas un rôle de club.
//
// Les écritures passent par des policies RLS super-admin (2026081802), pas par une Edge
// Function : créer ou suspendre un club ne manipule aucun secret. Seule l'invitation garde
// son Edge Function, qui a besoin du service role pour créer le compte auth (PR4).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { invokeInvite } from '../lib/invite';
import { useClub, enterSupportClub } from '../contexts/ClubContext';

type ClubRow = {
  id: string;
  slug: string;
  name: string;
  sport: string;
  status: string;
  created_at: string;
};

type MemberStat = { total: number; admins: number };

// Mêmes règles que le CHECK `clubs_slug_format` (migration 2026081802) : le slug est une
// adresse DNS (D9). Le CHECK SQL est le filet, ces messages sont l'UX.
const RESERVED_SLUGS = ['admin', 'app', 'www', 'api', 'mail', 'static', 'assets', 'feelike'];

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents décomposés par NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

function validateSlug(slug: string): string | null {
  if (slug.length < 2 || slug.length > 32) {
    return 'Le slug doit faire entre 2 et 32 caractères.';
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return 'Minuscules, chiffres et tirets uniquement, sans tiret au début ni à la fin.';
  }
  if (slug.startsWith('app-')) {
    return 'Le préfixe « app- » est réservé à la PWA (app-<slug>.feelike.app).';
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return 'Ce slug est réservé par la plateforme.';
  }
  return null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function SuperAdminPage() {
  const { clubId: currentClubId } = useClub();

  const [clubs, setClubs] = useState<ClubRow[] | null>(null);
  const [stats, setStats] = useState<Record<string, MemberStat>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [sport, setSport] = useState('tennis');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const [busyClub, setBusyClub] = useState<string | null>(null);
  const [inviteFor, setInviteFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const [{ data: clubRows, error: clubErr }, { data: memberRows, error: memberErr }] =
      await Promise.all([
        supabase
          .from('clubs')
          .select('id, slug, name, sport, status, created_at')
          .order('created_at', { ascending: false }),
        // Lisible grâce à `club_members_select_super_admin` (2026081802). Sans cette
        // policy on ne verrait que ses propres appartenances.
        supabase.from('club_members').select('club_id, role'),
      ]);

    if (clubErr) {
      setLoadError(`Chargement des clubs impossible : ${clubErr.message}`);
      return;
    }
    setClubs((clubRows ?? []) as ClubRow[]);

    if (memberErr) {
      setLoadError(`Effectifs indisponibles : ${memberErr.message}`);
      return;
    }
    const next: Record<string, MemberStat> = {};
    for (const row of (memberRows ?? []) as { club_id: string; role: string }[]) {
      const stat = next[row.club_id] ?? { total: 0, admins: 0 };
      stat.total += 1;
      if (row.role === 'admin') stat.admins += 1;
      next[row.club_id] = stat;
    }
    setStats(next);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const slugError = useMemo(() => (slug ? validateSlug(slug) : null), [slug]);

  const handleName = (value: string) => {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);

    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    const invalid = validateSlug(trimmedSlug);
    if (invalid) {
      setCreateError(invalid);
      return;
    }

    setCreating(true);
    // La ligne club_settings est créée par le trigger `clubs_create_settings` : un seul
    // insert ici, pas deux (un échec entre les deux laisserait un club à moitié provisionné).
    const { error } = await supabase
      .from('clubs')
      .insert({ name: trimmedName, slug: trimmedSlug, sport: sport.trim() || 'tennis' });
    setCreating(false);

    if (error) {
      setCreateError(
        error.code === '23505'
          ? `Le slug « ${trimmedSlug} » est déjà pris.`
          : `Création impossible : ${error.message}`,
      );
      return;
    }

    setCreateSuccess(`Club « ${trimmedName} » créé. Invitez son premier administrateur.`);
    setName('');
    setSlug('');
    setSlugEdited(false);
    setSport('tennis');
    load();
  };

  const handleToggleStatus = async (club: ClubRow) => {
    const suspending = club.status === 'active';
    // Le ClubContext filtre `status = 'active'` : suspendre le club dans lequel on se
    // trouve reviendrait à se claquemurer dehors du BO qu'on est en train d'utiliser.
    if (suspending && club.id === currentClubId) {
      window.alert(
        `Impossible de suspendre « ${club.name} » : c'est le club dans lequel vous êtes actuellement. Quittez-le d'abord (bandeau de support, ou autre adresse).`,
      );
      return;
    }
    const question = suspending
      ? `Suspendre « ${club.name} » ? Ses membres perdront l'accès au back-office et à la PWA.`
      : `Réactiver « ${club.name} » ?`;
    if (!window.confirm(question)) return;

    setBusyClub(club.id);
    const { error } = await supabase
      .from('clubs')
      .update({ status: suspending ? 'suspended' : 'active' })
      .eq('id', club.id);
    setBusyClub(null);
    if (error) {
      window.alert(`Changement de statut impossible : ${error.message}`);
      return;
    }
    load();
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Console plateforme</h1>
            <p className="mt-2 text-muted-foreground">
              Provisionner et administrer les clubs de feelike.
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
            Créer un club
          </h2>
          <form
            onSubmit={handleCreate}
            className="rounded-2xl border bg-card/90 p-6 shadow-sm"
          >
            {createError && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {createError}
              </div>
            )}
            {createSuccess && (
              <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                {createSuccess}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Nom</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleName(e.target.value)}
                  placeholder="Tennis Club de …"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Slug (sous-domaine)
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlug(e.target.value);
                  }}
                  placeholder="mon-club"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  required
                />
                <p
                  className={`mt-1.5 text-xs ${slugError ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {slugError ?? `${slug || 'mon-club'}.feelike.app`}
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Sport</label>
                <input
                  type="text"
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={creating || !name.trim() || !slug.trim() || slugError !== null}
              className="mt-5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60"
            >
              {creating ? '...' : 'Créer le club'}
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
            Clubs de la plateforme
          </h2>

          {loadError && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {loadError}
            </div>
          )}

          {clubs === null ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : clubs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun club.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {clubs.map((c) => {
                const stat = stats[c.id] ?? { total: 0, admins: 0 };
                const suspended = c.status !== 'active';
                return (
                  <div key={c.id} className="rounded-2xl border bg-card/90 p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-semibold text-card-foreground">{c.name}</h3>
                          {suspended && (
                            <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
                              Suspendu
                            </span>
                          )}
                          {c.id === currentClubId && (
                            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                              Club courant
                            </span>
                          )}
                          {stat.admins === 0 && (
                            <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                              Aucun admin
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {c.slug}.feelike.app · {c.sport} · créé le {formatDate(c.created_at)} ·{' '}
                          {stat.total} membre{stat.total > 1 ? 's' : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setInviteFor(inviteFor === c.id ? null : c.id)}
                          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
                        >
                          Inviter un admin
                        </button>
                        <button
                          type="button"
                          onClick={() => enterSupportClub(c.id)}
                          disabled={c.id === currentClubId}
                          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-50"
                        >
                          Entrer dans ce club
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(c)}
                          disabled={busyClub === c.id}
                          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-60"
                        >
                          {busyClub === c.id ? '...' : suspended ? 'Réactiver' : 'Suspendre'}
                        </button>
                      </div>
                    </div>

                    {inviteFor === c.id && (
                      <InviteAdminPanel
                        clubId={c.id}
                        clubName={c.name}
                        onInvited={load}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// Invitation du premier admin d'un club. Réutilise `invite-user` telle quelle : la
// function autorise déjà un super-admin sur n'importe quel club_id et upsert la ligne
// `club_members` à l'émission (PR4). Les deux actions de InvitePage sont conservées — au
// provisioning, le lien copié est souvent le chemin le plus court.
function InviteAdminPanel({
  clubId,
  clubName,
  onInvited,
}: {
  clubId: string;
  clubName: string;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState<null | 'send' | 'generate-link'>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (action: 'send' | 'generate-link') => {
    setError(null);
    setSuccess(null);
    setActionLink(null);
    setCopied(false);
    setLoading(action);
    const target = email.trim();
    const result = await invokeInvite({
      email: target,
      // Avant le wildcard (PR13) tout vit sur une seule origine : correct en l'état,
      // à revoir au passage à `*.feelike.app`.
      redirectTo: `${window.location.origin}/accept-invite`,
      action,
      club_id: clubId,
      role: 'admin',
    });
    setLoading(null);

    if (!result.success) {
      setError(result.error);
      return;
    }
    onInvited();
    if (result.already_existed) {
      setSuccess(
        `Un compte existait déjà pour ${target} : il est administrateur de ${clubName} (aucun email envoyé).`,
      );
      return;
    }
    if (action === 'send') {
      setSuccess(`Invitation envoyée à ${target} — administrateur de ${clubName}.`);
      setEmail('');
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
    <div className="mt-5 space-y-3 rounded-xl border border-border bg-muted/40 p-4">
      <p className="text-sm font-medium text-foreground">
        Inviter un administrateur de {clubName}
      </p>

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

      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@exemple.fr"
          autoComplete="email"
          className="min-w-[16rem] flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={() => run('send')}
          disabled={busy || !email.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60"
        >
          {loading === 'send' ? '...' : 'Envoyer l’invitation'}
        </button>
        <button
          type="button"
          onClick={() => run('generate-link')}
          disabled={busy || !email.trim()}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-60"
        >
          {loading === 'generate-link' ? '...' : 'Générer un lien à copier'}
        </button>
      </div>

      {actionLink && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <p className="text-xs text-muted-foreground">
            Lien d’invitation — à transmettre par un autre canal.
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
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95"
          >
            {copied ? 'Copié ✓' : 'Copier le lien'}
          </button>
        </div>
      )}
    </div>
  );
}
