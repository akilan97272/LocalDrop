import { useState, useEffect } from 'react';
import { setPassword, getServerInfo, setMaxUploadSize, disbandSession } from '../api/client';
import { useToast } from '../hooks/useToast';
import styles from './SettingsPanel.module.css';

// ── Password strength ─────────────────────────────────────────────

function strengthScore(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw))   s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLOR = ['', 'var(--danger)', 'var(--warn)', 'var(--accent)', 'var(--success)'];

// ── Password Section ──────────────────────────────────────────────

function PasswordSection({ serverInfo, onChanged }) {
  const toast = useToast();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPws,   setShowPws]   = useState(false);
  const [loading,   setLoading]   = useState(false);
  const strength = strengthScore(newPw);
  const hasPassword = serverInfo?.passwordRequired;

  async function handleSubmit(e) {
    e.preventDefault();
    if (newPw && newPw !== confirmPw) { toast('Passwords do not match', 'error'); return; }
    if (newPw && newPw.length < 4)   { toast('Password must be at least 4 characters', 'error'); return; }
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
            {hasPassword ? 'Server is password protected' : 'No password — anyone on the network can access'}
          </div>
        </div>
        <div className={`${styles.pill} ${hasPassword ? styles.pillOn : styles.pillOff}`}>
          {hasPassword ? 'Protected' : 'Open'}
        </div>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
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
              type="button" className={styles.eyeBtn}
              onClick={() => setShowPws(s => !s)}
            >{showPws ? '🙈' : '👁'}</button>
          </div>
          {newPw.length > 0 && (
            <div className={styles.strengthWrap}>
              <div className={styles.strengthBar}>
                {[1,2,3,4].map(i => (
                  <div key={i} className={styles.strengthSegment}
                    style={{ background: i <= strength ? STRENGTH_COLOR[strength] : 'var(--divider)', transition: 'background 0.3s ease' }}
                  />
                ))}
              </div>
              <span className={styles.strengthLabel} style={{ color: STRENGTH_COLOR[strength] }}>
                {STRENGTH_LABEL[strength]}
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
            <button type="submit"
              className={`${styles.btn} ${styles.btnDanger}`}
              disabled={loading || !currentPw}
            >
              {loading ? <span className={styles.spinner}/> : '🔓 Remove Password'}
            </button>
          )}
          {(newPw || !hasPassword) && (
            <button type="submit" className={styles.btn}
              disabled={loading || (hasPassword && !currentPw) || (newPw && newPw !== confirmPw)}
            >
              {loading ? <span className={styles.spinner}/> : hasPassword ? '🔑 Update Password' : '🔒 Set Password'}
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

// ── Upload Size Section ───────────────────────────────────────────

const SIZE_PRESETS = [
  { label: '100 MB',  value: 100  },
  { label: '500 MB',  value: 500  },
  { label: '1 GB',    value: 1024 },
  { label: '5 GB',    value: 5120 },
  { label: '10 GB',   value: 10240},
];

function UploadSizeSection({ serverInfo, onChanged }) {
  const toast = useToast();
  const [mb,      setMb]      = useState(serverInfo?.maxMB ?? 500);
  const [custom,  setCustom]  = useState('');
  const [mode,    setMode]    = useState('preset'); // preset | custom
  const [loading, setLoading] = useState(false);

  // Sync when serverInfo loads
  useEffect(() => {
    if (serverInfo?.maxMB) {
      const preset = SIZE_PRESETS.find(p => p.value === serverInfo.maxMB);
      if (preset) { setMb(serverInfo.maxMB); setMode('preset'); }
      else         { setCustom(String(serverInfo.maxMB)); setMode('custom'); }
    }
  }, [serverInfo?.maxMB]);

  async function handleApply() {
    const val = mode === 'custom' ? parseInt(custom, 10) : mb;
    if (!val || val < 1) { toast('Enter a valid size', 'error'); return; }
    if (val > 100_000)   { toast('Max is 100 000 MB (100 GB)', 'error'); return; }
    setLoading(true);
    try {
      await setMaxUploadSize(val);
      toast(`Max upload set to ${val >= 1024 ? `${(val/1024).toFixed(1)} GB` : `${val} MB`} ✓`, 'success');
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  const currentMB  = serverInfo?.maxMB ?? 500;
  const displayCur = currentMB >= 1024
    ? `${(currentMB / 1024).toFixed(1)} GB`
    : `${currentMB} MB`;

  return (
    <div className={`${styles.section} glass`}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>📦</span>
        <div>
          <div className={styles.sectionTitle}>Max Upload Size</div>
          <div className={styles.sectionSub}>
            Currently <strong style={{ color: 'var(--text)' }}>{displayCur}</strong> per file
          </div>
        </div>
        <div className={`${styles.pill} ${styles.pillNeutral}`}>{displayCur}</div>
      </div>

      {/* Mode toggle */}
      <div className={styles.modeToggle}>
        <button
          className={`${styles.modeBtn} ${mode === 'preset' ? styles.modeBtnActive : ''}`}
          onClick={() => setMode('preset')}
        >Presets</button>
        <button
          className={`${styles.modeBtn} ${mode === 'custom' ? styles.modeBtnActive : ''}`}
          onClick={() => setMode('custom')}
        >Custom</button>
      </div>

      {mode === 'preset' ? (
        <div className={styles.presetGrid}>
          {SIZE_PRESETS.map(p => (
            <button
              key={p.value}
              className={`${styles.presetBtn} ${mb === p.value ? styles.presetBtnActive : ''}`}
              onClick={() => setMb(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.customRow}>
          <input
            type="number"
            className={styles.input}
            placeholder="e.g. 2048"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            min={1}
            max={100000}
          />
          <span className={styles.customUnit}>MB</span>
        </div>
      )}

      {/* Visual bar */}
      <div className={styles.sizeBarWrap}>
        <div className={styles.sizeBarTrack}>
          <div
            className={styles.sizeBarFill}
            style={{
              width: `${Math.min(100, ((mode === 'custom' ? parseInt(custom)||0 : mb) / 10240) * 100)}%`
            }}
          />
        </div>
        <span className={styles.sizeBarLabel}>
          {mode === 'custom'
            ? (parseInt(custom) >= 1024 ? `${(parseInt(custom)/1024).toFixed(1)} GB` : `${custom || 0} MB`)
            : (mb >= 1024 ? `${(mb/1024).toFixed(1)} GB` : `${mb} MB`)
          }
        </span>
      </div>

      <button
        className={styles.btn}
        onClick={handleApply}
        disabled={loading}
        style={{ width: '100%', marginTop: 4 }}
      >
        {loading ? <span className={styles.spinner}/> : '💾 Apply Size Limit'}
      </button>
    </div>
  );
}

// ── Server Info Section ───────────────────────────────────────────

function ServerInfoSection({ serverInfo }) {
  if (!serverInfo) return null;
  const rows = [
    { label: 'Server IP',    value: `${serverInfo.ip}:${serverInfo.port}` },
    { label: 'Max upload',   value: serverInfo.maxMB >= 1024 ? `${(serverInfo.maxMB/1024).toFixed(1)} GB` : `${serverInfo.maxMB} MB` },
    { label: 'Encryption',   value: serverInfo.encrypted ? '✓ AES-256-GCM at rest' : 'Off' },
    { label: 'Token TTL',    value: `${serverInfo.tokenTTLHours}h` },
    { label: 'Auth',         value: serverInfo.passwordRequired ? 'bcrypt password' : 'Open access' },
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

// ── Disband Section ──────────────────────────────────────────────

function DisbandSection({ session, isMain, onDisbanded }) {
  const toast = useToast();
  const [phase,    setPhase]    = useState('idle'); // idle | confirm | disbanding
  const [inputVal, setInputVal] = useState('');

  // Can't disband main session
  if (isMain) {
    return (
      <div className={`${styles.section} glass`}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>🗑️</span>
          <div>
            <div className={styles.sectionTitle}>Disband Room</div>
            <div className={styles.sectionSub}>
              The Main session cannot be disbanded — it is the default room.
            </div>
          </div>
          <div className={`${styles.pill} ${styles.pillNeutral}`}>N/A</div>
        </div>
      </div>
    );
  }

  async function handleDisband() {
    if (inputVal.trim() !== session) {
      toast('Room name does not match. Type it exactly to confirm.', 'error');
      return;
    }
    setPhase('disbanding');
    try {
      await disbandSession(session);
      toast(`Room "${session}" has been permanently deleted.`, 'success', 5000);
      onDisbanded?.();
    } catch (err) {
      toast(err.message || 'Failed to disband room', 'error');
      setPhase('confirm');
    }
  }

  return (
    <div className={`${styles.section} glass`}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>🗑️</span>
        <div>
          <div className={styles.sectionTitle}>Disband Room</div>
          <div className={styles.sectionSub}>
            Permanently delete this room and <strong style={{color:'var(--danger)'}}>all its files</strong>.
            This cannot be undone.
          </div>
        </div>
        <div className={`${styles.pill} ${styles.pillDanger}`}>{session}</div>
      </div>

      {phase === 'idle' && (
        <button
          className={`${styles.btn} ${styles.btnDanger}`}
          style={{ width: '100%' }}
          onClick={() => setPhase('confirm')}
        >
          🗑️ Disband This Room
        </button>
      )}

      {(phase === 'confirm' || phase === 'disbanding') && (
        <div className={styles.disbandConfirm}>
          <div className={styles.disbandWarning}>
            <span className={styles.disbandWarningIcon}>⚠️</span>
            <div>
              <div className={styles.disbandWarningTitle}>
                This will permanently delete:
              </div>
              <ul className={styles.disbandList}>
                <li>All files uploaded to <strong>{session}</strong></li>
                <li>The room clipboard</li>
                <li>The room folder and all its contents</li>
                <li>The room entry from the session database</li>
              </ul>
              <div className={styles.disbandWarningTitle} style={{marginTop: 10}}>
                This action is <strong>irreversible</strong>.
              </div>
            </div>
          </div>

          <div className={styles.field} style={{marginTop: 14}}>
            <label className={styles.label}>
              Type the room name <strong style={{color:'var(--text)'}}>{session}</strong> to confirm:
            </label>
            <input
              type="text"
              className={`${styles.input} ${inputVal && inputVal !== session ? styles.inputMismatch : ''}`}
              placeholder={session}
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className={styles.disbandActions}>
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => { setPhase('idle'); setInputVal(''); }}
              disabled={phase === 'disbanding'}
            >
              Cancel
            </button>
            <button
              className={`${styles.btn} ${styles.btnDangerFull}`}
              onClick={handleDisband}
              disabled={phase === 'disbanding' || inputVal.trim() !== session}
            >
              {phase === 'disbanding'
                ? <><span className={styles.spinner}/> Deleting…</>
                : '🗑️ Yes, Delete Everything'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────

export default function SettingsPanel({ active, session, isMainSession, onDisbanded }) {
  const [serverInfo, setServerInfo] = useState(null);

  async function reload() {
    try {
      const data = await getServerInfo();
      setServerInfo(data);
    } catch (_) {}
  }

  useEffect(() => { if (active) reload(); }, [active]);

  return (
    <div className={styles.wrap}>
      <PasswordSection    serverInfo={serverInfo} onChanged={reload} />
      <UploadSizeSection  serverInfo={serverInfo} onChanged={reload} />
      <DisbandSection
        session={session || 'main'}
        isMain={isMainSession}
        onDisbanded={onDisbanded}
      />
      <ServerInfoSection  serverInfo={serverInfo} />
    </div>
  );
}