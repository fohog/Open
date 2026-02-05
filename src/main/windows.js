const path = require('path');
const { app, BrowserWindow, screen, nativeTheme } = require('electron');

let settingsWindow = null;
let chooserWindow = null;
let chooserUsesNativeControls = null;

function quitIfNoWindows() {
  const open = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  if (open.length === 0) app.quit();
}

function normalizeWindowEffect(effect) {
  const value = String(effect || '').toLowerCase();
  if (value === 'acrylic') return 'acrylic';
  if (value === 'tabbed') return 'tabbed';
  return 'mica';
}

function applyWindowEffect(win, effect) {
  if (!win || win.isDestroyed()) return;
  if (process.platform !== 'win32') return;
  if (typeof win.setBackgroundMaterial !== 'function') return;
  try {
    win.setBackgroundMaterial(normalizeWindowEffect(effect));
  } catch (err) {
    // ignore
  }
}

function updateTitleBarSymbolColor(win) {
  if (!win || win.isDestroyed()) return;
  const symbolColor = nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000';
  try {
    win.setTitleBarOverlay({
      color: '#00000000',
      symbolColor,
      height: 30
    });
  } catch (err) {
    // ignore
  }
}

function createSettingsWindow(windowState = {}, windowEffect = 'mica') {
  if (settingsWindow) return settingsWindow;
  const width = Number(windowState.width) || 980;
  const height = Number(windowState.height) || 720;
  const symbolColor = nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000';
  settingsWindow = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    transparent: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor,
      height: 30
    },
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  });

  applyWindowEffect(settingsWindow, windowEffect);
  updateTitleBarSymbolColor(settingsWindow);

  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    quitIfNoWindows();
  });

  return settingsWindow;
}

function showSettingsWindow() {
  if (!settingsWindow) return;
  settingsWindow.show();
  settingsWindow.focus();
}


function createChooserWindow(windowEffect = 'mica', useWindowControls = false) {
  if (chooserWindow && chooserUsesNativeControls !== null && chooserUsesNativeControls !== Boolean(useWindowControls)) {
    try {
      chooserWindow.close();
    } catch (err) {
      // ignore
    }
    chooserWindow = null;
  }
  if (chooserWindow) return chooserWindow;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  chooserUsesNativeControls = Boolean(useWindowControls);
  const symbolColor = nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000';
  chooserWindow = new BrowserWindow({
    width: 500,
    height: 500,
    resizable: false,
    minimizable: chooserUsesNativeControls,
    maximizable: false,
    frame: false,
    titleBarStyle: chooserUsesNativeControls ? 'hidden' : undefined,
    titleBarOverlay: chooserUsesNativeControls
      ? {
          color: '#00000000',
          symbolColor,
          height: 30
        }
      : undefined,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    show: false,
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  });

  applyWindowEffect(chooserWindow, windowEffect);
  updateTitleBarSymbolColor(chooserWindow);

  chooserWindow.loadFile(path.join(__dirname, '..', 'renderer', 'chooser.html'));
  chooserWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  chooserWindow.on('blur', () => {
    if (!chooserWindow || chooserWindow.isDestroyed()) return;
    if (chooserWindow.webContents.isDevToolsOpened()) return;
    chooserWindow.webContents.send('blur');
  });

  chooserWindow.on('closed', () => {
    chooserWindow = null;
    chooserUsesNativeControls = null;
    quitIfNoWindows();
  });

  const x = Math.round(width / 2 - 260);
  const y = Math.round(height / 2 - 260);
  chooserWindow.setPosition(x, y);

  return chooserWindow;
}

function showChooserWindow() {
  if (!chooserWindow) return;
  chooserWindow.show();
  chooserWindow.focus();
}

function closeChooserWindow() {
  if (chooserWindow) chooserWindow.close();
}

module.exports = {
  createSettingsWindow,
  showSettingsWindow,
  createChooserWindow,
  showChooserWindow,
  closeChooserWindow,
  get settingsWindow() {
    return settingsWindow;
  },
  getSettingsWindow() {
    return settingsWindow;
  },
  updateTitleBarSymbolColor,
  applyWindowEffect,
  get chooserWindow() {
    return chooserWindow;
  }
};
