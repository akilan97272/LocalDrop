import { useEffect, useState, useCallback } from 'react'
import { Plus, Search, Edit2, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { getCompanies, searchCompanies, createCompany, updateCompany, deleteCompany } from '../api'
import styles from './Companies.module.css'

const EMPTY = { gstin: '', company_name: '', address: '', phone: '', email: '', contact_person: '' }

export default function Companies() {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null) // null | 'new' | company object
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getCompanies({ is_active: true, limit: 200 })
      .then((r) => setCompanies(r.data))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleSearch = async (q) => {
    setSearch(q)
    if (!q) { load(); return }
    const r = await searchCompanies(q)
    setCompanies(r.data)
  }

  const openNew = () => { setForm(EMPTY); setModal('new') }
  const openEdit = (c) => { setForm({ ...c }); setModal(c) }
  const closeModal = () => setModal(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.company_name) return toast.error('Company name is required')
    setSaving(true)
    try {
      if (modal === 'new') { await createCompany(form); toast.success('Company created') }
      else { await updateCompany(modal.id, form); toast.success('Company updated') }
      load(); closeModal()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Deactivate this company?')) return
    try { await deleteCompany(id); toast.success('Company deactivated'); load() }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Companies</h1>
          <p className="page-subtitle">{companies.length} active companies</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Add Company</button>
      </div>

      <div className={styles.searchRow}>
        <div className={styles.searchWrap}>
          <Search size={15} className={styles.searchIcon} />
          <input className="form-input" style={{ paddingLeft: 36 }} placeholder="Search by name, GSTIN or phone…" value={search} onChange={(e) => handleSearch(e.target.value)} />
        </div>
      </div>

      <div className="table-wrapper glass">
        <table className="data-table">
          <thead>
            <tr><th>Company</th><th>GSTIN</th><th>Phone</th><th>Email</th><th>Contact</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}><span className="spinner" style={{ margin: 'auto' }} /></td></tr>
            ) : companies.map((c) => (
              <tr key={c.id}>
                <td><b>{c.company_name}</b></td>
                <td><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.gstin || '—'}</span></td>
                <td>{c.phone || '—'}</td>
                <td>{c.email || '—'}</td>
                <td>{c.contact_person || '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}><Edit2 size={13} /></button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c.id)}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal && (
        <div className={styles.overlay}>
          <div className={`${styles.modalCard} glass-accent`}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{modal === 'new' ? 'Add Company' : 'Edit Company'}</h2>
              <button className="btn btn-ghost btn-sm" onClick={closeModal}><X size={16} /></button>
            </div>
            <form onSubmit={handleSave} className={styles.modalForm}>
              <div className={styles.formGrid}>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Company Name *</label>
                  <input className="form-input" value={form.company_name} onChange={set('company_name')} required placeholder="Saleem & Brothers Exports Pvt Ltd" />
                </div>
                <div className="form-group">
                  <label className="form-label">GSTIN</label>
                  <input className="form-input" value={form.gstin} onChange={set('gstin')} placeholder="33AAWCS5881J1ZJ" maxLength={15} />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={form.phone} onChange={set('phone')} placeholder="98422 00000" />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={set('email')} placeholder="contact@company.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Contact Person</label>
                  <input className="form-input" value={form.contact_person} onChange={set('contact_person')} placeholder="Mr. Saleem" />
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Address</label>
                  <textarea className="form-input" rows={2} value={form.address} onChange={set('address')} placeholder="20/21, Fathma Nagar, Tirupur - 641 603" />
                </div>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : (modal === 'new' ? 'Add Company' : 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
