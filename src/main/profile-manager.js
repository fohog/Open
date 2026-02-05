const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

function pathExists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch (err) {
    return false;
  }
}

function normalize(p) {
  return path.normalize(p || '');
}

function isSubPath(parent, child) {
  const base = normalize(parent);
  const target = normalize(child);
  if (!base || !target) return false;
  const rel = path.relative(base, target);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function safeWriteJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function copyEntry(src, dest) {
  if (!pathExists(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true, force: true, errorOnExist: false });
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function listChromiumCopyEntries(options) {
  const copyBookmarks = Boolean(options && options.bookmarks);
  const copyExtensions = Boolean(options && options.extensions);
  const copyHistory = Boolean(options && options.history);
  const copySiteData = Boolean(options && options.siteData);

  const entries = [
    'Preferences',
    'Secure Preferences'
  ];

  if (copyBookmarks) entries.push('Bookmarks', 'Bookmarks.bak');
  if (copyExtensions) entries.push('Extensions');
  if (copyHistory) entries.push('History', 'History-journal', 'Favicons', 'Favicons-journal');
  if (copySiteData) {
    entries.push(
      'Cookies',
      'Cookies-journal',
      'Network',
      'Local Storage',
      'Session Storage',
      'Sessions',
      'Service Worker',
      'IndexedDB',
      'Code Cache',
      'GPUCache',
      'Cache'
    );
  }
  return Array.from(new Set(entries));
}

function pickNextChromiumProfileId(userDataDir) {
  const base = normalize(userDataDir);
  if (!base || !pathExists(base)) return '';
  const existing = new Set();
  try {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      existing.add(entry.name);
    }
  } catch (err) {
    return '';
  }

  for (let i = 1; i < 2000; i += 1) {
    const candidate = `Profile ${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `Profile ${Date.now()}`;
}

function setChromiumProfileName(profileDir, name) {
  const prefPath = path.join(profileDir, 'Preferences');
  const data = safeReadJson(prefPath);
  if (!data) return false;
  if (!data.profile || typeof data.profile !== 'object') data.profile = {};
  data.profile.name = name;
  data.profile.shortcut_name = name;
  safeWriteJson(prefPath, data);
  return true;
}

function duplicateChromiumProfile({ userDataDir, fromProfileId, toName, options }) {
  const base = normalize(userDataDir);
  const sourceDir = normalize(path.join(base, fromProfileId || ''));
  if (!base || !pathExists(base)) return { ok: false, error: 'missing-user-data-dir' };
  if (!fromProfileId) return { ok: false, error: 'missing-profile-id' };
  if (!pathExists(sourceDir)) return { ok: false, error: 'missing-source-profile-dir' };
  if (!isSubPath(base, sourceDir)) return { ok: false, error: 'invalid-source-profile-dir' };

  const toProfileId = pickNextChromiumProfileId(base);
  const destDir = path.join(base, toProfileId);
  fs.mkdirSync(destDir, { recursive: true });

  const entries = listChromiumCopyEntries(options);
  for (const rel of entries) {
    copyEntry(path.join(sourceDir, rel), path.join(destDir, rel));
  }

  const name = String(toName || '').trim();
  if (name) setChromiumProfileName(destDir, name);
  return { ok: true, profileId: toProfileId };
}

function renameChromiumProfile({ userDataDir, profileId, name }) {
  const base = normalize(userDataDir);
  const dir = normalize(path.join(base, profileId || ''));
  if (!base || !profileId || !pathExists(dir)) return { ok: false, error: 'missing-profile-dir' };
  if (!isSubPath(base, dir)) return { ok: false, error: 'invalid-profile-dir' };
  const nextName = String(name || '').trim();
  if (!nextName) return { ok: false, error: 'missing-name' };
  const ok = setChromiumProfileName(dir, nextName);
  return { ok };
}

function deleteProfileDir({ rootDir, profileDir }) {
  const base = normalize(rootDir);
  const target = normalize(profileDir);
  if (!base || !target) return { ok: false, error: 'missing-path' };
  if (!pathExists(target)) return { ok: true };
  if (!isSubPath(base, target)) return { ok: false, error: 'invalid-target' };
  fs.rmSync(target, { recursive: true, force: true });
  return { ok: true };
}

function parseIni(content) {
  const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const sections = [];
  let currentName = '';
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (current) sections.push({ name: currentName, values: current });
      currentName = trimmed.slice(1, -1);
      current = {};
      continue;
    }
    const idx = trimmed.indexOf('=');
    if (idx === -1 || !current) continue;
    current[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  if (current) sections.push({ name: currentName, values: current });
  return sections;
}

function stringifyIni(sections) {
  const out = [];
  for (const section of sections) {
    out.push(`[${section.name}]`);
    const values = section.values || {};
    for (const key of Object.keys(values)) {
      out.push(`${key}=${values[key]}`);
    }
    out.push('');
  }
  return out.join('\r\n');
}

function findFirefoxBaseDir(profileDir) {
  let current = normalize(profileDir);
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, 'profiles.ini');
    if (pathExists(candidate)) return current;
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  const direct = path.resolve(profileDir, '..', '..');
  if (pathExists(path.join(direct, 'profiles.ini'))) return direct;
  return '';
}

function getFirefoxProfilesRoot(profileDir) {
  const base = findFirefoxBaseDir(profileDir);
  if (!base) return '';
  const profilesDir = path.join(base, 'Profiles');
  return pathExists(profilesDir) ? profilesDir : '';
}

function nextFirefoxProfileSectionIndex(sections) {
  const used = new Set(
    sections
      .map((s) => (s.name || '').match(/^Profile(\d+)$/i))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n))
  );
  for (let i = 0; i < 5000; i += 1) {
    if (!used.has(i)) return i;
  }
  return used.size;
}

function duplicateFirefoxProfile({ profileDir, toName }) {
  const source = normalize(profileDir);
  if (!source || !pathExists(source)) return { ok: false, error: 'missing-source-profile-dir' };

  const baseDir = findFirefoxBaseDir(source);
  if (!baseDir) return { ok: false, error: 'missing-firefox-base-dir' };
  const profilesDir = path.join(baseDir, 'Profiles');
  if (!pathExists(profilesDir)) return { ok: false, error: 'missing-profiles-dir' };

  const srcName = path.basename(source);
  const suffix = `open-${Date.now().toString(36)}`;
  let folderName = `${srcName}-${suffix}`;
  let destDir = path.join(profilesDir, folderName);
  for (let i = 0; i < 50 && pathExists(destDir); i += 1) {
    folderName = `${srcName}-${suffix}-${i}`;
    destDir = path.join(profilesDir, folderName);
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(source, destDir, { recursive: true, force: true, errorOnExist: false });

  const iniPath = path.join(baseDir, 'profiles.ini');
  const raw = fs.readFileSync(iniPath, 'utf-8');
  const sections = parseIni(raw);

  const nextIndex = nextFirefoxProfileSectionIndex(sections);
  const name = String(toName || '').trim() || folderName;
  sections.push({
    name: `Profile${nextIndex}`,
    values: {
      Name: name,
      IsRelative: '1',
      Path: `Profiles/${folderName}`,
      Default: '0'
    }
  });

  fs.writeFileSync(iniPath, stringifyIni(sections));
  return { ok: true, profileId: normalize(destDir), name };
}

function renameFirefoxProfile({ profileDir, name }) {
  const dir = normalize(profileDir);
  const nextName = String(name || '').trim();
  if (!dir || !nextName) return { ok: false, error: 'missing-input' };
  const baseDir = findFirefoxBaseDir(dir);
  if (!baseDir) return { ok: false, error: 'missing-firefox-base-dir' };
  const iniPath = path.join(baseDir, 'profiles.ini');
  if (!pathExists(iniPath)) return { ok: false, error: 'missing-profiles-ini' };
  const raw = fs.readFileSync(iniPath, 'utf-8');
  const sections = parseIni(raw);

  const relPath = (() => {
    const profilesDir = path.join(baseDir, 'Profiles');
    if (isSubPath(profilesDir, dir)) {
      const folderName = path.relative(profilesDir, dir).split(path.sep)[0];
      return `Profiles/${folderName}`;
    }
    return '';
  })();

  let updated = false;
  for (const section of sections) {
    const values = section.values || {};
    if (!section.name || !/^Profile/i.test(section.name)) continue;
    const isRel = String(values.IsRelative || '1') === '1';
    const p = String(values.Path || '');
    if (isRel && relPath && p.replace(/\\/g, '/') === relPath) {
      values.Name = nextName;
      section.values = values;
      updated = true;
      break;
    }
    if (!isRel && normalize(p) === dir) {
      values.Name = nextName;
      section.values = values;
      updated = true;
      break;
    }
  }

  if (!updated) return { ok: false, error: 'profile-not-found' };
  fs.writeFileSync(iniPath, stringifyIni(sections));
  return { ok: true };
}

function readChromiumBookmarks({ userDataDir, profileId, limit = 200 }) {
  const base = normalize(userDataDir);
  const profileDir = normalize(path.join(base, profileId || ''));
  if (!base || !profileId || !pathExists(profileDir)) return { ok: false, error: 'missing-profile-dir', items: [] };
  if (!isSubPath(base, profileDir)) return { ok: false, error: 'invalid-profile-dir', items: [] };
  const filePath = path.join(profileDir, 'Bookmarks');
  if (!pathExists(filePath)) return { ok: true, items: [], filePath };
  const data = safeReadJson(filePath);
  if (!data) return { ok: false, error: 'invalid-bookmarks-json', items: [], filePath };

  const items = [];
  function walk(node, trail) {
    if (!node || items.length >= limit) return;
    if (node.type === 'url' && node.url) {
      items.push({
        title: String(node.name || ''),
        url: String(node.url),
        folder: trail.join(' / ')
      });
      return;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      if (items.length >= limit) break;
      const nextTrail = node.name ? [...trail, String(node.name)] : trail;
      walk(child, nextTrail);
    }
  }

  const roots = data.roots || {};
  for (const key of Object.keys(roots)) {
    if (items.length >= limit) break;
    walk(roots[key], []);
  }
  return { ok: true, items, filePath };
}

function getDirSizeStats(dirPath, { maxFiles = 400000, maxDepth = 64 } = {}) {
  const root = normalize(dirPath);
  if (!root || !pathExists(root)) return { ok: false, error: 'missing-dir', bytes: 0, files: 0, dirs: 0 };

  let bytes = 0;
  let files = 0;
  let dirs = 0;
  const stack = [{ dir: root, depth: 0 }];

  while (stack.length) {
    const item = stack.pop();
    if (!item) continue;
    const { dir, depth } = item;
    if (depth > maxDepth) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    dirs += 1;

    for (const entry of entries) {
      if (files >= maxFiles) return { ok: true, bytes, files, dirs, partial: true };
      const full = path.join(dir, entry.name);
      try {
        if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push({ dir: full, depth: depth + 1 });
          continue;
        }
        if (entry.isFile()) {
          const stat = fs.statSync(full);
          bytes += Number(stat.size) || 0;
          files += 1;
        }
      } catch (err) {
        // ignore
      }
    }
  }

  return { ok: true, bytes, files, dirs, partial: false };
}

let sizeWorker = null;
let sizeWorkerSeq = 0;
const sizeWorkerPending = new Map();

function ensureSizeWorker() {
  if (sizeWorker) return sizeWorker;
  const workerPath = path.join(__dirname, 'dir-size-worker.js');
  sizeWorker = new Worker(workerPath);
  sizeWorker.on('message', (msg) => {
    const { id, ok, result, error } = msg || {};
    const pending = sizeWorkerPending.get(id);
    if (!pending) return;
    sizeWorkerPending.delete(id);
    if (ok) pending.resolve(result);
    else pending.resolve({ ok: false, error: error || 'worker-error', bytes: 0, files: 0, dirs: 0 });
  });
  sizeWorker.on('error', () => {
    for (const pending of sizeWorkerPending.values()) {
      pending.resolve({ ok: false, error: 'worker-crashed', bytes: 0, files: 0, dirs: 0 });
    }
    sizeWorkerPending.clear();
    try {
      sizeWorker.terminate();
    } catch (err) {
      // ignore
    }
    sizeWorker = null;
  });
  sizeWorker.on('exit', () => {
    for (const pending of sizeWorkerPending.values()) {
      pending.resolve({ ok: false, error: 'worker-exited', bytes: 0, files: 0, dirs: 0 });
    }
    sizeWorkerPending.clear();
    sizeWorker = null;
  });
  return sizeWorker;
}

function getDirSizeStatsAsync(dirPath, options) {
  const worker = ensureSizeWorker();
  const id = `${Date.now()}-${++sizeWorkerSeq}`;
  return new Promise((resolve) => {
    sizeWorkerPending.set(id, { resolve });
    try {
      worker.postMessage({ id, dirPath, options: options || {} });
    } catch (err) {
      sizeWorkerPending.delete(id);
      resolve({ ok: false, error: 'worker-post-failed', bytes: 0, files: 0, dirs: 0 });
    }
  });
}

module.exports = {
  duplicateChromiumProfile,
  renameChromiumProfile,
  deleteProfileDir,
  duplicateFirefoxProfile,
  renameFirefoxProfile,
  readChromiumBookmarks,
  getFirefoxProfilesRoot,
  getDirSizeStats,
  getDirSizeStatsAsync
};
