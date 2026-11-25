import { usePush } from '../../hooks/usePush';
import PushSwitchRow from '../PushSwitchRow';

// Ligne « Interviews » de la liste Notifications de Mon profil (active par défaut).
export default function InterviewPushSettings({ clubId, userId }: { clubId: string; userId: string }) {
  const { supported, prefs, busy, error, set } = usePush(clubId, userId);
  const enabled = Boolean(prefs?.interviews);
  return (
    <PushSwitchRow title="Interviews" description="Quand le club veut votre réaction après un match."
      checked={enabled} disabled={!supported || busy} onToggle={() => void set('interviews', !enabled)} error={error} />
  );
}
