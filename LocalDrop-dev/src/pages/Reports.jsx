import { useState, useEffect } from 'react'
import { BarChart2, TrendingUp, Users, CreditCard, Calendar, AlertCircle } from 'lucide-react'
import {
  getSalesReport, getOutstandingReport,
  getPaymentReport, getCompanyWiseReport,
  getFinancialYears, getFYReport,
} from '../api'
import { formatCurrency, formatDate, statusConfig } from '../utils/format'
import styles from './Reports.module.css'

const TABS = [
  { key: 'sales',       label: 'Sales',           icon: TrendingUp  },
  { key: 'outstanding', label: 'Outstanding',     icon: AlertCircle },
  { key: 'payments',    label: 'Payments',        icon: CreditCard  },
  { key: 'company',     label: 'Company-wise',    icon: Users       },
  { key: 'fy',          label: 'Financial Year',  icon: Calendar    },
]

export default function Reports() {
  const [activeTab, setActiveTab] = useState('sales')
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [fromDate, setFromDate]   = useState('')
  const [toDate, setToDate]       = useState('')
  const [fys, setFys]             = useState([])
  const [selectedFy, setSelectedFy] = useState('')

  useEffect(() => {
    getFinancialYears().then((r) => {
      setFys(r.data)
      const active = r.data.find((f) => f.is_active)
      if (active) setSelectedFy(active.id)
    })
  }, [])

  // Auto-load when tab switches (for tabs that don't need a date filter)
  useEffect(() => {
    if (!['sales', 'payments'].includes(activeTab)) load()
  }, [activeTab, selectedFy])

  const load = async () => {
    setLoading(true)
    setData(null)
    try {
      const params = {}
      if (fromDate) params.from_date = fromDate
      if (toDate)   params.to_date   = toDate

      let res
      if (activeTab === 'sales')       res = await getSalesReport(params)
      if (activeTab === 'outstanding') res = await getOutstandingReport()
      if (activeTab === 'payments')    res = await getPaymentReport(params)
      if (activeTab === 'company')     res = await getCompanyWiseReport(selectedFy ? { financial_year_id: selectedFy } : {})
      if (activeTab === 'fy' && selectedFy) res = await getFYReport(selectedFy)

      setData(res?.data ?? null)
    } catch { } finally { setLoading(false) }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Financial insights and summaries</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className={styles.tabBar}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`${styles.tab} ${activeTab === key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Date-range filter (sales & payments) */}
      {['sales', 'payments'].includes(activeTab) && (
        <div className={`glass-card ${styles.filterRow}`}>
          <div className="form-group">
            <label className="form-label">From</label>
            <input className="form-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">To</label>
            <input className="form-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-primary" onClick={load}>Load Report</button>
          </div>
        </div>
      )}

      {/* FY selector (company-wise & FY summary) */}
      {['company', 'fy'].includes(activeTab) && (
        <div className={`glass-card ${styles.filterRow}`}>
          <div className="form-group">
            <label className="form-label">Financial Year</label>
            <select className="form-input" value={selectedFy} onChange={(e) => setSelectedFy(e.target.value)}>
              <option value="">All years</option>
              {fys.map((f) => <option key={f.id} value={f.id}>{f.fy_code}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-primary" onClick={load}>Load Report</button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <span className="spinner" style={{ margin: 'auto', width: 32, height: 32 }} />
        </div>
      )}

      {/* ── Content ── */}
      {!loading && data && (
        <>
          {/* Sales */}
          {activeTab === 'sales' && (
            <>
              <div className={styles.summaryRow}>
                <div className="stat-card">
                  <div className="stat-label">Total Sales (excl. GST)</div>
                  <div className="stat-value">{formatCurrency(data.total_sales)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total GST</div>
                  <div className="stat-value">{formatCurrency(data.total_gst)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Invoices</div>
                  <div className="stat-value">{data.rows?.length || 0}</div>
                </div>
              </div>
              <div className="table-wrapper glass">
                <table className="data-table">
                  <thead>
                    <tr><th>Date</th><th>Invoice No</th><th>Company</th><th>Subtotal</th><th>GST</th><th>Grand Total</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {data.rows?.map((r, i) => {
                      const sc = statusConfig[r.status] || statusConfig.DRAFT
                      return (
                        <tr key={i}>
                          <td>{formatDate(r.invoice_date)}</td>
                          <td><b style={{ color: 'var(--accent-primary)' }}>{r.invoice_number}</b></td>
                          <td>{r.company_name}</td>
                          <td>{formatCurrency(r.subtotal)}</td>
                          <td>{formatCurrency(r.total_gst)}</td>
                          <td><b>{formatCurrency(r.grand_total)}</b></td>
                          <td><span className={`badge ${sc.cls}`}>{sc.label}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Outstanding */}
          {activeTab === 'outstanding' && (
            <div className="table-wrapper glass">
              <table className="data-table">
                <thead>
                  <tr><th>Company</th><th>Total Invoiced</th><th>Total Paid</th><th>Outstanding</th></tr>
                </thead>
                <tbody>
                  {Array.isArray(data) && data.map((r) => (
                    <tr key={r.company_id}>
                      <td><b>{r.company_name}</b></td>
                      <td>{formatCurrency(r.total_invoiced)}</td>
                      <td style={{ color: 'var(--accent-success)' }}>{formatCurrency(r.total_paid)}</td>
                      <td>
                        <b style={{ color: Number(r.outstanding) > 0 ? 'var(--accent-warning)' : 'var(--accent-success)' }}>
                          {formatCurrency(r.outstanding)}
                        </b>
                      </td>
                    </tr>
                  ))}
                  {Array.isArray(data) && data.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      No outstanding balances
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Payments */}
          {activeTab === 'payments' && (
            <div className="table-wrapper glass">
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Company</th><th>Method</th><th>Direction</th><th>Amount</th><th>Reference</th></tr>
                </thead>
                <tbody>
                  {Array.isArray(data) && data.map((r, i) => (
                    <tr key={i}>
                      <td>{formatDate(r.payment_date)}</td>
                      <td>{r.company_name}</td>
                      <td>{r.payment_type}</td>
                      <td>
                        <span className={r.direction === 'IN' ? 'badge badge-success' : 'badge badge-danger'}>
                          {r.direction === 'IN' ? 'Received' : 'Sent'}
                        </span>
                      </td>
                      <td><b>{formatCurrency(r.amount)}</b></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                        {r.reference_number || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Company-wise */}
          {activeTab === 'company' && (
            <div className="table-wrapper glass">
              <table className="data-table">
                <thead>
                  <tr><th>Company</th><th>Invoices</th><th>Total Invoiced</th><th>Total Paid</th><th>Outstanding</th></tr>
                </thead>
                <tbody>
                  {Array.isArray(data) && data.map((r) => (
                    <tr key={r.company_id}>
                      <td><b>{r.company_name}</b></td>
                      <td>{r.invoice_count}</td>
                      <td>{formatCurrency(r.total_invoiced)}</td>
                      <td style={{ color: 'var(--accent-success)' }}>{formatCurrency(r.total_paid)}</td>
                      <td>
                        <b style={{ color: Number(r.outstanding) > 0 ? 'var(--accent-warning)' : 'var(--accent-success)' }}>
                          {formatCurrency(r.outstanding)}
                        </b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Financial Year summary */}
          {activeTab === 'fy' && !Array.isArray(data) && (
            <div className={styles.fyGrid}>
              {[
                { label: 'Total Revenue (incl. GST)', value: data.total_revenue,           color: '#6C63FF' },
                { label: 'Total Subtotal',            value: data.total_subtotal,           color: '#00D4FF' },
                { label: 'Total GST',                 value: data.total_gst,               color: '#F59E0B' },
                { label: 'CGST',                      value: data.total_cgst,              color: '#10B981' },
                { label: 'SGST',                      value: data.total_sgst,              color: '#10B981' },
                { label: 'Payments Received',         value: data.total_payments_received, color: '#10B981' },
              ].map(({ label, value, color }) => (
                <div key={label} className="stat-card">
                  <div className="stat-label">{label}</div>
                  <div className="stat-value" style={{ fontSize: 22, color }}>{formatCurrency(value)}</div>
                </div>
              ))}
              <div className="stat-card" style={{ gridColumn: '1/-1', textAlign: 'center' }}>
                <div className="stat-label">Total Invoices in Period</div>
                <div className="stat-value">{data.invoice_count}</div>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !data && !['sales', 'payments'].includes(activeTab) && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          Select a financial year and click Load Report
        </div>
      )}
    </div>
  )
}
