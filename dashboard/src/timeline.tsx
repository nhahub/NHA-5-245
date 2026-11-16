import { useState } from 'react';
import { CartesianGrid, ReferenceArea, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import type { Check, Status } from '../shared/contract.ts';
import { Empty, Panel, RangePicker, Skeleton } from './components.tsx';
import { healthLabels, number, timeline, utcDateTime, utcTime, type Range } from './model.ts';

function ObservationTooltip({ sample }: { sample: Check }) {
  return <div className="chart-tooltip">
    <strong>{sample.is_up ? 'Operational' : 'Down'}</strong>
    <span>{utcDateTime(sample.checked_at)}</span>
    <span>{sample.status_code == null ? 'No HTTP response' : `HTTP ${sample.status_code}`}{sample.response_ms == null ? '' : ` · ${number(sample.response_ms)} ms`}</span>
    {sample.error && <span>{sample.error}</span>}
  </div>;
}

export default function AvailabilityTimeline({ status, updatedAt, loading }: { status?: Status; updatedAt: number; loading: boolean }) {
  const [range, setRange] = useState<Range>('all');
  const series = status && timeline(status, range, updatedAt);
  const ticks = series ? [0, .25, .5, .75, 1].map(ratio => Math.round(series.start + (series.end - series.start) * ratio)) : [];
  return <Panel title="Availability timeline" subtitle={status?.dataset === 'demo' ? 'Latest returned synthetic observations' : 'Recent observed service health'}
    action={<RangePicker range={range} onChange={setRange} />} className="timeline-panel">
    {loading ? <Skeleton label="Loading timeline" /> : !series ? <Empty title="No observations yet">Recorded checks will appear here.</Empty> : <>
      <div className="chart-wrap" role="group" aria-label="Availability timeline with UTC timestamps">
        <ResponsiveContainer width="100%" height={170} minWidth={1}>
          <ScatterChart margin={{ top: 13, right: 20, bottom: 7, left: 8 }} accessibilityLayer>
            <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="4 4" />
            <XAxis type="number" dataKey="time" domain={[series.start, series.end]} allowDataOverflow ticks={ticks} tickFormatter={utcTime}
              tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--line)' }} tickLine={false} tickMargin={9} minTickGap={22} />
            <YAxis type="number" dataKey="lane" domain={[-.5, 1.5]} ticks={[0, 1]} width={72} tickMargin={9}
              axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={value => value === 1 ? 'Operational' : 'Down'} />
            {series.gaps.map(gap => <ReferenceArea key={`${gap.start}-${gap.end}`} x1={gap.start} x2={gap.end}
              fill="var(--unknown-chart)" fillOpacity={.37} strokeOpacity={0} />)}
            <Tooltip cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }} content={({ active, payload }) => {
              const sample = payload?.[0]?.payload?.sample as Check | undefined;
              return active && sample ? <ObservationTooltip sample={sample} /> : null;
            }} />
            <Scatter name="Operational" fill="var(--ok-chart)" data={series.points.filter(point => point.lane === 1)} shape="square" isAnimationActive={false} />
            <Scatter name="Down" fill="var(--down-chart)" data={series.points.filter(point => point.lane === 0)} shape="square" isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-footer">
        <div className="legend"><span><i className="swatch swatch-up" /> Operational</span><span><i className="swatch swatch-down" /> Down</span><span><i className="swatch swatch-unknown" /> Unknown coverage</span></div>
        <span className="muted">{series.points.length} {series.points.length === 1 ? 'check' : 'checks'} · UTC</span>
      </div>
      {status.current_status === 'unknown' && <p className="chart-note">Latest observations are historical. Current status is {healthLabels.unknown.toLowerCase()}.</p>}
    </>}
  </Panel>;
}

