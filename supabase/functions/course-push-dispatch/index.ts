// Gateway JWT + dedicated cron secret. Events and recipients come only from SQL.
// Sends course and Live deliveries; called every minute by pg_cron and woken by Live triggers.
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
  // Live only: notification grouping and lifetime.
  tag?: string;
  ttl?: number;
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

const SOURCES = [
  { claim: 'live_push_claim', table: 'live_push_deliveries', limit: 100 },
  { claim: 'course_push_claim', table: 'course_push_deliveries', limit: 10 },
];
const CONCURRENCY = 10;

// deno-lint-ignore no-explicit-any
async function deliver(db: any, table: string, job: Delivery): Promise<'sent' | 'failed' | 'unrecorded'> {
  let status: 'sent' | 'pending' | 'failed' = 'sent';
  let removeSubscription = false;
  try {
    if (!allowedEndpoint(job.endpoint)) throw new Error('Unsupported push endpoint');
    await webpush.sendNotification(
      { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth_secret } },
      JSON.stringify({ id: job.id, title: job.title, body: job.body, url: job.url, tag: job.tag }),
      { TTL: job.ttl || 3600, timeout: 10000 },
    );
  } catch (cause) {
    const code = (cause as { statusCode?: number }).statusCode;
    removeSubscription = code === 404 || code === 410;
    status = removeSubscription || code === 400 || code === 413 || !allowedEndpoint(job.endpoint) || job.attempts >= 5
      ? 'failed' : 'pending';
    console.error('Push delivery failed', table, job.id, code || 'transport error');
  }
  const retryMinutes = Math.min(60, 4 ** Math.max(0, job.attempts - 1));
  const { error: updateError } = await db.from(table).update({
    status,
    claim_token: null,
    lease_until: null,
    next_attempt_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
    sent_at: status === 'sent' ? new Date().toISOString() : null,
  }).eq('id', job.id).eq('claim_token', job.claim_token);
  if (removeSubscription) {
    const { error: deleteError } = await db.from('course_push_subscriptions')
      .delete().eq('id', job.subscription_id);
    if (deleteError) console.error('Cannot remove expired push subscription', deleteError);
  }
  if (updateError) return 'unrecorded';
  return status === 'sent' ? 'sent' : 'failed';
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
  let claimed = 0;
  let sent = 0;
  let failed = 0;
  let claimFailed = false;
  let recordFailed = false;
  // Live first: its alerts expire quickly. A Live claim failure never blocks course pushes.
  for (const source of SOURCES) {
    const { data, error } = await db.rpc(source.claim, { p_limit: source.limit });
    if (error) {
      console.error('Cannot claim push deliveries', source.claim, error);
      claimFailed = true;
      continue;
    }
    const jobs = (data || []) as Delivery[];
    claimed += jobs.length;
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const result = await deliver(db, source.table, job);
        if (result === 'sent') sent++;
        else failed++;
        if (result === 'unrecorded') recordFailed = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  }
  if (recordFailed) return new Response('Cannot record delivery result', { status: 500 });
  if (claimFailed) return new Response('Claim failed', { status: 500 });
  return Response.json({ claimed, sent, failed });
});
