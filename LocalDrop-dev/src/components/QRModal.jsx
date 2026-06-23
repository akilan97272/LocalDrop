import { useEffect, useState } from 'react';
import styles from './QRModal.module.css';

export default function QRModal({ onClose }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    fetch('/qr', { headers: { Authorization: `Bearer ${localStorage.getItem('localdrop_token')}` } })
      .then((r) => r.json())
      .then((d) => setUrl(d.url))
      .catch(() => setUrl(window.location.origin));
  }, []);

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onClose();
  }

  const qrSrc = url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&color=4f8ef7&bgcolor=transparent&data=${encodeURIComponent(url)}`
    : null;

  return (
    <div className={styles.backdrop} onClick={handleBackdrop}>
      <div className={`${styles.modal} glass-strong`}>
        <button className={styles.close} onClick={onClose}>✕</button>
        <h2 className={styles.title}>Scan to Connect</h2>
        <p className={styles.sub}>Open on another device on the same Wi-Fi</p>

        <div className={styles.qrWrap}>
          {qrSrc
            ? <img src={qrSrc} alt="QR code" className={styles.qr} />
            : <div className={styles.qrLoading}>Generating…</div>
          }
        </div>

        {url && (
          <div className={`${styles.urlBox} mono`}>
            {url}
          </div>
        )}
      </div>
    </div>
  );
}
