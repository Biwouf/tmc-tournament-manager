-- Configure Vault signup_email_project_url, signup_email_service_role_key and
-- signup_email_cron_secret first. The latter must match Edge SIGNUP_EMAIL_CRON_SECRET.
-- Use the legacy service_role JWT; keep Edge Function JWT verification enabled.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
SELECT cron.schedule('signup-email-dispatch', '* * * * *', $$
 SELECT net.http_post(
   url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='signup_email_project_url')
     || '/functions/v1/signup-email-dispatch',
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
     (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='signup_email_service_role_key'),
     'x-signup-email-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
       WHERE name='signup_email_cron_secret')),
   body := '{}'::jsonb, timeout_milliseconds := 120000
 )
 -- Skip the HTTP call (and its Edge invocation) while the queue is idle;
 -- same predicate as signup_email_claim's `picked`.
 WHERE EXISTS (SELECT 1 FROM public.signup_email_deliveries d
   WHERE (d.status='pending' AND d.next_attempt_at<=now())
      OR (d.status='sending' AND d.lease_until<now()));
$$);
