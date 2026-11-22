import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_COPY as T, SEX_LABEL, captainTeamLabel, dayMonth } from '../../../shared/accountCopy.mjs';
import { useClub } from '../contexts/ClubContext';
import { useCourseContext } from '../hooks/useCourses';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { coursePushSupported, disableCoursePush } from '../lib/coursePush';
import { accountError, changePassword, saveProfile } from '../lib/account';
import type { CourseContext, Profile, Sex } from '../lib/courses';
import { returnPath } from '../components/layout/headerConfig';
import Avatar from '../components/Avatar';
import { NameSexSheet, PasswordSheet, RankSheet } from '../components/account/AccountSheets';
import CoursePushSettings from '../components/courses/CoursePushSettings';
import { LivePushSettings } from '../components/live/LivePush';
import NewsPushSettings from '../components/actu/NewsPushSettings';
import { uiMessage } from '../lib/uiMessage';

type Toast = { text: string; undo?: () => void };
type Sheet = 'name' | 'rank' | 'password' | null;

const cardClass = 'overflow-hidden rounded-2xl bg-card';
const sectionTitleClass = 'mb-2 mt-6 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground';

function Chevron() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>;
}

/** Ligne « libellé + valeur + chevron » ; sans `onClick`, simple lecture. */
function Row({ label, hint, value, onClick }: { label: string; hint?: string; value?: string; onClick?: () => void }) {
  const body = <>
    <span className="min-w-0 flex-1">
      <span className="block text-base font-semibold text-foreground">{label}</span>
      {hint && <span className="block text-[13px] text-muted-foreground">{hint}</span>}
    </span>
    {value && <span className="min-w-0 max-w-[55%] truncate text-right text-base text-muted-foreground">{value}</span>}
    {onClick && <Chevron />}
  </>;
  const className = 'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left';
  return <li className="border-b border-border last:border-b-0">
    {onClick ? <button type="button" onClick={onClick} className={`${className} active:bg-muted`}>{body}</button> : <div className={className}>{body}</div>}
  </li>;
}

function Pill({ tone, children }: { tone: 'member' | 'pending' | 'neutral'; children: ReactNode }) {
  const tones = { member: 'bg-[#E0ECDF] text-[#2D5A2B]', pending: 'bg-[#F5EBD3] text-[#6B4A0E]', neutral: 'bg-muted text-foreground' };
  return <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]}`}>{children}</span>;
}

/** Nom affiché : profil s'il est chargé, sinon métadonnées de l'inscription (session). */
function displayName(profile: Profile | null | undefined, meta: Record<string, unknown> | undefined) {
  const signup = (meta?.club_signup ?? {}) as { prenom?: string; nom?: string };
  const prenom = profile?.prenom || signup.prenom || '';
  const nom = profile?.nom || signup.nom || '';
  return { prenom, nom, full: `${prenom} ${nom}`.trim() };
}

/** Demande en attente, refusée ou retirée : remplace le bandeau SignupNotice sur cette page. */
function StatusCard({ data, club, refreshing, onRefresh }: { data: CourseContext; club: string; refreshing: boolean; onRefresh: () => void }) {
  if (data.is_member || !data.signup_status) return null;
  const pending = data.signup_status === 'pending';
  return (
    <aside className={`mt-4 rounded-2xl border p-4 text-sm ${pending ? 'border-[#E8D3A6] bg-[#FBF2E1] text-[#4A3305]' : 'border-border bg-card text-foreground'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {pending && <p className="text-base font-bold">{T.pendingTitle}</p>}
          <p>{pending ? T.pendingCard(dayMonth(data.signup_requested_at ?? '')) : data.signup_status === 'denied' ? T.deniedCard : T.revokedCard(club)}</p>
        </div>
        <button type="button" disabled={refreshing} onClick={onRefresh}
          className="min-h-11 shrink-0 rounded-xl border border-border bg-card px-3 font-semibold text-foreground disabled:opacity-60">{T.refreshStatus}</button>
      </div>
    </aside>
  );
}

export default function ProfilePage() {
  const { clubId, club } = useClub();
  const context = useCourseContext();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const returnTo = returnPath(params.get('returnTo')) ?? '/actu';
  const clubName = club?.name ?? '';
  const data = context.data;
  const profile = data?.profile ?? null;
  const name = displayName(profile, user?.user_metadata);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['courses'] });

  async function saveNameSex(fields: { prenom: string; nom: string; sex: Sex }, revision: number) {
    try {
      await saveProfile(fields, revision);
      await refresh();
      setToast({ text: T.saved });
      return null;
    } catch (error) {
      return accountError(error);
    }
  }

  async function reloadProfile() {
    const result = await context.refetch();
    return result.data?.profile ?? null;
  }

  async function pickRank(rank: string | null) {
    setSheet(null);
    if (!profile?.prenom || !profile.nom || !profile.sex) return;
    const base = { prenom: profile.prenom, nom: profile.nom, sex: profile.sex };
    const previous = profile.classement;
    try {
      const revision = await saveProfile({ ...base, classement: rank }, profile.revision);
      await refresh();
      setToast({
        text: T.rankSaved(rank ?? T.unranked),
        undo: () => {
          setToast(null);
          void saveProfile({ ...base, classement: previous }, revision)
            .then(refresh)
            .then(() => setToast({ text: T.saved }))
            .catch(error => setToast({ text: accountError(error) }));
        },
      });
    } catch (error) {
      setToast({ text: accountError(error) });
      await refresh();
    }
  }

  async function savePassword(current: string, next: string) {
    const failure = await changePassword(user?.email ?? '', current, next);
    if (!failure) setToast({ text: T.passwordSaved });
    return failure;
  }

  async function logout() {
    setLoggingOut(true);
    setLogoutError('');
    try {
      if (clubId) await disableCoursePush(clubId);
      // Leave the protected page first, otherwise RequireUser redirects to /login.
      navigate(returnTo, { replace: true });
      await supabase.auth.signOut();
    } catch (error) {
      setLogoutError(uiMessage(error, T.logoutFailed));
      setLoggingOut(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-4">
      <h1 className="sr-only">{T.title}</h1>
      <section className={`${cardClass} flex flex-col items-center gap-2 px-4 py-6 text-center`}>
        {user && <Avatar person={{ id: user.id, prenom: name.prenom || user.email, nom: name.nom }} size={96} />}
        {name.full && <p className="mt-2 text-[22px] font-bold leading-tight text-foreground">{name.full}</p>}
        {user?.email && <p className="break-all text-base text-muted-foreground">{user.email}</p>}
        {data && clubName && (
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            {data.is_member && <Pill tone="member">✓ {T.memberPill(clubName)}</Pill>}
            {!data.is_member && data.signup_status === 'pending' && <Pill tone="pending">{T.pendingPill(clubName)}</Pill>}
            {(data.captain_teams ?? []).map(team => (
              <Pill key={`${team.genre}-${team.categorie}-${team.numero}`} tone="neutral">{T.captainPill(captainTeamLabel(team))}</Pill>
            ))}
          </div>
        )}
      </section>

      {context.isError ? (
        <div role="alert" className="mt-4 rounded-2xl border border-border bg-card p-4 text-base text-foreground">
          <p>{T.loadError}</p>
          <button type="button" disabled={context.isFetching} onClick={() => void context.refetch()}
            className="mt-3 min-h-11 rounded-xl bg-primary px-4 font-bold text-primary-foreground disabled:opacity-60">{T.retry}</button>
        </div>
      ) : !data ? (
        <div role="status" aria-label="Chargement du profil" className="mt-6 space-y-3">
          <div className="sk h-40 rounded-2xl" />
          <div className="sk h-24 rounded-2xl" />
        </div>
      ) : (
        <>
          <StatusCard data={data} club={clubName} refreshing={context.isFetching} onRefresh={() => void context.refetch()} />

          <h2 className={sectionTitleClass}>{T.playerSection}</h2>
          <ul className={cardClass}>
            <Row label={T.nameRow} value={name.full || T.toComplete} onClick={() => setSheet('name')} />
            <Row label={T.sexRow} hint={T.sexRowHint} value={profile?.sex ? SEX_LABEL[profile.sex] : T.toComplete} onClick={() => setSheet('name')} />
            <Row label={T.rankRow} value={profile?.classement ?? T.unranked} onClick={() => setSheet('rank')} />
          </ul>
          <p className="mt-2 px-1 text-sm text-muted-foreground">{T.allClubsNote}</p>

          <h2 className={sectionTitleClass}>{T.notificationsSection}</h2>
          {!data.is_member ? (
            <ul className={cardClass}><Row label={T.notificationsLater} hint={T.notificationsLaterHint} /></ul>
          ) : !coursePushSupported() ? (
            <p className={`${cardClass} px-4 py-3 text-sm text-muted-foreground`}>{T.pushUnavailable}</p>
          ) : user && clubId && (
            <ul className={`${cardClass} divide-y divide-border`}>
              <CoursePushSettings clubId={clubId} userId={user.id} />
              <LivePushSettings clubId={clubId} userId={user.id} />
              <NewsPushSettings clubId={clubId} userId={user.id} />
            </ul>
          )}

          <h2 className={sectionTitleClass}>{T.loginSection}</h2>
          <ul className={cardClass}>
            <Row label={T.emailRow} value={user?.email ?? ''} />
            <Row label={T.passwordRow} value={T.edit} onClick={() => setSheet('password')} />
          </ul>
        </>
      )}

      {/* Toujours atteignable, y compris pendant le chargement ou après une erreur. */}
      {logoutError && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{logoutError}</p>}
      <div className={`${cardClass} mt-6`}>
        <button type="button" disabled={loggingOut} onClick={() => void logout()}
          className="flex min-h-14 w-full items-center px-4 text-left text-base font-semibold text-primary disabled:opacity-60">
          {loggingOut ? T.loggingOut : T.logout}
        </button>
      </div>

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
        {toast && (
          <div className="pointer-events-auto flex min-h-12 max-w-md items-center gap-3 rounded-xl bg-foreground px-4 py-2 text-sm text-background shadow-lg">
            <span>{toast.text}</span>
            {toast.undo && <button type="button" onClick={toast.undo} className="min-h-11 font-bold underline">{T.undo}</button>}
          </div>
        )}
      </div>

      {sheet === 'name' && <NameSexSheet profile={profile} onSave={saveNameSex} onReload={reloadProfile} onClose={() => setSheet(null)} />}
      {sheet === 'rank' && <RankSheet current={profile?.classement ?? null} canSave={!!(profile?.prenom && profile.nom && profile.sex)}
        onPick={rank => void pickRank(rank)} onClose={() => setSheet(null)} />}
      {sheet === 'password' && <PasswordSheet onSave={savePassword} onClose={() => setSheet(null)} />}
    </div>
  );
}
