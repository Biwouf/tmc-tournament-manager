-- pg_cron logs every run in cron.job_run_details and never purges it
-- (the email dispatchers alone add ~2,880 rows a day). Keep 7 days.
-- Re-running this script updates the job of the same name.
SELECT cron.schedule('cron-history-purge', '17 3 * * *', $$
 DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
$$);
