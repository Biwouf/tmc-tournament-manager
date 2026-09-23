import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { clubSlugForEmail, platformBrand, renderEmail, type EmailBrand } from '../_shared/email-template.ts';
import { authEmails, type AuthEmailPayload } from '../_shared/auth-email.ts';

const failure = (status: number, message: string) => Response.json({ error: { http_code: status, message } }, { status });
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return failure(405, 'Method not allowed');
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const from = Deno.env.get('AUTH_FROM_EMAIL') || Deno.env.get('CONTACT_FROM_EMAIL');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !apiKey || !from || !supabaseUrl || !key) return failure(500, 'Email service not configured');
  let payload: AuthEmailPayload;
  try {
    // Vérifie la signature ET l'horodatage avant toute lecture DB ou envoi.
    payload = new Webhook(secret.replace(/^v1,whsec_/, '')).verify(await req.text(), Object.fromEntries(req.headers)) as AuthEmailPayload;
  } catch { return failure(401, 'Invalid webhook signature'); }
  try {
    const aliases = JSON.parse(Deno.env.get('AUTH_EMAIL_HOST_CLUBS') || '{}');
    const dynamicOrigins = JSON.parse(Deno.env.get('AUTH_EMAIL_DYNAMIC_ORIGINS') || '[]');
    const slug = clubSlugForEmail(payload.email_data.redirect_to || '', aliases, dynamicOrigins);
    let brand: EmailBrand = platformBrand;
    if (slug) {
      const admin = createClient(supabaseUrl, key);
      const { data: club, error } = await admin.from('clubs').select('id, name').eq('slug', slug).eq('status', 'active').maybeSingle();
      if (error) throw new Error('Club lookup failed');
      if (club) {
        const { data: settings, error: settingsError } = await admin.from('club_settings').select('config').eq('club_id', club.id).maybeSingle();
        if (settingsError) throw new Error('Brand lookup failed');
        const config = settings?.config?.brand;
        brand = { name: club.name, color: config?.color, logo: config?.logo };
      }
    }
    const messages = authEmails(payload, supabaseUrl);
    const versions = messages.map(({ to, content }) => {
      const { html, text } = renderEmail(brand, content);
      return { to: [{ email: to }], subject: `${brand.name} — ${content.title}`, htmlContent: html, textContent: text };
    });
    // Un seul appel Brevo pour les deux destinataires du changement d'adresse sécurisé.
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ sender: { email: from, name: brand.name }, subject: versions[0].subject,
        htmlContent: versions[0].htmlContent, textContent: versions[0].textContent, messageVersions: versions }),
    });
    if (!response.ok) {
      console.error('[send-auth-email] provider failure', { status: response.status });
      return failure(502, 'Email delivery failed');
    }
    return Response.json({});
  } catch {
    // Ne jamais journaliser le payload, les adresses, les tokens ni les URL de connexion.
    console.error('[send-auth-email] unable to send email');
    return failure(500, 'Email delivery failed');
  }
});
