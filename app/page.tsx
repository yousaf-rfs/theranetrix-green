import type { Metadata } from 'next';
import TheraNetrix from '@/components/theranetrix/app';
import { ReportChartPreview } from '@/components/theranetrix/report-score';
import styles from './forest-theme/home-preview.module.css';
import forestStyles from './forest-theme/forest-workspace.module.css';

export const metadata: Metadata = {
  title: 'TheraNetrix | Forest Green',
  robots: { index: false, follow: false },
};

export default function Home() {
  return (
    <div className={`${styles.preview} ${styles.forest} ${forestStyles.workspace}`}>
      <ReportChartPreview><TheraNetrix path="/" forestPreview /></ReportChartPreview>
    </div>
  );
}
