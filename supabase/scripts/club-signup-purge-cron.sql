-- Purge quotidienne des clubs self-serve jamais activés (SaaS S2, docs/specs/SAAS_ONBOARDING.md).
-- Configure Vault club_signup_purge_project_url, club_signup_purge_service_role_key and
-- club_signup_purge_secret first. The latter must match Edge CLUB_SIGNUP_PURGE_SECRET
-- (≥ 32 characters). Use the legacy service_role JWT; keep Edge Function JWT verification enabled.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
SELECT cron.schedule('club-signup-purge', '17 3 * * *', $$
 SELECT net.http_post(
   url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='club_signup_purge_project_url')
     || '/functions/v1/club-signup-purge',
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
     (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='club_signup_purge_service_role_key'),
     'x-club-signup-purge-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
       WHERE name='club_signup_purge_secret')),
   body := '{}'::jsonb, timeout_milliseconds := 120000
 )
 -- Pas d'appel tant qu'aucun club n'est à purger ; même prédicat que club_self_serve_purge_begin.
 WHERE EXISTS (SELECT 1 FROM public.clubs c
   WHERE c.status = 'pending' AND c.created_at < now() - interval '7 days');
$$);
