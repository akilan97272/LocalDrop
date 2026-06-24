import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ArrowRight, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth.jsx'
import { useTheme } from '../hooks/useTheme'
import { registerUser } from '../api'
import styles from './Login.module.css'

export default function Login() {
  const { login } = useAuth()
  const { logoName } = useTheme()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'STAFF' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!form.username || !form.password) return toast.error('Fill in all fields')
    setLoading(true)
    try {
      await login(form.username, form.password)
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Invalid credentials')
    } finally { setLoading(false) }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await registerUser(form)
      toast.success('User created — you can now log in')
      setMode('login')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Registration failed')
    } finally { setLoading(false) }
  }

  return (
    <div className={styles.page}>
      <div className="mesh-bg" />

      {/* ── Left panel — brand ── */}
      <div className={styles.leftPanel}>
        <div className={styles.brandContent}>
          <div className={styles.logoGroup}>
            <img src="/ledgix_logo.png" alt="Ledgix Logo" className={styles.logo} />
            <img src={logoName} alt="Ledgix" className={styles.logoName} />
          </div>
          <p className={styles.tagline}>
            Smart Accounting &amp; Billing<br />for Modern Businesses
          </p>
          <div className={styles.features}>
            {[
              'GST-compliant tax invoices',
              'Ledger-based double-entry accounting',
              'Real-time outstanding tracking',
              'Financial year management',
            ].map((f) => (
              <div key={f} className={styles.featureItem}>
                <span className={styles.featureDot} />
                {f}
              </div>
            ))}
          </div>
        </div>
        <div className={styles.poweredBy}>Powered by Ledgix</div>
      </div>

      {/* ── Right panel — form ── */}
      <div className={styles.rightPanel}>
        <div className={`${styles.card} glass-accent`}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`}
              onClick={() => setMode('login')}
            >Sign In</button>
            <button
              className={`${styles.tab} ${mode === 'register' ? styles.tabActive : ''}`}
              onClick={() => setMode('register')}
            ><UserPlus size={14} /> Create User</button>
          </div>

          {mode === 'login' ? (
            <>
              <div className={styles.formHeader}>
                <h2 className={styles.formTitle}>Welcome back</h2>
                <p className={styles.formSubtitle}>Sign in to your Ledgix workspace</p>
              </div>
              <form onSubmit={handleLogin} className={styles.form}>
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input className="form-input" placeholder="admin" value={form.username}
                    onChange={set('username')} autoComplete="username" />
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <div className={styles.passwordWrap}>
                    <input className="form-input" type={showPw ? 'text' : 'password'}
                      placeholder="••••••••" value={form.password} onChange={set('password')}
                      autoComplete="current-password" />
                    <button type="button" className={styles.eyeBtn} onClick={() => setShowPw(v => !v)}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                  {loading ? <span className="spinner" /> : <>Sign In <ArrowRight size={16} /></>}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className={styles.formHeader}>
                <h2 className={styles.formTitle}>Create User</h2>
                <p className={styles.formSubtitle}>Add a new team member (admin access required)</p>
              </div>
              <form onSubmit={handleRegister} className={styles.form}>
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input className="form-input" placeholder="johndoe" value={form.username} onChange={set('username')} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" placeholder="john@company.com" value={form.email} onChange={set('email')} />
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <div className={styles.passwordWrap}>
                    <input className="form-input" type={showPw ? 'text' : 'password'}
                      placeholder="••••••••" value={form.password} onChange={set('password')} />
                    <button type="button" className={styles.eyeBtn} onClick={() => setShowPw(v => !v)}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-input" value={form.role} onChange={set('role')}>
                    <option value="ADMIN">Admin</option>
                    <option value="ACCOUNTANT">Accountant</option>
                    <option value="STAFF">Staff</option>
                  </select>
                </div>
                <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                  {loading ? <span className="spinner" /> : <>Create User <UserPlus size={16} /></>}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
