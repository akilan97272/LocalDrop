import { useState, useEffect } from 'react'
import { Search, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react'
import { getCompanies, getStatement, getOutstanding } from '../api'
import { formatCurrency, formatDate } from '../utils/format'
import styles from './Ledger.module.css'

export default function Ledger() {
  const [companies, setCompanies] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [statement, setStatement] = useState(null)
  const [outstanding, setOutstanding] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getCompanies({ is_active: true, limit: 200 }).then((r) => setCompanies(r.data))
  }, [])

  const handleLoad = async () => {
    if (!selectedId) return
    setLoading(true)
    try {
      const params = {}
      if (fromDate) params.from_date = fromDate
      if (toDate) params.to_date = toDate
      const [st, out] = await Promise.all([
        getStatement(selectedId, params),
        getOutstanding(selectedId),
      ])
      setStatement(st.data)
      setOutstanding(out.data)
    } catch { } finally { setLoading(false) }
  }

  const entryColor = (type) => {
    if (['PAYMENT_IN', 'CREDIT_NOTE'].includes(type)) return 'var(--accent-success)'
    if (['PAYMENT_OUT', 'DEBIT_NOTE'].includes(type)) return 'var(--accent-danger)'
    return 'var(--text-primary)'
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Ledger</h1>
          <p className="page-subtitle">Company-wise account statement</p>
        </div>
      </div>

      {/* Filters */}
      <div className={`glass-card ${styles.filterCard}`}>
        <div className={styles.filterRow}>
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">Select Company</label>
            <select className="form-input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">Choose a company…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">From Date</label>
            <input className="form-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">To Date</label>
            <input className="form-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleLoad} disabled={!selectedId || loading}>
              {loading ? <span className="spinner" /> : <><Search size={15} /> Load Statement</>}
            </button>
          </div>
        </div>
      </div>

      {/* Outstanding Summary */}
      {outstanding && (
        <div className={styles.outstandingGrid}>
          {[
            { label: 'Total Invoiced',    value: outstanding.total_invoiced,    icon: TrendingUp,   color: '#6C63FF' },
            { label: 'Total Received',    value: outstanding.total_payments_in, icon: TrendingDown, color: '#10B981' },
            { label: 'Credit Notes',      value: outstanding.total_credit_notes,icon: TrendingDown, color: '#00D4FF' },
            { label: 'Outstanding',       value: outstanding.outstanding,       icon: AlertCircle,  color: outstanding.outstanding > 0 ? '#F59E0B' : '#10B981' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="stat-card">
              <div className="stat-icon" style={{ background: `${color}18` }}>
                <Icon size={20} color={color} />
              </div>
              <div className="stat-label">{label}</div>
              <div className="stat-value" style={{ fontSize: 22, color }}>{formatCurrency(value)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Statement Table */}
      {statement && (
        <div className={styles.statementSection}>
          <div className={styles.statementHeader}>
            <h2 className={styles.statementTitle}>Account Statement</h2>
            <div className={styles.balanceInfo}>
              <span>Opening Balance: <b>{formatCurrency(statement.opening_balance)}</b></span>
              <span>Closing Balance: <b style={{ color: statement.closing_balance > 0 ? 'var(--accent-warning)' : 'var(--accent-success)' }}>
                {formatCurrency(statement.closing_balance)}
              </b></span>
            </div>
          </div>

          <div className="table-wrapper glass">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Reference</th>
                  <th>Method</th>
                  <th>Debit (₹)</th>
                  <th>Credit (₹)</th>
                  <th>Balance (₹)</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {statement.rows.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    No entries in this period
                  </td></tr>
                ) : statement.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{formatDate(row.date)}</td>
                    <td>
                      <span className={styles.entryType} style={{ color: entryColor(row.entry_type) }}>
                        {row.entry_type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                      {row.reference_id ? row.reference_id.slice(0, 8) + '…' : '—'}
                    </td>
                    <td>{row.payment_method || '—'}</td>
                    <td style={{ color: 'var(--accent-danger)', fontWeight: row.debit > 0 ? 600 : 400 }}>
                      {Number(row.debit) > 0 ? formatCurrency(row.debit) : '—'}
                    </td>
                    <td style={{ color: 'var(--accent-success)', fontWeight: row.credit > 0 ? 600 : 400 }}>
                      {Number(row.credit) > 0 ? formatCurrency(row.credit) : '—'}
                    </td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(row.running_balance)}</td>
                    <td style={{ color: 'var(--text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.remarks || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!statement && !loading && (
        <div className={styles.emptyState}>
          <Search size={48} color="var(--text-muted)" />
          <p>Select a company and click <b>Load Statement</b> to view the ledger</p>
        </div>
      )}
    </div>
  )
}
