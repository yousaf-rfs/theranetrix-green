import styles from './brand-logo.module.css';

/** Outlined vector artwork from the supplied TheraNetrix logo, without the trademark. */
export function BrandLogo({compact = false}: {compact?: boolean}) {
  return <img className={compact ? styles.compact : styles.logo}
    src="/design-preview/theranetrix-logo.svg" alt="TheraNetrix, Inc."
    width={816} height={224} decoding="async"/>;
}
