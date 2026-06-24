import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import styles from './AppLayout.module.css'

const TITLES = {
  '/dashboard': 'Dashboard',
  '/companies': 'Companies',
  '/products':  'Products',
  '/invoices':  'Invoices',
  '/payments':  'Payments',
  '/ledger':    'Ledger',
  '/reports':   'Reports',
  '/settings':  'Settings',
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()

  const title = Object.entries(TITLES).find(([key]) => pathname.startsWith(key))?.[1] || 'Ledgix'

  return (
    <div className={styles.shell}>
      <div className="mesh-bg" />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className={`${styles.main} ${collapsed ? styles.mainCollapsed : ''}`}>
        <Topbar onToggleSidebar={() => setCollapsed((c) => !c)} title={title} />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
