import { useCallback, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
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
import { uiMessage } from '../lib/uiMessage';
import { closePhoto, exportAvatar, isMinor, openPhoto, setBirthYear, type Crop, type OpenedPhoto } from '../lib/avatar';
import { useAvatarUrls } from '../hooks/useAvatarUrls';
import { useProfilePhoto } from '../hooks/useProfilePhoto';
import PhotoSheet from '../components/account/PhotoSheet';
import PhotoCrop from '../components/account/PhotoCrop';
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
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  alert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5v5m0 3h.01',
};

const nudgeKey = (userId: string) => `account-photo-nudge:${userId}`;
function nudgeHidden(userId: string | undefined) {
  try { return !!userId && localStorage.getItem(nudgeKey(userId)) === '1'; } catch { return false; }
}

/** Anneau de progression autour du rond de 96 px. */
function ProgressRing({ percent }: { percent: number }) {
  const length = 2 * Math.PI * 52;
  return (
    <svg aria-hidden="true" viewBox="0 0 108 108" className="pointer-events-none absolute -inset-1.5 -rotate-90">
      <circle cx="54" cy="54" r="52" fill="none" strokeWidth="3" className="stroke-muted" />
      <circle cx="54" cy="54" r="52" fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-primary transition-[stroke-dashoffset]"
        strokeDasharray={length} strokeDashoffset={length * (1 - percent / 100)} />
    </svg>
  );
}

/** Ligne « libellé + valeur + chevron » ; sans `onClick`, simple lecture. Le pourquoi (`hint`) reste hors du nom du bouton. */
function Row({ label, hint, value, icon, leading, onClick }: { label: string; hint?: string; value?: string; icon?: string; leading?: ReactNode; onClick?: (event: MouseEvent<HTMLButtonElement>) => void }) {
  const hintId = useId();
  const body = <>
    {icon && <Icon d={icon} />}
    {leading}
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
  // Photo : la feuille (ancrée à l'élément qui l'a ouverte), puis le recadrage.
  const [photoSheet, setPhotoSheet] = useState<HTMLElement | null | false>(false);
  const [opened, setOpened] = useState<OpenedPhoto | null>(null);
  const [nudgeOff, setNudgeOff] = useState(() => nudgeHidden(user?.id));
  const photo = useProfilePhoto({ userId: user?.id, clubId, profile, setToast });
  const minor = isMinor(profile?.birth_year);
  const avatarPath = minor ? null : profile?.avatar_path ?? null;
  const large = useAvatarUrls([avatarPath], 96);
  const small = useAvatarUrls([avatarPath], 32);
  const uploading = !!photo.upload && !photo.upload.failed;
  const srcFor = (urls: Map<string, string>) => photo.localUrl ?? (avatarPath ? urls.get(avatarPath) : undefined);

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

  function openPhotoSheet(event: MouseEvent<HTMLElement>) {
    if (profile && !uploading) setPhotoSheet(event.currentTarget);
  }

  async function saveBirthYear(year: number): Promise<string | null> {
    try {
      patchProfile({ birth_year: await setBirthYear(year) });
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('BIRTH_YEAR_LOCKED')) {
        await reloadProfile();
        return T.birthYearLocked;
      }
      return message.includes('VALIDATION_ERROR') ? T.birthYearInvalid : uiMessage(error, T.birthYearFailed);
    }
  }

  async function choosePhoto(file: File): Promise<string | null> {
    try {
      setOpened(await openPhoto(file));
      setPhotoSheet(false);
      return null;
    } catch (error) {
      // Seuls nos deux messages sont montrés, jamais une erreur technique du navigateur.
      return error instanceof Error && error.message === T.photoTooSmall ? T.photoTooSmall : T.photoUnreadable;
    }
  }

  function closeCrop() {
    if (opened) closePhoto(opened);
    setOpened(null);
  }

  async function applyCrop(crop: Crop): Promise<string | null> {
    if (!opened) return null;
    try {
      const files = await exportAvatar(opened, crop);
      closeCrop();
      photo.send(files);
      return null;
    } catch {
      return T.photoUnreadable;
    }
  }

  function removePhoto() {
    setPhotoSheet(false);
    void photo.remove();
  }

  function hideNudge() {
    setNudgeOff(true);
    try { if (user) localStorage.setItem(nudgeKey(user.id), '1'); } catch { /* best effort */ }
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
        {user && (profile ? (
          <button type="button" onClick={openPhotoSheet} disabled={uploading} aria-label={minor ? T.photoSheetTitle : T.photoChange}
            className="relative rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring">
            <Avatar person={person} size={96} src={srcFor(large)} />
            {uploading && photo.upload && <ProgressRing percent={photo.upload.percent} />}
            {!minor && !uploading && (
              <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background ring-4 ring-card">
                <Icon d={ICONS.camera} className="h-4 w-4" />
              </span>
            )}
          </button>
        ) : <Avatar person={person} size={96} />)}
        {fullName && <p className="mt-2 text-[22px] font-bold leading-tight text-foreground">{fullName}</p>}
        {uploading && photo.upload
          ? <p role="progressbar" aria-label={T.photoUploadLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={photo.upload.percent}
              className="text-base text-muted-foreground">{T.photoUploading(photo.upload.percent)}</p>
          : user?.email && <p className="break-all text-base text-muted-foreground">{user.email}</p>}
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
          {photo.upload?.failed && minor === false && (
            <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-card p-4 text-base text-foreground">
              <div className="flex items-start gap-3">
                <span className="text-red-700"><Icon d={ICONS.alert} /></span>
                <div className="min-w-0 flex-1">
                  <p>{photo.upload.previous ? T.photoFailed : T.photoFailedFirst}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={photo.retry} className="min-h-11 rounded-xl bg-primary px-4 font-bold text-primary-foreground">{T.retry}</button>
                    <button type="button" onClick={() => void photo.cancel()} className="min-h-11 rounded-xl border border-border bg-card px-4 font-semibold">{T.cancel}</button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <StatusCard data={data} club={clubName} refreshing={context.isFetching} onRefresh={() => void context.refetch()} />
          {/* Incitation (§5.6) : jamais à côté d'une carte d'état, ni pour un mineur. */}
          {profile && !profile.avatar_path && minor !== true && !photo.upload && !nudgeOff && (data.is_member || !data.signup_status) && (
            <aside className="relative mt-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 pr-3">
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-foreground">{T.photoNudgeTitle}</p>
                <p className="text-sm text-foreground/80">{T.photoNudgeText}</p>
              </div>
              <button type="button" onClick={openPhotoSheet} className="min-h-11 shrink-0 rounded-xl bg-primary px-4 font-bold text-primary-foreground">{T.add}</button>
              <button type="button" onClick={hideNudge} aria-label={T.photoNudgeHide}
                className="absolute -right-1 -top-1 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground">
                <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-card text-xs shadow">✕</span>
              </button>
            </aside>
          )}

          <h2 className={sectionTitleClass}>{T.playerSection}</h2>
          <ul className={cardClass}>
            {profile && <Row label={T.photoRow} hint={minor ? T.minorLater : T.photoRowHint}
              leading={<Avatar person={person} size={32} src={srcFor(small)} />}
              value={minor ? undefined : profile.avatar_path ? T.edit : T.add} onClick={minor ? undefined : openPhotoSheet} />}
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
      {photoSheet !== false && profile && (
        <PhotoSheet anchor={photoSheet} hasPhoto={!!profile.avatar_path} birthYear={profile.birth_year}
          onBirthYear={saveBirthYear} onFile={choosePhoto} onRemove={removePhoto} onClose={() => setPhotoSheet(false)} />
      )}
      {opened && <PhotoCrop photo={opened} onUse={applyCrop} onCancel={closeCrop} />}
      {sheet === 'password' && <PasswordSheet email={user?.email ?? ''} onSave={savePassword} onForgot={() => sendPasswordReset(user?.email ?? '', club?.slug)}
        onReauth={() => signOut(null)} onClose={() => setSheet(null)} />}
    </div>
  );
}
