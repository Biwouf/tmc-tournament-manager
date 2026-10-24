// Web Push handlers for courses and Live (name kept: loaded by the service worker via importScripts).
const ALLOWED = /^\/(?:cours(?:\?|$)|matches\/[0-9a-f-]{36}$)/;

function destinationPath(candidate) {
  return typeof candidate === 'string' && ALLOWED.test(candidate) ? candidate : '/cours';
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let message;
    try { message = event.data.json(); } catch { return; }
    if (typeof message.title !== 'string' || typeof message.body !== 'string') return;
    const url = destinationPath(message.url);
    const live = url.startsWith('/matches/');
    // A Live feed tag groups the alerts of one match: the newest replaces the previous one.
    const tag = live && typeof message.tag === 'string' && /^live-[\w-]{1,80}$/.test(message.tag)
      ? message.tag
      : typeof message.id === 'string' ? `${live ? 'live' : 'course'}-${message.id}` : undefined;
    await self.registration.showNotification(message.title, {
      body: message.body,
      tag,
      renotify: Boolean(tag && tag.startsWith('live-post-')),
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = destinationPath(event.notification.data?.url);
  const destination = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const windowClient of windows) {
      if (new URL(windowClient.url).origin === self.location.origin) {
        await windowClient.navigate(destination);
        await windowClient.focus();
        return;
      }
    }
    await self.clients.openWindow(destination);
  })());
});
