import { useEffect, useState, useCallback } from 'react'
import { Plus, X, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { getPayments, createPayment, getCompanies } from '../api'
import { formatCurrency, formatDate } from '../utils/format'
import styles from './Companies.module.css'

const METHODS = ['Cash', 'UPI', 'Cheque', 'NEFT', 'RTGS', 'Bank Transfer']
const EMPTY = { company_id: '', invoice_id: '', payment_type: 'Cash', direction: 'IN', amount: '', reference_number: '', notes: '', payment_date: new Date().toISOString().slice(0, 10) }

export default function Payments() {
  const [payments, setPayments] = useState([])
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([getPayments({ limit: 100 }), getCompanies({ is_active: true })])
      .then(([p, c]) => { setPayments(p.data); setCompanies(c.data) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createPayment({ ...form, amount: Number(form.amount), invoice_id: form.invoice_id || undefined })
      toast.success('Payment recorded')
      setModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
    finally { setSaving(false) }
  }

  const companyName = (id) => companies.find((c) => c.id === id)?.company_name || id

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">{payments.length} records</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setModal(true) }}>
          <Plus size={16} /> Record Payment
        </button>
      </div>

      <div className="table-wrapper glass">
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Company</th><th>Direction</th><th>Method</th><th>Amount</th><th>Reference</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}><span className="spinner" style={{ margin: 'auto' }} /></td></tr>
            ) : payments.map((p) => (
              <tr key={p.id}>
                <td>{formatDate(p.payment_date)}</td>
                <td>{companyName(p.company_id)}</td>
                <td>
                  {p.direction === 'IN'
                    ? <span className="badge badge-success"><ArrowDownCircle size={11} style={{ marginRight: 4 }} />Received</span>
                    : <span className="badge badge-danger"><ArrowUpCircle size={11} style={{ marginRight: 4 }} />Sent</span>}
                </td>
                <td>{p.payment_type}</td>
                <td style={{ fontWeight: 600 }}>{formatCurrency(p.amount)}</td>
                <td style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>{p.reference_number || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className={styles.overlay}>
          <div className={`${styles.modalCard} glass-accent`}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Record Payment</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleSave} className={styles.modalForm}>
              <div className={styles.formGrid}>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Company *</label>
                  <select className="form-input" value={form.company_id} onChange={set('company_id')} required>
                    <option value="">Select company…</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Direction *</label>
                  <select className="form-input" value={form.direction} onChange={set('direction')}>
                    <option value="IN">Received (IN)</option>
                    <option value="OUT">Sent (OUT)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Method *</label>
                  <select className="form-input" value={form.payment_type} onChange={set('payment_type')}>
                    {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (₹) *</label>
                  <input className="form-input" type="number" min={0.01} step={0.01} value={form.amount} onChange={set('amount')} required placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Payment Date *</label>
                  <input className="form-input" type="date" value={form.payment_date} onChange={set('payment_date')} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Reference No</label>
                  <input className="form-input" value={form.reference_number} onChange={set('reference_number')} placeholder="UPI/cheque ref…" />
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <input className="form-input" value={form.notes} onChange={set('notes')} placeholder="Optional" />
                </div>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
