import type { Metadata } from 'next';
import { HomePreview } from '@/components/theranetrix/home-preview';
import { seedWorkspace } from '@/lib/theranetrix';
import { ensureShowcaseData } from '@/lib/demo-showcase';
import { normalizeWorkspace } from '@/lib/medications';
import { ReportChartPreview } from '@/components/theranetrix/report-score';
import styles from '../../app/forest-theme/home-preview.module.css';
import forestStyles from '../../app/forest-theme/forest-workspace.module.css';

export const metadata: Metadata = {
  title: 'TheraNetrix | Forest Green',
  robots: { index: false, follow: false },
};

export default function Home() {
  const data = normalizeWorkspace(ensureShowcaseData(seedWorkspace(), 'Demo care team', '2026-10-02T12:00:00Z'));
  return (
    <div className={`${styles.preview} ${styles.forest} ${forestStyles.workspace}`}>
      <ReportChartPreview><HomePreview data={data} /></ReportChartPreview>
    </div>
  );
}
