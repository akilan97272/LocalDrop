export const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
    .format(Number(amount) || 0)

export const formatDate = (dateStr) => {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const amountInWords = (amount) => {
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ]
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  const inWords = (n) => {
    if (n === 0) return ''
    if (n < 20) return a[n] + ' '
    if (n < 100) return b[Math.floor(n / 10)] + ' ' + a[n % 10] + ' '
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred ' + inWords(n % 100)
    if (n < 100000) return inWords(Math.floor(n / 1000)) + 'Thousand ' + inWords(n % 1000)
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + 'Lakh ' + inWords(n % 100000)
    return inWords(Math.floor(n / 10000000)) + 'Crore ' + inWords(n % 10000000)
  }

  const num = Math.round(Number(amount))
  if (num === 0) return 'Zero Rupees Only'
  return (inWords(num).trim() + ' Rupees Only').replace(/\s+/g, ' ')
}

export const statusConfig = {
  DRAFT:          { label: 'Draft',          cls: 'badge-default' },
  GENERATED:      { label: 'Generated',      cls: 'badge-info'    },
  PARTIALLY_PAID: { label: 'Partial',        cls: 'badge-warning' },
  PAID:           { label: 'Paid',           cls: 'badge-success' },
  CANCELLED:      { label: 'Cancelled',      cls: 'badge-danger'  },
}
