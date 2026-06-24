import { Menu, Sun, Moon, Bell } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import styles from './Topbar.module.css'

export default function Topbar({ onToggleSidebar, title }) {
  const { theme, toggle } = useTheme()

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <button className={styles.iconBtn} onClick={onToggleSidebar}>
          <Menu size={20} />
        </button>
        <h1 className={styles.pageTitle}>{title}</h1>
      </div>

      <div className={styles.right}>
        <button className={styles.iconBtn} onClick={toggle} title="Toggle theme">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className={styles.iconBtn} title="Notifications">
          <Bell size={18} />
        </button>
      </div>
    </header>
  )
}
