const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const htmlExtensions = ['.html', '.htm', '.mshtml', '.xhtml'];

const programFiles = process.env.ProgramFiles || process.env.PROGRAMFILES || '';
const programFilesX86 = process.env['ProgramFiles(x86)'] || process.env['PROGRAMFILES(X86)'] || '';
const localAppData = process.env.LOCALAPPDATA || process.env.LocalAppData || '';
const appData = process.env.APPDATA || process.env.AppData || '';

function getUserProfileDir() {
  const userProfile = process.env.USERPROFILE || '';
  if (userProfile) return userProfile;
  const homeDrive = process.env.HOMEDRIVE || '';
  const homePath = process.env.HOMEPATH || '';
  if (homeDrive && homePath) return path.join(homeDrive, homePath);
  return '';
}

function getRoamingAppDataDir() {
  if (appData) return appData;
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return app.getPath('appData');
  } catch (err) {
    // ignore
  }
  const home = getUserProfileDir();
  return home ? path.join(home, 'AppData', 'Roaming') : '';
}

function getLocalAppDataDir() {
  if (localAppData) return localAppData;
  const home = getUserProfileDir();
  return home ? path.join(home, 'AppData', 'Local') : '';
}
const envMap = {
  PROGRAMFILES: programFiles,
  'PROGRAMFILES(X86)': programFilesX86,
  PROGRAMFILES_X86: programFilesX86,
  LOCALAPPDATA: localAppData,
  APPDATA: appData,
  ROAMINGAPPDATA: appData,
  USERPROFILE: getUserProfileDir()
};

function expandTemplate(input) {
  const raw = String(input || '');
  if (!raw) return '';
  const replaced = raw.replace(/%([^%]+)%|\$\{([^}]+)\}/g, (_match, winKey, braceKey) => {
    const key = String(winKey || braceKey || '').trim();
    if (!key) return '';
    const normalized = key.toUpperCase();
    return envMap[normalized] || '';
  });
  if (/%[^%]+%/.test(replaced) || /\$\{[^}]+\}/.test(replaced)) return '';
  return replaced;
}

function resolveTemplatePath(template) {
  const expanded = expandTemplate(template);
  if (!expanded) return '';
  return path.normalize(expanded);
}

function loadBrowserRules() {
  const rulesPath = path.join(__dirname, 'browsers.json');
  try {
    const raw = fs.readFileSync(rulesPath, 'utf-8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data && data.browsers) ? data.browsers : [];
    const byId = {};
    for (const item of list) {
      if (!item || typeof item.id !== 'string') continue;
      byId[item.id] = item;
    }
    return { list, byId };
  } catch (err) {
    return { list: [], byId: {} };
  }
}

const browserRules = loadBrowserRules();

function getRulesForConfig(config) {
  const baseList = browserRules.list.map((rule) => JSON.parse(JSON.stringify(rule)));
  const custom = Array.isArray(config && config.customBrowsers) ? config.customBrowsers : [];

  const byId = {};
  const list = [];

  for (const rule of baseList) {
    if (!rule || !rule.id) continue;
    list.push(rule);
    byId[rule.id] = rule;
  }

  for (const item of custom) {
    if (!item || typeof item.id !== 'string') continue;
    const normalized = JSON.parse(JSON.stringify(item));
    list.push(normalized);
    byId[normalized.id] = normalized;
  }

  return { list, byId };
}

function getBrowserRule(browserId, rules) {
  if (rules && rules.byId) return rules.byId[browserId] || null;
  return browserRules.byId[browserId] || null;
}

function pathExists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch (err) {
    return false;
  }
}

function whichSync(command) {
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'where' : 'which';
  const result = spawnSync(bin, [command], { encoding: 'utf-8' });
  if (result.status === 0 && result.stdout) {
    const first = result.stdout.split(/\r?\n/)[0];
    return first || '';
  }
  return '';
}

function detectExecutable(browserId, configuredPath, rules) {
  if (configuredPath && pathExists(configuredPath)) return configuredPath;
  const platform = process.platform;
  const rule = getBrowserRule(browserId, rules);
  const rawCandidates = (rule && rule.exeCandidates && rule.exeCandidates[platform]) || [];
  for (const raw of rawCandidates) {
    const candidate = resolveTemplatePath(raw);
    if (!candidate) continue;
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (pathExists(candidate)) return candidate;
    } else {
      const found = whichSync(candidate);
      if (found) return found;
      return '';
    }
  }
  return '';
}

function detectSystemExecutable(browserId, rules) {
  return detectExecutable(browserId, '', rules);
}

function resolveUserDataDir(browserId, rules) {
  if (process.platform !== 'win32') return '';
  const rule = getBrowserRule(browserId, rules);
  const rawList = (rule && rule.userDataDir && rule.userDataDir.win32) || [];
  for (const raw of rawList) {
    const candidate = resolveTemplatePath(raw);
    if (candidate) return candidate;
  }
  return '';
}

function detectChromiumProfiles({ browserId, userDataDir, avatarPreference }) {
  if (!userDataDir || !pathExists(userDataDir)) return [];
  const profileInfoCache = readChromiumProfileInfoCache(userDataDir);
  const entries = fs.readdirSync(userDataDir, { withFileTypes: true });
  const profiles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name === 'Default' || name.startsWith('Profile ')) {
      const prefPath = path.join(userDataDir, name, 'Preferences');
      if (pathExists(prefPath)) {
        const info = readChromiumProfile(prefPath, name, userDataDir, profileInfoCache, browserId, avatarPreference);
        profiles.push(info);
      }
    }
  }
  return profiles;
}

function readChromiumProfile(prefPath, fallbackId, userDataDir, profileInfoCache, browserId, avatarPreference) {
  const profile = { id: fallbackId, name: fallbackId, avatarIndex: 0, avatarData: '', userName: '', gaiaName: '' };
  try {
    const raw = fs.readFileSync(prefPath, 'utf-8');
    const data = JSON.parse(raw);
    const profileData = data.profile || {};
    const cached = profileInfoCache && profileInfoCache[fallbackId] ? profileInfoCache[fallbackId] : null;
    if (cached && cached.name) {
      profile.name = cached.name;
    } else if (profileData.name) {
      profile.name = profileData.name;
    }
    if (cached && cached.userName) profile.userName = cached.userName;
    if (cached && cached.gaiaName) profile.gaiaName = cached.gaiaName;
    if (typeof profileData.avatar_index === 'number') {
      profile.avatarIndex = profileData.avatar_index;
    }
    profile.avatarData = readChromiumProfileImage(userDataDir, fallbackId, profile.avatarIndex, browserId, avatarPreference);
  } catch (err) {
    return profile;
  }
  return profile;
}

function readChromiumProfileInfoCache(userDataDir) {
  const localStatePath = path.join(userDataDir, 'Local State');
  if (!pathExists(localStatePath)) return {};
  try {
    const raw = fs.readFileSync(localStatePath, 'utf-8');
    const data = JSON.parse(raw);
    const cache = (data.profile && data.profile.info_cache) || {};
    const map = {};
    for (const key of Object.keys(cache)) {
      const entry = cache[key] || {};
      const name = entry.name || entry.shortcut_name || '';
      const userName = entry.user_name || '';
      const gaiaName = entry.gaia_name || '';
      map[key] = {
        name: name || userName || gaiaName || '',
        userName,
        gaiaName
      };
    }
    return map;
  } catch (err) {
    return {};
  }
}

const defaultProfileImageRule = {
  pictureFiles: ['Profile Picture.png'],
  iconFiles: ['Profile Picture.ico'],
  avatarsDir: 'Avatars',
  avatarsExtensions: ['.png']
};

function getProfileImageRule(browserId) {
  const rule = getBrowserRule(browserId);
  const imageRule = (rule && rule.profileImage) || {};
  return {
    pictureFiles: Array.isArray(imageRule.pictureFiles) ? imageRule.pictureFiles : defaultProfileImageRule.pictureFiles,
    iconFiles: Array.isArray(imageRule.iconFiles) ? imageRule.iconFiles : defaultProfileImageRule.iconFiles,
    avatarsDir: typeof imageRule.avatarsDir === 'string' ? imageRule.avatarsDir : defaultProfileImageRule.avatarsDir,
    avatarsExtensions: Array.isArray(imageRule.avatarsExtensions)
      ? imageRule.avatarsExtensions
      : defaultProfileImageRule.avatarsExtensions
  };
}

function readChromiumProfileImage(userDataDir, profileId, avatarIndex, browserId, avatarPreference) {
  const profileDir = path.join(userDataDir, profileId);
  const rule = getProfileImageRule(browserId);
  const preference = String(avatarPreference || 'picture').toLowerCase();
  const order = preference === 'icon' ? ['icon', 'picture', 'avatars'] : ['picture', 'icon', 'avatars'];

  function findFromList(list) {
    for (const name of list) {
      const filePath = path.join(profileDir, name);
      if (pathExists(filePath)) return fileToDataUrl(filePath);
    }
    return '';
  }

  function findFromAvatars() {
    const avatarsDir = path.join(userDataDir, rule.avatarsDir || 'Avatars');
    if (!pathExists(avatarsDir)) return '';
    try {
      const exts = (rule.avatarsExtensions || ['.png']).map((ext) => ext.toLowerCase());
      const files = fs
        .readdirSync(avatarsDir)
        .filter((file) => exts.includes(path.extname(file).toLowerCase()))
        .sort();
      if (files.length) {
        const index = Math.abs(Number(avatarIndex) || 0) % files.length;
        const filePath = path.join(avatarsDir, files[index]);
        if (pathExists(filePath)) return fileToDataUrl(filePath);
      }
    } catch (err) {
      return '';
    }
    return '';
  }

  for (const step of order) {
    if (step === 'picture') {
      const result = findFromList(rule.pictureFiles || []);
      if (result) return result;
    }
    if (step === 'icon') {
      const result = findFromList(rule.iconFiles || []);
      if (result) return result;
    }
    if (step === 'avatars') {
      const result = findFromAvatars();
      if (result) return result;
    }
  }
  return '';
}

function fileToDataUrl(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const base64 = buf.toString('base64');
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === '.ico'
        ? 'image/x-icon'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/png';
    return `data:${mime};base64,${base64}`;
  } catch (err) {
    return '';
  }
}

function parseIniSections(content) {
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
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    current[key] = value;
  }
  if (current) sections.push({ name: currentName, values: current });
  return sections.filter((s) => s.name);
}

function parseIniProfiles(content, baseDir) {
  const sections = parseIniSections(content);
  return sections
    .filter((s) => s.name.toLowerCase().startsWith('profile'))
    .map((s) => {
      const item = s.values || {};
      const rawPath = String(item.Path || '').trim();
      if (!rawPath) return null;
      const isRelative = String(item.IsRelative || '1') === '1';
      const resolved = isRelative && baseDir ? path.resolve(baseDir, rawPath) : rawPath;
      const profileDir = path.isAbsolute(resolved) ? path.normalize(resolved) : (baseDir ? path.resolve(baseDir, resolved) : resolved);
      const name = String(item.Name || '').trim() || path.basename(profileDir);
      return {
        id: profileDir,
        name,
        path: profileDir,
        isDefault: String(item.Default || '0') === '1'
      };
    })
    .filter(Boolean);
}

function getFirefoxBaseDirs() {
  const baseDirs = [];
  const roaming = getRoamingAppDataDir();
  if (roaming) baseDirs.push(path.join(roaming, 'Mozilla', 'Firefox'));

  const local = getLocalAppDataDir();
  const packagesRoot = local ? path.join(local, 'Packages') : '';
  if (packagesRoot && pathExists(packagesRoot)) {
    try {
      const entries = fs.readdirSync(packagesRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!/^Mozilla\\.Firefox/i.test(entry.name)) continue;
        const uwpBase = path.join(packagesRoot, entry.name, 'LocalCache', 'Roaming', 'Mozilla', 'Firefox');
        if (pathExists(uwpBase)) baseDirs.push(uwpBase);
      }
    } catch (err) {
      // ignore
    }
  }

  return Array.from(new Set(baseDirs.map((d) => d.toLowerCase()))).map((d) => baseDirs.find((x) => x.toLowerCase() === d));
}

function detectFirefoxProfilesFromDir(baseDir) {
  const profilesDir = baseDir ? path.join(baseDir, 'Profiles') : '';
  if (!profilesDir || !pathExists(profilesDir)) return [];
  try {
    const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(profilesDir, e.name))
      .filter((dir) => pathExists(path.join(dir, 'prefs.js')) || pathExists(path.join(dir, 'compatibility.ini')))
      .map((dir) => ({ id: path.normalize(dir), name: path.basename(dir), path: path.normalize(dir), isDefault: false }));
  } catch (err) {
    return [];
  }
}

function readFirefoxDefaultProfilePaths(baseDir) {
  const candidates = [];
  const installsIni = baseDir ? path.join(baseDir, 'installs.ini') : '';
  if (installsIni && pathExists(installsIni)) {
    try {
      const raw = fs.readFileSync(installsIni, 'utf-8');
      const sections = parseIniSections(raw);
      for (const s of sections) {
        const values = s.values || {};
        const def = String(values.Default || '').trim();
        if (!def) continue;
        const resolved = path.isAbsolute(def) ? def : path.resolve(baseDir, def);
        candidates.push(path.normalize(resolved));
      }
    } catch (err) {
      // ignore
    }
  }

  const profilesIni = baseDir ? path.join(baseDir, 'profiles.ini') : '';
  if (profilesIni && pathExists(profilesIni)) {
    try {
      const raw = fs.readFileSync(profilesIni, 'utf-8');
      const sections = parseIniSections(raw);
      for (const s of sections) {
        const name = s.name || '';
        if (!name.toLowerCase().startsWith('install')) continue;
        const values = s.values || {};
        const def = String(values.Default || '').trim();
        if (!def) continue;
        const resolved = path.isAbsolute(def) ? def : path.resolve(baseDir, def);
        candidates.push(path.normalize(resolved));
      }
    } catch (err) {
      // ignore
    }
  }

  return Array.from(new Set(candidates.map((p) => p.toLowerCase())));
}

function detectFirefoxProfiles() {
  const baseDirs = getFirefoxBaseDirs().filter(Boolean);
  const all = [];
  const defaultPaths = new Set();

  for (const baseDir of baseDirs) {
    for (const p of readFirefoxDefaultProfilePaths(baseDir)) defaultPaths.add(p);

    const profilesIni = path.join(baseDir, 'profiles.ini');
    if (pathExists(profilesIni)) {
      try {
        const raw = fs.readFileSync(profilesIni, 'utf-8');
        all.push(...parseIniProfiles(raw, baseDir));
      } catch (err) {
        // ignore
      }
    }

    all.push(...detectFirefoxProfilesFromDir(baseDir));
  }

  const unique = new Map();
  const isFolderName = (profile) => {
    const id = String((profile && profile.id) || '');
    const name = String((profile && profile.name) || '');
    if (!id || !name) return false;
    return name === path.basename(id);
  };
  for (const profile of all) {
    const key = String(profile.id || '').toLowerCase();
    if (!key) continue;
    if (!unique.has(key)) {
      unique.set(key, profile);
      continue;
    }
    const existing = unique.get(key);
    const next = profile;
    const existingDefault = Boolean(existing && existing.isDefault);
    const nextDefault = Boolean(next && next.isDefault);
    const existingHasRealName = existing && existing.name && !isFolderName(existing);
    const nextHasRealName = next && next.name && !isFolderName(next);

    if (!existingDefault && nextDefault) {
      unique.set(key, next);
      continue;
    }
    if (!existingHasRealName && nextHasRealName) {
      unique.set(key, { ...existing, ...next });
      continue;
    }
  }

  for (const [key, profile] of unique.entries()) {
    const isDefault = Boolean(profile.isDefault) || defaultPaths.has(key);
    unique.set(key, { ...profile, isDefault });
  }

  return Array.from(unique.values()).sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'en');
  });
}

function detectProfiles(browserId, options = {}) {
  if (process.platform !== 'win32') return [];
  const rule = getBrowserRule(browserId, options.rules);
  if (!rule || !rule.type) return [];
  if (rule.type === 'chromium') {
    const userDataDir = resolveUserDataDir(browserId, options.rules);
    return detectChromiumProfiles({
      browserId,
      userDataDir,
      avatarPreference: options.avatarPreference
    });
  }
  if (rule.type === 'firefox') return detectFirefoxProfiles();
  return [];
}

function scanBuiltInBrowsers(currentConfig) {
  const next = JSON.parse(JSON.stringify(currentConfig));
  if (!next.browsers || typeof next.browsers !== 'object') next.browsers = {};
  if (!next.systemBrowsers || typeof next.systemBrowsers !== 'object') next.systemBrowsers = {};
  const rules = getRulesForConfig(next);
  const ruleIds = rules.list.map((rule) => rule.id).filter(Boolean);
  const ruleNameMap = {};
  for (const rule of rules.list) {
    if (!rule || !rule.id) continue;
    const name = typeof rule.name === 'string' ? rule.name.trim() : '';
    if (name) ruleNameMap[rule.id] = name;
  }
  for (const ruleId of ruleIds) {
    const systemState = next.systemBrowsers[ruleId] || {};
    if (!next.browsers[ruleId]) {
      next.browsers[ruleId] = {
        enabled: systemState.enabled !== false,
        detected: false,
        path: '',
        profiles: [],
        excludedProfiles: [],
        lastProfileId: '',
        displayName: ruleNameMap[ruleId] || ''
      };
    } else if (ruleNameMap[ruleId]) {
      next.browsers[ruleId].displayName = ruleNameMap[ruleId];
    }
  }
  const browserIds = ruleIds;
  const rawPreference = String(next.avatarPreference || 'picture').toLowerCase();
  const avatarPreference = rawPreference === 'icon' || rawPreference === 'picture' ? rawPreference : 'picture';
  next.avatarPreference = avatarPreference;
  for (const browserId of browserIds) {
    if (!getBrowserRule(browserId, rules)) continue;
    const existing = next.browsers[browserId] || { enabled: true, detected: false, path: '', profiles: [] };
    const systemState = next.systemBrowsers[browserId] || {};
    const enabled = systemState.enabled !== false;
    const displayName = ruleNameMap[browserId] || existing.displayName || '';
    const systemPath = detectSystemExecutable(browserId, rules);
    const execPath = systemPath || (pathExists(existing.path) ? existing.path : '');
    const excludedProfiles = Array.isArray(existing.excludedProfiles) ? existing.excludedProfiles : [];
    const profilesRaw = detectProfiles(browserId, { avatarPreference, rules });
    const profiles = profilesRaw.filter((profile) => {
      if (excludedProfiles.includes(profile.id)) return false;
      if (browserId === 'firefox' && excludedProfiles.includes(profile.name)) return false;
      return true;
    });

    let lastProfileId = existing.lastProfileId || '';
    if (browserId === 'firefox' && lastProfileId && !pathExists(lastProfileId)) {
      const match = profilesRaw.find((p) => p.name === lastProfileId);
      if (match && match.id) lastProfileId = match.id;
    }
    if (excludedProfiles.includes(lastProfileId)) lastProfileId = '';
    if (browserId === 'firefox' && excludedProfiles.includes(existing.lastProfileId)) lastProfileId = '';
    next.browsers[browserId] = {
      ...existing,
      displayName,
      enabled,
      detected: Boolean(systemPath),
      path: execPath,
      excludedProfiles,
      profiles,
      lastProfileId
    };
  }

  const last = next.lastSelection || {};
  const lastBrowser = last.browserId ? next.browsers[last.browserId] : null;
  if (lastBrowser && last.browserId === 'firefox' && last.profileId && !pathExists(last.profileId)) {
    const match = (lastBrowser.profiles || []).find((p) => p.name === last.profileId);
    if (match && match.id) next.lastSelection = { ...last, profileId: match.id };
  }
  const updatedLast = next.lastSelection || last;
  if (
    lastBrowser &&
    Array.isArray(lastBrowser.excludedProfiles) &&
    lastBrowser.excludedProfiles.includes(updatedLast.profileId)
  ) {
    next.lastSelection = { ...updatedLast, profileId: '' };
  }
  return next;
}

function normalizeTarget(target) {
  if (!target) return '';
  if (/^(https?:|file:)/i.test(target)) return target;
  const looksLikePath = path.isAbsolute(target) || htmlExtensions.some((ext) => target.toLowerCase().endsWith(ext));
  if (looksLikePath) {
    try {
      return pathToFileURL(target).toString();
    } catch (err) {
      return target;
    }
  }
  return target;
}

function buildArgs(browserId, profileId, target, rules) {
  const url = normalizeTarget(target);
  const rule = getBrowserRule(browserId, rules);
  const launch = (rule && rule.launch) || {};
  const args = [];
  if (profileId) {
    if (launch.profileArg) {
      args.push(String(launch.profileArg).replace('{profileId}', profileId));
    } else if (Array.isArray(launch.profileArgName) && Array.isArray(launch.profileArgPath)) {
      const tuple = pathExists(profileId) ? launch.profileArgPath : launch.profileArgName;
      tuple.forEach((item) => args.push(String(item).replace('{profileId}', profileId)));
    }
  }
  args.push(url);
  return args;
}

function openInBrowser({ browserId, profileId, target, browserPath, rules }) {
  if (!browserId) return false;
  const execPath = detectExecutable(browserId, browserPath, rules);
  if (!execPath) return false;
  if (execPath === process.execPath) return false;
  const args = buildArgs(browserId, profileId, target, rules);
  try {
    const child = spawn(execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  htmlExtensions,
  getRulesForConfig,
  getBaseBrowserRules() {
    return browserRules.list;
  },
  detectExecutable,
  detectSystemExecutable,
  detectProfiles,
  resolveProfileFolder(browserId, profileId, rules) {
    if (process.platform !== 'win32') return '';
    if (!browserId) return '';
    const rule = getBrowserRule(browserId, rules);
    if (rule && rule.type === 'firefox') {
      if (profileId && path.isAbsolute(profileId)) return path.normalize(profileId);
      const bases = (typeof getFirefoxBaseDirs === 'function' ? getFirefoxBaseDirs() : []).filter(Boolean);
      return bases.length ? path.normalize(bases[0]) : '';
    }
    const userDataDir = resolveUserDataDir(browserId, rules);
    if (!userDataDir) return '';
    if (!profileId) return path.normalize(userDataDir);
    return path.normalize(path.join(userDataDir, profileId));
  },
  scanBuiltInBrowsers,
  normalizeTarget,
  openInBrowser
};
