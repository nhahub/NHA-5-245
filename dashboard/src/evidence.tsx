import { useState } from 'react';
import type { Check, Status } from '../shared/contract.ts';
import { Badge, Empty, Panel, RangePicker, Skeleton } from './components.tsx';
import { filterRecent, latestFirst, number, transitions, utcDateTime, type Range } from './model.ts';

export function CheckTable({ checks, changes }: { checks: readonly Check[]; changes?: ReadonlyMap<number, string> }) {
  if (!checks.length) return <Empty title="No observations">The selected view has no recorded checks.</Empty>;
  return <div className="table-scroll" tabIndex={0} aria-label="Monitoring observations">
    <table className="checks-table">
      <thead><tr><th scope="col">Timestamp (UTC)</th><th scope="col">Status</th><th scope="col">HTTP</th><th scope="col">Response time</th><th scope="col">Details</th></tr></thead>
      <tbody>{checks.map(check => <tr key={check.id} className={check.is_up ? undefined : 'down-row'}>
        <td><time dateTime={check.checked_at}>{utcDateTime(check.checked_at).replace(' UTC', '')}</time></td>
        <td><Badge tone={check.is_up ? 'up' : 'down'}>{check.is_up ? 'Operational' : 'Down'}</Badge></td>
        <td>{check.status_code ?? '—'}</td>
        <td>{check.response_ms == null ? '—' : `${number(check.response_ms)} ms`}</td>
        <td>{changes?.get(check.id) && <strong className="transition">{changes.get(check.id)}</strong>}
          {check.error || (changes?.get(check.id) ? '' : check.is_up ? '—' : 'Probe failed')}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function MonitoringHistory({ status, loading }: { status?: Status; loading: boolean }) {
  const [range, setRange] = useState<Range>('all');
  const [health, setHealth] = useState('all');
  const checks = status?.recent_checks ?? [];
  const filtered = filterRecent(checks, range).filter(check => health === 'all' || check.is_up === (health === 'up'));
  return <Panel title="Recorded checks" subtitle={status ? `${filtered.length} of ${checks.length} returned observations · UTC` : 'The gateway returns up to 20 observations.'}
    action={<div className="filter-row"><label className="compact-select"><span className="sr-only">Check status filter</span>
      <select value={health} onChange={event => setHealth(event.target.value)}><option value="all">All statuses</option><option value="up">Operational</option><option value="down">Down</option></select>
    </label><RangePicker range={range} onChange={setRange} /></div>}>
    {status?.current_status === 'unknown' && status.latest_check && <p className="chart-note">Latest sample at {utcDateTime(status.latest_check.checked_at)} is stale.</p>}
    {loading ? <Skeleton label="Loading observations" lines={5} /> : <CheckTable checks={latestFirst(filtered)} changes={transitions(checks, status?.service.max_sample_gap_seconds ?? 0)} />}
  </Panel>;
}
