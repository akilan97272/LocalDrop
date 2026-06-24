import api from './client'

// ── Auth ──────────────────────────────────────────────────────────────────────
// POST /auth/login         → { access_token, token_type, user }
// POST /auth/logout        → { message }
// GET  /auth/me            → UserOut
// POST /auth/register      → UserOut  (admin only)
export const login        = (data) => api.post('/auth/login', data)
export const getMe        = ()     => api.get('/auth/me')
export const registerUser = (data) => api.post('/auth/register', data)

// ── Seller Company ────────────────────────────────────────────────────────────
// GET  /seller-company     → SellerCompanyOut  (may 404 if not yet configured)
// POST /seller-company     → SellerCompanyOut
// PUT  /seller-company/{id}→ SellerCompanyOut
export const getSellerCompany    = ()       => api.get('/seller-company')
export const createSellerCompany = (data)   => api.post('/seller-company', data)
export const updateSellerCompany = (id, data) => api.put(`/seller-company/${id}`, data)

// ── Financial Years ───────────────────────────────────────────────────────────
// GET  /financial-years          → List[FinancialYearOut]
// GET  /financial-years/active   → FinancialYearOut
// GET  /financial-years/{id}     → FinancialYearOut
// POST /financial-years          → FinancialYearOut  (ADMIN/ACCOUNTANT)
// PUT  /financial-years/{id}     → FinancialYearOut  (ADMIN/ACCOUNTANT)
// GET  /financial-years/{id}/sequence → InvoiceSequenceOut
export const getFinancialYears      = ()         => api.get('/financial-years')
export const getActiveFinancialYear = ()         => api.get('/financial-years/active')
export const getFinancialYear       = (id)       => api.get(`/financial-years/${id}`)
export const createFinancialYear    = (data)     => api.post('/financial-years', data)
export const updateFinancialYear    = (id, data) => api.put(`/financial-years/${id}`, data)
export const getFYSequence          = (id)       => api.get(`/financial-years/${id}/sequence`)

// ── Companies ─────────────────────────────────────────────────────────────────
// GET    /companies                 → List[CompanyOut]  (?is_active, skip, limit)
// GET    /companies/search?q=       → List[CompanyOut]  (name/GSTIN/phone)
// GET    /companies/{id}            → CompanyOut
// POST   /companies                 → CompanyOut
// PUT    /companies/{id}            → CompanyOut
// DELETE /companies/{id}            → { message }  (ADMIN — soft delete)
export const getCompanies    = (params)     => api.get('/companies', { params })
export const searchCompanies = (q)          => api.get('/companies/search', { params: { q } })
export const getCompany      = (id)         => api.get(`/companies/${id}`)
export const createCompany   = (data)       => api.post('/companies', data)
export const updateCompany   = (id, data)   => api.put(`/companies/${id}`, data)
export const deleteCompany   = (id)         => api.delete(`/companies/${id}`)

// ── Products ──────────────────────────────────────────────────────────────────
// GET    /products           → List[ProductOut]  (?is_active, search, skip, limit)
// GET    /products/{id}      → ProductOut
// POST   /products           → ProductOut  (ADMIN/ACCOUNTANT)
// PUT    /products/{id}      → ProductOut  (ADMIN/ACCOUNTANT)
// DELETE /products/{id}      → { message }  (ADMIN — soft delete)
export const getProducts   = (params)     => api.get('/products', { params })
export const getProduct    = (id)         => api.get(`/products/${id}`)
export const createProduct = (data)       => api.post('/products', data)
export const updateProduct = (id, data)   => api.put(`/products/${id}`, data)
export const deleteProduct = (id)         => api.delete(`/products/${id}`)

// ── Invoices ──────────────────────────────────────────────────────────────────
// GET    /invoices           → List[InvoiceOut]  (?company_id, financial_year_id, status, from_date, to_date, skip, limit)
// GET    /invoices/{id}      → InvoiceOut  (with nested items[])
// POST   /invoices           → InvoiceOut  (creates invoice + items + ledger entry atomically)
// PUT    /invoices/{id}      → InvoiceOut  (status, remarks, due_date, bill_number only)
// DELETE /invoices/{id}      → { message }  (cancel — ADMIN/ACCOUNTANT)
// GET    /invoices/{id}/pdf  → PDF blob (streamed)
export const getInvoices        = (params)     => api.get('/invoices', { params })
export const getInvoice         = (id)         => api.get(`/invoices/${id}`)
export const createInvoice      = (data)       => api.post('/invoices', data)
export const updateInvoice      = (id, data)   => api.put(`/invoices/${id}`, data)
export const cancelInvoice      = (id)         => api.delete(`/invoices/${id}`)
export const downloadInvoicePDF = (id)         => api.get(`/invoices/${id}/pdf`, { responseType: 'blob' })

// ── Payments ──────────────────────────────────────────────────────────────────
// GET  /payments                  → List[PaymentOut]  (?company_id, from_date, to_date, skip, limit)
// POST /payments                  → PaymentOut  (creates payment + ledger entry atomically)
// GET  /payments/company/{id}     → List[PaymentOut]  (?from_date, to_date)
// GET  /payments/{id}             → PaymentOut
export const getPayments        = (params)  => api.get('/payments', { params })
export const createPayment      = (data)    => api.post('/payments', data)
export const getCompanyPayments = (id, params) => api.get(`/payments/company/${id}`, { params })
export const getPayment         = (id)      => api.get(`/payments/${id}`)

// ── Ledger ────────────────────────────────────────────────────────────────────
// GET /ledger/company/{id}             → List[LedgerEntryOut]  (?from_date, to_date, skip, limit)
// GET /ledger/company/{id}/statement   → StatementResponse  (running balance — never stored)
// GET /ledger/company/{id}/outstanding → OutstandingResponse (computed dynamically)
export const getLedger      = (id, params) => api.get(`/ledger/company/${id}`, { params })
export const getStatement   = (id, params) => api.get(`/ledger/company/${id}/statement`, { params })
export const getOutstanding = (id)         => api.get(`/ledger/company/${id}/outstanding`)

// ── Credit Notes ──────────────────────────────────────────────────────────────
// GET  /credit-notes        → List[CreditNoteOut]  (?company_id, skip, limit)
// POST /credit-notes        → CreditNoteOut  (creates note + ledger credit entry)
export const getCreditNotes    = (params) => api.get('/credit-notes', { params })
export const createCreditNote  = (data)   => api.post('/credit-notes', data)

// ── Debit Notes ───────────────────────────────────────────────────────────────
// GET  /debit-notes         → List[DebitNoteOut]  (?company_id, skip, limit)
// POST /debit-notes         → DebitNoteOut  (creates note + ledger debit entry)
export const getDebitNotes   = (params) => api.get('/debit-notes', { params })
export const createDebitNote = (data)   => api.post('/debit-notes', data)

// ── Reports ───────────────────────────────────────────────────────────────────
// GET /reports/sales               → SalesReportResponse        (?from_date, to_date, financial_year_id)
// GET /reports/outstanding         → List[OutstandingReportRow]
// GET /reports/payments            → List[PaymentReportRow]      (?from_date, to_date)
// GET /reports/company-wise        → List[CompanyWiseRow]        (?financial_year_id)
// GET /reports/financial-year      → dict                        (?financial_year_id required)
export const getSalesReport       = (params)           => api.get('/reports/sales', { params })
export const getOutstandingReport = ()                 => api.get('/reports/outstanding')
export const getPaymentReport     = (params)           => api.get('/reports/payments', { params })
export const getCompanyWiseReport = (params)           => api.get('/reports/company-wise', { params })
export const getFYReport          = (financial_year_id)=> api.get('/reports/financial-year', { params: { financial_year_id } })
