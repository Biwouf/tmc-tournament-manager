import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { clubSlugForEmail, emailBrandFromConfig, platformBrand, renderEmail, type EmailBrand } from '../_shared/email-template.ts';
import { authEmails, clubSignupSlug, feelikeSubject, headerName, signupSender, signupSubject, type AuthEmailPayload, type ClubSignup } from '../_shared/auth-email.ts';

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
        brand = emailBrandFromConfig(club.name, settings?.config?.brand);
      }
    }
    // Lien magique de l'inscription self-serve : seulement si le destinataire est bien
    // l'admin de ce club encore `pending` (sinon, gabarit « magiclink » ordinaire).
    // W2 (brief SAAS_11 §13.3) : club lu sur Ten'Up (`tenup_club_id`) → aux couleurs du club,
    // expéditeur « <nom court> via Feelike » ; club saisi à la main → e-mail Feelike, le nom du
    // club seulement dans le corps (jamais dans l'expéditeur ni l'objet).
    // Retours PR #277, M4 : connexion sous la marque Feelike → le code en tête d'objet. Un club actif
    // (CAC…) garde le sien.
    let signup: ClubSignup | null = null;
    let sender = brand.name;
    let subject: ((title: string) => string) = title => brand === platformBrand && payload.email_data.email_action_type === 'magiclink'
      ? feelikeSubject(title, payload.email_data.token) : `${brand.name} — ${title}`;
    const signupSlug = payload.email_data.email_action_type === 'magiclink'
      ? clubSignupSlug(payload.email_data.redirect_to) : null;
    if (signupSlug && payload.user.id) {
      const admin = createClient(supabaseUrl, key);
      const { data: club, error } = await admin.from('clubs').select('id, name, tenup_club_id').eq('slug', signupSlug).eq('status', 'pending').maybeSingle();
      if (error) throw new Error('Club lookup failed');
      if (club) {
        const { data: member, error: memberError } = await admin.from('club_members').select('role')
          .eq('club_id', club.id).eq('user_id', payload.user.id).eq('role', 'admin').maybeSingle();
        if (memberError) throw new Error('Membership lookup failed');
        if (member && club.tenup_club_id) {
          const { data: settings, error: settingsError } = await admin.from('club_settings').select('config').eq('club_id', club.id).maybeSingle();
          if (settingsError) throw new Error('Brand lookup failed');
          const config = settings?.config?.brand;
          const short = headerName(typeof config?.short_name === 'string' && config.short_name.trim() ? config.short_name : club.name);
          signup = { name: short, slug: signupSlug, tenup: true };
          brand = { ...emailBrandFromConfig(short, config), eyebrow: 'Votre app de club' };
          sender = signupSender(short);
          // P2 : le code en tête d'objet (« 482 913 : votre code pour garder Moissac TC »).
          subject = () => signupSubject(short, payload.email_data.token);
        } else if (member) {
          signup = { name: club.name, slug: signupSlug };
          brand = platformBrand;
          sender = platformBrand.name;
          // P2 : le code en tête d'objet, jamais le nom libre du club.
          subject = title => feelikeSubject(title, payload.email_data.token);
        }
      }
    }
    const messages = authEmails(payload, supabaseUrl, signup);
    const versions = messages.map(({ to, content }) => {
      const { html, text } = renderEmail(brand, content);
      return { to: [{ email: to }], subject: subject(content.title), htmlContent: html, textContent: text };
    });
    // Un seul appel Brevo pour les deux destinataires du changement d'adresse sécurisé.
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ sender: { email: from, name: sender }, subject: versions[0].subject,
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
