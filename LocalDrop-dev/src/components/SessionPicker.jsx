import { useState, useEffect, useRef } from 'react';
import { listSessions, createSession, joinSession } from '../api/client';
import styles from './SessionPicker.module.css';

// ── Animated particle background specific to session picker ──────
function Particles() {
  return (
    <div className={styles.particles} aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className={styles.particle} style={{
          left:              `${8 + (i * 7.5) % 90}%`,
          animationDuration: `${3.5 + (i * 0.4) % 4}s`,
          animationDelay:    `${(i * 0.35) % 3}s`,
          width:             `${4 + (i % 3) * 3}px`,
          height:            `${4 + (i % 3) * 3}px`,
          opacity:            0.25 + (i % 4) * 0.1,
        }} />
      ))}
    </div>
  );
}

// ── Modal overlay ────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  const [vis, setVis] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVis(true)); }, []);

  function close() {
    setVis(false);
    setTimeout(onClose, 280);
  }

  return (
    <div className={`${styles.modalBackdrop} ${vis ? styles.modalBackdropVis : ''}`}
         onClick={e => e.target === e.currentTarget && close()}>
      <div className={`${styles.modal} glass-strong ${vis ? styles.modalVis : ''}`}>
        <div className={styles.modalHandle} />
        <button className={styles.modalClose} onClick={close}>✕</button>
        <h2 className={styles.modalTitle}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ── Create session form ──────────────────────────────────────────
function CreateModal({ onClose, onCreate }) {
  const [name,     setName]     = useState('');
  const [pw,       setPw]       = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const nameRef = useRef(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim())     { setError('Please enter a session name.'); return; }
    if (pw.length < 4)    { setError('Password must be at least 4 characters.'); return; }
    if (pw !== confirm)   { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const data = await createSession(name.trim(), pw);
      onCreate(data);
    } catch (err) {
      setError(err.message || 'Failed to create session');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="✦ Create Session" onClose={onClose}>
      <p className={styles.modalSub}>
        Create a private room. Share the name and password with others to collaborate.
      </p>
      <form onSubmit={handleSubmit} className={styles.modalForm}>
        <div className={styles.field}>
          <label className={styles.label}>Room Name</label>
          <input
            ref={nameRef}
            type="text"
            className={styles.input}
            placeholder="e.g. project-alpha"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={48}
          />
          <span className={styles.hint}>{name.length}/48 · letters, numbers, spaces, - _</span>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Password</label>
          <div className={styles.inputRow}>
            <input
              type={showPw ? 'text' : 'password'}
              className={styles.input}
              placeholder="Min 4 characters"
              value={pw}
              onChange={e => setPw(e.target.value)}
              autoComplete="new-password"
            />
            <button type="button" className={styles.eyeBtn}
              onClick={() => setShowPw(s => !s)}>{showPw ? '🙈' : '👁'}</button>
          </div>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Confirm Password</label>
          <input
            type={showPw ? 'text' : 'password'}
            className={`${styles.input} ${confirm && confirm !== pw ? styles.inputErr : ''}`}
            placeholder="Repeat password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
          {confirm && confirm !== pw && (
            <span className={styles.hintErr}>Passwords don't match</span>
          )}
        </div>
        {error && <div className={styles.errorBox}>{error}</div>}
        <button type="submit" className={styles.submitBtn}
          disabled={loading || !name.trim() || pw.length < 4 || pw !== confirm}>
          {loading ? <span className={styles.spinner} /> : '🔒 Create Room'}
        </button>
      </form>
    </Modal>
  );
}

// ── Join session form ────────────────────────────────────────────
function JoinModal({ sessions, prefillName, onClose, onJoin }) {
  const [name,    setName]    = useState(prefillName || '');
  const [pw,      setPw]      = useState('');
  const [showPw,  setShowPw]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const pwRef = useRef(null);

  useEffect(() => {
    // If we arrived with a pre-selected room, focus the password field
    if (prefillName) pwRef.current?.focus();
  }, [prefillName]);

  // Filter out 'main' from joinable sessions — sessions are {id, displayName, main} objects
  const joinable = sessions.filter(s => !s.main);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name) { setError('Please select a session.'); return; }
    setLoading(true);
    try {
      const data = await joinSession(name, pw);
      onJoin(data);
    } catch (err) {
      setError(err.message || 'Failed to join session');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="→ Join Session" onClose={onClose}>
      <p className={styles.modalSub}>
        Enter an existing room name and its password to access shared files.
      </p>
      <form onSubmit={handleSubmit} className={styles.modalForm}>
        <div className={styles.field}>
          <label className={styles.label}>Room Name</label>
          {joinable.length > 0 ? (
            <div className={styles.sessionList}>
              {joinable.map(s => (
                <button
                  type="button"
                  key={s.id}
                  className={`${styles.sessionChip} ${name === s.id ? styles.sessionChipActive : ''}`}
                  onClick={() => setName(s.id)}
                >
                  <span className={styles.sessionDot} />
                  {s.displayName}
                </button>
              ))}
            </div>
          ) : null}
          <input
            type="text"
            className={styles.input}
            placeholder="Type room name…"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Password</label>
          <div className={styles.inputRow}>
            <input
              ref={pwRef}
              type={showPw ? 'text' : 'password'}
              className={styles.input}
              placeholder="Room password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              autoComplete="current-password"
            />
            <button type="button" className={styles.eyeBtn}
              onClick={() => setShowPw(s => !s)}>{showPw ? '🙈' : '👁'}</button>
          </div>
        </div>
        {error && <div className={styles.errorBox}>{error}</div>}
        <button type="submit" className={styles.submitBtn} disabled={loading || !name}>
          {loading ? <span className={styles.spinner} /> : '→ Join Room'}
        </button>
      </form>
    </Modal>
  );
}

// ── Main SessionPicker screen ────────────────────────────────────
export default function SessionPicker({ onEnter }) {
  const [sessions,    setSessions]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [showJoin,    setShowJoin]    = useState(false);
  const [prefillJoin, setPrefillJoin] = useState('');

  useEffect(() => {
    listSessions()
      .then(d => setSessions(d.sessions || []))
      .catch(() => setSessions([{ id: 'main', displayName: 'Main', main: true }]))
      .finally(() => setLoading(false));
  }, []);

  function enterMain() {
    onEnter({ session: 'main', token: null });
  }

  function handleCreated(data) {
    localStorage.setItem('localdrop_token',   data.token);
    localStorage.setItem('localdrop_session', data.session);
    onEnter({ session: data.session, displayName: data.displayName });
  }

  function handleJoined(data) {
    localStorage.setItem('localdrop_token',   data.token);
    localStorage.setItem('localdrop_session', data.session);
    onEnter({ session: data.session });
  }

  // sessions are {id, displayName, main} objects
  const otherSessions = sessions.filter(s => !s.main);

  return (
    <div className={styles.wrap}>
      <Particles />

      <div className={styles.content}>
        {/* Logo */}
        <div className={styles.logo}>
          <span className={styles.logoIcon}>📡</span>
          <div className={styles.logoText}>
            Local<span>Drop</span>
          </div>
          <div className={styles.logoSub}>Local file sharing — pick a session to continue</div>
        </div>

        {/* Main session card */}
        <button className={`${styles.mainCard} glass`} onClick={enterMain}>
          <div className={styles.mainCardLeft}>
            <div className={styles.mainCardIcon}>🏠</div>
            <div>
              <div className={styles.mainCardTitle}>Main Session</div>
              <div className={styles.mainCardSub}>Open access — no password required</div>
            </div>
          </div>
          <div className={styles.mainCardBadge}>Default</div>
          <span className={styles.mainCardArrow}>→</span>
        </button>

        {/* Divider */}
        <div className={styles.divider}>
          <span>or choose a room</span>
        </div>

        {/* Session list */}
        {loading ? (
          <div className={styles.loadingRow}>
            <div className={styles.loadingSpinner} />
            <span>Loading sessions…</span>
          </div>
        ) : otherSessions.length > 0 ? (
          <div className={styles.sessionGrid}>
            {otherSessions.map(s => (
              <button
                key={s.id}
                className={`${styles.sessionCard} glass`}
                onClick={() => { setPrefillJoin(s.id); setShowJoin(true); }}
              >
                <div className={styles.sessionCardIcon}>🔒</div>
                <div className={styles.sessionCardName}>{s.displayName}</div>
                <div className={styles.sessionCardSub}>Password protected</div>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.noSessions}>No other sessions yet</div>
        )}

        {/* Action buttons */}
        <div className={styles.actions}>
          <button className={styles.actionBtn} onClick={() => { setPrefillJoin(''); setShowJoin(true); }}>
            → Join a Session
          </button>
          <button className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
            onClick={() => setShowCreate(true)}>
            ✦ Create Session
          </button>
        </div>

        {/* Session count */}
        <div className={styles.footer}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} available
        </div>
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreated}
        />
      )}
      {showJoin && (
        <JoinModal
          sessions={sessions}
          prefillName={prefillJoin}
          onClose={() => { setShowJoin(false); setPrefillJoin(''); }}
          onJoin={handleJoined}
        />
      )}
    </div>
  );
}