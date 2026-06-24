import { useState, useEffect, useRef, useCallback } from 'react';
import { getClipboard, postClipboard, clearClipboard } from '../api/client';
import { useToast } from '../hooks/useToast';
import styles from './ClipboardPanel.module.css';

/* ── Particle burst animation ── */
function spawnParticles(fromEl, toEl) {
  if (!fromEl || !toEl) return;
  const fromRect = fromEl.getBoundingClientRect();
  const toRect   = toEl.getBoundingClientRect();

  const originX = fromRect.left + fromRect.width  / 2;
  const originY = fromRect.top  + fromRect.height / 2;
  const destX   = toRect.left   + toRect.width    / 2;
  const destY   = toRect.top    + toRect.height   / 2;

  const count = 12;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'clipboard-particle';

    // Randomise size, delay, scatter
    const size    = 4 + Math.random() * 5;
    const delay   = i * 28;
    const scatterX = (Math.random() - 0.5) * 60;
    const scatterY = (Math.random() - 0.5) * 40;
    const hue     = 200 + Math.random() * 60; // blue → purple band

    Object.assign(el.style, {
      position:    'fixed',
      left:        `${originX}px`,
      top:         `${originY}px`,
      width:       `${size}px`,
      height:      `${size}px`,
      borderRadius: '50%',
      background:  `hsl(${hue}, 90%, 70%)`,
      boxShadow:   `0 0 ${size * 2}px hsl(${hue}, 90%, 70%)`,
      pointerEvents: 'none',
      zIndex:      9998,
      opacity:     '1',
      transform:   'translate(-50%, -50%)',
      transition:  `all ${320 + delay}ms cubic-bezier(0.4, 0, 0.2, 1)`,
      transitionDelay: `${delay}ms`,
    });

    document.body.appendChild(el);

    // Frame 1: scatter mid-air
    requestAnimationFrame(() => {
      el.style.left    = `${originX + scatterX}px`;
      el.style.top     = `${originY + scatterY - 30}px`;
      el.style.opacity = '0.9';

      // Frame 2: fly to destination
      setTimeout(() => {
        el.style.left      = `${destX}px`;
        el.style.top       = `${destY}px`;
        el.style.opacity   = '0';
        el.style.transform = 'translate(-50%, -50%) scale(0.2)';
      }, 80 + delay);

      // Cleanup
      setTimeout(() => el.remove(), 600 + delay);
    });
  }
}

/* ── Ripple on clip item appear ── */
function ClipItem({ item, index, copiedId, onCopy }) {
  const [entering, setEntering] = useState(true);
  const time = new Date(item.updated * 1000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`${styles.clipItem} glass ${entering ? styles.clipEnter : ''}`}>
      <div className={styles.clipMeta}>
        <span className={`${styles.clipTime} mono muted`}>{time}</span>
        <button
          className={`${styles.copyBtn} ${copiedId === index ? styles.copied : ''}`}
          onClick={() => onCopy(item.text, index)}
        >
          {copiedId === index ? '✓ Copied' : '⎘ Copy'}
        </button>
      </div>
      <div className={styles.clipText}>{item.text}</div>
    </div>
  );
}

export default function ClipboardPanel({ active }) {
  const toast        = useToast();
  const [text, setText]         = useState('');
  const [items, setItems]       = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  const [sending, setSending]   = useState(false);
  const intervalRef  = useRef(null);
  const textareaRef  = useRef(null);
  const listRef      = useRef(null);
  const btnRef       = useRef(null);
  const prevCountRef = useRef(0);

  const poll = useCallback(async () => {
    try {
      const data = await getClipboard();
      setItems(data.items || []);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!active) return;
    poll();
    intervalRef.current = setInterval(poll, 4000);
    return () => clearInterval(intervalRef.current);
  }, [active, poll]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) { toast('Nothing to share — type something first.', 'warn'); return; }
    setSending(true);
    try {
      await postClipboard(trimmed);
      // Fire particles from button → list before clearing text
      spawnParticles(btnRef.current, listRef.current);
      setText('');
      await poll();
      toast('Text shared ✓', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
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
          ref={textareaRef}
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
          <button
            ref={btnRef}
            className={`${styles.sendBtn} ${sending ? styles.sending : ''}`}
            onClick={handleSend}
            disabled={sending}
          >
            {sending
              ? <span className={styles.sendingDots}><span/><span/><span/></span>
              : '📤 Share →'
            }
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
        <div ref={listRef} className={styles.clipList}>
          {items.map((item, i) => (
            <ClipItem
              key={`${item.updated}-${i}`}
              item={item}
              index={i}
              copiedId={copiedId}
              onCopy={handleCopy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
