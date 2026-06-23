import { logout } from '../api/client';
import styles from './Header.module.css';

export default function Header({ serverInfo, onQR, theme, onToggleTheme, onLogout }) {
  async function handleLogout() {
    await logout();
    onLogout();
  }

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>📡</span>
        <span className={styles.logoText}>
          Local<span>Drop</span>
        </span>
      </div>

      <div className={styles.controls}>
        {serverInfo && (
          <button className={`${styles.badge} glass`} onClick={onQR} title="Show QR code">
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

        <button className={styles.iconBtn} onClick={handleLogout} title="Logout">
          ⏏
        </button>
      </div>
    </header>
  );
}
