import type { ReactNode } from 'react';
import { AlertCircle, ArrowRight, Clock3, LoaderCircle, RotateCw, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { monthPattern, utcMonth, type Dataset } from '../shared/contract.ts';
import { ApiError } from './api.ts';
import { rangeLabels, type Range } from './model.ts';

export function Brand() {
  return <Link to="/" className="brand" aria-label="SLA Guard overview">
    <span className="brand-mark" aria-hidden="true"><Shield size={24} /><Clock3 size={12} /></span>
    <span>SLA<span className="brand-accent"> Guard</span></span>
  </Link>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'up' | 'down' | 'warning' | 'neutral' | 'info'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}><span className="status-dot" />{children}</span>;
}

export function Panel({ title, subtitle, action, children, className = '' }: {
  title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`panel ${className}`}>
    <div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>
    {children}
  </section>;
}

export function PageHeading({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <header className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="heading-actions">{actions}</div>}</header>;
}

export function InlineError({ error, retry }: { error: Error; retry?: () => void }) {
  return <div className="notice notice-error" role="alert"><AlertCircle size={18} />
    <div><strong>{error instanceof ApiError ? error.message : 'Something went wrong. Try again.'}</strong>
      {error instanceof ApiError && error.executionId && <div className="notice-meta">Execution {error.executionId}</div>}</div>
    {retry && <button type="button" className="button button-small" onClick={retry}><RotateCw size={14} /> Retry</button>}
  </div>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon" aria-hidden="true"><Clock3 size={22} /></span><strong>{title}</strong>{children && <p>{children}</p>}{action}</div>;
}

export function Skeleton({ label, lines = 3 }: { label: string; lines?: number }) {
  return <div className="skeleton" role="status"><span className="sr-only">{label}</span>
    {Array.from({ length: lines }, (_, index) => <span key={index} aria-hidden="true" />)}
  </div>;
}

export function Spinner() { return <LoaderCircle className="spin" size={16} aria-hidden="true" />; }

export function DatasetPicker({ dataset, onChange }: { dataset: Dataset; onChange: (dataset: Dataset) => void }) {
  return <div className="segmented dataset-picker" role="group" aria-label="Dataset">
    {(['live', 'demo'] as const).map(value => <button type="button" className={value} key={value} aria-pressed={value === dataset}
      onClick={() => onChange(value)}>{value === 'live' ? 'Live' : 'Demo'}</button>)}
  </div>;
}

export function RangePicker({ range, onChange }: { range: Range; onChange: (range: Range) => void }) {
  return <label className="compact-select"><span className="sr-only">Evidence range</span>
    <select value={range} onChange={event => onChange(event.target.value as Range)}>
      {(Object.keys(rangeLabels) as Range[]).map(value => <option key={value} value={value}>{rangeLabels[value]}</option>)}
    </select>
  </label>;
}

export function MonthInput({ month, selectMonth, setValid }: { month: string; selectMonth: (month: string) => void; setValid?: (valid: boolean) => void }) {
  const [text, setText] = useState(month);
  const invalid = !monthPattern.test(text) || text > utcMonth();
  return <div className="month-field"><label>Billing month
    <input type="text" value={text} placeholder="YYYY-MM" maxLength={7} autoComplete="off" spellCheck={false}
      aria-invalid={invalid} aria-describedby={invalid ? 'month-error' : undefined} onChange={event => {
        const value = event.target.value;
        const valid = monthPattern.test(value) && value <= utcMonth();
        setText(value);
        setValid?.(valid);
        if (valid) selectMonth(value);
      }} />
  </label>{invalid && <span id="month-error" className="field-error">Use YYYY-MM through the current UTC month.</span>}</div>;
}

export function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="more-link" to={to}>{children}<ArrowRight size={15} aria-hidden="true" /></Link>;
}
