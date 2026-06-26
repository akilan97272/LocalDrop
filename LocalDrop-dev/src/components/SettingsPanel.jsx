import { useState, useEffect } from 'react';
import { setPassword, getServerInfo } from '../api/client';
import { useToast } from '../hooks/useToast';
import styles from './SettingsPanel.module.css';

function PasswordSection({ serverInfo, onChanged }) {
  const toast = useToast();
  const [currentPw,  setCurrentPw]  = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirmPw,  setConfirmPw]  = useState('');
  const [showPws,    setShowPws]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [strength,   setStrength]   = useState(0); // 0-4

  const hasPassword = serverInfo?.passwordRequired;

  // Password strength meter
  useEffect(() => {
    if (!newPw) { setStrength(0); return; }
    let score = 0;
    if (newPw.length >= 8)                          score++;
    if (newPw.length >= 14)                         score++;
    if (/[A-Z]/.test(newPw) && /[a-z]/.test(newPw)) score++;
    if (/\d/.test(newPw))                           score++;
    if (/[^A-Za-z0-9]/.test(newPw))                score++;
    setStrength(Math.min(4, score));
  }, [newPw]);

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const strengthColor = ['', 'var(--danger)', 'var(--warn)', 'var(--accent)', 'var(--success)'];

  async function handleSubmit(e) {
    e.preventDefault();
    if (newPw && newPw !== confirmPw) {
      toast('Passwords do not match', 'error'); return;
    }
    if (newPw && newPw.length < 4) {
      toast('Password must be at least 4 characters', 'error'); return;
    }
    setLoading(true);
    try {
      const res = await setPassword(currentPw, newPw);
      toast(res.message || 'Password updated ✓', 'success', 5000);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`${styles.section} glass`}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>🔐</span>
        <div>
          <div className={styles.sectionTitle}>Access Password</div>
          <div className={styles.sectionSub}>
            {hasPassword
              ? 'Server is password protected'
              : 'No password set — anyone on the network can access'}
          </div>
        </div>
        <div className={`${styles.pill} ${hasPassword ? styles.pillOn : styles.pillOff}`}>
          {hasPassword ? 'Protected' : 'Open'}
        </div>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        {/* Current password — only shown if one is set */}
        {hasPassword && (
          <div className={styles.field}>
            <label className={styles.label}>Current Password</label>
            <div className={styles.inputRow}>
              <input
                type={showPws ? 'text' : 'password'}
                className={styles.input}
                placeholder="Current password"
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label}>
            New Password
            <span className={styles.labelNote}>(leave blank to remove password)</span>
          </label>
          <div className={styles.inputRow}>
            <input
              type={showPws ? 'text' : 'password'}
              className={styles.input}
              placeholder="New password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
            <button
              type="button"
              className={styles.eyeBtn}
              onClick={() => setShowPws(s => !s)}
              aria-label="Toggle visibility"
            >{showPws ? '🙈' : '👁'}</button>
          </div>

          {/* Strength meter */}
          {newPw.length > 0 && (
            <div className={styles.strengthWrap}>
              <div className={styles.strengthBar}>
                {[1,2,3,4].map(i => (
                  <div
                    key={i}
                    className={styles.strengthSegment}
                    style={{
                      background: i <= strength ? strengthColor[strength] : 'var(--divider)',
                      transition: 'background 0.3s ease',
                    }}
                  />
                ))}
              </div>
              <span className={styles.strengthLabel} style={{ color: strengthColor[strength] }}>
                {strengthLabel[strength]}
              </span>
            </div>
          )}
        </div>

        {newPw && (
          <div className={styles.field}>
            <label className={styles.label}>Confirm New Password</label>
            <input
              type={showPws ? 'text' : 'password'}
              className={`${styles.input} ${confirmPw && confirmPw !== newPw ? styles.inputMismatch : ''}`}
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              autoComplete="new-password"
            />
            {confirmPw && confirmPw !== newPw && (
              <span className={styles.mismatchHint}>Passwords don't match</span>
            )}
          </div>
        )}

        <div className={styles.formActions}>
          {hasPassword && !newPw && (
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnDanger}`}
              disabled={loading || !currentPw}
            >
              {loading ? <span className={styles.spinner}/> : '🔓 Remove Password'}
            </button>
          )}
          {(newPw || !hasPassword) && (
            <button
              type="submit"
              className={styles.btn}
              disabled={loading || (hasPassword && !currentPw) || (newPw && newPw !== confirmPw)}
            >
              {loading
                ? <span className={styles.spinner}/>
                : hasPassword ? '🔑 Update Password' : '🔒 Set Password'}
            </button>
          )}
        </div>
      </form>

      <div className={styles.warning}>
        <span>⚠️</span>
        Changing the password immediately invalidates all active sessions on all devices.
      </div>
    </div>
  );
}

function ServerInfoSection({ serverInfo }) {
  if (!serverInfo) return null;
  const rows = [
    { label: 'Server IP',        value: `${serverInfo.ip}:${serverInfo.port}` },
    { label: 'Max upload size',  value: `${serverInfo.maxMB} MB` },
    { label: 'Encryption',       value: serverInfo.encrypted ? '✓ AES-256-GCM at rest' : 'Off (set LOCALDROP_ENCRYPT=1)' },
    { label: 'Token TTL',        value: `${serverInfo.tokenTTLHours}h` },
    { label: 'Auth',             value: serverInfo.passwordRequired ? 'bcrypt password' : 'Open access' },
  ];

  return (
    <div className={`${styles.section} glass`}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>🛡️</span>
        <div>
          <div className={styles.sectionTitle}>Security Status</div>
          <div className={styles.sectionSub}>Current server configuration</div>
        </div>
      </div>
      <div className={styles.infoTable}>
        {rows.map(r => (
          <div key={r.label} className={styles.infoRow}>
            <span className={styles.infoLabel}>{r.label}</span>
            <span className={`${styles.infoValue} mono`}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPanel({ active }) {
  const [serverInfo, setServerInfo] = useState(null);

  async function reload() {
    try {
      const data = await getServerInfo();
      setServerInfo(data);
    } catch (_) {}
  }

  useEffect(() => {
    if (active) reload();
  }, [active]);

  return (
    <div className={styles.wrap}>
      <PasswordSection serverInfo={serverInfo} onChanged={reload} />
      <ServerInfoSection serverInfo={serverInfo} />
    </div>
  );
}
