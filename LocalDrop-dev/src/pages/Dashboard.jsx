import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Building2, TrendingUp, AlertCircle, Plus, ArrowRight, AlertTriangle } from 'lucide-react'
import { getInvoices, getCompanies, getOutstandingReport, getSalesReport, getSellerCompany } from '../api'
import { formatCurrency, formatDate, statusConfig } from '../utils/format'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState({ invoices: 0, companies: 0, sales: 0, outstanding: 0 })
  const [recent, setRecent] = useState([])
  const [companyNames, setCompanyNames] = useState({})
  const [loading, setLoading] = useState(true)
  const [sellerMissing, setSellerMissing] = useState(false)

  useEffect(() => {
    // Check if seller company is configured
    getSellerCompany().catch(() => setSellerMissing(true))

    Promise.all([
      getInvoices({ limit: 6 }),
      getCompanies({ is_active: true, limit: 200 }),
      getSalesReport(),
      getOutstandingReport(),
    ]).then(([inv, comp, sales, outstanding]) => {
      // Build a quick id→name map for the recent invoices table
      const nameMap = {}
      comp.data.forEach((c) => { nameMap[c.id] = c.company_name })
      setCompanyNames(nameMap)

      const totalOut = outstanding.data.reduce((s, r) => s + Number(r.outstanding), 0)
      setStats({
        invoices:    inv.data.length,
        companies:   comp.data.length,
        // SalesReportResponse returns total_sales (subtotal) not total_revenue
        sales:       Number(sales.data.total_sales || 0),
        outstanding: totalOut,
      })
      setRecent(inv.data.slice(0, 6))
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const STAT_CARDS = [
    { label: 'Total Invoices',   value: stats.invoices,    icon: FileText,    color: '#6C63FF', fmt: (v) => v           },
    { label: 'Active Companies', value: stats.companies,   icon: Building2,   color: '#00D4FF', fmt: (v) => v           },
    { label: 'Total Sales',      value: stats.sales,       icon: TrendingUp,  color: '#10B981', fmt: formatCurrency     },
    { label: 'Outstanding',      value: stats.outstanding, icon: AlertCircle, color: '#F59E0B', fmt: formatCurrency     },
  ]

  return (
    <div>
      {/* ── Seller company setup prompt ── */}
      {sellerMissing && (
        <div className={styles.setupBanner}>
          <AlertTriangle size={18} />
          <span>
            Your seller company details are not configured yet. Invoices will use placeholder information.
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/settings')}>
            Set Up Now
          </button>
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className={styles.statsGrid}>
        {STAT_CARDS.map(({ label, value, icon: Icon, color, fmt }) => (
          <div key={label} className="stat-card">
            <div className="stat-icon" style={{ background: `${color}18` }}>
              <Icon size={22} color={color} />
            </div>
            <div className="stat-label">{label}</div>
            <div className="stat-value">
              {loading
                ? <span className="spinner" style={{ margin: '6px 0', display: 'block' }} />
                : fmt(value)
              }
            </div>
          </div>
        ))}
      </div>

      {/* ── Recent invoices ── */}
      <div className={styles.section}>
        <div className="page-header">
          <div>
            <h2 className={styles.sectionTitle}>Recent Invoices</h2>
            <p className="page-subtitle">Last 6 invoices generated</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost" onClick={() => navigate('/invoices')}>
              View All <ArrowRight size={14} />
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/invoices')}>
              <Plus size={14} /> New Invoice
            </button>
          </div>
        </div>

        <div className="table-wrapper glass">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Company</th>
                <th>Date</th>
                <th>Grand Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>
                  <span className="spinner" style={{ margin: 'auto' }} />
                </td></tr>
              ) : recent.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                  No invoices yet — create your first one!
                </td></tr>
              ) : recent.map((inv) => {
                const sc = statusConfig[inv.status] || statusConfig.DRAFT
                return (
                  <tr
                    key={inv.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate('/invoices')}
                  >
                    <td><b style={{ color: 'var(--accent-primary)' }}>{inv.invoice_number}</b></td>
                    <td>{companyNames[inv.company_id] || inv.company_id?.slice(0, 8) + '…'}</td>
                    <td>{formatDate(inv.invoice_date)}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(inv.grand_total)}</td>
                    <td><span className={`badge ${sc.cls}`}>{sc.label}</span></td>
                    <td><ArrowRight size={14} color="var(--text-muted)" /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
