import { previousUtcMonth, utcMonth, type Check, type Dataset, type SavedReport, type Status } from '../shared/contract.ts';

// Synthetic responses for automated tests only. The application always calls its real proxy.
export const fixtureService = {
  id: 'website', name: 'Test fixture service', provider_name: 'Test provider', target_url: 'http://demo-site:8000/health',
  enabled: true, expected_status: 200, timeout_ms: 10_000, max_sample_gap_seconds: 90, sla_target_pct: 99.9,
  monthly_fee: 100, credit_pct: 10, currency: 'USD', contract_reference: 'FIXTURE-SLA',
};

export function sample(dataset: Dataset, id: number, time: number, up = true): Check {
  const stamp = new Date(time).toISOString();
  return {
    id, checked_at: stamp, recorded_at: stamp, is_up: up, source: dataset, service_id: 'website',
    response_ms: up ? 19 : 40, status_code: up ? 200 : 503, error: up ? null : 'Expected HTTP 200; received 503', execution_id: `fixture-${id}`,
  };
}

export function statusFixture(dataset: Dataset, health: Status['current_status']): Status {
  const now = Date.now() - (health === 'unknown' ? 10 * 60_000 : 0);
  const latest = sample(dataset, 3, now, health !== 'down');
  return {
    dataset, is_synthetic: dataset === 'demo', service: fixtureService, current_status: health, latest_check: latest,
    recent_checks: [latest, sample(dataset, 2, now - 60_000), sample(dataset, 1, now - 240_000)],
  };
}

export function reportFixture(dataset: Dataset, month = dataset === 'demo' ? previousUtcMonth() : utcMonth()): SavedReport {
  const final = month < utcMonth();
  const reportStart = new Date(`${month}-01T00:00:00Z`);
  const reportEnd = new Date(reportStart);
  reportEnd.setUTCMonth(reportEnd.getUTCMonth() + 1);
  const period = (reportEnd.getTime() - reportStart.getTime()) / 1000;
  return {
    report_id: 'b1bbaf5a-b683-46d8-8fa5-5dc7bf0e79a9', revision: 2,
    claim_draft: final ? 'SLA GUARD CLAIM DRAFT\nDEMO ONLY - SYNTHETIC EVIDENCE\nDraft for human review' : null,
    report: {
      month, dataset, is_synthetic: dataset === 'demo', service_id: 'website', service_name: 'Test fixture service',
      is_final: final, assessment: final ? 'breach_detected' : 'provisional', coverage_pct: final ? 100 : 60,
      period_start: reportStart.toISOString(), period_end: reportEnd.toISOString(), assessed_until: new Date().toISOString(),
      generated_at: new Date().toISOString(), contract_snapshot: fixtureService, measurement_method: 'Fixture monitoring sample carry-forward.',
      period_seconds: period, elapsed_seconds: final ? period : 600, up_seconds: final ? period - 7200 : 360,
      down_seconds: final ? 7200 : 0, unknown_seconds: final ? 0 : 240, sample_count: final ? period / 60 : 6,
      observed_availability_pct: final ? 99.731183 : 100, estimated_monthly_availability_pct: final ? 99.731183 : null,
      candidate_credit_pct: final ? 10 : 0, candidate_credit_amount: final ? 10 : 0, currency: 'USD',
      down_windows: final ? [{ started_at: new Date(reportStart.getTime() + 600_000).toISOString(),
        ended_at: new Date(reportStart.getTime() + 7_800_000).toISOString(), duration_seconds: 7200 }] : [],
    },
  };
}
