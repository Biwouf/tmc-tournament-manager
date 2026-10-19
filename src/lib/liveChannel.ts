import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/**
 * Canaux Broadcast du live (publiés en base par 2026101820_live_broadcast.sql) :
 *   live:match:<id>  'score' { row } · 'post' { id, sequence, op }
 *   live:club:<id>   'live' { id, op, status, team_rencontre_id } · 'team' { rencontre_id }
 * Copie PWA : pwa/src/lib/liveChannel.ts — à synchroniser.
 */
export const matchTopic = (matchId: string) => `live:match:${matchId}`;
export const clubTopic = (clubId: string) => `live:club:${clubId}`;

/** Filet de sécurité quand le canal est abonné : un message Broadcast perdu n'est jamais rejoué. */
export const LIVE_SAFETY_POLL = 120_000;

export type LiveMessage = { event: string; payload: Record<string, unknown> };
export type LiveListener = {
  onMessage: (message: LiveMessage) => void;
  /** true à chaque abonnement (le premier comme après une coupure), false quand le canal tombe. */
  onStatus?: (subscribed: boolean) => void;
};

type Entry = {
  channel?: RealtimeChannel;
  listeners: Set<LiveListener>;
  subscribed: boolean;
  release?: ReturnType<typeof setTimeout>;
};

/** Garde le canal ouvert un moment après le dernier écouteur : naviguer ne le rejoint pas à nouveau. */
export const RELEASE_DELAY = 10_000;

const registry = new WeakMap<SupabaseClient, { entries: Map<string, Entry>; closing: Map<string, Promise<unknown>> }>();

/**
 * Un seul canal par topic, partagé entre les écouteurs. `supabase.channel(topic)` renvoie le canal
 * existant de même topic : sans partage, le removeChannel d'un écran couperait l'autre.
 */
export function listenLiveTopic(supabase: SupabaseClient, topic: string, listener: LiveListener): () => void {
  let state = registry.get(supabase);
  if (!state) registry.set(supabase, (state = { entries: new Map(), closing: new Map() }));
  const { entries, closing } = state;
  let entry = entries.get(topic);
  if (!entry) {
    const created: Entry = { listeners: new Set(), subscribed: false };
    entries.set(topic, created);
    const open = () => {
      if (entries.get(topic) !== created || created.listeners.size === 0) return;
      created.channel = supabase
        .channel(topic, { config: { private: false } })
        .on('broadcast', { event: '*' }, (message) => {
          const payload = (message.payload ?? {}) as Record<string, unknown>;
          for (const l of [...created.listeners]) l.onMessage({ event: message.event, payload });
        })
        .subscribe((status) => {
          const subscribed = status === 'SUBSCRIBED';
          if (!subscribed && !created.subscribed) return;
          created.subscribed = subscribed;
          for (const l of [...created.listeners]) l.onStatus?.(subscribed);
        });
    };
    created.listeners.add(listener);
    // Un canal en cours de fermeture garde son topic : attendre qu'il soit retiré avant d'en rouvrir un.
    const pending = closing.get(topic);
    if (pending) void pending.then(open, open);
    else open();
    entry = created;
  } else {
    clearTimeout(entry.release);
    entry.release = undefined;
    entry.listeners.add(listener);
    if (entry.subscribed) listener.onStatus?.(true);
  }
  const current = entry;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    current.release = setTimeout(() => {
      if (current.listeners.size > 0 || entries.get(topic) !== current) return;
      entries.delete(topic);
      if (!current.channel) return;
      const removal = supabase.removeChannel(current.channel).finally(() => {
        if (closing.get(topic) === removal) closing.delete(topic);
      });
      closing.set(topic, removal);
    }, RELEASE_DELAY);
  };
}
