import type { Check, Report, SavedReport, Status } from '../shared/contract.ts';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const percentage = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const utcTime = (value: string | number) => timeFormat.format(new Date(value));
export const utcDateTime = (value: string | number) => `${dateFormat.format(new Date(value))} UTC`;
export const monthLabel = (value: string) => monthFormat.format(new Date(`${value}-01T00:00:00Z`));
export const pct = (value: number | null | undefined) => value == null ? '—' : `${percentage.format(value)}%`;
export const number = (value: number) => numberFormat.format(value);
export const percentagePoints = (value: number) => `${value > 0 ? '+' : ''}${percentage.format(value)} pp`;
export const money = (amount: number, currency: string) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency, currencyDisplay: 'code',
}).format(amount);

export function duration(value: number) {
  if (value > 0 && value < 1) return '< 1s';
  let seconds = Math.floor(value);
  const parts = [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']] as const;
  const rendered = parts.flatMap(([divisor, unit]) => {
    const n = Math.floor(seconds / divisor);
    seconds %= divisor;
    return n ? [`${n}${unit}`] : [];
  });
  return rendered.slice(0, 3).join(' ') || '0s';
}

export const healthLabels = { up: 'Operational', down: 'Down', unknown: 'Unknown' } as const;
export const assessments: Record<Report['assessment'], { label: string; tone: 'up' | 'down' | 'warning' | 'neutral'; detail: string }> = {
  within_sla: { label: 'Meets SLA', tone: 'up', detail: 'The final assessed availability met the contract target.' },
  breach_detected: { label: 'Breaches SLA', tone: 'down', detail: 'The final assessed availability fell below the contract target.' },
  needs_data_review: { label: 'Insufficient coverage', tone: 'warning', detail: 'Monitoring gaps prevent a final credit decision.' },
  insufficient_data: { label: 'Insufficient evidence', tone: 'warning', detail: 'The gateway found insufficient evidence to assess this period.' },
  provisional: { label: 'Assessment pending', tone: 'neutral', detail: 'This billing month is open. A final assessment requires a completed month.' },
};

export function claimText(saved: SavedReport) {
  const { report, claim_draft } = saved;
  return report.is_final && report.unknown_seconds === 0 && report.assessment === 'breach_detected'
    && claim_draft?.split(/\r?\n/, 1)[0] === 'SLA GUARD CLAIM DRAFT' ? claim_draft : null;
}

export function claimReason(report: Report) {
  if (!report.is_final) return 'A claim requires a completed UTC billing month.';
  if (report.assessment === 'insufficient_data' || report.unknown_seconds > 0) return 'A claim requires full monitoring coverage for the billing month.';
  if (report.assessment === 'within_sla') return 'The service met the SLA target for this period.';
  return 'This saved revision has no verified draft. Generate an assessment, then reload the latest saved report.';
}

export const latestFirst = (checks: readonly Check[]) => [...checks].sort((a, b) => Date.parse(b.checked_at) - Date.parse(a.checked_at) || b.id - a.id);
export type Range = 'all' | '10' | '5';
export const rangeLabels: Record<Range, string> = { all: 'All returned', '10': 'Last 10 min', '5': 'Last 5 min' };

export function timeline(status: Status, range: Range, refreshedAt: number) {
  const ordered = latestFirst(status.recent_checks).reverse();
  if (!ordered.length) return null;
  const first = Date.parse(ordered[0].checked_at);
  const last = Date.parse(ordered.at(-1)!.checked_at);
  const hold = status.service.max_sample_gap_seconds * 1000;
  // Synthetic history is anchored to its evidence, so old samples are legible.
  const end = status.dataset === 'demo' ? last + 1000 : Math.max(last + 1000, refreshedAt);
  const start = range === 'all' ? first - 1000 : end - Number(range) * 60_000;
  const gaps: { start: number; end: number }[] = [];
  let coveredUntil = first;
  for (const [index, sample] of ordered.entries()) {
    const time = Date.parse(sample.checked_at);
    if (time > coveredUntil && time > start) gaps.push({ start: Math.max(start, coveredUntil), end: time });
    coveredUntil = Math.min(time + hold, index < ordered.length - 1 ? Date.parse(ordered[index + 1].checked_at) : end);
  }
  if (coveredUntil < end) gaps.push({ start: Math.max(start, coveredUntil), end });
  if (range !== 'all' && first > start) gaps.unshift({ start, end: first });
  const points = ordered.flatMap(sample => {
    const time = Date.parse(sample.checked_at);
    return time >= start && time <= end ? [{ time, lane: sample.is_up ? 1 : 0, sample }] : [];
  });
  return { start, end, gaps, points };
}

export function filterRecent(checks: readonly Check[], range: Range) {
  const sorted = latestFirst(checks);
  return range === 'all' || !sorted.length ? sorted : sorted.filter(check =>
    Date.parse(check.checked_at) >= Date.parse(sorted[0].checked_at) - Number(range) * 60_000);
}

export function transitions(checks: readonly Check[], maximumGap: number) {
  const ordered = latestFirst(checks);
  return new Map(ordered.flatMap((sample, index) => {
    const previous = ordered[index + 1];
    if (!previous || (Date.parse(sample.checked_at) - Date.parse(previous.checked_at)) / 1000 > maximumGap) return [];
    return previous.is_up === sample.is_up ? [] : [[sample.id, sample.is_up ? 'Recovered' : 'Outage began'] as const];
  }));
}
