'use strict';

// Мост между страницей и Electron. contextIsolation остаётся включённым:
// страница получает только маленький API для путей к файлам и плейлиста.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

let pathToFileURL = null;
try {
  ({ pathToFileURL } = require('node:url'));
} catch {
  try {
    ({ pathToFileURL } = require('url'));
  } catch {
    pathToFileURL = null;
  }
}

function fileUrl(filePath) {
  if (typeof filePath !== 'string' || filePath === '') return '';

  if (pathToFileURL) {
    try {
      return pathToFileURL(filePath).href;
    } catch {
      // Ниже — запасной вариант без Node-модулей.
    }
  }

  let normalized = filePath.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;

  const encoded = normalized
    .split('/')
    .map((segment, index) => (index === 1 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');

  return `file://${encoded}`;
}

contextBridge.exposeInMainWorld('muzieDesktop', {
  isDesktop: true,

  // File.path убран из Electron, путь к выбранному файлу отдаёт webUtils.
  getPathForFile(file) {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },

  fileUrl,

  loadPlaylist() {
    return ipcRenderer.invoke('playlist:load');
  },

  savePlaylist(playlist) {
    return ipcRenderer.invoke('playlist:save', playlist);
  },
});
