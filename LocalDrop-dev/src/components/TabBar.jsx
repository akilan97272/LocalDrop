import styles from './TabBar.module.css';

const TABS = [
  { id: 'files',     label: 'Files',     icon: '🗂' },
  { id: 'clipboard', label: 'Clipboard', icon: '📋' },
];

export default function TabBar({ active, onChange }) {
  return (
    <div className={`${styles.tabs} glass`}>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`${styles.tab} ${active === t.id ? styles.active : ''}`}
          onClick={() => onChange(t.id)}
        >
          <span>{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}
