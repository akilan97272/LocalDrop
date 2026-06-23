import { useState, useEffect, useRef } from 'react';
import { getClipboard, postClipboard, clearClipboard } from '../api/client';
import { useToast } from '../hooks/useToast';
import styles from './ClipboardPanel.module.css';

export default function ClipboardPanel({ active }) {
  const toast = useToast();
  const [text, setText]     = useState('');
  const [items, setItems]   = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  const intervalRef = useRef(null);

  async function poll() {
    try {
      const data = await getClipboard();
      setItems(data.items || []);
    } catch (_) {}
  }

  useEffect(() => {
    if (!active) return;
    poll();
    intervalRef.current = setInterval(poll, 4000);
    return () => clearInterval(intervalRef.current);
  }, [active]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) { toast('Nothing to share — type something first.', 'warn'); return; }
    try {
      await postClipboard(trimmed);
      toast('Text shared ✓', 'success');
      setText('');
      await poll();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleClear() {
    await clearClipboard();
    setItems([]);
    setText('');
    toast('Clipboard cleared.', 'warn');
  }

  async function handleCopy(itemText, id) {
    try {
      await navigator.clipboard.writeText(itemText);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = itemText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopiedId(id);
    toast('Copied!', 'success');
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div>
      {/* Send area */}
      <div className={`${styles.sendBox} glass`}>
        <div className={styles.sendHeader}>
          <span className={styles.sendLabel}>Share Text</span>
          <span className={`${styles.charCount} mono muted`}>
            {text.length.toLocaleString()} char{text.length !== 1 ? 's' : ''}
          </span>
        </div>
        <textarea
          className={styles.textarea}
          placeholder="Type or paste text to share across devices…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
        />
        <div className={styles.sendActions}>
          <button className={styles.clearBtn} onClick={handleClear}>
            🗑 Clear All
          </button>
          <button className={styles.sendBtn} onClick={handleSend}>
            📤 Share →
          </button>
        </div>
      </div>

      {/* Received items */}
      <div className={styles.recvHeader}>
        <span className={styles.recvLabel}>Shared Clips</span>
        <span className={`${styles.recvCount} mono muted`}>
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <div className={`${styles.empty} glass`}>
          <span className={styles.emptyIcon}>📭</span>
          <p>Nothing shared yet — send text from another device.</p>
        </div>
      ) : (
        <div className={styles.clipList}>
          {items.map((item, i) => {
            const time = new Date(item.updated * 1000)
              .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
              <div key={i} className={`${styles.clipItem} glass`}>
                <div className={styles.clipMeta}>
                  <span className={`${styles.clipTime} mono muted`}>{time}</span>
                  <button
                    className={`${styles.copyBtn} ${copiedId === i ? styles.copied : ''}`}
                    onClick={() => handleCopy(item.text, i)}
                  >
                    {copiedId === i ? '✓ Copied' : '⎘ Copy'}
                  </button>
                </div>
                <div className={styles.clipText}>{item.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
