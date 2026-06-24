import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Building2, Package, FileText,
  CreditCard, BookOpen, BarChart2, Settings,
  LogOut, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import styles from './Sidebar.module.css'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/companies', icon: Building2,        label: 'Companies'  },
  { to: '/products',  icon: Package,          label: 'Products'   },
  { to: '/invoices',  icon: FileText,         label: 'Invoices'   },
  { to: '/payments',  icon: CreditCard,       label: 'Payments'   },
  { to: '/ledger',    icon: BookOpen,         label: 'Ledger'     },
  { to: '/reports',   icon: BarChart2,        label: 'Reports'    },
  { to: '/settings',  icon: Settings,         label: 'Settings'   },
]

export default function Sidebar({ collapsed }) {
  const { user, logout } = useAuth()
  const { logoName } = useTheme()
  const navigate = useNavigate()

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      {/* Logo */}
      <div className={styles.logoArea}>
        <img src="/ledgix_logo.png" alt="Ledgix" className={styles.logoImg} />
        {!collapsed && (
          <img src={logoName} alt="Ledgix" className={styles.logoName} />
        )}
      </div>

      <div className={styles.divider} />

      {/* Navigation */}
      <nav className={styles.nav}>
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <Icon size={18} strokeWidth={2} />
            {!collapsed && <span>{label}</span>}
            {!collapsed && <ChevronRight size={14} className={styles.chevron} />}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className={styles.userArea}>
        <div className={styles.divider} />
        <div className={styles.userInfo}>
          <div className={styles.avatar}>
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          {!collapsed && (
            <div className={styles.userMeta}>
              <span className={styles.userName}>{user?.username}</span>
              <span className={styles.userRole}>{user?.role}</span>
            </div>
          )}
          <button className={styles.logoutBtn} onClick={handleLogout} title="Logout">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
