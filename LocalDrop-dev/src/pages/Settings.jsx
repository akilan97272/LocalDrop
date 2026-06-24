import { useState, useEffect } from 'react'
import { Plus, Check, X, Save, Building } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getFinancialYears, createFinancialYear, updateFinancialYear,
  getSellerCompany, createSellerCompany, updateSellerCompany,
} from '../api'
import { formatDate } from '../utils/format'
import styles from './Settings.module.css'

export default function Settings() {
  const [tab, setTab] = useState('company')

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">System configuration</p>
        </div>
      </div>

      <div className={styles.tabs}>
        {[['company', 'Seller Company'], ['fy', 'Financial Years']].map(([k, l]) => (
          <button
            key={k}
            className={`${styles.tab} ${tab === k ? styles.tabActive : ''}`}
            onClick={() => setTab(k)}
          >{l}</button>
        ))}
      </div>

      {tab === 'company' && <SellerCompanyTab />}
      {tab === 'fy'      && <FinancialYearsTab />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Seller Company Tab
// ─────────────────────────────────────────────────────────────────────────────
function SellerCompanyTab() {
  const [seller, setSeller]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [form, setForm] = useState({
    gstin: '', company_name: '', address: '', phone: '', email: '',
    bank_name: '', account_number: '', ifsc_code: '', terms_and_conditions: '',
  })

  useEffect(() => {
    getSellerCompany()
      .then((r) => {
        setSeller(r.data)
        setForm({ ...r.data })
      })
      .catch(() => {
        // 404 means not yet configured — that's fine, show empty form
        setSeller(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.company_name || !form.gstin) return toast.error('Company name and GSTIN are required')
    setSaving(true)
    try {
      if (seller) {
        const { data } = await updateSellerCompany(seller.id, form)
        setSeller(data)
        toast.success('Seller company updated')
      } else {
        const { data } = await createSellerCompany(form)
        setSeller(data)
        toast.success('Seller company created')
      }
    } catch (err) { toast.error(err.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner" style={{ margin: 'auto' }} /></div>

  return (
    <div className="glass-card">
      <div className={styles.sectionHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Building size={20} color="var(--accent-primary)" />
          <h2 className={styles.sectionTitle}>
            {seller ? 'Your Company Details' : '⚠ Seller Company Not Configured'}
          </h2>
        </div>
        {!seller && (
          <span className="badge badge-warning">Required for Invoices</span>
        )}
      </div>

      {!seller && (
        <div className={styles.setupNotice}>
          Fill in your company details below. This information appears on every invoice you generate.
        </div>
      )}

      <form onSubmit={handleSave} className={styles.sellerForm}>
        <div className={styles.formGrid2}>
          <div className="form-group" style={{ gridColumn: '1/-1' }}>
            <label className="form-label">Company Name *</label>
            <input className="form-input" value={form.company_name} onChange={set('company_name')}
              placeholder="Kanmani Trading Company" required />
          </div>
          <div className="form-group">
            <label className="form-label">GSTIN *</label>
            <input className="form-input" value={form.gstin} onChange={set('gstin')}
              placeholder="33AVTPS8740FIZI" maxLength={15} required />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="form-input" value={form.phone} onChange={set('phone')} placeholder="98422 12404" />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={form.email} onChange={set('email')}
              placeholder="kanmanitrading.ts@gmail.com" />
          </div>
          <div className="form-group" style={{ gridColumn: '1/-1' }}>
            <label className="form-label">Address</label>
            <textarea className="form-input" rows={2} value={form.address} onChange={set('address')}
              placeholder="27 KRE Lay Out, Pornima Hospital Road, College Road, Tiruppur - 641603" />
          </div>
        </div>

        <div className="divider" />
        <p className={styles.subHead}>Bank Details (shown on invoice)</p>

        <div className={styles.formGrid3}>
          <div className="form-group">
            <label className="form-label">Bank Name</label>
            <input className="form-input" value={form.bank_name} onChange={set('bank_name')} placeholder="Karur Vysya Bank" />
          </div>
          <div className="form-group">
            <label className="form-label">Account Number</label>
            <input className="form-input" value={form.account_number} onChange={set('account_number')} placeholder="1235115000017006" />
          </div>
          <div className="form-group">
            <label className="form-label">IFSC Code</label>
            <input className="form-input" value={form.ifsc_code} onChange={set('ifsc_code')} placeholder="KVBL0001235" />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Terms & Conditions</label>
          <textarea className="form-input" rows={3} value={form.terms_and_conditions}
            onChange={set('terms_and_conditions')}
            placeholder="E.g. Goods once sold will not be taken back…" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
            {saving ? <span className="spinner" /> : <><Save size={16} /> {seller ? 'Save Changes' : 'Create Company'}</>}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial Years Tab
// ─────────────────────────────────────────────────────────────────────────────
function FinancialYearsTab() {
  const [fys, setFys]         = useState([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [newFy, setNewFy]     = useState({ fy_code: '', start_date: '', end_date: '' })

  const load = () => getFinancialYears().then((r) => setFys(r.data))
  useEffect(() => { load() }, [])

  const handleActivate = async (id) => {
    try {
      await updateFinancialYear(id, { is_active: true })
      toast.success('Financial year activated')
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  const handleCreateFy = async (e) => {
    e.preventDefault()
    if (!newFy.fy_code || !newFy.start_date || !newFy.end_date) return toast.error('Fill all fields')
    setSaving(true)
    try {
      await createFinancialYear(newFy)
      toast.success('Financial year created')
      setShowForm(false)
      setNewFy({ fy_code: '', start_date: '', end_date: '' })
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Already exists or invalid dates') }
    finally { setSaving(false) }
  }

  return (
    <div className="glass-card">
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Financial Years</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={14} /> New FY
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreateFy} className={styles.fyForm}>
          <div className="form-group">
            <label className="form-label">FY Code *</label>
            <input className="form-input" placeholder="FY2027-28" value={newFy.fy_code}
              onChange={(e) => setNewFy((f) => ({ ...f, fy_code: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Start Date *</label>
            <input className="form-input" type="date" value={newFy.start_date}
              onChange={(e) => setNewFy((f) => ({ ...f, start_date: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">End Date *</label>
            <input className="form-input" type="date" value={newFy.end_date}
              onChange={(e) => setNewFy((f) => ({ ...f, end_date: e.target.value }))} required />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner" /> : 'Create'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
              <X size={14} />
            </button>
          </div>
        </form>
      )}

      <div className="divider" />

      <div className="table-wrapper" style={{ border: 'none' }}>
        <table className="data-table">
          <thead>
            <tr><th>FY Code</th><th>Start Date</th><th>End Date</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {fys.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                No financial years yet
              </td></tr>
            )}
            {fys.map((f) => (
              <tr key={f.id}>
                <td><b>{f.fy_code}</b></td>
                <td>{formatDate(f.start_date)}</td>
                <td>{formatDate(f.end_date)}</td>
                <td>
                  {f.is_active
                    ? <span className="badge badge-success"><Check size={11} style={{ marginRight: 4 }} />Active</span>
                    : <span className="badge badge-default">Inactive</span>}
                </td>
                <td>
                  {!f.is_active && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handleActivate(f.id)}>
                      Set Active
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
