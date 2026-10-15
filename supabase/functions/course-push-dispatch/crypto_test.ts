import webpush from 'npm:web-push@3.6.7';
import { createECDH, randomBytes } from 'node:crypto';
import { strict as assert } from 'node:assert';

Deno.test('real Web Push dependency generates an encrypted VAPID request in Deno', () => {
  const vapid = webpush.generateVAPIDKeys();
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  const payload = JSON.stringify({ title: 'Test de cours', body: 'Contenu privé', url: '/cours' });
  const request = webpush.generateRequestDetails({
    endpoint: 'https://web.push.apple.com/test-not-sent',
    keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  }, payload, {
    vapidDetails: { subject: 'mailto:contact@feelike.pro', publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: 3600,
  });
  assert.match(request.headers.Authorization, /^vapid /);
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(request.body.length > payload.length);
  assert.equal(request.body.includes(Buffer.from('Contenu privé')), false);
});
