import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, ArrowUpRight, ChartNoAxesCombined, Clock3, FileCheck2, Gauge, Globe2, LayoutDashboard, Menu, Moon, RotateCw, Settings2, ShieldCheck, Sun, Timer, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { previousUtcMonth, utcMonth, type Dataset, type SavedReport, type Status } from '../shared/contract.ts';
import { ApiError, callGateway } from './api.ts';
import { Badge, Brand, DatasetPicker, Empty, InlineError, MonthInput, MoreLink, PageHeading, Panel, Skeleton, Spinner } from './components.tsx';
import { CheckTable, MonitoringHistory } from './evidence.tsx';
import { ClaimReview, ReportControls, Reports, type ReportView } from './reports.tsx';
import { assessments, duration, healthLabels, latestFirst, money, monthLabel, number, pct, percentagePoints, utcDateTime, utcTime } from './model.ts';

const navigation = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/history', label: 'Monitoring History', icon: Activity },
  { path: '/reports', label: 'SLA Reports', icon: ChartNoAxesCombined },
  { path: '/claims', label: 'Claim Review', icon: FileCheck2 },
  { path: '/settings', label: 'Settings', icon: Settings2 },
];
const reportKey = (dataset: Dataset, month: string) => ['report', dataset, month] as const;
const AvailabilityTimeline = lazy(() => import('./timeline.tsx'));
type Theme = 'light' | 'dark';

function loadTheme(): Theme {
  const stored = localStorage.getItem('sla-guard-theme');
  return stored === 'light' || stored === 'dark' ? stored : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [dataset, setDataset] = useState<Dataset>('live');
  const [months, setMonths] = useState(() => ({ live: utcMonth(), demo: previousUtcMonth() }));
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const month = months[dataset];
  const selectMonth = (value: string) => setMonths(current => ({ ...current, [dataset]: value }));
  const toggleTheme = () => setTheme(value => value === 'dark' ? 'light' : 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sla-guard-theme', theme);
  }, [theme]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);
  useEffect(() => { document.title = `${navigation.find(page => page.path === pathname)?.label ?? 'Overview'} · SLA Guard`; }, [pathname]);

  const status = useQuery({
    queryKey: ['status', dataset], queryFn: ({ signal }) => callGateway({ action: 'status', dataset }, signal),
    refetchInterval: 60_000, refetchIntervalInBackground: false, staleTime: 30_000,
  });
  const report = useQuery({
    queryKey: reportKey(dataset, month), queryFn: ({ signal }) => callGateway({ action: 'get_report', dataset, month }, signal),
    enabled: ['/', '/reports', '/claims'].includes(pathname),
  });
  const saveCheck = useMutation({
    mutationFn: () => callGateway({ action: 'check' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['status', 'live'] }, { cancelRefetch: false }),
  });
  const generateAssessment = useMutation({
    mutationFn: (selection: { dataset: Dataset; month: string }) => callGateway({ action: 'report', ...selection }),
    onSuccess: (result, selection) => queryClient.setQueryData(reportKey(selection.dataset, selection.month), result),
  });
  const reportView: ReportView = {
    report: report.data, error: report.error, loading: report.isLoading, fetching: report.isFetching,
    load: () => { void report.refetch({ cancelRefetch: false }); },
  };
  const refreshStatus = () => { void status.refetch({ cancelRefetch: false }); };
  const runHealthCheck = () => { if (dataset === 'live' && !saveCheck.isPending) saveCheck.mutate(); };
  const generate = () => { if (!generateAssessment.isPending && !report.isFetching) generateAssessment.mutate({ dataset, month }); };
  const activeGeneration = generateAssessment.variables?.dataset === dataset && generateAssessment.variables?.month === month;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside id="sidebar" className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><Brand /><button type="button" className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={20} /></button></div>
      <nav aria-label="Main navigation">
        {navigation.map(({ path, label, icon: Icon }) => <NavLink to={path} end={path === '/'} key={path} onClick={() => setMenuOpen(false)}><Icon size={19} strokeWidth={1.8} />{label}</NavLink>)}
      </nav>
      <div className="sidebar-footer"><Clock3 size={16} /><span>Time zone</span><strong>UTC</strong></div>
    </aside>
    {menuOpen && <button type="button" className="nav-backdrop" aria-label="Close navigation backdrop" tabIndex={-1} onClick={() => setMenuOpen(false)} />}
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-service">
          <button type="button" className="icon-button mobile-toggle" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="sidebar" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <span className="service-icon" aria-hidden="true"><Globe2 size={19} /></span>
          <div className="service-text"><strong>{status.data?.service.name ?? 'Monitored website'}</strong><span>{status.data ? status.data.service.target_url.replace(/^https?:\/\//, '') : 'SLA Guard'}</span></div>
        </div>
        <div className="topbar-actions">
          <DatasetPicker dataset={dataset} onChange={setDataset} />
          <span className="refresh-time" title={status.dataUpdatedAt ? utcDateTime(status.dataUpdatedAt) : 'Awaiting first refresh'}><Clock3 size={15} />{status.dataUpdatedAt ? `${utcTime(status.dataUpdatedAt)} UTC` : 'Awaiting refresh'}</span>
          <button type="button" className="icon-button" title="Refresh status" aria-label="Refresh status" disabled={status.isFetching} onClick={refreshStatus}>
            <RotateCw size={18} className={status.isFetching ? 'spin' : undefined} />
          </button>
          <button type="button" className="icon-button" title={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main className="content" id="main-content" tabIndex={-1}>
        {dataset === 'demo' && <div className="notice notice-demo"><ShieldCheck size={17} /><strong>Synthetic demo evidence</strong><span>Use Live to see current monitoring.</span></div>}
        {status.error && <InlineError error={status.error} retry={refreshStatus} />}
        <Routes>
          <Route path="/" element={<>
            <PageHeading title="Overview" description="Service health, recent checks, and the selected billing month." actions={<>
              <MonthInput key={dataset} month={month} selectMonth={selectMonth} />
              <button type="button" className="button button-primary check-button" disabled={dataset === 'demo' || saveCheck.isPending}
                title={dataset === 'demo' ? 'Health checks use the live dataset' : undefined} onClick={runHealthCheck}>
                {saveCheck.isPending ? <Spinner /> : <Activity size={17} />}{saveCheck.isPending ? 'Checking…' : 'Run health check'}
              </button>
            </>} />
            {dataset === 'live' && saveCheck.error && <InlineError error={saveCheck.error} retry={runHealthCheck} />}
            {dataset === 'live' && saveCheck.data && <div className={`notice ${saveCheck.data.check.is_up ? 'notice-success' : 'notice-error'}`} role="status">
              <Activity size={17} /><strong>Check saved · {saveCheck.data.check.is_up ? 'Operational' : 'Down'}</strong><span>{utcDateTime(saveCheck.data.check.checked_at)}</span>
            </div>}
            <Overview status={status.data} statusLoading={status.isLoading} statusUnavailable={status.isError} updatedAt={status.dataUpdatedAt} report={report.data} reportLoading={report.isLoading} reportError={report.error} month={month} />
          </>} />
          <Route path="/history" element={<><PageHeading title="Monitoring History" description="Inspect recent observations, failures, and recovery transitions." /><MonitoringHistory key={dataset} status={status.data} loading={status.isLoading} /></>} />
          <Route path="/reports" element={<>
            <PageHeading title="SLA Reports" description="Assess availability, evidence coverage, and service credit by UTC billing month." />
            <ReportControls key={dataset} dataset={dataset} month={month} selectMonth={selectMonth} view={reportView} generate={generate} generating={generateAssessment.isPending} />
            {activeGeneration && generateAssessment.error && <InlineError error={generateAssessment.error} retry={reportView.load} />}
            {activeGeneration && generateAssessment.isSuccess && report.data?.revision === generateAssessment.data?.revision && <div className="notice notice-success" role="status"><FileCheck2 size={17} /><strong>Assessment saved · Revision {report.data?.revision}</strong></div>}
            <Reports month={month} view={reportView} />
          </>} />
          <Route path="/claims" element={<><PageHeading title="Claim Review" description="Review the saved evidence and the claim draft for its exact report revision." />
            <ReportControls key={dataset} dataset={dataset} month={month} selectMonth={selectMonth} view={reportView} />
            <ClaimReview month={month} view={reportView} /></>} />
          <Route path="/settings" element={<><PageHeading title="Settings" description="Inspect the monitor configuration and adjust the dashboard appearance." />
            <Settings status={status.data} loading={status.isLoading} theme={theme} toggleTheme={toggleTheme} /></>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  </div>;
}

function Kpi({ icon, label, value, detail, tone = 'neutral', loading = false }: {
  icon: ReactNode; label: string; value: ReactNode; detail: ReactNode; tone?: 'up' | 'down' | 'warning' | 'neutral' | 'info'; loading?: boolean;
}) {
  return <section className={`kpi panel kpi-${tone}`} aria-label={label}>
    <div className="kpi-heading"><span className={`kpi-icon kpi-icon-${tone}`}>{icon}</span><h2>{label}</h2></div>
    {loading ? <Skeleton label={`Loading ${label}`} lines={2} /> : <><div className="kpi-value">{value}</div><div className="kpi-detail">{detail}</div></>}
  </section>;
}

function Overview({ status, statusLoading, statusUnavailable, updatedAt, report, reportLoading, reportError, month }: {
  status?: Status; statusLoading: boolean; statusUnavailable: boolean; updatedAt: number; report?: SavedReport; reportLoading: boolean; reportError: Error | null; month: string;
}) {
  const current = statusUnavailable ? 'unknown' : status?.current_status ?? 'unknown';
  const assessment = report?.report;
  const outcome = assessment && assessments[assessment.assessment];
  const target = assessment?.contract_snapshot.sla_target_pct ?? status?.service.sla_target_pct;
  const uptime = assessment?.estimated_monthly_availability_pct;
  const gap = uptime != null && target != null ? Number((uptime - target).toFixed(6)) : null;
  const latest = status?.latest_check;
  return <div className="stack">
    <div className="kpi-grid">
      <Kpi label="Website status" icon={<Activity size={18} />} tone={current === 'unknown' ? 'neutral' : current} loading={statusLoading}
        value={healthLabels[current]} detail={latest ? `${statusUnavailable ? 'Refresh failed' : current === 'unknown' ? 'Stale sample' : 'Last check'} · ${utcTime(latest.checked_at)} UTC` : 'No recent status available'} />
      <Kpi label="Monthly uptime" icon={<Gauge size={18} />} tone="info" loading={reportLoading} value={pct(uptime)}
        detail={assessment && uptime == null ? 'Final availability unavailable' : monthLabel(month)} />
      <Kpi label="Observed downtime" icon={<Timer size={18} />} tone={assessment && assessment.down_seconds > 0 ? 'down' : 'neutral'} loading={reportLoading}
        value={assessment ? duration(assessment.down_seconds) : '—'} detail={assessment ? `${assessment.down_windows.length} observed ${assessment.down_windows.length === 1 ? 'window' : 'windows'}` : 'Load or generate a monthly report'} />
      <Kpi label="SLA compliance" icon={<ShieldCheck size={18} />} tone={outcome?.tone ?? 'neutral'} loading={reportLoading}
        value={outcome?.label ?? 'Unassessed'} detail={<>Target {pct(target)}{gap != null && <> · {percentagePoints(gap)}</>}</>} />
    </div>
    <div className="overview-grid">
      <Suspense fallback={<Panel title="Availability timeline"><Skeleton label="Loading timeline" /></Panel>}>
        <AvailabilityTimeline key={status?.dataset ?? 'initial'} status={status} updatedAt={updatedAt} loading={statusLoading} />
      </Suspense>
      <Panel title="Evidence coverage" subtitle={monthLabel(month)} className="overview-coverage">
        {reportLoading ? <Skeleton label="Loading coverage" /> : assessment ? <>
          <div className="coverage-value">{pct(assessment.coverage_pct)}</div>
          <div className="coverage-track" role="img" aria-label={`Monitoring coverage ${pct(assessment.coverage_pct)}`}><span className="fill-up" style={{ width: `${assessment.coverage_pct ?? 0}%` }} /></div>
          <dl className="details compact-details"><div><dt>Unknown time</dt><dd>{duration(assessment.unknown_seconds)}</dd></div><div><dt>Evidence samples</dt><dd>{number(assessment.sample_count)}</dd></div><div><dt>Assessed through</dt><dd>{utcDateTime(assessment.assessed_until)}</dd></div></dl>
        </> : <Empty title={reportError instanceof ApiError && reportError.code !== 'REPORT_NOT_FOUND' ? 'Coverage unavailable' : 'No saved assessment'}>Open SLA Reports to load or generate the monthly assessment.</Empty>}
        <div className="panel-footer"><MoreLink to="/reports">View SLA reports</MoreLink></div>
      </Panel>
    </div>
    <Panel title="Latest observations" subtitle="Six most recent recorded checks" action={<MoreLink to="/history">View history</MoreLink>}>
      {statusLoading ? <Skeleton label="Loading latest observations" lines={5} /> : <CheckTable checks={latestFirst(status?.recent_checks ?? []).slice(0, 6)} />}
    </Panel>
  </div>;
}

function Settings({ status, loading, theme, toggleTheme }: { status?: Status; loading: boolean; theme: Theme; toggleTheme: () => void }) {
  const service = status?.service;
  return <div className="secondary-grid settings-grid">
    <Panel title="Monitor configuration" subtitle="Values reported by the SLA Guard gateway">
      {loading ? <Skeleton label="Loading monitor configuration" /> : service ? <>
        <dl className="details"><div><dt>Monitored URL</dt><dd className="mono">{service.target_url}</dd></div><div><dt>Service ID</dt><dd>{service.id}</dd></div>
          <div><dt>Monitoring</dt><dd><Badge tone={service.enabled ? 'up' : 'warning'}>{service.enabled ? 'Enabled' : 'Disabled'}</Badge></dd></div>
          <div><dt>Expected response</dt><dd>HTTP {service.expected_status}</dd></div><div><dt>Request timeout</dt><dd>{number(service.timeout_ms)} ms</dd></div>
          <div><dt>Maximum coverage gap</dt><dd>{service.max_sample_gap_seconds}s</dd></div><div><dt>Contract</dt><dd>{service.contract_reference}</dd></div>
          <div><dt>SLA target</dt><dd>{pct(service.sla_target_pct)}</dd></div><div><dt>Monthly fee</dt><dd>{money(service.monthly_fee, service.currency)}</dd></div></dl>
        <p className="measurement-note">Edit the <code>website</code> row in <code>sg_services</code> to change the monitor or contract settings.</p>
      </> : <Empty title="Monitor settings unavailable">Refresh status to load the configuration.</Empty>}
    </Panel>
    <div className="stack"><Panel title="Appearance" subtitle="Theme is saved on this browser">
      <div className="setting-row"><span><strong>Color theme</strong><small>{theme === 'dark' ? 'Dark' : 'Light'}</small></span><button type="button" className="button" onClick={toggleTheme}>
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} Use {theme === 'dark' ? 'light' : 'dark'} theme</button></div>
    </Panel><Panel title="Dashboard refresh">
      <dl className="details"><div><dt>Status refresh</dt><dd>60 seconds while visible</dd></div><div><dt>Reporting time zone</dt><dd>UTC</dd></div><div><dt>Recent history limit</dt><dd>20 checks per dataset</dd></div></dl>
      <div className="panel-footer"><a href="http://localhost:8082/" className="more-link" target="_blank" rel="noreferrer">Endpoint directory <ArrowUpRight size={15} /></a></div>
    </Panel></div>
  </div>;
}
