import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { usePush } from '../../hooks/usePush';
import { useLiveFollows } from '../../hooks/useLiveFollows';
import { setLiveFollow } from '../../lib/liveFollows';
import PushSwitchRow from '../PushSwitchRow';

const LIVE_TEXT = 'Soyez prévenu quand un match du club commence.';

// Ligne « Live » de la liste Notifications de Mon profil.
export function LivePushSettings({ clubId, userId }: { clubId: string; userId: string }) {
  const { supported, prefs, busy, error, set } = usePush(clubId, userId);
  const enabled = Boolean(prefs?.live);
  return (
    <PushSwitchRow title="Live" description="Début des matchs du club."
      checked={enabled} disabled={!supported || busy} onToggle={() => void set('live', !enabled)} error={error} />
  );
}

function laterKey(userId: string | null) {
  return `live-push-prompt:${userId ?? 'visitor'}`;
}
function askedLater(userId: string | null): boolean {
  try { return localStorage.getItem(laterKey(userId)) === '1'; } catch { return false; }
}
function rememberLater(userId: string | null) {
  try { localStorage.setItem(laterKey(userId), '1'); } catch { /* best effort */ }
}

const bannerClass = 'rounded-xl border border-border bg-card p-4 text-sm flex flex-col gap-3';
const primaryClass = 'min-h-11 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50';
const secondaryClass = 'min-h-11 rounded-lg border border-border px-4 font-medium text-foreground disabled:opacity-50';

function MemberBanner({ clubId, userId }: { clubId: string; userId: string }) {
  const { supported, prefs, busy, ready, error, set } = usePush(clubId, userId);
  const [hidden, setHidden] = useState(() => askedLater(userId)
    || (typeof Notification !== 'undefined' && Notification.permission === 'denied'));
  const [done, setDone] = useState(false);
  if (!supported || hidden || !ready || (prefs?.live && !done)) return null;
  if (done) {
    return (
      <div className={bannerClass} role="status">
        <p>Alertes Live activées. Vous pouvez les gérer depuis votre profil.</p>
        <button type="button" className={secondaryClass} onClick={() => setHidden(true)}>Fermer</button>
      </div>
    );
  }
  return (
    <div className={bannerClass}>
      <p><strong className="block text-foreground">Être prévenu des matchs en direct ?</strong>{LIVE_TEXT}</p>
      <div className="flex gap-2">
        <button type="button" className={secondaryClass} disabled={busy}
          onClick={() => { rememberLater(userId); setHidden(true); }}>Plus tard</button>
        {/* Called directly from the click: iOS only grants permission inside a user gesture. */}
        <button type="button" className={primaryClass} disabled={busy}
          onClick={() => void set('live', true).then((ok) => { if (ok) setDone(true); })}>
          {busy ? 'En cours…' : 'Activer'}
        </button>
      </div>
      {error && <p className="text-red-600" role="alert">{error}</p>}
    </div>
  );
}

// Bandeau de l'accueil des live : activation pour un membre, connexion pour un visiteur.
export function LivePushBanner({ clubId, userId, isMember }: {
  clubId: string | null;
  userId: string | null;
  isMember: boolean;
}) {
  const [hidden, setHidden] = useState(() => !userId && askedLater(null));
  if (!clubId) return null;
  if (userId) return isMember ? <MemberBanner clubId={clubId} userId={userId} /> : null;
  if (hidden) return null;
  return (
    <div className={bannerClass}>
      <p><strong className="block text-foreground">Être prévenu des matchs en direct ?</strong>
        Connectez-vous pour recevoir une alerte quand un match commence et suivre le score de vos matchs.</p>
      <div className="flex gap-2">
        <button type="button" className={secondaryClass}
          onClick={() => { rememberLater(null); setHidden(true); }}>Plus tard</button>
        <Link to="/login" state={{ from: '/matches' }} className={`${primaryClass} flex items-center`}>Se connecter</Link>
      </div>
    </div>
  );
}

function Bell({ on, size = 'h-4 w-4' }: { on: boolean; size?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={size} aria-hidden="true">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

// Cloche « Alertes » d'un match : fins de set, fin du match et publications du fil.
// iconOnly : cloche seule, la zone tactile reste de 44 px. onChange : après un changement réussi.
export function LiveFollowButton({ clubId, userId, matchId, className = '', iconOnly = false, onChange }: {
  clubId: string;
  userId: string;
  matchId: string;
  className?: string;
  iconOnly?: boolean;
  onChange?: (following: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const push = usePush(clubId, userId);
  const follows = useLiveFollows(clubId, userId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!push.supported) return null;
  const on = !!follows.data?.includes(matchId);
  const busy = saving || push.busy || follows.isPending;
  const label = on ? 'Alertes activées' : 'Alertes';
  async function toggle() {
    setSaving(true);
    setError('');
    try {
      // Subscribes the device first; the permission prompt must stay in the click.
      if (!on && !await push.ensure()) return;
      const next = await setLiveFollow(clubId, matchId, !on);
      queryClient.setQueryData<string[]>(['live-follows', clubId, userId], (ids = []) =>
        next ? [...new Set([...ids, matchId])] : ids.filter((id) => id !== matchId));
      onChange?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de modifier les alertes.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <span className={`relative z-10 inline-flex flex-col items-end ${className}`}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={on ? 'Ne plus recevoir les alertes de ce match' : 'Recevoir les alertes de ce match'}
        disabled={busy}
        onClick={() => void toggle()}
        title={iconOnly ? label : undefined}
        className={iconOnly
          ? `inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg disabled:opacity-50 ${on ? 'text-primary' : 'text-muted-foreground'}`
          : `inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50 ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
      >
        <Bell on={on} size={iconOnly ? 'h-5 w-5' : undefined} />
        {!iconOnly && label}
      </button>
      {(error || push.error) && <span role="alert" className="mt-1 text-xs text-red-600">{error || push.error}</span>}
    </span>
  );
}
