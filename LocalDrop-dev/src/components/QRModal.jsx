import { useEffect, useState, useRef } from 'react';
import styles from './QRModal.module.css';

export default function QRModal({ onClose }) {
  const [url, setUrl]         = useState('');
  const [visible, setVisible] = useState(false);  // controls enter/exit animation
  const [copied, setCopied]   = useState(false);
  const modalRef              = useRef(null);

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Fetch server URL
  useEffect(() => {
    fetch('/api/server-info', {
      headers: { Authorization: `Bearer ${localStorage.getItem('localdrop_token')}` },
    })
      .then(r => r.json())
      .then(d => setUrl(d.url || window.location.origin))
      .catch(() => setUrl(window.location.origin));
  }, []);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Close with exit animation
  function close() {
    setVisible(false);
    setTimeout(onClose, 320);
  }

  // Backdrop click — close only if clicking the backdrop itself
  function handleBackdrop(e) {
    if (e.target === e.currentTarget) close();
  }

  // Swipe-down-to-close on mobile
  const touchStartY = useRef(0);
  function onTouchStart(e) { touchStartY.current = e.touches[0].clientY; }
  function onTouchEnd(e) {
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    if (delta > 60) close();
  }

  // Copy URL
  async function copyUrl() {
    try { await navigator.clipboard.writeText(url); }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const qrColor = '#4f8ef7';
  const qrSrc = url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=${qrColor.replace('#','')}&bgcolor=00000000&qzone=1&data=${encodeURIComponent(url)}`
    : null;

  return (
    <div
      className={`${styles.backdrop} ${visible ? styles.backdropVisible : ''}`}
      onClick={handleBackdrop}
    >
      {/* Blur layer (separate so we can animate it independently) */}
      <div className={`${styles.blurLayer} ${visible ? styles.blurLayerVisible : ''}`} />

      <div
        ref={modalRef}
        className={`${styles.modal} glass-strong ${visible ? styles.modalVisible : ''}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle — mobile only */}
        <div className={styles.handle} />

        {/* Close button */}
        <button className={styles.close} onClick={close} aria-label="Close">✕</button>

        {/* Header */}
        <div className={styles.header}>
          <span className={styles.headerIcon}>📡</span>
          <h2 className={styles.title}>Scan to Connect</h2>
          <p className={styles.sub}>Open on any device on the same Wi-Fi</p>
        </div>

        {/* QR code */}
        <div className={styles.qrWrap}>
          {qrSrc ? (
            <img
              src={qrSrc}
              alt="QR code to connect"
              className={`${styles.qr} ${qrSrc ? styles.qrLoaded : ''}`}
            />
          ) : (
            <div className={styles.qrSkeleton}>
              <div className={styles.qrSkeletonInner} />
            </div>
          )}

          {/* Animated corner brackets */}
          <div className={`${styles.corner} ${styles.cornerTL}`} />
          <div className={`${styles.corner} ${styles.cornerTR}`} />
          <div className={`${styles.corner} ${styles.cornerBL}`} />
          <div className={`${styles.corner} ${styles.cornerBR}`} />
        </div>

        {/* URL pill — tap to copy */}
        <button
          className={`${styles.urlBox} mono ${copied ? styles.urlCopied : ''}`}
          onClick={copyUrl}
          title="Tap to copy URL"
        >
          <span className={styles.urlText}>{url || 'Loading…'}</span>
          <span className={styles.urlCopyHint}>{copied ? '✓ Copied' : '⎘'}</span>
        </button>
      </div>
    </div>
  );
}
