import { useState } from 'react';
import { downloadFile, deleteFile, deleteBulk, downloadBulk } from '../api/client';
import { useToast } from '../hooks/useToast';
import styles from './FileList.module.css';

function humanSize(file) {
  // Prefer pre-formatted string from server, fall back to computing from bytes
  if (file.size_human) return file.size_human;
  let bytes = file.size;
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    pdf: '📄', zip: '🗜', tar: '🗜', gz: '🗜', rar: '🗜',
    jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼', svg: '🖼',
    mp4: '🎬', mov: '🎬', mkv: '🎬', avi: '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵',
    txt: '📝', md: '📝',
    js: '💻', ts: '💻', py: '💻', jsx: '💻', tsx: '💻', html: '💻', css: '💻',
    json: '📦', xml: '📦', csv: '📊', xlsx: '📊', xls: '📊',
    docx: '📃', doc: '📃', pptx: '📊',
  };
  return map[ext] || '📎';
}

// Group files by folder prefix
function groupByFolder(files) {
  const flat   = [];
  const folders = {};
  for (const f of files) {
    if (f.name.includes('/')) {
      const parts  = f.name.split('/');
      const folder = parts.slice(0, -1).join('/');
      const base   = parts[parts.length - 1];
      if (!folders[folder]) folders[folder] = [];
      folders[folder].push({ ...f, baseName: base });
    } else {
      flat.push(f);
    }
  }
  return { flat, folders };
}

export default function FileList({ files, onRefresh }) {
  const toast = useToast();
  const [view, setView]       = useState('list'); // list | tree
  const [selected, setSelected] = useState(new Set());
  const [collapsed, setCollapsed] = useState(new Set());

  function toggleSelect(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === files.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map((f) => f.name)));
    }
  }

  function toggleFolder(folder) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(folder) ? next.delete(folder) : next.add(folder);
      return next;
    });
  }

  async function handleDelete(name) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteFile(name);
      toast(`Deleted ${name}`, 'success');
      onRefresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleBulkDelete() {
    const names = [...selected];
    if (!names.length) return;
    if (!confirm(`Delete ${names.length} file(s)?`)) return;
    try {
      await deleteBulk(names);
      toast(`Deleted ${names.length} file(s)`, 'success');
      setSelected(new Set());
      onRefresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleBulkDownload() {
    const names = [...selected];
    if (!names.length) return;
    try {
      await downloadBulk(names);
      toast(`Downloading ${names.length} file(s) as ZIP…`, 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (!files.length) {
    return (
      <div className={`${styles.empty} glass`}>
        <span className={styles.emptyIcon}>📭</span>
        <p>No files yet — upload something!</p>
      </div>
    );
  }

  const { flat, folders } = groupByFolder(files);
  const allSelected = selected.size === files.length;

  return (
    <div>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <label className={styles.checkAll}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          {selected.size > 0
            ? <span key={selected.size} className={styles.selCount}>
                <span>✦</span>{selected.size} selected
              </span>
            : <span>{files.length} files</span>
          }
        </label>

        <div className={styles.toolbarRight}>
          {selected.size > 0 && (
            <>
              <button className={`${styles.toolBtn} ${styles.danger}`} onClick={handleBulkDelete}>
                🗑 Delete
              </button>
              <button className={styles.toolBtn} onClick={handleBulkDownload}>
                ⬇ Download ZIP
              </button>
            </>
          )}
          <div className={`${styles.viewToggle} glass`}>
            <button className={view === 'list' ? styles.viewActive : ''} onClick={() => setView('list')}>≡ List</button>
            <button className={view === 'tree' ? styles.viewActive : ''} onClick={() => setView('tree')}>⊞ Tree</button>
          </div>
        </div>
      </div>

      {/* File rows */}
      {view === 'list' && (
        <div className={styles.list}>
          {files.map((f) => (
            <FileRow
              key={f.name}
              file={f}
              selected={selected.has(f.name)}
              onToggle={() => toggleSelect(f.name)}
              onDownload={() => downloadFile(f.name)}
              onDelete={() => handleDelete(f.name)}
            />
          ))}
        </div>
      )}

      {/* Tree view */}
      {view === 'tree' && (
        <div className={`${styles.tree} mono`}>
          {/* Root flat files */}
          {flat.length > 0 && (
            <div className={`${styles.treeFolder} glass`}>
              <div className={styles.treeFolderHeader}>📂 / (root)</div>
              <div className={styles.treeFolderBody}>
                {flat.map((f) => (
                  <TreeFileRow
                    key={f.name}
                    file={{ ...f, baseName: f.name }}
                    onDownload={() => downloadFile(f.name)}
                    onDelete={() => handleDelete(f.name)}
                  />
                ))}
              </div>
            </div>
          )}
          {/* Subfolders */}
          {Object.entries(folders).map(([folder, ffiles]) => (
            <div key={folder} className={`${styles.treeFolder} glass`}>
              <div
                className={styles.treeFolderHeader}
                onClick={() => toggleFolder(folder)}
              >
                <span>{collapsed.has(folder) ? '▶' : '▼'}</span>
                📁 {folder}
                <span className={styles.treeFolderCount}>{ffiles.length} files</span>
              </div>
              {!collapsed.has(folder) && (
                <div className={styles.treeFolderBody}>
                  {ffiles.map((f) => (
                    <TreeFileRow
                      key={f.name}
                      file={f}
                      onDownload={() => downloadFile(f.name)}
                      onDelete={() => handleDelete(f.name)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ file, selected, onToggle, onDownload, onDelete }) {
  const [rippling, setRippling] = useState(false);
  const [justSelected, setJustSelected] = useState(false);

  function handleToggle() {
    setRippling(true);
    if (!selected) setJustSelected(true);
    setTimeout(() => setRippling(false),    400);
    setTimeout(() => setJustSelected(false), 600);
    onToggle();
  }

  return (
    <div
      className={[
        styles.row, 'glass',
        selected     ? styles.rowSelected : '',
        rippling     ? styles.rowRipple   : '',
        justSelected ? styles.rowFlash    : '',
      ].filter(Boolean).join(' ')}
      onClick={handleToggle}
    >
      <div className={`${styles.selBar} ${selected ? styles.selBarActive : ''}`} />
      <input
        type="checkbox"
        checked={selected}
        onChange={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        className={styles.checkbox}
      />
      <span className={`${styles.fileIcon} ${selected ? styles.fileIconSelected : ''}`}>
        {fileIcon(file.name)}
      </span>
      <span className={styles.fileName}>
        {file.name}
        {file.kind && file.kind !== 'other' && (
          <span className={`${styles.kindBadge} ${styles[`kind_${file.kind}`]}`}>
            {file.kind}
          </span>
        )}
      </span>
      <span className={`${styles.fileMeta} mono muted`}>
        <span>{humanSize(file)}</span>
        {file.uploaded && <span className={styles.uploadedDate}>{file.uploaded}</span>}
      </span>
      <div className={styles.fileActions}>
        <button className={styles.actionBtn} onClick={e => { e.stopPropagation(); onDownload(); }} title="Download">⬇</button>
        <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={e => { e.stopPropagation(); onDelete(); }} title="Delete">🗑</button>
      </div>
    </div>
  );
}

function TreeFileRow({ file, onDownload, onDelete }) {
  return (
    <div className={styles.treeFileRow}>
      <span className={styles.treeIcon}>{fileIcon(file.baseName)}</span>
      <span className={styles.treeFileName}>{file.baseName}</span>
      <span className={`${styles.treeFileSize} muted`}>{humanSize(file)}</span>
      <div className={styles.treeFileActions}>
        <button className={styles.actionBtn} onClick={onDownload} title="Download">⬇</button>
        <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={onDelete} title="Delete">🗑</button>
      </div>
    </div>
  );
}
