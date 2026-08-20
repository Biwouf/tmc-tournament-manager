// Multi-tenant — PR5-bis : gestion des membres d'un club par un admin de ce club.
// Spec : docs/specs/MULTI_TENANT.md §4.2.
//
// Absorbe l'ancienne page /admin/invite (le panneau d'invitation ci-dessous) : inviter
// quelqu'un et voir la liste se rafraîchir est le même geste.
//
// Tout passe par l'Edge Function `club-members` (service role) : l'email et le statut
// « invitation en attente » vivent dans `auth.users`, et `club_members` n'a aucune
// policy d'écriture. Le serveur est la barrière — les contrôles désactivés ci-dessous
// ne sont que du confort.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listClubMembers,
  removeClubMember,
  resendClubInvite,
  setClubMemberRole,
  type ClubMember,
} from '../lib/clubMembers';
import { invokeInvite } from '../lib/invite';
import { useClub } from '../contexts/ClubContext';
import type { ClubRole } from '../contexts/ClubRoleContext';
import { supabase } from '../lib/supabase';

// Le rôle définit ce que la personne VOIT dans le back-office. La RLS cloisonne par
// club, pas par rôle (MULTI_TENANT.md §4.1) : ne pas promettre plus que ça.
const ROLE_OPTIONS: { value: ClubRole; label: string }[] = [
  { value: 'member', label: 'Membre — Live Score uniquement' },
  { value: 'manager', label: 'Gestionnaire — contenus et outils du club' },
  { value: 'admin', label: 'Administrateur — tout, y compris les membres' },
];

const ROLE_SHORT: Record<ClubRole, string> = {
  admin: 'Administrateur',
  manager: 'Gestionnaire',
  member: 'Membre',
};

function fullName(member: ClubMember): string {
  const name = `${member.prenom} ${member.nom}`.trim();
  return name || '—';
}

export default function MembersPage() {
  const { clubId, club } = useClub();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [members, setMembers] = useState<ClubMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowSuccess, setRowSuccess] = useState<string | null>(null);
  const [resendLink, setResendLink] = useState<{ userId: string; link: string } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoadError(null);
    const result = await listClubMembers(clubId);
    if (!result.success) {
      setLoadError(result.error);
      setMembers([]);
      return;
    }
    setMembers(result.members);
  }, [clubId]);

  useEffect(() => {
    load();
  }, [load]);

  const adminCount = useMemo(
    () => (members ?? []).filter((m) => m.role === 'admin').length,
    [members],
  );

  const resetRowFeedback = () => {
    setRowError(null);
    setRowSuccess(null);
    setResendLink(null);
  };

  const handleRoleChange = async (member: ClubMember, role: ClubRole) => {
    if (role === member.role) return;
    resetRowFeedback();
    if (member.user_id === currentUserId && role !== 'admin') {
      const confirmed = window.confirm(
        `Vous allez passer votre propre compte en « ${ROLE_SHORT[role]} » sur ${club?.name ?? 'ce club'} : vous perdrez l’accès à cet écran.`,
      );
      if (!confirmed) return;
    }
    setBusyMember(member.user_id);
    const result = await setClubMemberRole(clubId!, member.user_id, role);
    setBusyMember(null);
    if (!result.success) {
      setRowError(result.error);
      return;
    }
    setRowSuccess(`${fullName(member) === '—' ? member.email : fullName(member)} est désormais ${ROLE_SHORT[role].toLowerCase()}.`);
    load();
  };

  const handleRemove = async (member: ClubMember) => {
    resetRowFeedback();
    const who = fullName(member) === '—' ? member.email : `${fullName(member)} (${member.email})`;
    const question =
      member.user_id === currentUserId
        ? `Vous retirer vous-même de ${club?.name ?? 'ce club'} ? Vous perdrez l’accès au back-office de ce club.`
        : `Retirer ${who} de ${club?.name ?? 'ce club'} ? Son accès au back-office est coupé immédiatement. Son compte n’est pas supprimé : une nouvelle invitation le rattachera.`;
    if (!window.confirm(question)) return;

    setBusyMember(member.user_id);
    const result = await removeClubMember(clubId!, member.user_id);
    setBusyMember(null);
    if (!result.success) {
      setRowError(result.error);
      return;
    }
    setRowSuccess(`${who} a été retiré du club.`);
    load();
  };

  const handleResend = async (member: ClubMember) => {
    resetRowFeedback();
    setBusyMember(member.user_id);
    const result = await resendClubInvite(
      clubId!,
      member.user_id,
      `${window.location.origin}/accept-invite`,
    );
    setBusyMember(null);
    if (!result.success) {
      setRowError(result.error);
      return;
    }
    if (result.email_sent) {
      setRowSuccess(`Un nouvel email d’invitation a été envoyé à ${result.email}.`);
      return;
    }
    // L'email n'est pas parti : on ne l'annonce pas. Il reste le lien à transmettre.
    setRowSuccess(
      `Aucun email n’a pu être envoyé à ${result.email} — voici un nouveau lien d’activation à lui transmettre.`,
    );
    if (result.action_link) setResendLink({ userId: member.user_id, link: result.action_link });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 bg-card/85 text-card-foreground shadow-sm backdrop-blur">
        <div className="container mx-auto flex items-start justify-between px-4 py-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Membres</h1>
            <p className="mt-2 text-muted-foreground">
              Les comptes ayant accès au back-office de{' '}
              <span className="font-medium text-foreground">{club?.name ?? 'ce club'}</span>. Le
              rôle définit ce que la personne voit dans le back-office.
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
        <InvitePanel clubName={club?.name ?? 'ce club'} clubId={clubId} onInvited={load} />

        <section>
          <h2 className="mb-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
            Membres du club
          </h2>

          {loadError && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {loadError}
            </div>
          )}
          {rowError && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {rowError}
            </div>
          )}
          {rowSuccess && (
            <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
              {rowSuccess}
            </div>
          )}

          {members === null ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun membre.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {members.map((m) => {
                const busy = busyMember === m.user_id;
                const lastAdmin = m.role === 'admin' && adminCount <= 1;
                return (
                  <div key={m.user_id} className="rounded-2xl border bg-card/90 p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-card-foreground">
                            {fullName(m)}
                          </h3>
                          {m.status === 'pending' && (
                            <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                              Invitation en attente
                            </span>
                          )}
                          {m.user_id === currentUserId && (
                            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                              Vous
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-sm text-muted-foreground">{m.email}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m, e.target.value as ClubRole)}
                          disabled={busy || lastAdmin}
                          title={
                            lastAdmin
                              ? 'Dernier administrateur du club : promouvez d’abord quelqu’un d’autre.'
                              : undefined
                          }
                          className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                        >
                          {ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>

                        {m.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleResend(m)}
                            disabled={busy}
                            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-60"
                          >
                            {busy ? '...' : 'Renvoyer l’invitation'}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleRemove(m)}
                          disabled={busy || lastAdmin}
                          title={
                            lastAdmin
                              ? 'Dernier administrateur du club : promouvez d’abord quelqu’un d’autre.'
                              : undefined
                          }
                          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
                        >
                          {busy ? '...' : 'Retirer'}
                        </button>
                      </div>
                    </div>

                    {resendLink?.userId === m.user_id && (
                      <CopyLink link={resendLink.link} />
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

// Panneau d'invitation — contenu de l'ancienne InvitePage. Les deux actions sont
// conservées : le lien à copier reste le chemin court quand le SMTP limite.
function InvitePanel({
  clubId,
  clubName,
  onInvited,
}: {
  clubId: string | null;
  clubName: string;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ClubRole>('member');
  const [loading, setLoading] = useState<null | 'send' | 'generate-link'>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<string | null>(null);

  const run = async (action: 'send' | 'generate-link') => {
    setError(null);
    setSuccess(null);
    setActionLink(null);
    setLoading(action);
    const target = email.trim();
    const result = await invokeInvite({
      email: target,
      redirectTo: `${window.location.origin}/accept-invite`,
      action,
      club_id: clubId,
      role,
    });
    setLoading(null);

    if (!result.success) {
      setError(result.error);
      return;
    }
    onInvited();
    if (result.already_existed) {
      setSuccess(
        `Un compte existait déjà pour ${target} : il a été rattaché à ${clubName} (aucun email envoyé). Il peut se connecter avec son mot de passe habituel.`,
      );
      setEmail('');
      return;
    }
    if (action === 'send') {
      setSuccess(`Invitation envoyée à ${target}.`);
      setEmail('');
      return;
    }
    if (!result.action_link) {
      setError('Le lien d’invitation n’a pas pu être récupéré.');
      return;
    }
    setActionLink(result.action_link);
  };

  const busy = loading !== null;

  return (
    <section>
      <h2 className="mb-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
        Inviter quelqu’un
      </h2>
      <div className="rounded-2xl border bg-card/90 p-6 shadow-sm">
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

        <p className="mb-4 text-sm text-muted-foreground">
          L’invité recevra un email pour choisir son mot de passe. Il sera rattaché à{' '}
          <span className="font-medium text-foreground">{clubName}</span> avec le rôle choisi.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemple.fr"
              autoComplete="email"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="min-w-[16rem] flex-1">
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

        {actionLink && <CopyLink link={actionLink} />}
      </div>
    </section>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mt-4 space-y-2 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">
        Lien d’activation — à transmettre à la personne par un autre canal.
      </p>
      <textarea
        readOnly
        value={link}
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
  );
}
