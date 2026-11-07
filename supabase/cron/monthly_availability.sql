create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('pulsebridge-monthly-availability')
where exists (select 1 from cron.job where jobname = 'pulsebridge-monthly-availability');

select cron.schedule(
  'pulsebridge-monthly-availability',
  '30 4 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/monthly-availability',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),
    body := '{}'::jsonb
  );
  $$
);
