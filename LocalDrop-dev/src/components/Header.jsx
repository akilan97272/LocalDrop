import { logout } from '../api/client';
import styles from './Header.module.css';

export default function Header({ serverInfo, session, isMainSession, onQR, theme, onToggleTheme, onLogout }) {
  return (
    <header className={`${styles.header} glass`}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>📡</span>
        <span className={styles.logoText}>
          Local<span>Drop</span>
        </span>
        {/* Session badge */}
        <div className={`${styles.sessionBadge} ${isMainSession ? styles.sessionMain : styles.sessionRoom}`}>
          {isMainSession ? '🏠 Main' : `🔒 ${session}`}
        </div>
      </div>

      <div className={styles.controls}>
        {serverInfo && (
          <button className={`${styles.badge}`} onClick={onQR} title="Show QR code">
            <span className={styles.dot} />
            <span className={`${styles.badgeAddr} mono`}>
              {serverInfo.ip}:{serverInfo.port}
            </span>
            <span className={styles.qrLabel}>◈ QR</span>
          </button>
        )}

        <button className={styles.iconBtn} onClick={onToggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        <button
          className={`${styles.iconBtn} ${styles.leaveBtn}`}
          onClick={onLogout}
          title={isMainSession ? 'Switch session' : 'Leave session'}
        >
          {isMainSession ? '⊞' : '⏏'}
        </button>
      </div>
    </header>
  );
}
