import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_COPY as T, SEX_LABEL, captainTeamLabel, dayMonth, rankLabel } from '../../../shared/accountCopy.mjs';
import { useClub } from '../contexts/ClubContext';
import { courseContextKey, useCourseContext } from '../hooks/useCourses';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { coursePushSupported, disableCoursePush } from '../lib/coursePush';
import { accountError, alreadySaved, authMessage, changePassword, isConflict, saveProfile, sendPasswordReset, sessionPerson, type ProfileFields } from '../lib/account';
import type { CourseContext, Profile, Sex } from '../lib/courses';
import { returnPath } from '../components/layout/headerConfig';
import Avatar from '../components/Avatar';
import AccountToast, { type Toast } from '../components/account/AccountToast';
import { leaveAfterSignOut } from '../lib/signOutTarget';
import { NameSexSheet, PasswordSheet, RankSheet } from '../components/account/AccountSheets';
import CoursePushSettings from '../components/courses/CoursePushSettings';
import { LivePushSettings } from '../components/live/LivePush';
import NewsPushSettings from '../components/actu/NewsPushSettings';

type Sheet = 'name' | 'rank' | 'password' | null;

const cardClass = 'overflow-hidden rounded-2xl bg-card';
const sectionTitleClass = 'mb-2 mt-6 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground';

function Chevron() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>;
}

function Icon({ d, className = 'h-5 w-5' }: { d: string; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}
const ICONS = {
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 2 9 6 9-6',
  key: 'M11.5 12.5 20 4m-3 3 2.5 2.5M8 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  logout: 'M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M4 12h11M8 8l-4 4 4 4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4.5V12l3 2',
  check: 'm5 12.5 4.5 4.5L19 7.5',
};

/** Ligne « libellé + valeur + chevron » ; sans `onClick`, simple lecture. Le pourquoi (`hint`) reste hors du nom du bouton. */
function Row({ label, hint, value, icon, onClick }: { label: string; hint?: string; value?: string; icon?: string; onClick?: () => void }) {
  const hintId = useId();
  const body = <>
    {icon && <Icon d={icon} />}
    <span className="min-w-0 flex-1">
      <span className="block text-base font-semibold text-foreground">{label}</span>
      {hint && <span id={hintId} className="block text-[13px] text-muted-foreground">{hint}</span>}
    </span>
    {value && <span className="min-w-0 max-w-[55%] truncate text-right text-base text-muted-foreground">{value}</span>}
    {onClick && <Chevron />}
  </>;
  const className = 'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left';
  return <li className="border-b border-border last:border-b-0">
    {onClick
      ? <button type="button" onClick={onClick} aria-label={value ? `${label}, ${value}` : label} aria-describedby={hint ? hintId : undefined}
          className={`${className} active:bg-muted`}>{body}</button>
      : <div className={className}>{body}</div>}
  </li>;
}

function Pill({ tone, icon, children }: { tone: 'member' | 'pending' | 'neutral'; icon?: string; children: ReactNode }) {
  const tones = { member: 'bg-[#E0ECDF] text-[#2D5A2B]', pending: 'bg-[#F5EBD3] text-[#6B4A0E]', neutral: 'bg-muted text-foreground' };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]}`}>
    {icon && <Icon d={icon} className="h-4 w-4" />}{children}
  </span>;
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
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const returnTo = returnPath(params.get('returnTo')) ?? '/actu';
  const clubName = club?.name ?? '';
  const data = context.data;
  const profile = data?.profile ?? null;
  const person = user && sessionPerson(user, profile, !context.isPending);
  const fullName = person && person.prenom !== user?.email ? `${person.prenom ?? ''} ${person.nom ?? ''}`.trim() : '';
  const complete = !!(profile?.prenom && profile.nom && profile.sex);
  // Un seul enregistrement à la fois : un second partirait avec une révision périmée.
  const saving = useRef(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['courses'] });
  const contextKey = courseContextKey(clubId, user?.id);
  const patchProfile = (patch: Partial<Profile>) => queryClient.setQueryData<CourseContext>(contextKey, old =>
    old?.profile ? { ...old, profile: { ...old.profile, ...patch } } : old);

  async function reloadProfile() {
    const result = await context.refetch();
    return result.data?.profile ?? null;
  }

  /** Enregistre ; un conflit avec notre propre essai abandonné (délai dépassé) n'en est pas un. */
  async function save(fields: ProfileFields, revision: number) {
    try {
      return await saveProfile(fields, revision);
    } catch (error) {
      if (!isConflict(error)) throw error;
      const fresh = await reloadProfile();
      if (!alreadySaved(fields, fresh)) throw error;
      return fresh.revision;
    }
  }

  function open(next: Sheet) {
    if (!saving.current) setSheet(next);
  }

  async function saveNameSex(fields: { prenom: string; nom: string; sex: Sex }, revision: number) {
    try {
      await save(fields, revision);
      await refresh();
      setToast({ text: T.saved });
      return null;
    } catch (error) {
      return accountError(error);
    }
  }

  /** Classement : la ligne change tout de suite, et revient en arrière si l'enregistrement échoue. */
  async function writeRank(rank: string | null, from: Profile, done: (revision: number) => Toast) {
    if (saving.current || !from.prenom || !from.nom || !from.sex) return;
    saving.current = true;
    setToast(null);
    try {
      await queryClient.cancelQueries({ queryKey: contextKey });
      patchProfile({ classement: rank });
      const revision = await save({ prenom: from.prenom, nom: from.nom, sex: from.sex, classement: rank }, from.revision);
      patchProfile({ classement: rank, revision });
      setToast(done(revision));
    } catch (error) {
      patchProfile({ classement: from.classement });
      setToast({ text: accountError(error) });
    } finally {
      saving.current = false;
      void refresh();
    }
  }

  function pickRank(rank: string | null) {
    setSheet(null);
    if (!profile) return;
    const previous = profile;
    void writeRank(rank, previous, revision => ({
      text: T.rankSaved(rankLabel(rank)),
      undo: () => void writeRank(previous.classement, { ...previous, classement: rank, revision }, () => ({ text: T.saved })),
    }));
  }

  async function savePassword(current: string, next: string, others: boolean) {
    const result = await changePassword(user?.email ?? '', current, next, others);
    if (result.ok) setToast({ text: result.message });
    return result;
  }

  /** Déconnexion ; la page n'est quittée qu'en cas de succès (RequireUser redirige vers `target`, sinon /login). */
  async function signOut(target: string | null): Promise<string | null> {
    try {
      if (clubId) await disableCoursePush(clubId);
      leaveAfterSignOut(target);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return null;
    } catch (error) {
      leaveAfterSignOut(null);
      return authMessage(error, T.logoutFailed);
    }
  }

  async function logout() {
    setLoggingOut(true);
    setLogoutError('');
    const failure = await signOut(returnTo);
    if (!failure) return;
    setLogoutError(failure);
    setLoggingOut(false);
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-4">
      <h1 className="sr-only">{T.title}</h1>
      <section className={`${cardClass} flex flex-col items-center gap-2 px-4 py-6 text-center`}>
        {user && <Avatar person={person} size={96} />}
        {fullName && <p className="mt-2 text-[22px] font-bold leading-tight text-foreground">{fullName}</p>}
        {user?.email && <p className="break-all text-base text-muted-foreground">{user.email}</p>}
        {data && clubName && (
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            {data.is_member && <Pill tone="member" icon={ICONS.check}>{T.memberPill(clubName)}</Pill>}
            {!data.is_member && data.signup_status === 'pending' && <Pill tone="pending" icon={ICONS.clock}>{T.pendingPill(clubName)}</Pill>}
            {(data.captain_teams ?? []).map(team => (
              <Pill key={`${team.genre}-${team.categorie}-${team.numero}`} tone="neutral">{T.captainPill(captainTeamLabel(team))}</Pill>
            ))}
          </div>
        )}
      </section>

      {context.isError && !data ? (
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
            <Row label={T.nameRow} value={fullName || T.toComplete} onClick={() => open('name')} />
            <Row label={T.sexRow} hint={T.sexRowHint} value={profile?.sex ? SEX_LABEL[profile.sex] : T.toComplete} onClick={() => open('name')} />
            <Row label={T.rankRow} value={rankLabel(profile?.classement)} onClick={() => open(complete ? 'rank' : 'name')} />
          </ul>
          <p className="mt-2 px-1 text-sm text-muted-foreground">{T.allClubsNote}</p>

          <h2 className={sectionTitleClass}>{T.notificationsSection}</h2>
          {!data.is_member ? (
            <ul className={cardClass}><Row label={data.signup_status === 'pending' ? T.notificationsLater : T.notificationsMembersOnly} hint={T.notificationsLaterHint} /></ul>
          ) : !coursePushSupported() ? (
            <p className={`${cardClass} px-4 py-3 text-sm text-muted-foreground`}>{T.pushUnavailable}</p>
          ) : user && clubId && (
            <ul className={`${cardClass} divide-y divide-border`}>
              <CoursePushSettings clubId={clubId} userId={user.id} />
              <LivePushSettings clubId={clubId} userId={user.id} />
              <NewsPushSettings clubId={clubId} userId={user.id} />
            </ul>
          )}
        </>
      )}

      {/* Connexion et déconnexion : toujours là, y compris pendant le chargement ou après une erreur. */}
      <h2 className={sectionTitleClass}>{T.loginSection}</h2>
      <ul className={cardClass}>
        <Row icon={ICONS.mail} label={T.emailRow} value={user?.email ?? ''} />
        <Row icon={ICONS.key} label={T.passwordRow} value={T.edit} onClick={() => setSheet('password')} />
      </ul>

      {logoutError && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{logoutError}</p>}
      <div className={`${cardClass} mt-6`}>
        <button type="button" disabled={loggingOut} onClick={() => void logout()}
          className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-base font-semibold text-primary disabled:opacity-60">
          <Icon d={ICONS.logout} />
          {loggingOut ? T.loggingOut : T.logout}
        </button>
      </div>

      <AccountToast toast={toast} onClose={closeToast} />

      {sheet === 'name' && <NameSexSheet profile={profile} onSave={saveNameSex} onReload={reloadProfile} onClose={() => setSheet(null)} />}
      {sheet === 'rank' && <RankSheet current={profile?.classement ?? null} onPick={pickRank} onClose={() => setSheet(null)} />}
      {sheet === 'password' && <PasswordSheet email={user?.email ?? ''} onSave={savePassword} onForgot={() => sendPasswordReset(user?.email ?? '', club?.slug)}
        onReauth={() => signOut(null)} onClose={() => setSheet(null)} />}
    </div>
  );
}
