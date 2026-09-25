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
 );
$$);
