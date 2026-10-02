'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';

const ReportChartContext = createContext(false);

/** Enables the visual study only within the isolated home preview. */
export function ReportChartPreview({ children }: { children: ReactNode }) {
  return <ReportChartContext.Provider value={true}>{children}</ReportChartContext.Provider>;
}

export function ReportScore({ metric, value }: {
  metric: 'pain' | 'function' | 'sleep';
  value: number | null | undefined;
}) {
  const showChart = useContext(ReportChartContext);
  const label = metric === 'pain' ? 'Pain' : metric === 'function' ? 'Function' : 'Sleep';
  const score = <strong>{value ?? 'N/A'}{value != null && <small>/10</small>}</strong>;

  if (!showChart) return <><span>{label}</span>{score}</>;

  return <>
    <span className="report-score-label">{label}</span>
    {score}
    <span className={'report-score-track report-score-' + metric} aria-hidden="true">
      {value != null && <span style={{ width: `${Math.max(0, Math.min(10, value)) * 10}%` }} />}
    </span>
    <small className="report-score-direction">
      {value == null ? 'Not recorded' : metric === 'pain' ? 'Lower is better' : 'Higher is better'}
    </small>
  </>;
}

export function ReportFooter({ children }: { children: ReactNode }) {
  const showChart = useContext(ReportChartContext);
  return showChart ? <div className="report-summary-footer">{children}</div> : <>{children}</>;
}

export function ReportDateIcon() {
  const showChart = useContext(ReportChartContext);
  return showChart ? <CalendarDays size={13} aria-hidden="true" /> : null;
}
