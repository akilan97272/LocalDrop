import { useState, useEffect, useRef } from 'react';
import { login, getLockoutStatus } from '../api/client';
import styles from './LoginPage.module.css';

function LockoutTimer({ seconds, onExpired }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) { onExpired(); return; }
    const id = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) { clearInterval(id); onExpired(); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return (
    <div className={styles.lockout}>
      <span className={styles.lockoutIcon}>🔒</span>
      <div>
        <div className={styles.lockoutTitle}>Too many failed attempts</div>
        <div className={styles.lockoutTimer}>
          Try again in <strong>{m > 0 ? `${m}m ` : ''}{s}s</strong>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage({ onSuccess }) {
  const [password, setPassword]         = useState('');
  const [error, setError]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [showPw, setShowPw]             = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(null);
  const [lockedFor, setLockedFor]       = useState(0);  // seconds
  const inputRef = useRef(null);

  // On mount, check if this IP is already locked out
  useEffect(() => {
    getLockoutStatus()
      .then(data => {
        if (data.locked)      setLockedFor(data.retryAfter);
        else if (data.attemptsRemaining < 5)
          setAttemptsLeft(data.attemptsRemaining);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(password);
      localStorage.setItem('localdrop_token', data.token);
      onSuccess();
    } catch (err) {
      const msg = err.message || 'Incorrect password';
      setError(msg);

      // Extract attempts remaining from error message if present
      const match = msg.match(/(\d+) attempt/);
      if (match) setAttemptsLeft(parseInt(match[1]));

      // If 429 lockout, re-check and show timer
      if (err.status === 429) {
        getLockoutStatus()
          .then(d => { if (d.locked) setLockedFor(d.retryAfter); })
          .catch(() => {});
      }

      // Shake the input
      inputRef.current?.classList.add(styles.inputShake);
      setTimeout(() => inputRef.current?.classList.remove(styles.inputShake), 500);
    } finally {
      setLoading(false);
    }
  }

  function handleLockoutExpired() {
    setLockedFor(0);
    setAttemptsLeft(null);
    setError('');
    getLockoutStatus()
      .then(d => setAttemptsLeft(d.attemptsRemaining))
      .catch(() => {});
  }

  return (
    <div className={styles.wrap}>
      <div className={`${styles.card} glass-strong`}>
        <span className={styles.icon}>📡</span>
        <h1 className={styles.title}>Local<span>Drop</span></h1>
        <p className={styles.sub}>Enter the password to access the file server.</p>

        {lockedFor > 0 ? (
          <LockoutTimer seconds={lockedFor} onExpired={handleLockoutExpired} />
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.inputWrap} ref={inputRef}>
              <input
                type={showPw ? 'text' : 'password'}
                className={styles.input}
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPw(s => !s)}
                tabIndex={-1}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>

            {/* Attempts warning bar */}
            {attemptsLeft !== null && attemptsLeft < 5 && (
              <div className={styles.attemptsWarn}>
                <div
                  className={styles.attemptsBar}
                  style={{ width: `${(attemptsLeft / 5) * 100}%` }}
                />
                <span className={styles.attemptsText}>
                  {attemptsLeft === 0
                    ? 'No attempts left'
                    : `${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} left`}
                </span>
              </div>
            )}

            <button type="submit" className={styles.btn} disabled={loading}>
              {loading ? <span className={styles.spinner} /> : 'Unlock →'}
            </button>
          </form>
        )}

        {error && !lockedFor && (
          <div className={styles.error}>{error}</div>
        )}
      </div>
    </div>
  );
}
