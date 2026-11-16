-- OPTIONAL verification: run AFTER schema.sql as the SQL Editor's postgres role.
-- Everything below is rolled back, including temporary test services/checks/reports.
-- A failed assertion aborts the transaction: execute ROLLBACK before trying again.
begin;
do $$
declare
  sid text := '__sg_test_' || gen_random_uuid()::text;
  a timestamptz := '2024-02-01 00:00:00+00';
  b timestamptz := '2024-03-01 00:00:00+00';
  r jsonb;
  duplicate_r jsonb;
  c jsonb;
begin
  insert into public.sg_services(id, name, provider_name, target_url, monthly_fee, credit_pct)
  values (sid, 'ROLLBACK TEST', 'Fictional', 'https://example.com/health', 200, 25);
  insert into public.sg_checks(service_id, source, execution_id, checked_at, is_up, status_code)
  select sid, 'demo', 'test-' || t::text, t, true, 200
  from generate_series(a, b - interval '1 minute', interval '1 minute') t;

  r := public.sg_monthly_report(sid, '2024-02-01', 'demo', 'all-up');
  assert (r #>> '{report,period_seconds}')::numeric = 2505600, 'Leap-month length';
  assert (r #>> '{report,unknown_seconds}')::numeric = 0, 'Full coverage';
  assert r #>> '{report,assessment}' = 'within_sla', 'All-up SLA';
  assert (r #>> '{report,estimated_monthly_availability_pct}')::numeric = 100, 'All-up availability';
  assert (r #>> '{report,candidate_credit_amount}')::numeric = 0, 'No credit when healthy';

  update public.sg_checks set is_up = false, status_code = 503
    where service_id = sid and checked_at >= a + interval '4 days 12 hours'
    and checked_at < a + interval '4 days 14 hours';
  r := public.sg_monthly_report(sid, '2024-02-01', 'demo', 'breach');
  assert r #>> '{report,assessment}' = 'breach_detected', 'Breach classification';
  assert (r #>> '{report,down_seconds}')::numeric = 7200, 'Two-hour outage';
  assert (r #>> '{report,candidate_credit_amount}')::numeric = 50, '200 x 25% = 50';
  assert jsonb_array_length(r #> '{report,down_windows}') = 1, 'Contiguous down samples form one window';
  assert r #>> '{report,claim_status}' = 'demonstration_only', 'Synthetic watermark';
  duplicate_r := public.sg_monthly_report(sid, '2024-02-01', 'demo', 'breach');
  assert (duplicate_r ->> 'duplicate')::boolean, 'Report retry deduplicates';
  assert duplicate_r ->> 'revision' = r ->> 'revision', 'Retry does not increment revision';
  duplicate_r := public.sg_monthly_report(sid, '2024-02-01', 'demo', 'breach-new-run');
  assert (duplicate_r ->> 'revision')::integer = (r ->> 'revision')::integer + 1, 'New generation increments revision';
  assert duplicate_r ->> 'report_id' = r ->> 'report_id', 'Report identity is stable';

  update public.sg_checks set is_up = true, status_code = 200 where service_id = sid;
  update public.sg_services set sla_target_pct = 100 where id = sid;
  r := public.sg_monthly_report(sid, '2024-02-01', 'demo', 'equality');
  assert r #>> '{report,assessment}' = 'within_sla', 'Equality meets target (strict less-than breach)';
  update public.sg_services set sla_target_pct = 99.9 where id = sid;

  delete from public.sg_checks where service_id = sid
    and checked_at >= a + interval '9 days 10 hours' and checked_at < a + interval '9 days 11 hours';
  r := public.sg_monthly_report(sid, '2024-02-01', 'demo', 'gap');
  assert (r #>> '{report,unknown_seconds}')::numeric = 3570, 'Gap beyond 90-second hold is unknown';
  assert r #>> '{report,assessment}' = 'needs_data_review', 'Unknown time blocks credit';
  assert (r #>> '{report,candidate_credit_amount}')::numeric = 0, 'No credit decision with gaps';
  assert r #> '{report,estimated_monthly_availability_pct}' = 'null'::jsonb, 'No misleading full-month availability';
  assert (r #>> '{report,down_seconds}')::numeric = 0, 'Monitor gap does not become provider downtime';

  delete from public.sg_checks where service_id = sid;
  insert into public.sg_checks(service_id, source, execution_id, checked_at, is_up, status_code)
  select sid, 'demo', 'cross-' || t::text, t, t >= a, case when t < a then 503 else 200 end
  from generate_series(a - interval '30 seconds', b - interval '30 seconds', interval '1 minute') t;
  r := public.sg_monthly_report(sid, '2024-02-01', 'demo', 'boundary');
  assert (r #>> '{report,down_seconds}')::numeric = 30, 'Previous-month sample clips at month start';
  assert (r #>> '{report,unknown_seconds}')::numeric = 0, 'End-of-month clipping';
  assert (r #>> '{report,up_seconds}')::numeric + (r #>> '{report,down_seconds}')::numeric = 2505600, 'No double counting';
  c := public.sg_status(sid, 'demo');
  assert c ->> 'current_status' = 'unknown', 'Historical sample cannot look currently healthy';

  r := public.sg_monthly_report(sid, '2024-02-01', 'live', 'separate');
  assert r #>> '{report,assessment}' = 'insufficient_data', 'Demo evidence never enters live report';
  assert (r #>> '{report,unknown_seconds}')::numeric = 2505600, 'No samples means whole month unknown';
  r := public.sg_monthly_report(sid, date_trunc('month', now() at time zone 'UTC')::date, 'demo', 'current');
  assert not (r #>> '{report,is_final}')::boolean, 'Current month is not final';
  assert (r #>> '{report,candidate_credit_amount}')::numeric = 0, 'No current-month credit';

  c := public.sg_record_check(sid, 'live-up', now() - interval '30 seconds', true, 200, 25, null);
  assert c ->> 'transition' = 'initial_up', 'Initial live transition';
  duplicate_r := public.sg_record_check(sid, 'live-up', now() - interval '30 seconds', true, 200, 25, null);
  assert (duplicate_r ->> 'duplicate')::boolean, 'Check retry is idempotent';
  assert (select count(*) from public.sg_checks where service_id = sid and source = 'live') = 1, 'Only one row per execution';
  c := public.sg_record_check(sid, 'live-down', now(), false, null, 10000, 'Timeout');
  assert c ->> 'transition' = 'outage_started', 'Transport error starts an observed outage';
  c := public.sg_record_check(sid, 'late', now() - interval '15 seconds', true, 200, 25, null);
  assert c ->> 'transition' = 'recorded_out_of_order', 'Late writes do not replace latest status';
  c := public.sg_status(sid, 'live');
  assert c ->> 'current_status' = 'down', 'Latest timestamp determines current status';

  begin
    perform public.sg_monthly_report(sid, '2024-02-02', 'demo', 'bad-date');
    raise exception 'TEST DID NOT REJECT bad date';
  exception when others then
    if sqlerrm like 'TEST DID NOT REJECT%' then raise; end if;
  end;
  begin
    perform public.sg_monthly_report(sid, '2999-01-01', 'demo', 'future');
    raise exception 'TEST DID NOT REJECT future';
  exception when others then
    if sqlerrm like 'TEST DID NOT REJECT%' then raise; end if;
  end;
  begin
    perform public.sg_status(sid, 'invalid');
    raise exception 'TEST DID NOT REJECT source';
  exception when others then
    if sqlerrm like 'TEST DID NOT REJECT%' then raise; end if;
  end;
  begin
    perform public.sg_record_check(sid, 'contradiction', now(), true, 503, 10, null);
    raise exception 'TEST DID NOT REJECT inconsistent status';
  exception when others then
    if sqlerrm like 'TEST DID NOT REJECT%' then raise; end if;
  end;

  assert not has_table_privilege('anon', 'public.sg_checks', 'SELECT'), 'No anonymous table reads';
  assert not has_table_privilege('authenticated', 'public.sg_reports', 'SELECT'), 'No public report reads';
  assert not has_function_privilege('anon', 'public.sg_status(text,text)', 'EXECUTE'), 'No anonymous RPC';
  assert not has_function_privilege('authenticated', 'public.sg_monthly_report(text,date,text,text)', 'EXECUTE'), 'No authenticated RPC';
  assert (select bool_and(relrowsecurity) from pg_class where oid in
    ('public.sg_services'::regclass, 'public.sg_checks'::regclass, 'public.sg_reports'::regclass)), 'RLS enabled';
  raise notice 'PASS: SLA Guard database assertions';
end;
$$;
set local role service_role;
select public.sg_status('website', 'live')->>'dataset' as backend_role_access_must_be_live;
reset role;
rollback;
