import { useState } from 'react';
import { login } from '../api/client';
import styles from './LoginPage.module.css';

export default function LoginPage({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(password);
      localStorage.setItem('localdrop_token', data.token);
      onSuccess();
    } catch (err) {
      setError(err.message || 'Incorrect password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={`${styles.card} glass-strong`}>
        <span className={styles.icon}>📡</span>
        <h1 className={styles.title}>
          Local<span>Drop</span>
        </h1>
        <p className={styles.sub}>Enter the password to access the file server.</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.inputWrap}>
            <input
              type="password"
              className={styles.input}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? <span className={styles.spinner} /> : 'Unlock →'}
          </button>
        </form>

        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
