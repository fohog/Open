const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function loadBrowserDefaults() {
  try {
    const rulesPath = path.join(__dirname, 'browsers.json');
    const raw = fs.readFileSync(rulesPath, 'utf-8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data && data.browsers) ? data.browsers : [];
    const result = {};
    for (const item of list) {
      if (!item || typeof item.id !== 'string') continue;
      result[item.id] = { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' };
    }
    return result;
  } catch (err) {
    return {
      edge: { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      chrome: { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      'chrome-beta': { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      'chrome-dev': { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      'chrome-canary': { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      firefox: { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      brave: { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      vivaldi: { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      chromium: { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      'edge-beta': { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      'edge-dev': { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' },
      'edge-canary': { enabled: true, detected: false, path: '', profiles: [], excludedProfiles: [], lastProfileId: '' }
    };
  }
}

const systemBrowserIds = Object.keys(loadBrowserDefaults());

const defaultConfig = {
  locale: '',
  debug: {
    showAllBrowsers: false
  },
  avatarPreference: 'picture',
  windowEffect: 'mica',
  chooserInputMode: 'link',
  chooserColumns: 2,
  chooserWindowControls: false,
  closeChooserOnBlur: true,
  routing: {
    chooser: true
  },
  associations: {
    http: true,
    https: true,
    files: true
  },
  profileSizeCache: {},
  profileGroups: {},
  browsers: {},
  systemBrowsers: {},
  customBrowsers: [],
  browserRuleOverrides: {},
  lastSelection: { browserId: 'edge', profileId: '' },
};

let cachedConfig = null;

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const configPath = getConfigPath();
  let config = JSON.parse(JSON.stringify(defaultConfig));
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      config = deepMerge(config, parsed);
    } catch (err) {
      // Keep defaults if config is corrupted.
    }
  }
  if (!config.locale) {
    try {
      config.locale = app.getLocale();
    } catch (err) {
      config.locale = 'en-US';
    }
  }
  if (config.windowEffect !== 'mica' && config.windowEffect !== 'acrylic' && config.windowEffect !== 'tabbed') {
    config.windowEffect = 'mica';
  }
  if (!['link', 'search', 'hidden'].includes(config.chooserInputMode)) {
    config.chooserInputMode = 'link';
  }
  if (![1, 2, 3, 4].includes(Number(config.chooserColumns))) {
    config.chooserColumns = 2;
  }
  if (!config.associations || typeof config.associations !== 'object') {
    config.associations = { http: true, https: true, files: true };
  } else {
    config.associations.http = config.associations.http !== false;
    config.associations.https = config.associations.https !== false;
    config.associations.files = config.associations.files !== false;
  }
  if (!config.systemBrowsers || typeof config.systemBrowsers !== 'object') {
    config.systemBrowsers = {};
  }
  if (config.window) delete config.window;
  cachedConfig = config;
  return config;
}

function saveConfig(nextConfig) {
  const configPath = getConfigPath();
  const sanitized = JSON.parse(JSON.stringify(nextConfig));
  if (sanitized && sanitized.browsers && typeof sanitized.browsers === 'object') {
    systemBrowserIds.forEach((id) => {
      if (id in sanitized.browsers) delete sanitized.browsers[id];
    });
  }
  cachedConfig = sanitized;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2));
}

function updateConfig(partial) {
  const current = loadConfig();
  const next = deepMerge(JSON.parse(JSON.stringify(current)), partial);
  saveConfig(next);
  return next;
}

module.exports = {
  defaultConfig,
  loadConfig,
  saveConfig,
  updateConfig,
  getConfigPath
};
