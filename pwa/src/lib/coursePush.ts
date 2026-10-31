import { supabase } from './supabase';

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const bindingKey = 'course-push-binding';
type Binding = { userId: string; clubId: string; endpoint: string };
let pending: Promise<unknown> = Promise.resolve();

// Serialize activation, synchronization and logout, including across tabs when supported.
function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(async (): Promise<T> => {
    if (navigator.locks) return await navigator.locks.request('course-push', operation);
    return await operation();
  });
  pending = next.catch(() => {});
  return next;
}
function binding(): Binding | null {
  try { return JSON.parse(localStorage.getItem(bindingKey) || 'null'); }
  catch { return null; }
}
function platformSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export function coursePushSupported(): boolean {
  return Boolean(vapidPublicKey && platformSupported() && window.isSecureContext);
}
function applicationServerKey(): Uint8Array<ArrayBuffer> {
  const encoded = (vapidPublicKey || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function pushRegistration(): Promise<ServiceWorkerRegistration> {
  if (!await navigator.serviceWorker.getRegistration('/')) {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('L’application se prépare. Réessayez dans un instant.')), 10000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
async function existingSubscription(): Promise<PushSubscription | null> {
  if (!platformSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration ? registration.pushManager.getSubscription() : null;
}
async function clearNotifications() {
  const registration = await navigator.serviceWorker.getRegistration('/');
  for (const notification of await registration?.getNotifications() || []) notification.close();
}
export type PushPreferences = { courses: boolean; live: boolean; news: boolean };
type PreferencePatch = { courses?: boolean; live?: boolean; news?: boolean };

// Shared by every push control on the page (profile, prompts, follow buttons).
const listeners = new Set<(prefs: PushPreferences | null) => void>();
export function onPushPreferences(listener: (prefs: PushPreferences | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(prefs: PushPreferences | null) {
  for (const listener of listeners) listener(prefs);
}

async function saveSubscription(clubId: string, userId: string, subscription: PushSubscription,
  patch: PreferencePatch = {}): Promise<PushPreferences> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== userId) throw new Error('Votre session a changé. Reconnectez-vous.');
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('Abonnement push incomplet.');
  const { data: rows, error } = await supabase.rpc('push_subscribe', {
    p_club: clubId, p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
    p_courses: patch.courses ?? null, p_live: patch.live ?? null, p_news: patch.news ?? null,
  });
  if (error) throw new Error('Impossible d’enregistrer les notifications. Réessayez.');
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== userId) {
    await subscription.unsubscribe();
    throw new Error('Votre session a changé. Reconnectez-vous.');
  }
  localStorage.setItem(bindingKey, JSON.stringify({ clubId, userId, endpoint }));
  const row = (Array.isArray(rows) ? rows[0] : rows) as
    { notify_courses?: boolean; notify_live?: boolean; notify_news?: boolean } | null;
  const prefs = { courses: Boolean(row?.notify_courses), live: Boolean(row?.notify_live), news: Boolean(row?.notify_news) };
  publish(prefs);
  return prefs;
}

// Subscribes this device (if needed) and applies the preference patch. An empty patch only makes
// sure the device can receive the alerts of followed matches.
// Permission request starts directly in the click handler, before any queued work.
export function enablePush(clubId: string, userId: string, patch: PreferencePatch): Promise<PushPreferences> {
  if (!coursePushSupported()) return Promise.reject(new Error('Notifications indisponibles sur cet appareil.'));
  const permission = Notification.requestPermission();
  return exclusive(async () => {
    if (await permission !== 'granted') throw new Error('Autorisez les notifications dans les réglages de votre appareil.');
    const registration = await pushRegistration();
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: applicationServerKey(),
    });
    try { return await saveSubscription(clubId, userId, subscription, patch); }
    catch (error) {
      // Never revoke a device subscription that other categories still rely on.
      if (!existing || binding()?.userId !== userId) {
        await subscription.unsubscribe().catch(() => {});
        localStorage.removeItem(bindingKey);
        publish(null);
      }
      throw error;
    }
  });
}
export function enableCoursePush(clubId: string, userId: string): Promise<void> {
  return enablePush(clubId, userId, { courses: true }).then(() => {});
}

// Turns one category off while keeping the device subscribed (other category, followed matches).
export function disablePushCategory(clubId: string, userId: string, patch: PreferencePatch): Promise<PushPreferences | null> {
  return exclusive(async () => {
    const subscription = await existingSubscription();
    if (!subscription || binding()?.userId !== userId || binding()?.clubId !== clubId) return null;
    return saveSubscription(clubId, userId, subscription, patch);
  });
}

// Device preferences, or null when this device is not subscribed for this account and club.
export function syncPush(clubId: string, userId: string): Promise<PushPreferences | null> {
  return exclusive(async () => {
    const current = binding();
    // A system permission alone is not consent for a new account.
    if (!coursePushSupported() || Notification.permission !== 'granted' ||
      current?.userId !== userId || current.clubId !== clubId) return null;
    const subscription = await existingSubscription();
    if (!subscription || subscription.endpoint !== current.endpoint) return null;
    return saveSubscription(clubId, userId, subscription);
  });
}
export function syncCoursePush(clubId: string, userId: string): Promise<boolean> {
  return syncPush(clubId, userId).then((prefs) => Boolean(prefs?.courses));
}

// Full revocation of this device (logout).
export function disableCoursePush(clubId: string): Promise<void> {
  return exclusive(async () => {
    const subscription = await existingSubscription();
    const endpoint = subscription?.endpoint || binding()?.endpoint;
    let serverRevoked = !endpoint;
    if (endpoint) {
      try {
        const { error } = await supabase.rpc('course_push_unsubscribe', {
          p_club: clubId, p_endpoint: endpoint,
        });
        serverRevoked = !error;
      } catch { /* The browser can still revoke its subscription. */ }
    }
    let browserRevoked = !subscription;
    if (subscription) {
      try {
        await subscription.unsubscribe();
        browserRevoked = !(await existingSubscription());
      } catch { /* Server revocation also stops future sends. */ }
    }
    if (!serverRevoked && !browserRevoked) {
      throw new Error('Impossible de désactiver les notifications. Vérifiez votre connexion et réessayez.');
    }
    localStorage.removeItem(bindingKey);
    publish(null);
    if (platformSupported()) await clearNotifications().catch(() => {});
  });
}

// Runs on every auth change, even away from the Courses page.
export function reconcileCoursePush(userId: string | null): Promise<void> {
  return exclusive(async () => {
    const saved = binding();
    if (!saved || saved.userId === userId) return;
    const subscription = await existingSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      if (await existingSubscription()) throw new Error('Push subscription still active');
    }
    localStorage.removeItem(bindingKey);
    publish(null);
    if (platformSupported()) await clearNotifications();
  });
}
