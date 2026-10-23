self.addEventListener('push', (event) => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let message;
    try { message = event.data.json(); } catch { return; }
    if (typeof message.title !== 'string' || typeof message.body !== 'string') return;
    const url = typeof message.url === 'string' && /^\/cours(?:\?|$)/.test(message.url)
      ? message.url : '/cours';
    await self.registration.showNotification(message.title, {
      body: message.body,
      tag: typeof message.id === 'string' ? `course-${message.id}` : undefined,
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const candidate = event.notification.data?.url;
  const path = typeof candidate === 'string' && /^\/cours(?:\?|$)/.test(candidate) ? candidate : '/cours';
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
