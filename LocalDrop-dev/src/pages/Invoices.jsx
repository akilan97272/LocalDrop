import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Download, XCircle, ArrowLeft, X, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getInvoices, cancelInvoice, downloadInvoicePDF,
  getCompanies, createCompany,
  getProducts, createProduct,
  getActiveFinancialYear, createInvoice,
  getInvoice, getCompany,
} from '../api'
import { formatCurrency, formatDate, statusConfig, amountInWords } from '../utils/format'
import { useTheme } from '../hooks/useTheme'
import styles from './Invoices.module.css'

const GST_RATES = [0, 5, 12, 18, 28]
const UNITS = ['PCS', 'PKT', 'KG', 'LTR', 'MTR', 'BOX', 'NOS', 'SET']
const BLANK_ITEM = { product_id: '', description: '', quantity: '', rate: '', gst_percent: 18 }

// ─────────────────────────────────────────────────────────────────────────────
// Small inline modal shared by quick-add company + quick-add product
// ─────────────────────────────────────────────────────────────────────────────
function QuickModal({ title, onClose, children }) {
  return (
    <div className={styles.quickOverlay}>
      <div className={`${styles.quickModal} glass-accent`}>
        <div className={styles.quickHeader}>
          <h3 className={styles.quickTitle}>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice List
// ─────────────────────────────────────────────────────────────────────────────
export default function Invoices() {
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [view, setView] = useState('list') // 'list' | 'new' | 'detail'
  const [detailId, setDetailId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    getInvoices({ limit: 100 })
      .then((r) => setInvoices(r.data))
      .catch(() => toast.error('Failed to load invoices'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = invoices.filter((inv) => {
    const matchSearch = !search || inv.invoice_number.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || inv.status === statusFilter
    return matchSearch && matchStatus
  })

  const handleDownload = async (id, invNum, e) => {
    e.stopPropagation()
    try {
      const res = await downloadInvoicePDF(id)
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url; a.download = `${invNum.replace(/\//g, '_')}.pdf`; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('PDF download failed') }
  }

  const handleCancel = async (id, e) => {
    e.stopPropagation()
    if (!window.confirm('Cancel this invoice? This cannot be undone.')) return
    try {
      await cancelInvoice(id)
      toast.success('Invoice cancelled')
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  if (view === 'new') {
    return <NewInvoiceForm onBack={() => { setView('list'); load() }} />
  }
  if (view === 'detail' && detailId) {
    return (
      <InvoiceDetail
        id={detailId}
        onBack={() => { setView('list'); setDetailId(null) }}
        onRefresh={load}
      />
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">{invoices.length} total invoices</p>
        </div>
        <button className="btn btn-primary" onClick={() => setView('new')}>
          <Plus size={16} /> New Invoice
        </button>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.searchWrap}>
          <Search size={15} className={styles.searchIcon} />
          <input
            className="form-input"
            style={{ paddingLeft: '36px' }}
            placeholder="Search invoice number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-input"
          style={{ width: 'auto', minWidth: 160 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          {Object.entries(statusConfig).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      <div className="table-wrapper glass">
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice No</th>
              <th>Date</th>
              <th>Due Date</th>
              <th>Subtotal</th>
              <th>GST</th>
              <th>Grand Total</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px' }}>
                <span className="spinner" style={{ margin: 'auto' }} />
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                No invoices found.
              </td></tr>
            ) : filtered.map((inv) => {
              const sc = statusConfig[inv.status] || statusConfig.DRAFT
              return (
                <tr
                  key={inv.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => { setDetailId(inv.id); setView('detail') }}
                >
                  <td><b style={{ color: 'var(--accent-primary)' }}>{inv.invoice_number}</b></td>
                  <td>{formatDate(inv.invoice_date)}</td>
                  <td>{formatDate(inv.due_date)}</td>
                  <td>{formatCurrency(inv.subtotal)}</td>
                  <td>{formatCurrency(inv.total_gst)}</td>
                  <td><b>{formatCurrency(inv.grand_total)}</b></td>
                  <td><span className={`badge ${sc.cls}`}>{sc.label}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Download PDF"
                        onClick={(e) => handleDownload(inv.id, inv.invoice_number, e)}
                      >
                        <Download size={13} />
                      </button>
                      {inv.status !== 'CANCELLED' && inv.status !== 'PAID' && (
                        <button
                          className="btn btn-danger btn-sm"
                          title="Cancel invoice"
                          onClick={(e) => handleCancel(inv.id, e)}
                        >
                          <XCircle size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// New Invoice Form — with inline quick-add company + product
// ─────────────────────────────────────────────────────────────────────────────
function NewInvoiceForm({ onBack }) {
  const [companies, setCompanies] = useState([])
  const [products, setProducts] = useState([])
  const [fy, setFy] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Quick-add modals
  const [showAddCompany, setShowAddCompany] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(null) // null | row index

  const [form, setForm] = useState({
    company_id: '',
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: '',
    bill_number: '',
    remarks: '',
    use_igst: false,
  })

  // Each item: product_id, description, quantity (string for input), rate (string), gst_percent (number)
  const [items, setItems] = useState([{ ...BLANK_ITEM }])

  // Load reference data
  useEffect(() => {
    setLoading(true)
    Promise.all([
      getCompanies({ is_active: true, limit: 200 }),
      getProducts({ is_active: true, limit: 200 }),
      getActiveFinancialYear(),
    ])
      .then(([c, p, f]) => {
        setCompanies(c.data)
        setProducts(p.data)
        setFy(f.data)
      })
      .catch(() => toast.error('Failed to load form data'))
      .finally(() => setLoading(false))
  }, [])

  const setField = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  // ── Item helpers ──────────────────────────────────────────────────────────
  // FIXED: batch all four field updates into a single state change so none
  // get overwritten by a stale closure.
  const selectProduct = (rowIdx, productId) => {
    const p = products.find((p) => p.id === productId)
    setItems((prev) =>
      prev.map((it, i) =>
        i !== rowIdx ? it : {
          ...it,
          product_id:  productId,
          description: p ? p.product_name : it.description,
          rate:        p ? String(p.price) : it.rate,
          // API returns gst_percent as "18.00" string — parse to number for the select
          gst_percent: p ? Number(p.gst_percent) : it.gst_percent,
        }
      )
    )
  }

  const updateItem = (rowIdx, key, value) =>
    setItems((prev) =>
      prev.map((it, i) => (i !== rowIdx ? it : { ...it, [key]: value }))
    )

  const addItem = () => setItems((prev) => [...prev, { ...BLANK_ITEM }])
  const removeItem = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i))

  // ── GST calculation (live preview) ───────────────────────────────────────
  const calcItem = (it) => {
    const qty  = parseFloat(it.quantity) || 0
    const rate = parseFloat(it.rate)     || 0
    const gst  = parseFloat(it.gst_percent) || 0
    const taxable = qty * rate
    const gstAmt  = taxable * gst / 100
    return { taxable, gstAmt, total: taxable + gstAmt }
  }

  const totals = items.reduce(
    (acc, it) => {
      const { taxable, gstAmt, total } = calcItem(it)
      return { subtotal: acc.subtotal + taxable, gst: acc.gst + gstAmt, grand: acc.grand + total }
    },
    { subtotal: 0, gst: 0, grand: 0 }
  )

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.company_id)  return toast.error('Select a company')
    if (!fy)               return toast.error('No active financial year. Create one in Settings.')
    if (items.some((it) => !it.description || !it.rate || !it.quantity))
      return toast.error('Fill in description, quantity and rate for every item')

    setSubmitting(true)
    try {
      await createInvoice({
        ...form,
        financial_year_id: fy.id,
        items: items.map((it) => ({
          product_id:  it.product_id || undefined,
          description: it.description,
          quantity:    parseFloat(it.quantity),
          rate:        parseFloat(it.rate),
          gst_percent: parseFloat(it.gst_percent),
        })),
      })
      toast.success('Invoice created!')
      onBack()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create invoice')
    } finally { setSubmitting(false) }
  }

  // ── Quick-add company ─────────────────────────────────────────────────────
  const [newCoForm, setNewCoForm] = useState({ company_name: '', gstin: '', phone: '', email: '', address: '' })
  const setNco = (k) => (e) => setNewCoForm((f) => ({ ...f, [k]: e.target.value }))

  const handleAddCompany = async (e) => {
    e.preventDefault()
    if (!newCoForm.company_name) return toast.error('Company name required')
    try {
      const { data } = await createCompany(newCoForm)
      setCompanies((prev) => [...prev, data])
      setForm((f) => ({ ...f, company_id: data.id }))
      setShowAddCompany(false)
      setNewCoForm({ company_name: '', gstin: '', phone: '', email: '', address: '' })
      toast.success('Company added')
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  // ── Quick-add product ─────────────────────────────────────────────────────
  const [newProdForm, setNewProdForm] = useState({ product_name: '', hsn_code: '', unit: 'PCS', price: '', gst_percent: '18' })
  const setNpf = (k) => (e) => setNewProdForm((f) => ({ ...f, [k]: e.target.value }))

  const handleAddProduct = async (e) => {
    e.preventDefault()
    if (!newProdForm.product_name || !newProdForm.price) return toast.error('Name and price required')
    try {
      const { data } = await createProduct({
        ...newProdForm,
        price: parseFloat(newProdForm.price),
        gst_percent: parseFloat(newProdForm.gst_percent),
      })
      setProducts((prev) => [...prev, data])
      // Auto-select into the row that triggered the modal
      if (showAddProduct !== null) selectProduct(showAddProduct, data.id)
      setShowAddProduct(null)
      setNewProdForm({ product_name: '', hsn_code: '', unit: 'PCS', price: '', gst_percent: '18' })
      toast.success('Product added')
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <span className="spinner" style={{ margin: 'auto', width: 32, height: 32 }} />
    </div>
  )

  return (
    <div>
      {/* ── Quick-add Company modal ── */}
      {showAddCompany && (
        <QuickModal title="Add New Company" onClose={() => setShowAddCompany(false)}>
          <form onSubmit={handleAddCompany} className={styles.quickForm}>
            <div className="form-group">
              <label className="form-label">Company Name *</label>
              <input className="form-input" value={newCoForm.company_name} onChange={setNco('company_name')}
                placeholder="Saleem & Brothers Exports" required />
            </div>
            <div className={styles.quickGrid}>
              <div className="form-group">
                <label className="form-label">GSTIN</label>
                <input className="form-input" value={newCoForm.gstin} onChange={setNco('gstin')}
                  placeholder="33AAWCS5881J1ZJ" maxLength={15} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={newCoForm.phone} onChange={setNco('phone')} placeholder="98422 00000" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Address</label>
              <textarea className="form-input" rows={2} value={newCoForm.address} onChange={setNco('address')}
                placeholder="20/21, Fathma Nagar, Tirupur - 641 603" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddCompany(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add Company</button>
            </div>
          </form>
        </QuickModal>
      )}

      {/* ── Quick-add Product modal ── */}
      {showAddProduct !== null && (
        <QuickModal title="Add New Product" onClose={() => setShowAddProduct(null)}>
          <form onSubmit={handleAddProduct} className={styles.quickForm}>
            <div className="form-group">
              <label className="form-label">Product Name *</label>
              <input className="form-input" value={newProdForm.product_name} onChange={setNpf('product_name')}
                placeholder="A4 Sheet 80 GSM" required />
            </div>
            <div className={styles.quickGrid}>
              <div className="form-group">
                <label className="form-label">HSN Code</label>
                <input className="form-input" value={newProdForm.hsn_code} onChange={setNpf('hsn_code')} placeholder="48025790" />
              </div>
              <div className="form-group">
                <label className="form-label">Unit</label>
                <select className="form-input" value={newProdForm.unit} onChange={setNpf('unit')}>
                  {UNITS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Price (₹) *</label>
                <input className="form-input" type="number" min={0} step={0.01} value={newProdForm.price}
                  onChange={setNpf('price')} placeholder="280.00" required />
              </div>
              <div className="form-group">
                <label className="form-label">GST %</label>
                <select className="form-input" value={newProdForm.gst_percent} onChange={setNpf('gst_percent')}>
                  {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddProduct(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add Product</button>
            </div>
          </form>
        </QuickModal>
      )}

      {/* ── Page header ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn btn-ghost" onClick={onBack}><ArrowLeft size={16} /></button>
          <div>
            <h1 className="page-title">New Invoice</h1>
            {fy && <p className="page-subtitle">Financial Year: {fy.fy_code}</p>}
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? <span className="spinner" /> : 'Generate Invoice'}
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {/* ── Invoice details card ── */}
        <div className={`glass-card ${styles.section}`}>
          <h3 className={styles.sectionTitle}>Invoice Details</h3>
          <div className={styles.grid3}>
            {/* Company selector + quick-add */}
            <div className="form-group" style={{ gridColumn: '1 / span 2' }}>
              <label className="form-label">Buyer Company *</label>
              <div className={styles.selectWithAdd}>
                <select
                  className="form-input"
                  value={form.company_id}
                  onChange={setField('company_id')}
                  required
                >
                  <option value="">Select company…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowAddCompany(true)}
                  title="Add new company"
                >
                  <Plus size={14} /> New
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Invoice Date *</label>
              <input className="form-input" type="date" value={form.invoice_date} onChange={setField('invoice_date')} required />
            </div>
            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input className="form-input" type="date" value={form.due_date} onChange={setField('due_date')} />
            </div>
            <div className="form-group">
              <label className="form-label">DC / Bill No</label>
              <input className="form-input" placeholder="Buyer's reference" value={form.bill_number} onChange={setField('bill_number')} />
            </div>
            <div className="form-group">
              <label className="form-label">Remarks</label>
              <input className="form-input" placeholder="Optional notes" value={form.remarks} onChange={setField('remarks')} />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 14, color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={form.use_igst} onChange={setField('use_igst')} />
                Use IGST (inter-state)
              </label>
            </div>
          </div>
        </div>

        {/* ── Items card ── */}
        <div className={`glass-card ${styles.section}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <h3 className={styles.sectionTitle} style={{ marginBottom: 0 }}>Items</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addItem}>
              <Plus size={14} /> Add Row
            </button>
          </div>

          <div className={styles.itemsScroll}>
            <table className={styles.itemsTable}>
              <thead>
                <tr>
                  <th style={{ minWidth: 160 }}>Product</th>
                  <th style={{ minWidth: 180 }}>Description *</th>
                  <th style={{ width: 80 }}>Qty *</th>
                  <th style={{ width: 110 }}>Rate *</th>
                  <th style={{ width: 90 }}>GST %</th>
                  <th style={{ width: 110 }}>Taxable</th>
                  <th style={{ width: 100 }}>GST Amt</th>
                  <th style={{ width: 110 }}>Total</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const { taxable, gstAmt, total } = calcItem(it)
                  return (
                    <tr key={i}>
                      {/* Product select + quick-add */}
                      <td>
                        <div className={styles.selectWithAdd}>
                          <select
                            className="form-input"
                            value={it.product_id}
                            onChange={(e) => selectProduct(i, e.target.value)}
                          >
                            <option value="">— pick —</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>{p.product_name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            title="Add new product"
                            onClick={() => setShowAddProduct(i)}
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </td>

                      {/* Description */}
                      <td>
                        <input
                          className="form-input"
                          value={it.description}
                          onChange={(e) => updateItem(i, 'description', e.target.value)}
                          placeholder="Item description"
                        />
                      </td>

                      {/* Quantity — plain text input, no min/step blocking */}
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          value={it.quantity}
                          onChange={(e) => updateItem(i, 'quantity', e.target.value)}
                          placeholder="0"
                          min="0"
                          step="any"
                        />
                      </td>

                      {/* Rate */}
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          value={it.rate}
                          onChange={(e) => updateItem(i, 'rate', e.target.value)}
                          placeholder="0.00"
                          min="0"
                          step="any"
                        />
                      </td>

                      {/* GST % — shows actual number, reflects immediately */}
                      <td>
                        <select
                          className="form-input"
                          value={it.gst_percent}
                          onChange={(e) => updateItem(i, 'gst_percent', Number(e.target.value))}
                        >
                          {GST_RATES.map((r) => (
                            <option key={r} value={r}>{r}%</option>
                          ))}
                        </select>
                      </td>

                      {/* Live computed columns */}
                      <td className={styles.computedCell}>{formatCurrency(taxable)}</td>
                      <td className={styles.computedCell} style={{ color: 'var(--accent-warning)' }}>
                        {formatCurrency(gstAmt)}
                      </td>
                      <td className={styles.computedCell}><b>{formatCurrency(total)}</b></td>

                      <td>
                        {items.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => removeItem(i)}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Totals summary */}
          <div className={styles.totalsBox}>
            <div className={styles.totalRow}>
              <span>Subtotal</span>
              <span>{formatCurrency(totals.subtotal)}</span>
            </div>
            <div className={styles.totalRow}>
              <span>{form.use_igst ? 'IGST' : 'CGST + SGST'}</span>
              <span style={{ color: 'var(--accent-warning)' }}>{formatCurrency(totals.gst)}</span>
            </div>
            <div className={`${styles.totalRow} ${styles.grandTotal}`}>
              <span>Grand Total</span>
              <span>{formatCurrency(totals.grand)}</span>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice Detail — exact KTC bill format
// ─────────────────────────────────────────────────────────────────────────────
function InvoiceDetail({ id, onBack, onRefresh }) {
  const { logoName } = useTheme()
  const [inv, setInv] = useState(null)
  const [company, setCompany] = useState(null)
  const [loadingData, setLoadingData] = useState(true)

  useEffect(() => {
    setLoadingData(true)
    getInvoice(id)
      .then((r) => {
        setInv(r.data)
        return getCompany(r.data.company_id)
      })
      .then((c) => setCompany(c.data))
      .catch(() => toast.error('Failed to load invoice'))
      .finally(() => setLoadingData(false))
  }, [id])

  const handlePrint = () => window.print()

  const handleDownload = async () => {
    try {
      const res = await downloadInvoicePDF(id)
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${inv.invoice_number.replace(/\//g, '_')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('PDF download failed') }
  }

  if (loadingData) return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <span className="spinner" style={{ margin: 'auto', width: 32, height: 32 }} />
    </div>
  )
  if (!inv) return null

  const wordsText = amountInWords(inv.grand_total)

  return (
    <div>
      {/* Screen-only action bar */}
      <div className={`page-header ${styles.noPrint}`}>
        <button className="btn btn-ghost" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Invoices
        </button>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-ghost" onClick={handlePrint}>
            <Printer size={14} /> Print
          </button>
          <button className="btn btn-primary" onClick={handleDownload}>
            <Download size={14} /> Download PDF
          </button>
        </div>
      </div>

      {/* ══ Invoice Paper ═══════════════════════════════════════════════════ */}
      <div className={styles.invoicePaper} id="invoice-print">

        {/* Title bar */}
        <div className={styles.titleBar}>TAX INVOICE</div>

        {/* Seller header */}
        <div className={styles.sellerHeader}>
          <div className={styles.sellerLeft}>
            <img src="/ledgix_logo.png" alt="" className={styles.sellerLogoImg} />
            <div>
              <div className={styles.sellerName}>Kanmani Trading Company</div>
              <div className={styles.sellerAddr}>
                27 KRE Lay Out, Pornima Hospital Road, College Road, Tiruppur – 641603
              </div>
              <div className={styles.sellerContact}>
                Mobile: 98422 12404 &nbsp;|&nbsp; Email: kanmanitrading.ts@gmail.com
              </div>
              <div className={styles.sellerGstin}>GSTIN: 33AVTPS8740FIZI</div>
            </div>
          </div>
        </div>

        {/* Buyer + invoice meta */}
        <div className={styles.metaRow}>
          <div className={styles.buyerBlock}>
            <div className={styles.blockLabel}>BUYER</div>
            {company && (
              <>
                <div className={styles.buyerName}>{company.company_name}</div>
                {company.address && <div className={styles.buyerAddr}>{company.address}</div>}
                {company.gstin && (
                  <div className={styles.buyerGstin}>
                    <span className={styles.metaKey}>GSTIN:</span> {company.gstin}
                  </div>
                )}
              </>
            )}
          </div>
          <div className={styles.invoiceMetaBlock}>
            <table className={styles.metaTable}>
              <tbody>
                <tr>
                  <td className={styles.metaKey}>Invoice No</td>
                  <td><b>{inv.invoice_number}</b></td>
                </tr>
                <tr>
                  <td className={styles.metaKey}>Date</td>
                  <td>{formatDate(inv.invoice_date)}</td>
                </tr>
                {inv.due_date && (
                  <tr>
                    <td className={styles.metaKey}>Due Date</td>
                    <td>{formatDate(inv.due_date)}</td>
                  </tr>
                )}
                {inv.bill_number && (
                  <tr>
                    <td className={styles.metaKey}>DC / Bill No</td>
                    <td>{inv.bill_number}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Items table */}
        <table className={styles.itemsTablePrint}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>S.No</th>
              <th>Description of Goods</th>
              <th style={{ width: 80 }}>HSN</th>
              <th style={{ width: 60 }}>Qty</th>
              <th style={{ width: 90 }}>Rate</th>
              <th style={{ width: 50 }}>Per</th>
              <th style={{ width: 100, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={it.id}>
                <td style={{ textAlign: 'center' }}>{i + 1}</td>
                <td>{it.description}</td>
                <td>{it.product?.hsn_code || '—'}</td>
                <td style={{ textAlign: 'right' }}>{Number(it.quantity)}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(it.rate)}</td>
                <td style={{ textAlign: 'center' }}>{it.product?.unit || 'NOS'}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(it.taxable_amount)}</td>
              </tr>
            ))}
            {/* Filler rows to maintain height */}
            {Array.from({ length: Math.max(0, 7 - inv.items.length) }).map((_, i) => (
              <tr key={`fill-${i}`} className={styles.fillerRow}>
                <td colSpan={7}>&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals + Amount in words */}
        <div className={styles.footerRow}>
          <div className={styles.wordsBlock}>
            <div className={styles.blockLabel}>Rupees In Words</div>
            <div className={styles.wordsText}>{wordsText}</div>
          </div>
          <div className={styles.totalsBlock}>
            <div className={styles.totalLine}>
              <span>Sub Total</span><span>{formatCurrency(inv.subtotal)}</span>
            </div>
            <div className={styles.totalLine}>
              <span>CGST {Number(inv.cgst_amount) > 0 ? `${Number(inv.cgst_amount) / Number(inv.subtotal) * 100 > 0 ? (Number(inv.total_gst) / Number(inv.subtotal) * 50).toFixed(0) : 9}%` : '0%'}</span>
              <span>{formatCurrency(inv.cgst_amount)}</span>
            </div>
            <div className={styles.totalLine}>
              <span>SGST {Number(inv.sgst_amount) > 0 ? `${(Number(inv.total_gst) / Number(inv.subtotal) * 50).toFixed(0)}%` : '0%'}</span>
              <span>{formatCurrency(inv.sgst_amount)}</span>
            </div>
            <div className={styles.totalLine}>
              <span>IGST {Number(inv.igst_amount) > 0 ? '' : '0%'}</span>
              <span>{formatCurrency(inv.igst_amount)}</span>
            </div>
            <div className={styles.totalLine}>
              <span>Total Tax Amount</span><span>{formatCurrency(inv.total_gst)}</span>
            </div>
            <div className={styles.totalLine}>
              <span>Round Off</span><span>—</span>
            </div>
            <div className={`${styles.totalLine} ${styles.grandLine}`}>
              <span>Grand Total</span><span>{formatCurrency(inv.grand_total)}</span>
            </div>
          </div>
        </div>

        {/* Declaration + Bank + Signature */}
        <div className={styles.bottomRow}>
          <div className={styles.declarationBlock}>
            <b>Declaration:</b> We declare that this invoice shows the actual price of the goods
            and that all particulars are true and correct.
            {inv.remarks && <p style={{ marginTop: 6 }}><b>Remarks:</b> {inv.remarks}</p>}
            <div className={styles.dcPo}>
              <div>DC No : ___________</div>
              <div>PO &nbsp;&nbsp;&nbsp;: ___________</div>
            </div>
            <div style={{ marginTop: 8 }}>Received By: ___________________</div>
          </div>
          <div className={styles.bankBlock}>
            <b>Bank Details:</b><br />
            A/C No: 1235115000017006<br />
            Bank Name: Karur Vysya Bank<br />
            Branch: P.N Road<br />
            IFSC: KVBL0001235
          </div>
          <div className={styles.signBlock}>
            <div>For Kanmani Trading Company</div>
            <div className={styles.signLine} />
            <div>Authorised Signature</div>
          </div>
        </div>

        <div className={styles.poweredBy}>Powered by Ledgix</div>
      </div>
    </div>
  )
}
