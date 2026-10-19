import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listenLiveTopic, type LiveMessage } from '../lib/liveChannel';

export { LIVE_SAFETY_POLL } from '../lib/liveChannel';

/**
 * Écoute un topic Broadcast du live. `onMessage` reçoit aussi `{ event: 'subscribed' }` à chaque
 * réabonnement après une coupure, pour rattraper ce qui a pu être manqué (pas au premier : la
 * lecture initiale de l'écran suffit).
 * Renvoie `true` tant que le canal est abonné : le polling ne sert alors que de filet.
 */
export function useLiveTopic(topic: string | null, onMessage: (message: LiveMessage) => void) {
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => {
    if (!topic) return;
    let joined = false;
    const stop = listenLiveTopic(supabase, topic, {
      onMessage: (message) => handler.current(message),
      onStatus: (ok) => {
        setSubscribed(ok);
        if (ok && joined) handler.current({ event: 'subscribed', payload: {} });
        joined ||= ok;
      },
    });
    return () => {
      stop();
      setSubscribed(false);
    };
  }, [topic]);
  return subscribed;
}
