// Gateway JWT + dedicated cron secret. Events and recipients come only from SQL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type Delivery = {
  id: string;
  claim_token: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  title: string;
  body: string;
  url: string;
  attempts: number;
};

function allowedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && (
      host === 'fcm.googleapis.com' ||
      host === 'updates.push.services.mozilla.com' ||
      host.endsWith('.push.apple.com') ||
      host.endsWith('.notify.windows.com')
    );
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const cronSecret = Deno.env.get('COURSE_PUSH_CRON_SECRET');
  if (!cronSecret || cronSecret.length < 32) {
    return new Response('Cron authentication not configured', { status: 503 });
  }
  if (req.headers.get('x-course-push-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!url || !serviceKey || !publicKey || !privateKey || !subject) {
    console.error('Course push dispatch is not configured');
    return new Response('Not configured', { status: 503 });
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch {
    return new Response('Invalid VAPID configuration', { status: 503 });
  }
  const db = createClient(url, serviceKey);
  const { data, error } = await db.rpc('course_push_claim', { p_limit: 10 });
  if (error) {
    console.error('Cannot claim course push deliveries', error);
    return new Response('Claim failed', { status: 500 });
  }
  let sent = 0;
  let failed = 0;
  for (const job of (data || []) as Delivery[]) {
    let status: 'sent' | 'pending' | 'failed' = 'sent';
    let removeSubscription = false;
    try {
      if (!allowedEndpoint(job.endpoint)) throw new Error('Unsupported push endpoint');
      await webpush.sendNotification(
        { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth_secret } },
        JSON.stringify({ id: job.id, title: job.title, body: job.body, url: job.url }),
        { TTL: 3600, timeout: 10000 },
      );
      sent++;
    } catch (cause) {
      failed++;
      const code = (cause as { statusCode?: number }).statusCode;
      removeSubscription = code === 404 || code === 410;
      status = removeSubscription || code === 400 || code === 413 || !allowedEndpoint(job.endpoint) || job.attempts >= 5
        ? 'failed' : 'pending';
      console.error('Course push delivery failed', job.id, code || 'transport error');
    }
    const retryMinutes = Math.min(60, 4 ** Math.max(0, job.attempts - 1));
    const { error: updateError } = await db.from('course_push_deliveries').update({
      status,
      claim_token: null,
      lease_until: null,
      next_attempt_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
      sent_at: status === 'sent' ? new Date().toISOString() : null,
    }).eq('id', job.id).eq('claim_token', job.claim_token);
    if (updateError) return new Response('Cannot record delivery result', { status: 500 });
    if (removeSubscription) {
      const { error: deleteError } = await db.from('course_push_subscriptions')
        .delete().eq('id', job.subscription_id);
      if (deleteError) console.error('Cannot remove expired push subscription', deleteError);
    }
  }
  return Response.json({ claimed: data?.length || 0, sent, failed });
});
