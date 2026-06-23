import { useRef, useState, useCallback } from 'react';
import { uploadFile } from '../api/client';
import { useToast } from '../hooks/useToast';
import styles from './UploadZone.module.css';

function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function humanEta(sec) {
  if (sec == null || !isFinite(sec)) return '…';
  if (sec > 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  if (sec > 60)   return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
  return `${Math.ceil(sec)}s`;
}

let _queueId = 0;

export default function UploadZone({ onUploadDone }) {
  const toast     = useToast();
  const fileRef   = useRef();
  const folderRef = useRef();
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue]       = useState([]);

  const updateItem = useCallback((id, patch) => {
    setQueue((q) => q.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const removeItem = useCallback((id) => {
    setQueue((q) => q.filter((item) => item.id !== id));
  }, []);

  async function processFiles(files) {
    const arr = Array.from(files);
    if (!arr.length) return;

    const items = arr.map((f) => ({
      id:      ++_queueId,
      name:    f.name,
      size:    f.size,
      pct:     0,
      status:  'uploading', // uploading | done | error
      metrics: '',
      file:    f,
    }));

    setQueue((q) => [...q, ...items]);

    for (const item of items) {
      const startTime = Date.now();
      try {
        await uploadFile(item.file, {
          onProgress(pct, loaded, total, speed) {
            const remaining = total - loaded;
            const eta = speed > 0 ? humanEta(remaining / speed) : '…';
            const metrics = speed > 0
              ? `${humanSize(loaded)} / ${humanSize(total)}  ·  ${humanSize(speed)}/s  ·  ETA ${eta}`
              : `${humanSize(loaded)} / ${humanSize(total)}`;
            updateItem(item.id, { pct, metrics });
          },
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const avgSpeed = humanSize(item.size / elapsed);
        updateItem(item.id, {
          pct: 100,
          status: 'done',
          metrics: `${humanSize(item.size)} in ${elapsed}s · avg ${avgSpeed}/s`,
        });
        toast(`${item.name} uploaded!`, 'success');
        onUploadDone?.();
        setTimeout(() => removeItem(item.id), 3500);
      } catch (err) {
        const msg = err.status === 413
          ? 'File too large for server limit'
          : err.message;
        updateItem(item.id, { status: 'error', metrics: msg });
        toast(msg, 'error', 6000);
        setTimeout(() => removeItem(item.id), 6000);
      }
    }
  }

  // Drag events
  function onDragOver(e)  { e.preventDefault(); setDragging(true); }
  function onDragLeave()  { setDragging(false); }
  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    processFiles(e.dataTransfer.files);
  }

  return (
    <>
      {/* Drop zone */}
      <div
        className={`${styles.zone} ${dragging ? styles.over : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <span className={styles.icon}>☁️</span>
        <div className={styles.title}>Drop files here</div>
        <div className={styles.sub}>or pick files from your device</div>
        <div className={styles.btnRow}>
          <button className={styles.pickBtn} onClick={() => fileRef.current.click()}>
            📁 Choose Files
          </button>
          <button className={styles.pickBtn} onClick={() => folderRef.current.click()}>
            🗂 Choose Folder
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => processFiles(e.target.files)}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          webkitdirectory=""
          style={{ display: 'none' }}
          onChange={(e) => processFiles(e.target.files)}
        />
      </div>

      {/* Upload queue */}
      {queue.length > 0 && (
        <div className={styles.queue}>
          {queue.map((item) => (
            <div key={item.id} className={`${styles.qItem} glass`}>
              <div className={styles.qHeader}>
                <span className={styles.qName}>{item.name}</span>
                <span className={`${styles.qStatus} ${styles[item.status]}`}>
                  {item.status === 'uploading' && `${item.pct}%`}
                  {item.status === 'done'      && 'Done ✓'}
                  {item.status === 'error'     && 'Error ✗'}
                </span>
              </div>
              <div className={styles.barBg}>
                <div
                  className={styles.barFill}
                  style={{
                    width: `${item.pct}%`,
                    background: item.status === 'error' ? 'var(--danger)'
                              : item.status === 'done'  ? 'var(--success)'
                              : 'var(--accent)',
                  }}
                />
              </div>
              {item.metrics && (
                <div className={`${styles.metrics} mono`}>{item.metrics}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
