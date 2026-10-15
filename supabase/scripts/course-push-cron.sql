-- Run once on each Supabase project after setting Vault secrets named
-- course_push_project_url, course_push_service_role_key and course_push_cron_secret.
-- The service role secret must be the legacy JWT service_role key (not an sb_secret_ API key),
-- because Edge Functions verify_jwt remains enabled.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule('course-push-dispatch', '* * * * *', $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name='course_push_project_url') || '/functions/v1/course-push-dispatch',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name='course_push_service_role_key'),
      'x-course-push-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name='course_push_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
