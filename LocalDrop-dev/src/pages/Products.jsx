import { useEffect, useState, useCallback } from 'react'
import { Plus, Edit2, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { getProducts, createProduct, updateProduct, deleteProduct } from '../api'
import { formatCurrency } from '../utils/format'
import styles from './Companies.module.css' // reuse modal styles

const EMPTY = { product_name: '', hsn_code: '', unit: 'PCS', price: '', gst_percent: '18' }
const GST_RATES = [0, 5, 12, 18, 28]

export default function Products() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getProducts({ is_active: true, limit: 200 })
      .then((r) => setProducts(r.data))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const openNew = () => { setForm(EMPTY); setModal('new') }
  const openEdit = (p) => { setForm({ ...p, price: String(p.price), gst_percent: String(p.gst_percent) }); setModal(p) }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form, price: Number(form.price), gst_percent: Number(form.gst_percent) }
      if (modal === 'new') { await createProduct(payload); toast.success('Product created') }
      else { await updateProduct(modal.id, payload); toast.success('Product updated') }
      load(); setModal(null)
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Deactivate this product?')) return
    try { await deleteProduct(id); toast.success('Product deactivated'); load() }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="page-subtitle">{products.length} active products</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Add Product</button>
      </div>

      <div className="table-wrapper glass">
        <table className="data-table">
          <thead>
            <tr><th>Product</th><th>HSN Code</th><th>Unit</th><th>Price</th><th>GST %</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}><span className="spinner" style={{ margin: 'auto' }} /></td></tr>
            ) : products.map((p) => (
              <tr key={p.id}>
                <td><b>{p.product_name}</b></td>
                <td><span style={{ fontFamily: 'monospace' }}>{p.hsn_code || '—'}</span></td>
                <td>{p.unit || '—'}</td>
                <td>{formatCurrency(p.price)}</td>
                <td><span className="badge badge-info">{p.gst_percent}%</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}><Edit2 size={13} /></button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id)}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className={styles.overlay}>
          <div className={`${styles.modalCard} glass-accent`}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{modal === 'new' ? 'Add Product' : 'Edit Product'}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}><X size={16} /></button>
            </div>
            <form onSubmit={handleSave} className={styles.modalForm}>
              <div className={styles.formGrid}>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Product Name *</label>
                  <input className="form-input" value={form.product_name} onChange={set('product_name')} required placeholder="A4 Sheet 80 GSM" />
                </div>
                <div className="form-group">
                  <label className="form-label">HSN Code</label>
                  <input className="form-input" value={form.hsn_code} onChange={set('hsn_code')} placeholder="48025790" />
                </div>
                <div className="form-group">
                  <label className="form-label">Unit</label>
                  <select className="form-input" value={form.unit} onChange={set('unit')}>
                    {['PCS', 'PKT', 'KG', 'LTR', 'MTR', 'BOX', 'NOS', 'SET'].map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Price (₹) *</label>
                  <input className="form-input" type="number" min={0} step={0.01} value={form.price} onChange={set('price')} required placeholder="280.00" />
                </div>
                <div className="form-group">
                  <label className="form-label">GST %</label>
                  <select className="form-input" value={form.gst_percent} onChange={set('gst_percent')}>
                    {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                  </select>
                </div>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : (modal === 'new' ? 'Add Product' : 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
