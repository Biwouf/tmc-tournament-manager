// Scheduled server-side only. Events and recipients never come from the caller.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { renderEmail } from '../_shared/email-template.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('COURSE_EMAIL_CRON_SECRET');
  if (!cronSecret || cronSecret.length < 32) {
    return new Response('Cron authentication not configured', { status: 503 });
  }
  if (req.headers.get('x-course-email-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = Deno.env.get('SUPABASE_URL');
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const from = Deno.env.get('COURSE_FROM_EMAIL') || Deno.env.get('CONTACT_FROM_EMAIL');
  if (!serviceKey || !url || !apiKey || !from) return new Response('Not configured', { status: 503 });
  const db = createClient(url, serviceKey);
  const { data, error } = await db.rpc('course_email_claim', { p_limit: 10 });
  if (error) return new Response('Claim failed', { status: 500 });
  let sent = 0;
  let failed = 0;
  for (const job of data || []) {
    let status = 'sent';
    try {
      const { data: account, error: accountError } = await db.auth.admin.getUserById(job.user_id);
      if (accountError) throw new Error('Account lookup failed');
      if (!account.user?.email) {
        status = 'failed';
      } else {
        // Le club vient du job réclamé côté serveur, jamais du destinataire ou du caller.
        // Lecture séparée pour conserver le contrat SQL course_email_claim existant.
        const { data: delivery, error: deliveryError } = await db.from('course_email_deliveries')
          .select('club_id').eq('id', job.id).eq('claim_token', job.claim_token).single();
        if (deliveryError || !delivery?.club_id) throw new Error('Delivery lookup failed');
        const { data: settings, error: settingsError } = await db.from('club_settings')
          .select('config').eq('club_id', delivery.club_id).maybeSingle();
        if (settingsError) throw new Error('Brand lookup failed');
        const brand = settings?.config?.brand;
        const rendered = renderEmail({ name: job.club_name, color: brand?.color, logo: brand?.logo }, {
          title: job.title,
          paragraphs: [job.body],
          footer: 'Cet email concerne une demande de place à un cours. Consultez l’application du club pour les détails.',
        });
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            sender: { email: from, name: job.club_name },
            to: [{ email: account.user.email }],
            subject: job.title,
            textContent: job.body,
            htmlContent: rendered.html,
          }),
        });
        if (!response.ok) {
          // Invalid credentials/configuration can be fixed before the next retry.
          status = response.status === 429 || response.status >= 500 ||
            response.status === 401 || response.status === 403 ? 'pending' : 'failed';
          console.error('Course email rejected', job.id, response.status);
        }
        await response.body?.cancel();
      }
    } catch {
      status = 'pending';
      console.error('Course email delivery interrupted', job.id);
    }
    if (status === 'pending' && job.attempts >= 5) status = 'failed';
    const { error: finishError } = await db.from('course_email_deliveries').update({
      status, claim_token: null, lease_until: null,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      next_attempt_at: new Date(Date.now() + Math.min(60, 4 ** (job.attempts - 1)) * 60000).toISOString(),
    }).eq('id', job.id).eq('claim_token', job.claim_token);
    if (finishError) return new Response('Cannot record delivery result', { status: 500 });
    if (status === 'sent') sent++; else failed++;
  }
  return Response.json({ claimed: data?.length || 0, sent, failed });
});
