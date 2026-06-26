/**
 * LocalDrop API client
 * All requests include Authorization: Bearer <token> from localStorage.
 * BASE_URL defaults to same-origin; set VITE_API_URL env var to override.
 */

export const BASE_URL = import.meta.env.VITE_API_URL || '';

function getToken() {
  return localStorage.getItem('localdrop_token') || '';
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${getToken()}`,
    ...extra,
  };
}

async function handleResponse(res) {
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const body = ct.includes('json') ? await res.json() : { error: res.statusText };
    throw Object.assign(new Error(body.error || 'Request failed'), { status: res.status });
  }
  if (ct.includes('json')) return res.json();
  return res;
}

// ── Auth ──────────────────────────────────────────────────────────────

export async function authStatus() {
  // Never send a stale/empty Bearer token on the status check —
  // it can cause a 400 on some server configs. Only attach it if
  // we actually have one stored (i.e. a returning session).
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE_URL}/api/auth/status`, { headers });
  return handleResponse(res);
}

export async function login(password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return handleResponse(res);
}

export async function logout() {
  const token = getToken();
  if (!token) return;
  await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: authHeaders(),
  });
  localStorage.removeItem('localdrop_token');
}

// ── Server info ───────────────────────────────────────────────────────

export async function getServerInfo() {
  const res = await fetch(`${BASE_URL}/api/server-info`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ── Files ─────────────────────────────────────────────────────────────

export async function listFiles() {
  const res = await fetch(`${BASE_URL}/api/files`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function deleteFile(filename) {
  const res = await fetch(`${BASE_URL}/api/delete/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function deleteBulk(filenames) {
  const res = await fetch(`${BASE_URL}/api/delete`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filenames }),
  });
  return handleResponse(res);
}

/**
 * Streaming upload with XHR (for progress events).
 * Returns a Promise that resolves with the server response JSON.
 * Calls onProgress(pct, loaded, total, speedBps) during upload.
 */
export function uploadFile(file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/api/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.timeout = 30 * 60 * 1000;

    if (signal) {
      signal.addEventListener('abort', () => xhr.abort());
    }

    let lastLoaded = 0;
    let lastTime = Date.now();

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      let speed = 0;
      if (elapsed > 0.2) {
        speed = (e.loaded - lastLoaded) / elapsed;
        lastLoaded = e.loaded;
        lastTime = now;
      }
      const pct = Math.round((e.loaded / e.total) * 100);
      onProgress?.(pct, e.loaded, e.total, speed);
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { resolve({}); }
      } else {
        let msg = 'Upload failed';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) {}
        reject(Object.assign(new Error(msg), { status: xhr.status }));
      }
    };

    xhr.onerror = () => reject(new Error('Network error — check Wi-Fi and server'));
    xhr.ontimeout = () => reject(new Error('Upload timed out after 30 minutes'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));

    xhr.send(file);
  });
}

/** Single-file download with Range support (browser handles it) */
export function downloadFile(filename) {
  const a = document.createElement('a');
  a.href = `${BASE_URL}/download/${encodeURIComponent(filename)}?token=${getToken()}`;
  a.download = filename;
  a.click();
}

/** Bulk download as ZIP */
export function downloadBulk(filenames) {
  // Use fetch + blob so we can show progress later if needed
  return fetch(`${BASE_URL}/api/download`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filenames }),
  }).then((res) => {
    if (!res.ok) throw new Error('Bulk download failed');
    return res.blob();
  }).then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'localdrop_selection.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
}

// ── Clipboard ─────────────────────────────────────────────────────────

export async function getClipboard() {
  const res = await fetch(`${BASE_URL}/api/clipboard`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function postClipboard(text) {
  const res = await fetch(`${BASE_URL}/api/clipboard`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text }),
  });
  return handleResponse(res);
}

export async function clearClipboard() {
  const res = await fetch(`${BASE_URL}/api/clipboard`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ── Security / Auth management ────────────────────────────────────

export async function getLockoutStatus() {
  const res = await fetch(`${BASE_URL}/api/auth/lockout-status`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function setPassword(currentPassword, newPassword) {
  const res = await fetch(`${BASE_URL}/api/auth/set-password`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  return handleResponse(res);
}

