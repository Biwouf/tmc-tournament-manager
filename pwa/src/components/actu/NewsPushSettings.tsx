import { usePush } from '../../hooks/usePush';
import PushSwitchRow from '../PushSwitchRow';

// Ligne « Actus et événements » de la liste Notifications de Mon profil.
export default function NewsPushSettings({ clubId, userId }: { clubId: string; userId: string }) {
  const { supported, prefs, busy, error, set } = usePush(clubId, userId);
  const enabled = Boolean(prefs?.news);
  return (
    <PushSwitchRow title="Actus et événements" description="Nouvelles actus et nouveaux événements du club."
      checked={enabled} disabled={!supported || busy} onToggle={() => void set('news', !enabled)} error={error} />
  );
}
