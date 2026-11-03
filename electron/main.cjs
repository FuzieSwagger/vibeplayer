'use strict';

const { app, BrowserWindow, Menu, ipcMain, shell, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_NAME = "M'uzie";
const APP_ID = 'com.fuzieswagger.muzie';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 860;
const MIN_WIDTH = 820;
const MIN_HEIGHT = 620;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
const playlistFile = () => path.join(app.getPath('userData'), 'playlist.json');

const MAX_TRACKS = 5000;
const MAX_NAME_LENGTH = 512;
const MAX_PATH_LENGTH = 4096;

/* --------------------------------------------------------------------------
   Плейлист на диске
   -------------------------------------------------------------------------- */

function sanitizeTrack(value, index) {
  if (!value || typeof value !== 'object') return null;

  const filePath = typeof value.path === 'string' ? value.path.trim() : '';
  if (!filePath || filePath.length > MAX_PATH_LENGTH) return null;

  const fallbackName = path.basename(filePath, path.extname(filePath)) || path.basename(filePath);
  const rawName = typeof value.name === 'string' ? value.name.trim() : '';
  const name = (rawName || fallbackName).slice(0, MAX_NAME_LENGTH);

  const rawExt = typeof value.ext === 'string' ? value.ext.replace(/[^a-z0-9]/gi, '') : '';
  const ext = (rawExt || path.extname(filePath).replace('.', '') || 'audio').toUpperCase().slice(0, 8);

  const size = Number(value.size);
  const id = Number(value.id);

  return {
    id: Number.isFinite(id) && id > 0 ? Math.round(id) : index + 1,
    path: filePath,
    name,
    ext,
    size: Number.isFinite(size) && size >= 0 ? Math.round(size) : 0
  };
}

function readPlaylist() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(playlistFile(), 'utf8'));
  } catch {
    return { tracks: [], currentId: null };
  }

  const rawTracks = Array.isArray(data?.tracks) ? data.tracks : [];
  const tracks = rawTracks
    .slice(0, MAX_TRACKS)
    .map(sanitizeTrack)
    .filter(Boolean)
    .map((track) => {
      let exists = false;
      let size = track.size;

      try {
        const stat = fs.statSync(track.path);
        exists = stat.isFile();
        if (exists) size = stat.size;
      } catch {
        // Файл могли переместить или отключить диск: запись оставляем,
        // чтобы плейлист не терялся, но помечаем как недоступную.
      }

      return { ...track, size, exists };
    });

  const rawCurrent = Number(data?.currentId);
  return {
    tracks,
    currentId: Number.isFinite(rawCurrent) && rawCurrent > 0 ? Math.round(rawCurrent) : null
  };
}

function writePlaylist(payload) {
  const rawTracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
  const tracks = rawTracks
    .slice(0, MAX_TRACKS)
    .map(sanitizeTrack)
    .filter(Boolean);

  const rawCurrent = Number(payload?.currentId);
  const currentId = Number.isFinite(rawCurrent) && rawCurrent > 0 ? Math.round(rawCurrent) : null;

  const file = playlistFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version: 1, currentId, tracks }, null, 2), 'utf8');
  fs.renameSync(temp, file);

  return { ok: true, count: tracks.length };
}

function isAppFrame(event) {
  try {
    return Boolean(event.senderFrame && event.senderFrame.url.startsWith('file://'));
  } catch {
    return false;
  }
}

ipcMain.handle('playlist:load', (event) => {
  if (!isAppFrame(event)) return { tracks: [], currentId: null };
  return readPlaylist();
});

ipcMain.handle('playlist:save', (event, payload) => {
  if (!isAppFrame(event)) return { ok: false, count: 0 };
  return writePlaylist(payload);
});

function readWindowState() {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const width = Number(data.width);
    const height = Number(data.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return {
      width: Math.max(MIN_WIDTH, Math.round(width)),
      height: Math.max(MIN_HEIGHT, Math.round(height)),
      x: Number.isFinite(data.x) ? Math.round(data.x) : undefined,
      y: Number.isFinite(data.y) ? Math.round(data.y) : undefined,
      maximized: Boolean(data.maximized)
    };
  } catch {
    return null;
  }
}

function isVisibleOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const horizontal = bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x;
    const vertical = bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y;
    return horizontal && vertical;
  });
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const bounds = maximized ? win.getNormalBounds() : win.getBounds();
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized }, null, 2));
  } catch {
    // Не критично: при следующем запуске просто откроется окно по умолчанию.
  }
}

function createWindow() {
  const saved = readWindowState();
  const useSavedPosition = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    && isVisibleOnSomeDisplay({ x: saved.x, y: saved.y, width: saved.width, height: saved.height });

  const win = new BrowserWindow({
    width: saved?.width ?? DEFAULT_WIDTH,
    height: saved?.height ?? DEFAULT_HEIGHT,
    x: useSavedPosition ? saved.x : undefined,
    y: useSavedPosition ? saved.y : undefined,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: APP_NAME,
    backgroundColor: '#fdf4ea',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  win.setMenuBarVisibility(false);

  // Заголовок окна и ярлыка всегда остаётся именем приложения.
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle(APP_NAME);
  });

  win.once('ready-to-show', () => {
    if (saved?.maximized) win.maximize();
    win.show();
  });

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('close', () => saveWindowState(win));

  // Ссылки из интерфейса открываются в системном браузере, а не внутри окна.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'));
  return win;
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
