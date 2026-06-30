import { useState } from 'react';
import { downloadFile, previewUrl, deleteFile, deleteBulk, downloadBulk } from '../api/client';
import { useToast } from '../hooks/useToast';
import FilePreview from './FilePreview';
import styles from './FileList.module.css';

// ── Helpers ───────────────────────────────────────────────────────

function humanSize(file) {
  if (file.size_human) return file.size_human;
  let bytes = file.size;
  if (bytes == null) return '';
  const units = ['B','KB','MB','GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

const EXT_ICON = {
  pdf:'📄', zip:'🗜', tar:'🗜', gz:'🗜', rar:'🗜', '7z':'🗜',
  jpg:'🖼', jpeg:'🖼', png:'🖼', gif:'🖼', webp:'🖼', svg:'🖼', bmp:'🖼', avif:'🖼',
  mp4:'🎬', mov:'🎬', mkv:'🎬', avi:'🎬', webm:'🎬',
  mp3:'🎵', wav:'🎵', flac:'🎵', aac:'🎵', ogg:'🎵',
  txt:'📝', md:'📝',
  js:'💻', ts:'💻', py:'💻', jsx:'💻', tsx:'💻',
  html:'💻', css:'💻', scss:'💻', java:'💻', kt:'💻',
  c:'💻', cpp:'💻', cs:'💻', go:'💻', rs:'💻', rb:'💻',
  php:'💻', sh:'💻', swift:'💻', lua:'💻', r:'💻',
  json:'📦', xml:'📦', yaml:'📦', yml:'📦', toml:'📦',
  csv:'📊', xlsx:'📊', xls:'📊', docx:'📃', doc:'📃', pptx:'📊',
};

function fileIcon(name) {
  const e = name.split('.').pop().toLowerCase();
  return EXT_ICON[e] || '📎';
}

const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','avif']);

function isImage(name) {
  return IMAGE_EXTS.has((name.split('.').pop() || '').toLowerCase());
}

// Thumbnails use previewUrl() from api/client (sends ?inline=1 so browser renders)

function groupByFolder(files) {
  const flat = [], folders = {};
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

// ── Grid card ─────────────────────────────────────────────────────

function GridCard({ file, selected, onToggle, onPreview, onDownload, onDelete }) {
  const [rippling, setRippling]       = useState(false);
  const [justSelected, setJustSelected] = useState(false);
  const [thumbErr, setThumbErr]       = useState(false);
  const showThumb = isImage(file.name) && !thumbErr;

  function handleCardClick(e) {
    // Clicks on action buttons handled separately
    if (e.target.closest('button') || e.target.closest('input')) return;
    onPreview();
  }

  function handleToggle(e) {
    e.stopPropagation();
    setRippling(true);
    if (!selected) setJustSelected(true);
    setTimeout(() => setRippling(false), 400);
    setTimeout(() => setJustSelected(false), 600);
    onToggle();
  }

  return (
    <div
      className={[
        styles.gridCard, 'glass',
        selected     ? styles.gridCardSelected : '',
        rippling     ? styles.rowRipple   : '',
        justSelected ? styles.rowFlash    : '',
      ].filter(Boolean).join(' ')}
      onClick={handleCardClick}
    >
      {/* Checkbox */}
      <div className={styles.gridCheck} onClick={handleToggle}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => {}}
          className={styles.checkbox}
        />
      </div>

      {/* Thumbnail or icon */}
      <div className={styles.gridThumb}>
        {showThumb
          ? <img
              src={previewUrl(file.name)}
              alt={file.name}
              className={styles.gridThumbImg}
              onError={() => setThumbErr(true)}
            />
          : <span className={styles.gridThumbIcon}>{fileIcon(file.name)}</span>
        }
        {/* Kind badge overlay */}
        {file.kind && file.kind !== 'other' && (
          <span className={`${styles.gridKindBadge} ${styles[`kind_${file.kind}`]}`}>
            {file.kind}
          </span>
        )}
      </div>

      {/* Info */}
      <div className={styles.gridInfo}>
        <div className={styles.gridName} title={file.name}>{file.name}</div>
        <div className={`${styles.gridMeta} mono`}>
          <span>{humanSize(file)}</span>
        </div>
      </div>

      {/* Hover actions */}
      <div className={styles.gridActions}>
        <button className={styles.gridActBtn} onClick={e => { e.stopPropagation(); onPreview(); }} title="Preview">👁</button>
        <button className={styles.gridActBtn} onClick={e => { e.stopPropagation(); onDownload(); }} title="Download">⬇</button>
        <button className={`${styles.gridActBtn} ${styles.deleteBtn}`} onClick={e => { e.stopPropagation(); onDelete(); }} title="Delete">🗑</button>
      </div>
    </div>
  );
}

// ── List row ──────────────────────────────────────────────────────

function FileRow({ file, selected, onToggle, onPreview, onDownload, onDelete }) {
  const [rippling, setRippling]         = useState(false);
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
        type="checkbox" checked={selected}
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
          <span className={`${styles.kindBadge} ${styles[`kind_${file.kind}`]}`}>{file.kind}</span>
        )}
      </span>
      <span className={`${styles.fileMeta} mono muted`}>
        <span>{humanSize(file)}</span>
        {file.uploaded && <span className={styles.uploadedDate}>{file.uploaded}</span>}
      </span>
      <div className={styles.fileActions}>
        <button className={styles.actionBtn} onClick={e => { e.stopPropagation(); onPreview(); }} title="Preview">👁</button>
        <button className={styles.actionBtn} onClick={e => { e.stopPropagation(); onDownload(); }} title="Download">⬇</button>
        <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={e => { e.stopPropagation(); onDelete(); }} title="Delete">🗑</button>
      </div>
    </div>
  );
}

// ── Tree row ──────────────────────────────────────────────────────

function TreeFileRow({ file, onPreview, onDownload, onDelete }) {
  return (
    <div className={styles.treeFileRow}>
      <span className={styles.treeIcon}>{fileIcon(file.baseName || file.name)}</span>
      <span className={styles.treeFileName}>{file.baseName || file.name}</span>
      <span className={`${styles.treeFileSize} muted`}>{humanSize(file)}</span>
      <div className={styles.treeFileActions}>
        <button className={styles.actionBtn} onClick={onPreview}  title="Preview">👁</button>
        <button className={styles.actionBtn} onClick={onDownload} title="Download">⬇</button>
        <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={onDelete} title="Delete">🗑</button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

export default function FileList({ files, onRefresh }) {
  const toast = useToast();
  const [view,      setView]      = useState('grid'); // list | grid | tree
  const [selected,  setSelected]  = useState(new Set());
  const [collapsed, setCollapsed] = useState(new Set());
  const [preview,   setPreview]   = useState(null);  // index into files[]
  const [reloading, setReloading] = useState(false);

  async function handleReload() {
    setReloading(true);
    await onRefresh();
    setTimeout(() => setReloading(false), 600);
  }

  function toggleSelect(name) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleAll() {
    setSelected(selected.size === files.length ? new Set() : new Set(files.map(f => f.name)));
  }

  function toggleFolder(folder) {
    setCollapsed(prev => {
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
      if (preview !== null && files[preview]?.name === name) setPreview(null);
      onRefresh();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleBulkDelete() {
    const names = [...selected];
    if (!names.length) return;
    if (!confirm(`Delete ${names.length} file(s)?`)) return;
    try {
      await deleteBulk(names);
      toast(`Deleted ${names.length} file(s)`, 'success');
      setSelected(new Set());
      setPreview(null);
      onRefresh();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleBulkDownload() {
    const names = [...selected];
    if (!names.length) return;
    try {
      await downloadBulk(names);
      toast(`Downloading ${names.length} file(s) as ZIP…`, 'info');
    } catch (err) { toast(err.message, 'error'); }
  }

  if (!files.length) {
    return (
      <div className={`${styles.empty} glass`}>
        <span className={styles.emptyIcon}>📭</span>
        <p>No files yet — upload something!</p>
        <button
          className={`${styles.reloadBtn} ${reloading ? styles.reloadBtnSpin : ''}`}
          onClick={handleReload}
          disabled={reloading}
          style={{ margin: '12px auto 0' }}
          title="Reload"
        >↻</button>
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
            ? <span key={selected.size} className={styles.selCount}><span>✦</span>{selected.size} selected</span>
            : <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
          }
        </label>

        <div className={styles.toolbarRight}>
          {selected.size > 0 && (
            <>
              <button className={`${styles.toolBtn} ${styles.danger}`} onClick={handleBulkDelete}>🗑 Delete</button>
              <button className={styles.toolBtn} onClick={handleBulkDownload}>⬇ ZIP</button>
            </>
          )}
          <button
            className={`${styles.reloadBtn} ${reloading ? styles.reloadBtnSpin : ''}`}
            onClick={handleReload}
            title="Reload file list"
            disabled={reloading}
          >↻</button>
          <div className={`${styles.viewToggle} glass`}>
            <button className={view === 'list' ? styles.viewActive : ''} onClick={() => setView('list')} title="List view">≡</button>
            <button className={view === 'grid' ? styles.viewActive : ''} onClick={() => setView('grid')} title="Grid view">⊞</button>
            <button className={view === 'tree' ? styles.viewActive : ''} onClick={() => setView('tree')} title="Tree view">⊟</button>
          </div>
        </div>
      </div>

      {/* List */}
      {view === 'list' && (
        <div className={styles.list}>
          {files.map((f, i) => (
            <FileRow key={f.name} file={f}
              selected={selected.has(f.name)}
              onToggle={() => toggleSelect(f.name)}
              onPreview={() => setPreview(i)}
              onDownload={() => downloadFile(f.name)}
              onDelete={() => handleDelete(f.name)}
            />
          ))}
        </div>
      )}

      {/* Grid */}
      {view === 'grid' && (
        <div className={styles.grid}>
          {files.map((f, i) => (
            <GridCard key={f.name} file={f}
              selected={selected.has(f.name)}
              onToggle={() => toggleSelect(f.name)}
              onPreview={() => setPreview(i)}
              onDownload={() => downloadFile(f.name)}
              onDelete={() => handleDelete(f.name)}
            />
          ))}
        </div>
      )}

      {/* Tree */}
      {view === 'tree' && (
        <div className={`${styles.tree} mono`}>
          {flat.length > 0 && (
            <div className={`${styles.treeFolder} glass`}>
              <div className={styles.treeFolderHeader}>📂 / (root)</div>
              <div className={styles.treeFolderBody}>
                {flat.map((f, i) => (
                  <TreeFileRow key={f.name} file={{ ...f, baseName: f.name }}
                    onPreview={() => setPreview(i)}
                    onDownload={() => downloadFile(f.name)}
                    onDelete={() => handleDelete(f.name)}
                  />
                ))}
              </div>
            </div>
          )}
          {Object.entries(folders).map(([folder, ffiles]) => (
            <div key={folder} className={`${styles.treeFolder} glass`}>
              <div className={styles.treeFolderHeader} onClick={() => toggleFolder(folder)}>
                <span>{collapsed.has(folder) ? '▶' : '▼'}</span>
                📁 {folder}
                <span className={styles.treeFolderCount}>{ffiles.length} files</span>
              </div>
              {!collapsed.has(folder) && (
                <div className={styles.treeFolderBody}>
                  {ffiles.map(f => (
                    <TreeFileRow key={f.name} file={f}
                      onPreview={() => setPreview(files.indexOf(f))}
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

      {/* Preview modal */}
      {preview !== null && files[preview] && (
        <FilePreview
          file={files[preview]}
          onClose={() => setPreview(null)}
          onDownload={() => downloadFile(files[preview].name)}
          onDelete={() => { handleDelete(files[preview].name); setPreview(null); }}
          hasPrev={preview > 0}
          hasNext={preview < files.length - 1}
          onPrev={() => setPreview(i => Math.max(0, i - 1))}
          onNext={() => setPreview(i => Math.min(files.length - 1, i + 1))}
        />
      )}
    </div>
  );
}
