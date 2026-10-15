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
async function saveSubscription(clubId: string, userId: string, subscription: PushSubscription) {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== userId) throw new Error('Votre session a changé. Reconnectez-vous.');
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('Abonnement push incomplet.');
  const { error } = await supabase.rpc('course_push_subscribe', {
    p_club: clubId, p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
  });
  if (error) throw new Error('Impossible d’enregistrer les notifications. Réessayez.');
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== userId) {
    await subscription.unsubscribe();
    throw new Error('Votre session a changé. Reconnectez-vous.');
  }
  localStorage.setItem(bindingKey, JSON.stringify({ clubId, userId, endpoint }));
}

// Permission request starts directly in the click handler, before any queued work.
export function enableCoursePush(clubId: string, userId: string): Promise<void> {
  if (!coursePushSupported()) return Promise.reject(new Error('Notifications indisponibles sur cet appareil.'));
  const permission = Notification.requestPermission();
  return exclusive(async () => {
    if (await permission !== 'granted') throw new Error('Autorisez les notifications dans les réglages de votre appareil.');
    const registration = await pushRegistration();
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: applicationServerKey(),
    });
    try { await saveSubscription(clubId, userId, subscription); }
    catch (error) {
      await subscription.unsubscribe().catch(() => {});
      localStorage.removeItem(bindingKey);
      throw error;
    }
  });
}

export function syncCoursePush(clubId: string, userId: string): Promise<boolean> {
  return exclusive(async () => {
    const saved = binding();
    // A system permission alone is not consent for a new account.
    if (!coursePushSupported() || Notification.permission !== 'granted' ||
      saved?.userId !== userId || saved.clubId !== clubId) return false;
    const subscription = await existingSubscription();
    if (!subscription || subscription.endpoint !== saved.endpoint) return false;
    await saveSubscription(clubId, userId, subscription);
    return true;
  });
}

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
    if (platformSupported()) await clearNotifications();
  });
}
