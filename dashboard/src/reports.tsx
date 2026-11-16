import { useState } from 'react';
import { CalendarCheck2, Check, Clipboard, FileSearch, RotateCw } from 'lucide-react';
import type { Dataset, Report, SavedReport } from '../shared/contract.ts';
import { ApiError } from './api.ts';
import { Badge, Empty, InlineError, MonthInput, MoreLink, Panel, Skeleton, Spinner } from './components.tsx';
import { assessments, claimReason, claimText, duration, money, monthLabel, number, pct, utcDateTime } from './model.ts';

export type ReportView = {
  report?: SavedReport;
  error: Error | null;
  loading: boolean;
  fetching: boolean;
  load: () => void;
};

export function ReportControls({ dataset, month, selectMonth, view, generate, generating = false }: {
  dataset: Dataset; month: string; selectMonth: (month: string) => void; view: ReportView;
  generate?: () => void; generating?: boolean;
}) {
  const [valid, setValid] = useState(true);
  return <section className="report-controls panel" aria-label="Report selection">
    <MonthInput month={month} selectMonth={selectMonth} setValid={setValid} />
    <Badge tone={dataset === 'demo' ? 'warning' : 'info'}>{dataset === 'demo' ? 'Synthetic demo' : 'Live evidence'}</Badge>
    <div className="control-actions">
      <button type="button" className="button" disabled={!valid || view.fetching || generating} onClick={view.load}>
        {view.fetching ? <Spinner /> : <FileSearch size={16} />} Load saved report
      </button>
      {generate && <button type="button" className="button button-primary" disabled={!valid || view.fetching || generating} onClick={generate}>
        {generating ? <Spinner /> : <CalendarCheck2 size={16} />} {generating ? 'Generating…' : 'Generate assessment'}
      </button>}
    </div>
  </section>;
}

function MissingReport({ month, view, forClaim }: { month: string; view: ReportView; forClaim?: boolean }) {
  if (view.loading) return <Panel title="Saved assessment"><Skeleton label="Loading saved assessment" /></Panel>;
  if (view.error && !(view.error instanceof ApiError && view.error.code === 'REPORT_NOT_FOUND')) {
    return <InlineError error={view.error} retry={view.load} />;
  }
  return <Panel title="Saved assessment"><Empty title="No saved report">
    Generate a {monthLabel(month)} assessment for this dataset to {forClaim ? 'check claim eligibility' : 'see the monthly results'}.
  </Empty>{forClaim && <div className="panel-footer"><MoreLink to="/reports">Open SLA reports</MoreLink></div>}</Panel>;
}

export function CoverageBar({ report }: { report: Report }) {
  const parts = [
    { key: 'up', label: 'Operational', value: report.up_seconds },
    { key: 'down', label: 'Down', value: report.down_seconds },
    { key: 'unknown', label: 'Unknown', value: report.unknown_seconds },
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return <div className="coverage-breakdown">
    <div className="coverage-track stacked" role="img" aria-label={parts.map(part => `${part.label} ${duration(part.value)}`).join(', ')}>
      {total > 0 && parts.map(part => part.value > 0 && <span key={part.key} className={`fill-${part.key}`}
        style={{ width: `${100 * part.value / total}%` }} />)}
    </div>
    <div className="coverage-legend">
      {parts.map(part => <div key={part.key}><span><i className={`swatch swatch-${part.key}`} />{part.label}</span><strong>{duration(part.value)}</strong></div>)}
    </div>
  </div>;
}

function ReportIdentity({ saved }: { saved: SavedReport }) {
  return <dl className="report-identity details">
    <div><dt>Report ID</dt><dd className="mono">{saved.report_id}</dd></div>
    <div><dt>Revision</dt><dd>{saved.revision}</dd></div>
    <div><dt>Generated</dt><dd>{utcDateTime(saved.report.generated_at)}</dd></div>
  </dl>;
}

export function Reports({ month, view }: { month: string; view: ReportView }) {
  const saved = view.report;
  if (!saved) return <MissingReport month={month} view={view} />;
  const report = saved.report;
  const contract = report.contract_snapshot;
  const assessment = assessments[report.assessment];
  const eligible = report.is_final && report.unknown_seconds === 0 && report.assessment === 'breach_detected';
  return <div className="stack">
    {view.error && <InlineError error={view.error} retry={view.load} />}
    <Panel title={`${monthLabel(report.month)} assessment`} subtitle={`${report.service_name} · ${contract.contract_reference}`} action={<Badge tone={assessment.tone}>{assessment.label}</Badge>}>
      <div className="assessment-metrics">
        <Metric label="Monthly availability" value={pct(report.estimated_monthly_availability_pct)} detail={`Target ${pct(contract.sla_target_pct)}`} />
        <Metric label="Observed downtime" value={duration(report.down_seconds)} detail={`${number(report.down_windows.length)} observed ${report.down_windows.length === 1 ? 'window' : 'windows'}`} />
        <Metric label="Monitoring coverage" value={pct(report.coverage_pct)} detail={`${duration(report.unknown_seconds)} unknown`} />
        <Metric label="Candidate credit" value={money(report.candidate_credit_amount, report.currency)} detail={eligible ? 'Eligible breach' : report.is_final ? 'Ineligible' : 'Pending final assessment'} />
      </div>
      <p className="assessment-detail">{assessment.detail}</p>
    </Panel>
    <div className="secondary-grid">
      <Panel title="Measured time" subtitle={`Through ${utcDateTime(report.assessed_until)}`}>
        <CoverageBar report={report} />
        <p className="measurement-note">Each observation is carried forward for up to {contract.max_sample_gap_seconds} seconds. Time outside those observations is shown as unknown.</p>
        {!report.is_final && <p className="measurement-note">Elapsed time {duration(report.elapsed_seconds)} of {duration(report.period_seconds)} in this UTC billing month.</p>}
        {report.observed_availability_pct != null && report.estimated_monthly_availability_pct == null && <p className="measurement-note">Availability over observed time <strong>{pct(report.observed_availability_pct)}</strong></p>}
      </Panel>
      <Panel title="Contract and report" subtitle={contract.provider_name}>
        <dl className="details"><div><dt>Contractual target</dt><dd>{pct(contract.sla_target_pct)}</dd></div>
          <div><dt>Monthly fee</dt><dd>{money(contract.monthly_fee, contract.currency)}</dd></div>
          <div><dt>Contract credit rate</dt><dd>{pct(contract.credit_pct)}</dd></div>
          <div><dt>Recorded samples</dt><dd>{number(report.sample_count)}</dd></div></dl>
        <ReportIdentity saved={saved} />
        {eligible && <div className="panel-footer"><MoreLink to="/claims">Review claim</MoreLink></div>}
      </Panel>
    </div>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="assessment-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function Draft({ text, synthetic }: { text: string; synthetic: boolean }) {
  const [feedback, setFeedback] = useState<'copied' | 'failed' | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback('copied');
    } catch {
      setFeedback('failed');
    }
  }
  return <Panel title="Claim draft" subtitle="Draft for human review" action={<button type="button" className="button button-primary" onClick={() => void copy()}>
    {feedback === 'copied' ? <Check size={16} /> : <Clipboard size={16} />}{feedback === 'copied' ? 'Copied' : 'Copy claim'}
  </button>}>
    {synthetic && <div className="notice notice-demo"><strong>Demo only · Synthetic evidence</strong></div>}
    <pre className="claim-document" tabIndex={0} aria-label="Claim draft text">{text}</pre>
    <p className="copy-feedback" role="status">{feedback === 'copied' ? 'Claim text copied to clipboard.' : feedback === 'failed' ? 'Clipboard access failed. Select and copy the text from the draft.' : ''}</p>
  </Panel>;
}

export function ClaimReview({ month, view }: { month: string; view: ReportView }) {
  const saved = view.report;
  if (!saved) return <MissingReport month={month} view={view} forClaim />;
  const { report } = saved;
  const text = claimText(saved);
  const assessment = assessments[report.assessment];
  return <div className="stack">
    {view.error && <InlineError error={view.error} retry={view.load} />}
    <div className="secondary-grid claim-grid">
      <Panel title={`${monthLabel(report.month)} evidence`} subtitle={report.service_name} action={<Badge tone={assessment.tone}>{assessment.label}</Badge>}>
        <dl className="details"><div><dt>Eligibility</dt><dd>{text ? 'Eligible for review' : report.is_final ? (report.assessment === 'breach_detected' ? 'Draft unavailable' : 'Ineligible') : 'Pending final assessment'}</dd></div>
          <div><dt>Candidate credit</dt><dd>{money(report.candidate_credit_amount, report.currency)}</dd></div>
          <div><dt>Observed downtime</dt><dd>{duration(report.down_seconds)}</dd></div>
          <div><dt>Coverage</dt><dd>{pct(report.coverage_pct)}</dd></div></dl>
        <ReportIdentity saved={saved} />
      </Panel>
      <Panel title="Observed downtime windows" subtitle={`${report.down_windows.length} recorded · UTC`}>
        {report.down_windows.length ? <ul className="windows-list">{report.down_windows.map(window =>
          <li key={window.started_at}><span>{utcDateTime(window.started_at)}<small>to {utcDateTime(window.ended_at)}</small></span><Badge tone="down">{duration(window.duration_seconds)}</Badge></li>
        )}</ul> : <Empty title="No observed outage windows" />}
      </Panel>
    </div>
    {text && !view.error ? <Draft key={`${saved.report_id}-${saved.revision}`} text={text} synthetic={report.is_synthetic} /> : <Panel title="Claim draft">
      <Empty title="Draft unavailable">{view.error ? 'Reload the saved report to verify its current revision.' : claimReason(report)}</Empty>
      <div className="panel-footer">{view.error ? <button type="button" className="button" onClick={view.load}><RotateCw size={15} /> Retry</button>
        : <MoreLink to="/reports">Open SLA reports</MoreLink>}</div>
    </Panel>}
  </div>;
}
