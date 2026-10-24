import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  coursePushSupported, disablePushCategory, enablePush, onPushPreferences, syncPush,
  type PushPreferences,
} from '../lib/coursePush';

export type PushCategory = keyof PushPreferences;

// Device push state for a member, shared by every control of the page (one synchronization).
// null preferences = this device is not subscribed for this account and club.
export function usePush(clubId: string, userId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supported = coursePushSupported();
  const query = useQuery({
    queryKey: ['push-prefs', clubId, userId],
    queryFn: () => syncPush(clubId, userId),
    enabled: supported,
    staleTime: Infinity,
    retry: false,
  });

  // A single binding per device: every account/club view follows the latest result.
  useEffect(() => onPushPreferences((prefs) => {
    queryClient.setQueriesData({ queryKey: ['push-prefs'] }, prefs);
  }), [queryClient]);

  // Must be called directly from a click: iOS only grants permission inside a user gesture.
  async function run(operation: () => Promise<PushPreferences | null>): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      queryClient.setQueryData(['push-prefs', clubId, userId], await operation());
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de modifier les notifications.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const prefs = query.data ?? null;
  return {
    supported,
    prefs,
    busy: busy || query.isPending && supported,
    ready: query.isSuccess || query.isError,
    error: error || (query.isError ? 'Impossible de synchroniser les notifications. Réessayez.' : ''),
    // Turns a category on or off for this device.
    set: (category: PushCategory, on: boolean) => run(() => on
      ? enablePush(clubId, userId, { [category]: true })
      : disablePushCategory(clubId, userId, { [category]: false })),
    // Subscribes this device without changing its preferences (followed matches).
    ensure: () => prefs ? Promise.resolve(true) : run(() => enablePush(clubId, userId, {})),
  };
}
