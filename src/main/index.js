const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { app, ipcMain, nativeTheme, systemPreferences, dialog, shell, Menu, BrowserWindow, nativeImage } = require('electron');
const { execFile } = require('child_process');
const { loadConfig, saveConfig, updateConfig } = require('./config');
const { resolveLocale, loadLocale, t } = require('./i18n');
const {
  scanBuiltInBrowsers,
  openInBrowser,
  htmlExtensions,
  normalizeTarget,
  resolveProfileFolder,
  detectSystemExecutable,
  getRulesForConfig,
  getBaseBrowserRules
} = require('./browsers');
const { registerDefaultHandlers } = require('./associations');
const {
  duplicateChromiumProfile,
  renameChromiumProfile,
  deleteProfileDir,
  duplicateFirefoxProfile,
  renameFirefoxProfile,
  readChromiumBookmarks,
  getFirefoxProfilesRoot,
  getDirSizeStatsAsync
} = require('./profile-manager');
const {
  createSettingsWindow,
  showSettingsWindow,
  createChooserWindow,
  showChooserWindow,
  closeChooserWindow,
  updateTitleBarSymbolColor,
  applyWindowEffect,
  getSettingsWindow
} = require('./windows');
const { chooserWindow } = require('./windows');
const { isRegistered, registerBrowser, unregisterBrowser } = require('./windows-browser');

let pendingTarget = null;
const iconCache = new Map();

function isDebugOverride() {
  const flag = process.env.OPEN_DEBUG || process.env.OPEN_DEBUG_MODE;
  return String(flag).toLowerCase() === 'true' || String(flag) === '1';
}

function setPortableUserData() {
  const exeDir = path.dirname(app.getPath('exe'));
  const baseDir = process.defaultApp ? process.cwd() : exeDir;
  const portableDir = path.join(baseDir, 'OpenData');
  app.setPath('userData', portableDir);
}

setPortableUserData();

function extractTargetFromArgv(argv) {
  let last = '';
  for (const rawArg of argv) {
    if (!rawArg) continue;
    if (rawArg.startsWith('--')) {
      const valueIndex = rawArg.indexOf('=');
      if (valueIndex > -1) {
        const candidate = rawArg.slice(valueIndex + 1);
        const normalized = normalizeArg(candidate);
        if (normalized) last = normalized;
      }
      continue;
    }
    const normalized = normalizeArg(rawArg);
    if (normalized) last = normalized;
  }
  return last;
}

function isAssociationInvocation(argv) {
  return Boolean(extractTargetFromArgv(argv));
}

function normalizeArg(arg) {
  if (!arg) return '';
  const cleaned = arg.replace(/^\"+|\"+$/g, '');
  if (/^(https?:|file:)/i.test(cleaned)) return cleaned;
  const protocolIndex = cleaned.indexOf('http://') >= 0 ? cleaned.indexOf('http://') : cleaned.indexOf('https://');
  if (protocolIndex >= 0) return cleaned.slice(protocolIndex);
  const lower = cleaned.toLowerCase();
  if (htmlExtensions.some((ext) => lower.endsWith(ext))) return cleaned;
  return '';
}

async function getExeIconDataUrl(exePath, index) {
  if (!exePath) return '';
  const cacheKey = `${exePath}|${typeof index === 'number' ? index : typeof index === 'string' ? index : 'default'}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);
  let dataUrl = '';
  if (typeof index === 'number' || typeof index === 'string') {
    const tempName = `open-icon-${crypto.createHash('md5').update(cacheKey).digest('hex')}.png`;
    const tempPath = path.join(os.tmpdir(), tempName);
    const isName = typeof index === 'string';
    const script = `
$path = '${exePath.replace(/'/g, "''")}';
$index = ${typeof index === 'number' ? index : 0};
$name = ${isName ? `'${String(index).replace(/'/g, "''")}'` : '$null'};
$out = '${tempPath.replace(/'/g, "''")}';
Add-Type -AssemblyName System.Drawing;
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IconUtil {
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern uint ExtractIconEx(string szFileName, int nIconIndex, IntPtr[] phiconLarge, IntPtr[] phiconSmall, uint nIcons);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hFile, uint dwFlags);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool FreeLibrary(IntPtr hModule);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr LoadImage(IntPtr hInst, string name, uint type, int cx, int cy, uint fuLoad);
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern bool DestroyIcon(IntPtr handle);
}
"@;
$iconHandle = [IntPtr]::Zero;
if ($name -ne $null -and $name.Length -gt 0) {
  $LOAD_LIBRARY_AS_DATAFILE = 0x00000002;
  $IMAGE_ICON = 1;
  $LR_DEFAULTCOLOR = 0x00000000;
  $hMod = [IconUtil]::LoadLibraryEx($path, [IntPtr]::Zero, $LOAD_LIBRARY_AS_DATAFILE);
  if ($hMod -ne [IntPtr]::Zero) {
    $iconHandle = [IconUtil]::LoadImage($hMod, $name, $IMAGE_ICON, 256, 256, $LR_DEFAULTCOLOR);
    if ($iconHandle -eq [IntPtr]::Zero) {
      $iconHandle = [IconUtil]::LoadImage($hMod, $name, $IMAGE_ICON, 64, 64, $LR_DEFAULTCOLOR);
    }
    if ($iconHandle -eq [IntPtr]::Zero) {
      $iconHandle = [IconUtil]::LoadImage($hMod, $name, $IMAGE_ICON, 32, 32, $LR_DEFAULTCOLOR);
    }
    [IconUtil]::FreeLibrary($hMod) | Out-Null;
  }
} else {
  $large = New-Object IntPtr[] 1;
  [IconUtil]::ExtractIconEx($path, $index, $large, $null, 1) | Out-Null;
  $iconHandle = $large[0];
}
if ($iconHandle -ne [IntPtr]::Zero) {
  $icon = [System.Drawing.Icon]::FromHandle($iconHandle);
  $bmp = $icon.ToBitmap();
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png);
  $bmp.Dispose();
  $icon.Dispose();
  [IconUtil]::DestroyIcon($iconHandle) | Out-Null;
}
`;
    await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], () => resolve());
    });
    if (fs.existsSync(tempPath)) {
      const img = nativeImage.createFromPath(tempPath);
      dataUrl = img && typeof img.toDataURL === 'function' ? img.toDataURL() : '';
    }
  }
  if (!dataUrl && typeof index !== 'number' && typeof index !== 'string') {
    try {
      const img = await app.getFileIcon(exePath, { size: 'large' });
      dataUrl = img && typeof img.toDataURL === 'function' ? img.toDataURL() : '';
    } catch (err) {
      dataUrl = '';
    }
  }
  iconCache.set(cacheKey, dataUrl);
  return dataUrl;
}

async function getBrowserIcons(config) {
  const rules = getRulesForConfig(config);
  const ids = new Set([
    ...Object.keys(config.browsers || {}),
    ...rules.list.map((rule) => (rule && rule.id ? rule.id : '')).filter(Boolean)
  ]);
  const entries = await Promise.all(
    Array.from(ids).map(async (browserId) => {
      const browser = config.browsers && config.browsers[browserId] ? config.browsers[browserId] : null;
      const configuredPath = browser && browser.path ? browser.path : '';
      const systemPath = detectSystemExecutable(browserId, rules);
      const iconPath = configuredPath || systemPath || '';
      const rule = rules.byId && rules.byId[browserId] ? rules.byId[browserId] : null;
      let iconIndex = undefined;
      if (rule && typeof rule.iconResourceId === 'string' && rule.iconResourceId.trim()) {
        iconIndex = rule.iconResourceId.trim();
      } else if (rule && typeof rule.iconResourceId === 'number') {
        iconIndex = -Math.abs(rule.iconResourceId);
      } else if (rule && typeof rule.iconIndex === 'number') {
        iconIndex = rule.iconIndex;
      }
      const icon = iconPath ? await getExeIconDataUrl(iconPath, iconIndex) : '';
      return [browserId, icon];
    })
  );
  return Object.fromEntries(entries.filter(([, icon]) => Boolean(icon)));
}

async function prepareChooserPayload(target) {
  const config = loadConfig();
  const scanned = scanBuiltInBrowsers(config);
  saveConfig(scanned);
  const locale = resolveLocale(scanned.locale);
  const dict = loadLocale(locale);
  const normalized = normalizeTarget(target);
  const browserIcons = await getBrowserIcons(scanned);
  return {
    target: normalized,
    targetKind: normalized.toLowerCase().startsWith('file:') ? 'file' : 'link',
    config: scanned,
    debugOverride: isDebugOverride(),
    theme: getThemePayload(),
    locale,
    dict,
    browserIcons
  };
}

async function prepareManagerPayload() {
  const config = loadConfig();
  const scanned = scanBuiltInBrowsers(config);
  saveConfig(scanned);
  const locale = resolveLocale(scanned.locale);
  const dict = loadLocale(locale);
  const browserIcons = await getBrowserIcons(scanned);
  return {
    config: scanned,
    debugOverride: isDebugOverride(),
    theme: getThemePayload(),
    locale,
    dict,
    browserIcons
  };
}

async function sendChooserPayload(target) {
  const payload = await prepareChooserPayload(target);
  const chooser = createChooserWindow(payload.config.windowEffect, payload.config.chooserWindowControls);
  if (chooser.webContents.isLoading()) {
    chooser.webContents.once('did-finish-load', () => {
      chooser.webContents.send('init', payload);
      showChooserWindow();
    });
  } else {
    chooser.webContents.send('init', payload);
    showChooserWindow();
  }
}

function handleTargetOpen(target) {
  if (!target) return;
  if (!app.isReady()) {
    pendingTarget = target;
    return;
  }
  const config = loadConfig();
  const chooserEnabled = !(config.routing && config.routing.chooser === false);
  if (!chooserEnabled) {
    const last = config.lastSelection || {};
    const browserId = last.browserId || '';
    const profileId = last.profileId || '';
    const browser = (config.browsers && config.browsers[browserId]) || null;
    const enabled = browser ? browser.enabled !== false : true;
    if (browserId && enabled) {
      const result = handleOpenInBrowser({
        browserId,
        profileId,
        target,
        browserPath: browser && browser.path ? browser.path : ''
      });
      if (result && result.ok) return;
    }
  }
  void sendChooserPayload(target);
}

function getThemePayload() {
  const rawAccent = systemPreferences.getAccentColor() || '0078d4ff';
  const accent = rawAccent.length >= 6 ? rawAccent.slice(0, 6) : rawAccent;
  return {
    dark: nativeTheme.shouldUseDarkColors,
    accent: `#${accent.slice(0, 6)}`
  };
}

async function openWindowsDefaultAppsForOpen() {
  const name = encodeURIComponent('Open');
  try {
    return await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${name}`);
  } catch (err) {
    return false;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const target = extractTargetFromArgv(argv);
    if (target) {
      handleTargetOpen(target);
    } else if (!isAssociationInvocation(argv)) {
      createSettingsWindow(loadConfig().window, loadConfig().windowEffect);
      showSettingsWindow();
    }
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url) handleTargetOpen(url);
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (filePath) handleTargetOpen(filePath);
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (url && !url.startsWith('file://')) {
      event.preventDefault();
      handleTargetOpen(url);
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (url && !url.startsWith('file://')) {
      handleTargetOpen(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
});

app.on('ready', () => {
  let config = loadConfig();
  registerDefaultHandlers(config.associations);

  config = scanBuiltInBrowsers(config);
  saveConfig(config);
  const locale = resolveLocale(config.locale);

  const initialTarget = extractTargetFromArgv(process.argv);
  if (initialTarget) {
    handleTargetOpen(initialTarget);
    return;
  }
  if (pendingTarget) {
    handleTargetOpen(pendingTarget);
    pendingTarget = null;
    return;
  }

  if (!isAssociationInvocation(process.argv)) {
    const settingsWindow = createSettingsWindow(config.window, config.windowEffect);
    settingsWindow.once('ready-to-show', () => {
      settingsWindow.show();
    });
    showSettingsWindow();

  }
});

app.on('window-all-closed', () => {
  app.quit();
});

function scheduleQuitIfIdle() {
  setTimeout(() => {
    if (!app.isReady()) return;
    const open = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
    if (open.length === 0) app.quit();
  }, 100);
}

app.on('activate', () => {
  if (createSettingsWindow(loadConfig().window, loadConfig().windowEffect)) {
    showSettingsWindow();
  }
});

app.on('browser-window-created', (_event, win) => {
  win.on('closed', scheduleQuitIfIdle);
});

ipcMain.handle('get-state', async () => {
  const baseConfig = loadConfig();
  const config = scanBuiltInBrowsers(baseConfig);
  const locale = resolveLocale(config.locale);
  const dict = loadLocale(locale);
  return {
    config,
    locale,
    dict,
    debugOverride: isDebugOverride(),
    browserRegistered: isRegistered(),
    theme: getThemePayload(),
    browserRules: getBaseBrowserRules(),
    browserIcons: await getBrowserIcons(config)
  };
});

ipcMain.handle('get-manager-state', async () => {
  return await prepareManagerPayload();
});

ipcMain.handle('save-config', (_event, nextConfig) => {
  updateConfig(nextConfig);
  return { ok: true };
});

ipcMain.handle('set-window-effect', (_event, effect) => {
  const config = loadConfig();
  const allowed = ['mica', 'acrylic', 'tabbed'];
  const next = String(effect || '').toLowerCase();
  config.windowEffect = allowed.includes(next) ? next : 'mica';
  saveConfig(config);
  const settingsWin = createSettingsWindow(loadConfig().window, config.windowEffect);
  if (settingsWin && !settingsWin.isDestroyed()) {
    applyWindowEffect(settingsWin, config.windowEffect);
  }
  const chooserWin = createChooserWindow(config.windowEffect, config.chooserWindowControls);
  if (chooserWin && !chooserWin.isDestroyed()) {
    applyWindowEffect(chooserWin, config.windowEffect);
  }
  return { ok: true };
});

ipcMain.handle('set-associations', (_event, associations) => {
  const config = loadConfig();
  config.associations = Object.assign({}, config.associations, associations || {});
  saveConfig(config);
  registerDefaultHandlers(config.associations);
  return { ok: true };
});

ipcMain.handle('scan-browsers', () => {
  const config = loadConfig();
  const next = scanBuiltInBrowsers(config);
  saveConfig(next);
  return next;
});

ipcMain.handle('manager-scan', async () => {
  return await prepareManagerPayload();
});

ipcMain.handle('manager-open-profiles', (_event, payload) => {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  const results = [];
  for (const item of items) {
    const browserId = item && typeof item.browserId === 'string' ? item.browserId : '';
    const profileId = item && typeof item.profileId === 'string' ? item.profileId : '';
    if (!browserId) continue;
    const config = loadConfig();
    const browser = config.browsers[browserId] || {};
    const result = handleOpenInBrowser({
      browserId,
      profileId,
      target: 'about:blank',
      browserPath: browser.path
    });
    results.push({ browserId, profileId, ok: Boolean(result && result.ok) });
  }
  return { ok: results.some((r) => r.ok), results };
});

ipcMain.handle('manager-hide-profiles', (_event, payload) => {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  const current = loadConfig();
  const next = JSON.parse(JSON.stringify(current));

  for (const item of items) {
    const browserId = item && typeof item.browserId === 'string' ? item.browserId : '';
    const profileId = item && typeof item.profileId === 'string' ? item.profileId : '';
    if (!browserId || !profileId) continue;
    if (!next.browsers || !next.browsers[browserId]) continue;
    const browser = next.browsers[browserId];
    if (!Array.isArray(browser.excludedProfiles)) browser.excludedProfiles = [];
    if (!browser.excludedProfiles.includes(profileId)) browser.excludedProfiles.push(profileId);
    if (next.lastSelection && next.lastSelection.browserId === browserId && next.lastSelection.profileId === profileId) {
      next.lastSelection.profileId = '';
    }
    if (browser.lastProfileId === profileId) browser.lastProfileId = '';
  }

  const scanned = scanBuiltInBrowsers(next);
  saveConfig(scanned);
  return { ok: true, config: scanned };
});

ipcMain.handle('manager-delete-profiles', (_event, payload) => {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  const deleted = [];
  for (const item of items) {
    const browserId = item && typeof item.browserId === 'string' ? item.browserId : '';
    const profileId = item && typeof item.profileId === 'string' ? item.profileId : '';
    if (!browserId || !profileId) continue;
    if (browserId === 'firefox') {
      const root = getFirefoxProfilesRoot(profileId);
      const result = deleteProfileDir({ rootDir: root, profileDir: profileId });
      deleted.push({ browserId, profileId, ok: Boolean(result && result.ok) });
      continue;
    }
    const rules = getRulesForConfig(loadConfig());
    const root = resolveProfileFolder(browserId, '', rules);
    const dir = resolveProfileFolder(browserId, profileId, rules);
    const result = deleteProfileDir({ rootDir: root, profileDir: dir });
    deleted.push({ browserId, profileId, ok: Boolean(result && result.ok) });
  }

  const current = loadConfig();
  const next = JSON.parse(JSON.stringify(current));
  for (const row of deleted.filter((d) => d.ok)) {
    if (!next.browsers || !next.browsers[row.browserId]) continue;
    const browser = next.browsers[row.browserId];
    if (!Array.isArray(browser.excludedProfiles)) browser.excludedProfiles = [];
    if (!browser.excludedProfiles.includes(row.profileId)) browser.excludedProfiles.push(row.profileId);
    if (next.lastSelection && next.lastSelection.browserId === row.browserId && next.lastSelection.profileId === row.profileId) {
      next.lastSelection.profileId = '';
    }
    if (browser.lastProfileId === row.profileId) browser.lastProfileId = '';
  }

  const scanned = scanBuiltInBrowsers(next);
  saveConfig(scanned);
  return { ok: deleted.some((d) => d.ok), deleted, config: scanned };
});

ipcMain.handle('manager-duplicate-profile', (_event, payload) => {
  const browserId = payload && typeof payload.browserId === 'string' ? payload.browserId : '';
  const profileId = payload && typeof payload.profileId === 'string' ? payload.profileId : '';
  const name = payload && typeof payload.name === 'string' ? payload.name : '';
  const options = (payload && payload.options) || {};
  if (!browserId || !profileId) return { ok: false };

  if (browserId === 'firefox') {
    const result = duplicateFirefoxProfile({ profileDir: profileId, toName: name });
    if (!result || !result.ok) return { ok: false, error: result && result.error };
    const scanned = scanBuiltInBrowsers(loadConfig());
    saveConfig(scanned);
    return { ok: true, profileId: result.profileId, config: scanned };
  }

  const rules = getRulesForConfig(loadConfig());
  const userDataDir = resolveProfileFolder(browserId, '', rules);
  const result = duplicateChromiumProfile({
    userDataDir,
    fromProfileId: profileId,
    toName: name,
    options
  });
  if (!result || !result.ok) return { ok: false, error: result && result.error };
  const scanned = scanBuiltInBrowsers(loadConfig());
  saveConfig(scanned);
  return { ok: true, profileId: result.profileId, config: scanned };
});

ipcMain.handle('manager-rename-profile', (_event, payload) => {
  const browserId = payload && typeof payload.browserId === 'string' ? payload.browserId : '';
  const profileId = payload && typeof payload.profileId === 'string' ? payload.profileId : '';
  const name = payload && typeof payload.name === 'string' ? payload.name : '';
  if (!browserId || !profileId) return { ok: false };
  if (browserId === 'firefox') {
    const result = renameFirefoxProfile({ profileDir: profileId, name });
    if (!result || !result.ok) return { ok: false, error: result && result.error };
    const scanned = scanBuiltInBrowsers(loadConfig());
    saveConfig(scanned);
    return { ok: true, config: scanned };
  }
  const rules = getRulesForConfig(loadConfig());
  const userDataDir = resolveProfileFolder(browserId, '', rules);
  const result = renameChromiumProfile({ userDataDir, profileId, name });
  if (!result || !result.ok) return { ok: false, error: result && result.error };
  const scanned = scanBuiltInBrowsers(loadConfig());
  saveConfig(scanned);
  return { ok: true, config: scanned };
});

ipcMain.handle('manager-read-bookmarks', (_event, payload) => {
  const browserId = payload && typeof payload.browserId === 'string' ? payload.browserId : '';
  const profileId = payload && typeof payload.profileId === 'string' ? payload.profileId : '';
  if (!browserId || !profileId) return { ok: false, items: [] };
  if (browserId === 'firefox') return { ok: false, items: [], error: 'unsupported' };
  const rules = getRulesForConfig(loadConfig());
  const userDataDir = resolveProfileFolder(browserId, '', rules);
  return readChromiumBookmarks({ userDataDir, profileId, limit: 300 });
});

ipcMain.handle('manager-profile-files', (_event, payload) => {
  const browserId = payload && typeof payload.browserId === 'string' ? payload.browserId : '';
  const profileId = payload && typeof payload.profileId === 'string' ? payload.profileId : '';
  if (!browserId || !profileId) return { ok: false, files: {} };

  if (browserId === 'firefox') {
    const dir = profileId;
    return {
      ok: true,
      files: {
        profileDir: dir,
        history: path.join(dir, 'places.sqlite'),
        bookmarks: path.join(dir, 'places.sqlite')
      }
    };
  }

  const rules = getRulesForConfig(loadConfig());
  const profileDir = resolveProfileFolder(browserId, profileId, rules);
  return {
    ok: true,
    files: {
      profileDir,
      bookmarks: path.join(profileDir, 'Bookmarks'),
      history: path.join(profileDir, 'History')
    }
  };
});

ipcMain.handle('manager-profile-size', (_event, payload) => {
  const browserId = payload && typeof payload.browserId === 'string' ? payload.browserId : '';
  const profileId = payload && typeof payload.profileId === 'string' ? payload.profileId : '';
  if (!browserId || !profileId) return { ok: false, bytes: 0, files: 0, dirs: 0 };
  const rules = getRulesForConfig(loadConfig());
  const dir = browserId === 'firefox' ? profileId : resolveProfileFolder(browserId, profileId, rules);
  if (!dir) return { ok: false, bytes: 0, files: 0, dirs: 0 };
  let mtimeMs = 0;
  try {
    const stat = fs.statSync(dir);
    mtimeMs = Number(stat.mtimeMs) || 0;
  } catch (err) {
    // ignore
  }

  const config = loadConfig();
  const cacheRoot = config && typeof config.profileSizeCache === 'object' ? config.profileSizeCache : {};
  const byBrowser = cacheRoot && typeof cacheRoot[browserId] === 'object' ? cacheRoot[browserId] : null;
  const cached = byBrowser && byBrowser[profileId] ? byBrowser[profileId] : null;
  if (cached && cached.ok && Number(cached.mtimeMs) === mtimeMs && Number(cached.bytes) >= 0) {
    return { ...cached, cached: true };
  }

  return getDirSizeStatsAsync(dir, { maxFiles: 2500000, maxDepth: 64 }).then((result) => {
    try {
      const next = JSON.parse(JSON.stringify(loadConfig()));
      if (!next.profileSizeCache || typeof next.profileSizeCache !== 'object') next.profileSizeCache = {};
      if (!next.profileSizeCache[browserId] || typeof next.profileSizeCache[browserId] !== 'object') {
        next.profileSizeCache[browserId] = {};
      }
      next.profileSizeCache[browserId][profileId] = {
        ...(result || { ok: false, bytes: 0, files: 0, dirs: 0 }),
        mtimeMs,
        updatedAt: Date.now()
      };
      saveConfig(next);
    } catch (err) {
      // ignore
    }
    return { ...(result || { ok: false, bytes: 0, files: 0, dirs: 0 }), cached: false };
  });
});

ipcMain.handle('reveal-path', async (_event, targetPath) => {
  const p = typeof targetPath === 'string' ? targetPath : '';
  if (!p) return { ok: false };
  try {
    if (typeof shell.showItemInFolder === 'function') {
      shell.showItemInFolder(p);
      return { ok: true };
    }
    const result = await shell.openPath(p);
    return { ok: result === '' };
  } catch (err) {
    return { ok: false };
  }
});

ipcMain.handle('pick-executable', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Pick executable',
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return '';
  return result.filePaths[0];
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Pick folder',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return '';
  return result.filePaths[0];
});

ipcMain.handle('open-target', (_event, payload) => {
  const { browserId, profileId, target } = payload || {};
  const config = loadConfig();
  const browser = config.browsers[browserId] || {};
  return handleOpenInBrowser({
    browserId,
    profileId,
    target,
    browserPath: browser.path
  });
});

ipcMain.handle('open-chooser', (_event, payload) => {
  const kind = payload && payload.kind ? String(payload.kind) : '';
  let target = payload && payload.target ? String(payload.target) : '';
  if (kind === 'test-link') {
    target = 'https://example.com';
  } else if (kind === 'test-file') {
    const filePath = path.join(app.getAppPath(), 'scripts', 'open-test.html');
    if (fs.existsSync(filePath)) {
      target = filePath;
    } else {
      target = 'https://example.com';
    }
  }
  if (target) handleTargetOpen(target);
  return { ok: Boolean(target) };
});

function handleOpenInBrowser({ browserId, profileId, target, browserPath }) {
  const config = loadConfig();
  const rules = getRulesForConfig(config);
  const ok = openInBrowser({
    browserId,
    profileId,
    target,
    browserPath,
    rules
  });
  if (ok) {
    const next = JSON.parse(JSON.stringify(config));
    next.lastSelection = { browserId, profileId };
    if (next.browsers[browserId]) {
      next.browsers[browserId].lastProfileId = profileId;
    }
    saveConfig(next);
  }
  if (!ok) {
    dialog.showMessageBox({
      type: 'error',
      message: 'Failed to open in the selected browser.'
    });
  }
  return { ok };
}

ipcMain.handle('close-chooser', () => {
  closeChooserWindow();
  return { ok: true };
});

ipcMain.handle('show-settings', () => {
  closeChooserWindow();
  const win = createSettingsWindow(loadConfig().window, loadConfig().windowEffect);
  win.once('ready-to-show', () => {
    showSettingsWindow();
  });
  showSettingsWindow();
  return { ok: true };
});

ipcMain.handle('show-manager', () => {
  closeChooserWindow();
  const win = createSettingsWindow(loadConfig().window, loadConfig().windowEffect);
  win.once('ready-to-show', () => {
    showSettingsWindow();
  });
  showSettingsWindow();
  return { ok: true };
});

ipcMain.handle('chooser-control', (_event, action) => {
  const win = createChooserWindow(loadConfig().windowEffect, loadConfig().chooserWindowControls);
  if (!win) return { ok: false };
  if (action === 'minimize') win.minimize();
  if (action === 'close') win.close();
  return { ok: true };
});

ipcMain.handle('set-chooser-controls', (_event, enabled) => {
  const config = loadConfig();
  config.chooserWindowControls = Boolean(enabled);
  saveConfig(config);
  closeChooserWindow();
  createChooserWindow(loadConfig().windowEffect, config.chooserWindowControls);
  return { ok: true };
});

ipcMain.handle('edit-browser', (_event, browserId) => {
  const id = typeof browserId === 'string' ? browserId : '';
  closeChooserWindow();
  const win = createSettingsWindow(loadConfig().window, loadConfig().windowEffect);
  const payload = { browserId: id };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('edit-browser', payload);
      showSettingsWindow();
    });
  } else {
    win.webContents.send('edit-browser', payload);
    showSettingsWindow();
  }
  return { ok: true };
});

ipcMain.handle('window-control', (_event, action) => {
  const win = createSettingsWindow(loadConfig().window, loadConfig().windowEffect);
  if (!win) return { ok: false };
  if (action === 'minimize') win.minimize();
  if (action === 'close') win.close();
  return { ok: true };
});

ipcMain.handle('resize-chooser', () => {
  return { ok: true };
});

ipcMain.handle('theme-state', () => {
  return getThemePayload();
});

async function openWindowsColorsSettings() {
  try {
    return await shell.openExternal('ms-settings:colors');
  } catch (err) {
    return false;
  }
}

ipcMain.handle('open-system-settings', async (_event, target) => {
  const key = typeof target === 'string' ? target : '';
  if (key === 'default-apps') {
    await openWindowsDefaultAppsForOpen();
    return { ok: true };
  }
  if (key === 'appearance') {
    await openWindowsColorsSettings();
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('open-profile-folder', async (_event, payload) => {
  const browserId = payload && typeof payload.browserId === 'string' ? payload.browserId : '';
  const profileId = payload && typeof payload.profileId === 'string' ? payload.profileId : '';
  const rules = getRulesForConfig(loadConfig());
  const folder = resolveProfileFolder(browserId, profileId, rules);
  if (!folder) return { ok: false };
  try {
    const result = await shell.openPath(folder);
    return { ok: result === '' };
  } catch (err) {
    return { ok: false };
  }
});

ipcMain.handle('show-profile-menu', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { ok: false };

  const x = payload && Number.isFinite(payload.x) ? Math.round(payload.x) : undefined;
  const y = payload && Number.isFinite(payload.y) ? Math.round(payload.y) : undefined;
  const browserId = payload && typeof payload.browserId === 'string' ? payload.browserId : '';
  const profileId = payload && typeof payload.profileId === 'string' ? payload.profileId : '';
  const target = payload && typeof payload.target === 'string' ? payload.target : '';
  const labels = (payload && payload.labels) || {};
  const labelOpen = typeof labels.open === 'string' ? labels.open : 'Open';
  const labelReveal = typeof labels.reveal === 'string' ? labels.reveal : 'Reveal';
  const labelCopyPath = typeof labels.copyPath === 'string' ? labels.copyPath : 'Copy path';
  const labelRename = typeof labels.rename === 'string' ? labels.rename : 'Rename';
  const labelDelete = typeof labels.delete === 'string' ? labels.delete : 'Delete';
  const config = loadConfig();
  const browser = config.browsers[browserId] || {};

  function send(action) {
    try {
      win.webContents.send('profile-menu-action', { action, browserId, profileId, target });
    } catch (err) {
      // ignore
    }
  }

  const menu = Menu.buildFromTemplate([
    {
      label: labelOpen,
      enabled: Boolean(browserId && browser.enabled && browser.path && target),
      click: () => {
        const result = handleOpenInBrowser({
          browserId,
          profileId,
          target,
          browserPath: browser.path
        });
        if (result && result.ok) {
          try {
            win.close();
          } catch (err) {
            // ignore
          }
        }
      }
    },
    {
      label: labelReveal,
      enabled: Boolean(browserId && profileId),
      click: () => send('reveal')
    },
    {
      label: labelCopyPath,
      enabled: Boolean(browserId && profileId),
      click: () => send('copy-path')
    },
    {
      label: labelRename,
      enabled: Boolean(browserId && profileId),
      click: () => send('rename')
    },
    {
      label: labelDelete,
      enabled: Boolean(browserId && profileId),
      click: () => send('delete')
    }
  ]);

  menu.popup({ window: win, x, y });
  return { ok: true };
});

ipcMain.handle('show-manager-menu', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { ok: false };

  const x = payload && Number.isFinite(payload.x) ? Math.round(payload.x) : undefined;
  const y = payload && Number.isFinite(payload.y) ? Math.round(payload.y) : undefined;
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  const labels = (payload && payload.labels) || {};

  const labelOpen = labels.open || 'Open';
  const labelReveal = labels.reveal || 'Reveal';
  const labelCopyPath = labels.copyPath || 'Copy path';
  const labelRename = labels.rename || 'Rename';
  const labelDelete = labels.delete || 'Delete';
  const single = items.length === 1 ? items[0] : null;
  const hasSelection = items.length > 0;
  const canSingle = Boolean(single && single.browserId && single.profileId);

  function send(action, extra = {}) {
    try {
      win.webContents.send('manager-menu-action', { action, items, ...extra });
    } catch (err) {
      // ignore
    }
  }

  const template = [
    {
      label: labelOpen,
      enabled: hasSelection,
      click: () => send('open')
    },
    { type: 'separator' },
    {
      label: labelReveal,
      enabled: canSingle,
      click: () => send('reveal')
    },
    {
      label: labelCopyPath,
      enabled: canSingle,
      click: () => send('copy-path')
    },
    {
      label: labelRename,
      enabled: canSingle,
      click: () => send('rename')
    },
    { type: 'separator' },
    {
      label: labelDelete,
      enabled: hasSelection,
      click: () => send('delete')
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win, x, y });
  return { ok: true };
});

ipcMain.handle('show-browser-menu', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { ok: false };

  const x = payload && Number.isFinite(payload.x) ? Math.round(payload.x) : undefined;
  const y = payload && Number.isFinite(payload.y) ? Math.round(payload.y) : undefined;
  const browserId = payload && typeof payload.browserId === 'string' ? payload.browserId : '';
  const labels = (payload && payload.labels) || {};
  const labelReveal = labels.reveal || 'Reveal';
  const labelCopyPath = labels.copyPath || 'Copy path';
  const labelEdit = labels.edit || 'Edit';
  const labelDisable = labels.disable || 'Disable';

  function send(action) {
    try {
      win.webContents.send('browser-menu-action', { action, browserId });
    } catch (err) {
      // ignore
    }
  }

  const template = [
    {
      label: labelReveal,
      enabled: Boolean(browserId),
      click: () => send('reveal')
    },
    {
      label: labelCopyPath,
      enabled: Boolean(browserId),
      click: () => send('copy-path')
    },
    {
      label: labelEdit,
      enabled: Boolean(browserId),
      click: () => send('edit')
    },
    { type: 'separator' },
    {
      label: labelDisable,
      enabled: Boolean(browserId),
      click: () => send('disable')
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win, x, y });
  return { ok: true };
});

ipcMain.handle('show-link-menu', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { ok: false };

  const x = payload && Number.isFinite(payload.x) ? Math.round(payload.x) : undefined;
  const y = payload && Number.isFinite(payload.y) ? Math.round(payload.y) : undefined;
  const labels = (payload && payload.labels) || {};
  const labelCopy = labels.copy || 'Copy link';
  const labelKeepDomain = labels.keepDomain || 'Keep domain only';
  const labelStripFile = labels.stripFile || 'Remove file name';
  const labelStripTrailingSlash = labels.stripTrailingSlash || 'Remove trailing slash';
  const labelStripProtocol = labels.stripProtocol || 'Remove protocol';
  const labelStripQuery = labels.stripQuery || 'Remove query';
  const labelStripHash = labels.stripHash || 'Remove hash';
  const labelStripTracking = labels.stripTracking || 'Remove tracking';

  function send(action) {
    try {
      win.webContents.send('link-menu-action', { action });
    } catch (err) {
      // ignore
    }
  }

  const template = [
    { label: labelCopy, click: () => send('copy') },
    { type: 'separator' },
    { label: labelKeepDomain, click: () => send('keep-domain') },
    { label: labelStripFile, click: () => send('strip-file') },
    { label: labelStripTrailingSlash, click: () => send('strip-trailing-slash') },
    { label: labelStripProtocol, click: () => send('strip-protocol') },
    { label: labelStripQuery, click: () => send('strip-query') },
    { label: labelStripHash, click: () => send('strip-hash') },
    { label: labelStripTracking, click: () => send('strip-tracking') }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win, x, y });
  return { ok: true };
});

nativeTheme.on('updated', () => {
  const settingsWin = getSettingsWindow();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('theme', getThemePayload());
    updateTitleBarSymbolColor(settingsWin);
  }
  const chooserWin = chooserWindow;
  if (chooserWin && !chooserWin.isDestroyed()) {
    chooserWin.webContents.send('theme', getThemePayload());
    updateTitleBarSymbolColor(chooserWin);
  }
});

systemPreferences.on('accent-color-changed', () => {
  const settingsWin = getSettingsWindow();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('theme', getThemePayload());
  }
  const chooserWin = chooserWindow;
  if (chooserWin && !chooserWin.isDestroyed()) {
    chooserWin.webContents.send('theme', getThemePayload());
  }
});

ipcMain.handle('register-browser', () => {
  return registerBrowser();
});

ipcMain.handle('unregister-browser', () => {
  return unregisterBrowser();
});

ipcMain.handle('check-browser', () => {
  return { registered: isRegistered() };
});


module.exports = {};
