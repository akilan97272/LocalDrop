import { useState, useEffect, useCallback } from 'react';
import { authStatus, listFiles, getServerInfo, joinSession, leaveSession } from './api/client';
import { ToastProvider } from './hooks/useToast';

import SessionPicker from './components/SessionPicker';
import LoginPage     from './components/LoginPage';
import Header        from './components/Header';
import TabBar        from './components/TabBar';
import UploadZone    from './components/UploadZone';
import FileList      from './components/FileList';
import ClipboardPanel from './components/ClipboardPanel';
import QRModal       from './components/QRModal';
import SettingsPanel from './components/SettingsPanel';

import './themes.css';
import './globals.css';
import './components/toast.css';
import styles from './App.module.css';

function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem('localdrop_theme') || 'dark'
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('localdrop_theme', theme);
  }, [theme]);
  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return [theme, toggle];
}

export default function App() {
  const [phase, setPhase]         = useState('loading'); // loading | picker | login | app
  const [passwordRequired, setPR] = useState(false);
  const [session, setSession]     = useState('main');
  const [tab, setTab]             = useState('files');
  const [files, setFiles]         = useState([]);
  const [serverInfo, setServerInfo] = useState(null);
  const [showQR, setShowQR]       = useState(false);
  const [theme, toggleTheme]      = useTheme();

  // ── Bootstrap ───────────────────────────────────────────────────
  useEffect(() => {
    async function bootstrap() {
      try {
        const data = await authStatus();
        setPR(data.passwordRequired);

        if (!data.passwordRequired) {
          // Open main session — get a token silently
          try {
            const { login } = await import('./api/client');
            const res = await login('');
            localStorage.setItem('localdrop_token', res.token);
            localStorage.setItem('localdrop_session', 'main');
          } catch (_) {}
          // Show session picker so user can pick main or another room
          setPhase('picker');
        } else if (data.authenticated) {
          // Valid token already — go to picker to choose session
          setPhase('picker');
        } else {
          // Password required, no token yet
          setPhase('login');
        }
      } catch (_) {
        setPhase('login');
      }
    }
    bootstrap();
  }, []);

  // ── After main-session login (password-protected server) ─────────
  function handleMainLogin() {
    setPhase('picker');
  }

  // ── After picking / creating / joining a session ─────────────────
  function handleSessionEnter({ session: s, token, displayName }) {
    const name = s || 'main';
    setSession(name);
    if (token) {
      localStorage.setItem('localdrop_token', token);
      localStorage.setItem('localdrop_session', name);
    }
    setPhase('app');
  }

  // ── Leave session → back to picker ───────────────────────────────
  async function handleLeaveSession() {
    await leaveSession();
    setSession('main');
    setFiles([]);
    setPhase('picker');
  }

  // ── File fetching ─────────────────────────────────────────────────
  const fetchFiles = useCallback(async () => {
    try {
      const data = await listFiles();
      setFiles(data.files || []);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (phase !== 'app') return;
    fetchFiles();
    getServerInfo().then(setServerInfo).catch(() => {});
  }, [phase]);

  useEffect(() => {
    if (phase !== 'app' || tab !== 'files') return;
    const id = setInterval(fetchFiles, 30000);
    return () => clearInterval(id);
  }, [phase, tab, fetchFiles]);

  // ── Renders ───────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className={styles.splash}>
        <div className={styles.splashSpinner} />
      </div>
    );
  }

  if (phase === 'login') {
    return (
      <ToastProvider>
        <LoginPage onSuccess={handleMainLogin} />
      </ToastProvider>
    );
  }

  if (phase === 'picker') {
    return (
      <ToastProvider>
        <SessionPicker onEnter={handleSessionEnter} />
      </ToastProvider>
    );
  }

  // phase === 'app'
  const isMainSession = session === 'main';
  return (
    <ToastProvider>
      <div className={styles.wrap}>
        <Header
          serverInfo={serverInfo}
          session={session}
          isMainSession={isMainSession}
          onQR={() => setShowQR(true)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleLeaveSession}
        />

        <TabBar active={tab} onChange={setTab} />

        {tab === 'files' && (
          <div>
            <UploadZone onUploadDone={fetchFiles} />
            <FileList files={files} onRefresh={fetchFiles} />
          </div>
        )}

        {tab === 'clipboard' && (
          <ClipboardPanel active={tab === 'clipboard'} />
        )}

        {tab === 'settings' && (
          <SettingsPanel
            active={tab === 'settings'}
            session={session}
            isMainSession={isMainSession}
            onDisbanded={() => {
              // Session is gone — kick back to picker
              localStorage.removeItem('localdrop_token');
              localStorage.removeItem('localdrop_session');
              setSession('main');
              setFiles([]);
              setPhase('picker');
            }}
          />
        )}
      </div>

      {showQR && <QRModal onClose={() => setShowQR(false)} />}
    </ToastProvider>
  );
}
