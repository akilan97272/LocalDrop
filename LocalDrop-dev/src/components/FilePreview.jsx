import { useState, useEffect, useRef } from 'react';
import { previewUrl, downloadFile } from '../api/client';
import styles from './FilePreview.module.css';

// ── Language → syntax highlight colour map (no external dep) ─────
const LANG_MAP = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', cpp: 'cpp', cs: 'csharp', go: 'go', rs: 'rust',
  rb: 'ruby', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  html: 'html', css: 'css', scss: 'css', json: 'json', xml: 'xml',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', sql: 'sql',
  md: 'markdown', txt: 'text', csv: 'text', env: 'bash',
  dockerfile: 'dockerfile', makefile: 'makefile',
  lua: 'lua', r: 'r', m: 'matlab', jl: 'julia',
};

const IMAGE_EXTS  = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif']);
const VIDEO_EXTS  = new Set(['mp4','webm','mov','ogg','mkv','avi']);
const AUDIO_EXTS  = new Set(['mp3','wav','flac','aac','ogg','m4a','opus']);
const PDF_EXTS    = new Set(['pdf']);
const CODE_EXTS   = new Set(Object.keys(LANG_MAP));
const MAX_TEXT_BYTES = 512 * 1024; // 512 KB — don't fetch huge files for preview

function ext(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

function previewType(file) {
  const e = ext(file.name);
  if (IMAGE_EXTS.has(e))  return 'image';
  if (VIDEO_EXTS.has(e))  return 'video';
  if (AUDIO_EXTS.has(e))  return 'audio';
  if (PDF_EXTS.has(e))    return 'pdf';
  if (CODE_EXTS.has(e))   return 'code';
  if (file.kind === 'text') return 'code';
  return 'unsupported';
}

// Uses previewUrl() from api/client — sends ?token=&inline=1 so browser renders inline

// ── Tiny syntax highlighter — colour keywords by language family ──
function highlight(code, language) {
  const esc = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Generic patterns applied to all languages
  let h = esc
    // Strings
    .replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g,
      '<span class="tok-str">$1$2$1</span>')
    // Comments
    .replace(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g,
      '<span class="tok-cmt">$1</span>')
    // Numbers
    .replace(/\b(\d+\.?\d*)\b/g,
      '<span class="tok-num">$1</span>');

  // Language-specific keywords — plain JS object (no TS type annotations in .jsx)
  const KW = {
    python:     ['def','class','import','from','return','if','elif','else','for','while','try','except','finally','with','as','pass','break','continue','lambda','yield','async','await','True','False','None','and','or','not','in','is'],
    javascript: ['const','let','var','function','return','if','else','for','while','class','import','export','default','new','this','typeof','instanceof','async','await','try','catch','throw','switch','case','break','continue','of','in','from','null','undefined','true','false'],
    typescript: ['const','let','var','function','return','if','else','for','while','class','import','export','default','new','this','typeof','interface','type','enum','namespace','async','await','try','catch','null','undefined','true','false','string','number','boolean','any','void'],
    java:       ['public','private','protected','class','interface','extends','implements','return','if','else','for','while','new','this','super','static','final','void','import','package','try','catch','throw','throws','null','true','false','int','long','double','float','boolean','String'],
    go:         ['func','return','if','else','for','range','switch','case','break','continue','import','package','var','const','type','struct','interface','go','chan','select','defer','true','false','nil','map','make','new','append','len','cap'],
    rust:       ['fn','let','mut','return','if','else','for','while','loop','match','use','mod','pub','struct','enum','impl','trait','where','async','await','true','false','None','Some','Ok','Err','self','Self','super'],
    kotlin:     ['fun','val','var','return','if','else','for','while','when','class','object','interface','import','package','try','catch','throw','null','true','false','override','open','data','sealed','suspend','companion'],
    swift:      ['func','var','let','return','if','else','for','while','switch','case','class','struct','enum','protocol','import','try','catch','nil','true','false','guard','defer','async','await','self','super'],
    cpp:        ['int','long','double','float','char','bool','void','return','if','else','for','while','class','struct','namespace','using','public','private','protected','new','delete','true','false','nullptr','const','static','virtual'],
    csharp:     ['public','private','protected','class','interface','return','if','else','for','while','new','this','static','void','using','namespace','try','catch','throw','null','true','false','var','async','await','string','int','bool'],
    php:        ['function','return','if','else','for','while','class','interface','extends','implements','echo','new','null','true','false','public','private','protected','static','use','namespace'],
    ruby:       ['def','class','module','return','if','elsif','else','unless','for','while','do','end','nil','true','false','require','include','begin','rescue','attr_reader','attr_writer'],
    bash:       ['if','then','else','elif','fi','for','while','do','done','case','esac','function','return','exit','echo','export','source','local'],
    sql:        ['SELECT','FROM','WHERE','JOIN','LEFT','RIGHT','INNER','ON','GROUP','BY','ORDER','HAVING','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','DROP','ALTER','NULL','NOT','AND','OR','IN','AS','DISTINCT'],
    markdown:   [],
    text:       [],
  };

  const words = KW[language] || KW['javascript'];
  if (words) {
    const pat = new RegExp(`\\b(${words.join('|')})\\b`, 'g');
    h = h.replace(pat, '<span class="tok-kw">$1</span>');
  }

  return h;
}

// ── Sub-components ────────────────────────────────────────────────

function ImagePreview({ file }) {
  const [loaded, setLoaded] = useState(false);
  const [error,  setError]  = useState(false);
  return (
    <div className={styles.imgWrap}>
      {!loaded && !error && <div className={styles.loadSpinner} />}
      {error
        ? <div className={styles.previewError}>Could not load image</div>
        : <img
            src={previewUrl(file.name)}
            alt={file.name}
            className={`${styles.img} ${loaded ? styles.imgLoaded : ''}`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
      }
    </div>
  );
}

function VideoPreview({ file }) {
  return (
    <div className={styles.mediaWrap}>
      <video
        controls
        className={styles.video}
        src={previewUrl(file.name)}
        preload="metadata"
      >
        Your browser doesn't support video preview.
      </video>
    </div>
  );
}

function AudioPreview({ file }) {
  return (
    <div className={styles.audioWrap}>
      <span className={styles.audioIcon}>🎵</span>
      <div className={styles.audioName}>{file.name}</div>
      <div className={styles.audioSize}>{file.size_human}</div>
      <audio controls className={styles.audio} src={previewUrl(file.name)}>
        Your browser doesn't support audio preview.
      </audio>
    </div>
  );
}

function PdfPreview({ file }) {
  return (
    <div className={styles.pdfWrap}>
      <iframe
        src={`${previewUrl(file.name)}#toolbar=1&navpanes=0`}
        className={styles.pdf}
        title={file.name}
      />
    </div>
  );
}

function CodePreview({ file }) {
  const [code,    setCode]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [copied,  setCopied]  = useState(false);
  const language = LANG_MAP[ext(file.name)] || 'text';

  useEffect(() => {
    if (file.size > MAX_TEXT_BYTES) {
      setError(`File is too large to preview (${file.size_human}). Download to view.`);
      setLoading(false);
      return;
    }
    fetch(previewUrl(file.name))
      .then(r => {
        if (!r.ok) throw new Error('Failed to load file');
        return r.text();
      })
      .then(text => { setCode(text); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [file.name]);

  async function handleCopy() {
    try { await navigator.clipboard.writeText(code); }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = code; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const lines = code ? code.split('\n').length : 0;

  return (
    <div className={styles.codeWrap}>
      <div className={styles.codeBar}>
        <span className={styles.codeLang}>{language}</span>
        {code && (
          <>
            <span className={styles.codeLines}>{lines} lines</span>
            <button
              className={`${styles.copyCodeBtn} ${copied ? styles.copyCodeBtnDone : ''}`}
              onClick={handleCopy}
            >
              {copied ? '✓ Copied' : '⎘ Copy'}
            </button>
          </>
        )}
      </div>
      <div className={styles.codeScroll}>
        {loading && <div className={styles.loadSpinner} />}
        {error   && <div className={styles.previewError}>{error}</div>}
        {code != null && (
          <table className={styles.codeTable}>
            <tbody>
              {code.split('\n').map((line, i) => (
                <tr key={i} className={styles.codeLine}>
                  <td className={`${styles.lineNum} mono`}>{i + 1}</td>
                  <td
                    className={`${styles.lineCode} mono`}
                    dangerouslySetInnerHTML={{
                      __html: highlight(line || ' ', language)
                    }}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function UnsupportedPreview({ file }) {
  return (
    <div className={styles.unsupported}>
      <span className={styles.unsupportedIcon}>🗂</span>
      <div className={styles.unsupportedName}>{file.name}</div>
      <div className={styles.unsupportedSub}>
        No preview available for <strong>.{ext(file.name)}</strong> files
      </div>
      <div className={styles.unsupportedMeta}>
        {file.size_human} · {file.uploaded}
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────

export default function FilePreview({ file, onClose, onDownload, onDelete, onPrev, onNext, hasPrev, hasNext }) {
  const [visible, setVisible] = useState(false);
  const type = previewType(file);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Keyboard nav
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape')      close();
      if (e.key === 'ArrowLeft')  onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPrev, onNext]);

  function close() {
    setVisible(false);
    setTimeout(onClose, 280);
  }

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) close();
  }

  return (
    <div
      className={`${styles.backdrop} ${visible ? styles.backdropVisible : ''}`}
      onClick={handleBackdrop}
    >
      <div className={`${styles.blurLayer} ${visible ? styles.blurLayerVisible : ''}`} />

      <div className={`${styles.modal} glass-strong ${visible ? styles.modalVisible : ''}`}>

        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerInfo}>
            <span className={styles.headerType}>{type === 'code' ? (LANG_MAP[ext(file.name)] || 'text') : type}</span>
            <span className={styles.headerName} title={file.name}>{file.name}</span>
            <span className={styles.headerMeta}>{file.size_human} · {file.uploaded}</span>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.hBtn} onClick={onDownload} title="Download">⬇</button>
            <button className={`${styles.hBtn} ${styles.hBtnDanger}`} onClick={onDelete} title="Delete">🗑</button>
            <button className={styles.hBtnClose} onClick={close} title="Close">✕</button>
          </div>
        </div>

        {/* Content */}
        <div className={styles.modalBody}>
          {type === 'image'       && <ImagePreview   file={file} />}
          {type === 'video'       && <VideoPreview   file={file} />}
          {type === 'audio'       && <AudioPreview   file={file} />}
          {type === 'pdf'         && <PdfPreview     file={file} />}
          {type === 'code'        && <CodePreview    file={file} />}
          {type === 'unsupported' && <UnsupportedPreview file={file} />}
        </div>

        {/* Prev / Next */}
        {(hasPrev || hasNext) && (
          <div className={styles.navBar}>
            <button
              className={`${styles.navBtn} ${!hasPrev ? styles.navBtnDisabled : ''}`}
              onClick={onPrev} disabled={!hasPrev}
            >← Prev</button>
            <button
              className={`${styles.navBtn} ${!hasNext ? styles.navBtnDisabled : ''}`}
              onClick={onNext} disabled={!hasNext}
            >Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
