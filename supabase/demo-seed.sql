-- OPTIONAL: creates one full PREVIOUS UTC month of clearly synthetic checks.
-- One 120-minute outage, on day 10 from 12:00 through 13:59 UTC.
-- Live checks are never changed. Re-running does not duplicate demo checks.
-- Use the default fictional contract for the documented expected credit.
begin;
with month as (
  select (date_trunc('month', now() at time zone 'UTC') - interval '1 month') at time zone 'UTC' as a,
         date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' as b
), samples as (
  select t, a from month cross join lateral generate_series(a, b - interval '1 minute', interval '1 minute') t
)
insert into public.sg_checks(service_id, source, execution_id, checked_at, is_up, status_code, response_ms, error)
select 'website', 'demo', 'synthetic-' || to_char(t at time zone 'UTC', 'YYYYMMDDHH24MI'), t,
       not (t >= a + interval '9 days 12 hours' and t < a + interval '9 days 14 hours'),
       case when t >= a + interval '9 days 12 hours' and t < a + interval '9 days 14 hours' then 503 else 200 end,
       25,
       case when t >= a + interval '9 days 12 hours' and t < a + interval '9 days 14 hours' then 'SYNTHETIC demo outage' else null end
from samples on conflict (service_id, source, execution_id) do nothing;
commit;

select to_char((date_trunc('month', now() at time zone 'UTC') - interval '1 month'), 'YYYY-MM') as demo_month,
       'report' as webhook_action, 'demo' as webhook_dataset;
