import { useState, useEffect, useCallback } from 'react';
import { authStatus, listFiles, getServerInfo } from './api/client';
import { ToastProvider } from './hooks/useToast';

import LoginPage      from './components/LoginPage';
import Header         from './components/Header';
import TabBar         from './components/TabBar';
import UploadZone     from './components/UploadZone';
import FileList       from './components/FileList';
import ClipboardPanel from './components/ClipboardPanel';
import QRModal        from './components/QRModal';

import './themes.css';
import './globals.css';
import './components/toast.css';
import styles from './App.module.css';

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('localdrop_theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('localdrop_theme', theme);
  }, [theme]);
  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return [theme, toggle];
}

export default function App() {
  const [authed, setAuthed]       = useState(false);
  const [checking, setChecking]   = useState(true);
  const [tab, setTab]             = useState('files');
  const [files, setFiles]         = useState([]);
  const [serverInfo, setServerInfo] = useState(null);
  const [showQR, setShowQR]       = useState(false);
  const [theme, toggleTheme]      = useTheme();

  // Check auth on mount
  useEffect(() => {
    authStatus()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
      .finally(() => setChecking(false));
  }, []);

  // Load files + server info when authed
  useEffect(() => {
    if (!authed) return;
    fetchFiles();
    getServerInfo().then(setServerInfo).catch(() => {});
  }, [authed]);

  const fetchFiles = useCallback(async () => {
    try {
      const data = await listFiles();
      setFiles(data.files || []);
    } catch (_) {}
  }, []);

  // Poll files every 30s while on Files tab
  useEffect(() => {
    if (!authed || tab !== 'files') return;
    const id = setInterval(fetchFiles, 30000);
    return () => clearInterval(id);
  }, [authed, tab, fetchFiles]);

  if (checking) {
    return (
      <div className={styles.splash}>
        <div className={styles.splashSpinner} />
      </div>
    );
  }

  if (!authed) {
    return (
      <ToastProvider>
        <LoginPage onSuccess={() => setAuthed(true)} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className={styles.wrap}>
        <Header
          serverInfo={serverInfo}
          onQR={() => setShowQR(true)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={() => setAuthed(false)}
        />

        <TabBar active={tab} onChange={setTab} />

        {/* Files tab */}
        {tab === 'files' && (
          <div>
            <UploadZone onUploadDone={fetchFiles} />
            <FileList files={files} onRefresh={fetchFiles} />
          </div>
        )}

        {/* Clipboard tab */}
        {tab === 'clipboard' && (
          <ClipboardPanel active={tab === 'clipboard'} />
        )}
      </div>

      {showQR && <QRModal onClose={() => setShowQR(false)} />}
    </ToastProvider>
  );
}
