let dict = {};
let config = null;
let target = '';
let targetKind = 'link';
let activeTab = 'edge';
let debugOverride = false;
let selectedProfile = { browserId: '', profileId: '' };
let browserIcons = {};
let searchQuery = '';
let renameResolver = null;
const query = (() => {
  try {
    return new URLSearchParams(window.location.search || '');
  } catch (err) {
    return new URLSearchParams('');
  }
})();
const previewMode = query.get('preview') === '1';
const previewTarget = query.get('target') || 'https://www.google.com';
const previewColumns = (() => {
  const value = Number(query.get('columns'));
  return [1, 2, 3, 4].includes(value) ? value : 2;
})();
const previewInputMode = (() => {
  const value = String(query.get('inputMode') || 'link').toLowerCase();
  return ['link', 'search', 'hidden'].includes(value) ? value : 'link';
})();

function ensureApiBridge() {
  const listeners = {
    onTheme: [],
    onInit: [],
    onBlur: [],
    onManagerMenuAction: [],
    onProfileMenuAction: [],
    onBrowserMenuAction: [],
    onEditBrowser: [],
    onLinkMenuAction: []
  };
  const bridge = window.api && typeof window.api === 'object' ? window.api : {};
  const asyncFalse = async () => ({ ok: false });
  const asyncEmpty = async () => '';
  const defaults = {
    getState: asyncFalse,
    getManagerState: asyncFalse,
    saveConfig: asyncFalse,
    scanBrowsers: asyncFalse,
    scanManager: asyncFalse,
    pickExecutable: asyncEmpty,
    pickFolder: asyncEmpty,
    openTarget: asyncFalse,
    openChooser: asyncFalse,
    openProfiles: asyncFalse,
    hideProfiles: asyncFalse,
    deleteProfiles: asyncFalse,
    undoDeleteProfiles: asyncFalse,
    duplicateProfile: asyncFalse,
    renameProfile: asyncFalse,
    readBookmarks: asyncFalse,
    getProfileFiles: async () => ({ ok: false, files: {} }),
    getProfileSize: asyncFalse,
    revealPath: asyncFalse,
    closeChooser: asyncFalse,
    openSystemSettings: asyncFalse,
    openProfileFolder: asyncFalse,
    showProfileMenu: asyncFalse,
    registerBrowser: asyncFalse,
    unregisterBrowser: asyncFalse,
    checkBrowser: asyncFalse,
    showSettings: asyncFalse,
    showManager: asyncFalse,
    showBrowserMenu: asyncFalse,
    showLinkMenu: asyncFalse,
    chooserControl: asyncFalse,
    setChooserWindowControls: asyncFalse,
    setAssociations: asyncFalse,
    editBrowser: asyncFalse,
    showManagerMenu: asyncFalse,
    setWindowEffect: asyncFalse,
    windowControl: asyncFalse,
    resizeChooser: asyncFalse,
    getTheme: asyncFalse
  };
  const events = ['onTheme', 'onInit', 'onBlur', 'onManagerMenuAction', 'onProfileMenuAction', 'onBrowserMenuAction', 'onEditBrowser', 'onLinkMenuAction'];

  Object.keys(defaults).forEach((key) => {
    if (typeof bridge[key] !== 'function') bridge[key] = defaults[key];
  });
  events.forEach((key) => {
    if (typeof bridge[key] !== 'function') {
      bridge[key] = (callback) => {
        if (typeof callback === 'function') listeners[key].push(callback);
      };
    }
  });
  bridge.__emit = (eventName, payload) => {
    const list = listeners[eventName] || [];
    list.forEach((callback) => {
      try {
        callback(payload);
      } catch (err) {
        // ignore
      }
    });
  };
  window.api = bridge;
  return bridge;
}

const api = ensureApiBridge();

const tabOrder = [
  'edge',
  'edge-beta',
  'edge-dev',
  'edge-canary',
  'chrome',
  'chrome-beta',
  'chrome-dev',
  'chrome-canary',
  'firefox',
  'brave',
  'vivaldi',
  'chromium'
];

function t(key) {
  return dict[key] || key;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    if (!key) return;
    node.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const key = node.getAttribute('data-i18n-placeholder');
    if (!key) return;
    node.setAttribute('placeholder', t(key));
  });
}

function applyTheme(theme) {
  if (!theme) return;
  document.documentElement.setAttribute('data-theme', theme.dark ? 'dark' : 'light');
  if (theme.accent) {
    document.documentElement.style.setProperty('--accent', theme.accent);
    document.documentElement.style.setProperty('--accent-2', theme.accent);
  }
}

function applyIconGlyphs() {
  const glyphs = {
    app: '\uE7C5',
    settings: '\uE713',
    close: '\uE8BB',
    minimize: '\uE921',
    copy: '\uE8C8',
    open: '\uE8A7',
    browser: '\uE774',
    search: '\uE721',
    link: '\uE71B'
  };
  document.querySelectorAll('[data-icon]').forEach((node) => {
    const key = node.getAttribute('data-icon');
    if (glyphs[key]) {
      node.textContent = glyphs[key];
    }
  });
}

function isIconDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/x-icon');
}

function isBrowserAvailable(browserId) {
  const browser = config.browsers[browserId];
  return Boolean(browser && browser.enabled && browser.path);
}

function isBrowserVisible(browserId) {
  return isBrowserAvailable(browserId);
}

function isLastUsed(browserId, profileId) {
  const last = config.lastSelection || {};
  return last.browserId === browserId && (last.profileId || '') === (profileId || '');
}

function getBrowserIds() {
  const all = config && config.browsers ? Object.keys(config.browsers) : [];
  const ordered = [];
  tabOrder.forEach((id) => {
    if (all.includes(id) && !ordered.includes(id)) ordered.push(id);
  });
  all.forEach((id) => {
    if (!ordered.includes(id)) ordered.push(id);
  });
  return ordered.filter(isBrowserVisible);
}

function renderTabs() {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '';

  const browserIds = getBrowserIds();
  if (!browserIds.includes(activeTab)) activeTab = browserIds[0] || '';
  const tabIds = [...browserIds];

  tabIds.forEach((tabId) => {
    const tab = document.createElement('button');
    tab.className = 'tab';

    const iconDataUrl = browserIcons && browserIcons[tabId] ? browserIcons[tabId] : '';
    if (iconDataUrl) {
      const img = document.createElement('img');
      img.className = 'tab-icon';
      img.src = iconDataUrl;
      tab.appendChild(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'fluent-icon';
      placeholder.setAttribute('data-icon', 'browser');
      tab.appendChild(placeholder);
    }

    if (tabId === activeTab) {
      tab.classList.add('active');
    }
    tab.addEventListener('click', () => {
      activeTab = tabId;
      selectedProfile = { browserId: tabId, profileId: '' };
      renderTabs();
      renderTabContent();
    });
    tab.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      window.api.showBrowserMenu({
        x: event.clientX,
        y: event.clientY,
        browserId: tabId,
        labels: {
          reveal: t('chooser.browserMenu.reveal'),
          copyPath: t('chooser.browserMenu.copyPath'),
          edit: t('chooser.browserMenu.edit'),
          disable: t('chooser.browserMenu.disable')
        }
      });
    });
    tabs.appendChild(tab);
  });
}

function renderEmptyState() {
  const wrap = document.createElement('div');
  wrap.className = 'notice chooser-empty';
  const text = document.createElement('div');
  text.textContent = t('chooser.empty.guide');
  const actions = document.createElement('div');
  actions.className = 'inline-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'button secondary';
  btn.textContent = t('chooser.empty.openSettings');
  btn.addEventListener('click', async () => {
    await window.api.showSettings();
    window.api.closeChooser();
  });
  actions.appendChild(btn);
  wrap.appendChild(text);
  wrap.appendChild(actions);
  return wrap;
}

function renderBrowserOptions(browserId) {
  const container = document.createElement('div');
  const browser = config.browsers[browserId] || {};

  if (!isBrowserAvailable(browserId)) {
    const msg = document.createElement('div');
    msg.className = 'notice';
    msg.textContent = t('chooser.notConfigured');
    container.appendChild(msg);
    return container;
  }

  const options = document.createElement('div');
  options.className = 'option-list scrollable';
  const rawProfiles =
    browser.profiles && browser.profiles.length
      ? browser.profiles
      : [{ id: '', name: t('chooser.profile.default') }];
  const profiles = rawProfiles.filter((profile) => matchesSearch(profile, searchQuery));
  if (profiles.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'notice';
    msg.textContent = t('chooser.search.empty');
    container.appendChild(msg);
    return container;
  }

  profiles.forEach((profile) => {
    const option = document.createElement('div');
    option.className = 'option';
    option.tabIndex = 0;
    if (isLastUsed(browserId, profile.id)) {
      option.classList.add('highlight');
    }
    if (selectedProfile.browserId === browserId && selectedProfile.profileId === (profile.id || '')) {
      option.classList.add('selected');
    }
    const left = document.createElement('div');
    left.className = 'icon-stack';
    const avatar = document.createElement('div');
    avatar.className = 'profile-avatar';
    const displayName = profile.name || t('chooser.profile.default');
    if (profile.avatarData) {
      const img = document.createElement('img');
      img.src = profile.avatarData;
      img.alt = displayName;
      img.className = 'profile-avatar-image';
      if (isIconDataUrl(profile.avatarData)) {
        img.classList.add('icon-avatar');
        avatar.classList.add('icon-avatar');
        avatar.classList.remove('text-avatar');
      }
      avatar.appendChild(img);
    } else {
      avatar.classList.add('text-avatar');
      avatar.textContent = displayName.slice(0, 1).toUpperCase();
    }
    const name = document.createElement('div');
    name.className = 'profile-name';
    name.textContent = displayName;
    const meta = document.createElement('small');
    meta.className = 'profile-meta';
    if (isLastUsed(browserId, profile.id)) {
      meta.textContent = t('chooser.lastUsed');
    }
    if (!meta.textContent) {
      meta.style.display = 'none';
    }
    const textWrap = document.createElement('div');
    textWrap.className = 'profile-text';
    textWrap.appendChild(name);
    textWrap.appendChild(meta);
    left.appendChild(avatar);
    left.appendChild(textWrap);

    option.addEventListener('click', async () => {
      selectedProfile = { browserId, profileId: profile.id || '' };
      renderTabContent();
    });
    option.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectedProfile = { browserId, profileId: profile.id || '' };
        renderTabContent();
      }
    });

    option.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      window.api.showProfileMenu({
        x: event.clientX,
        y: event.clientY,
        browserId,
        profileId: profile.id || '',
        target,
        labels: {
          open: t('chooser.profileMenu.open'),
          reveal: t('chooser.profileMenu.reveal'),
          copyPath: t('chooser.profileMenu.copyPath'),
          rename: t('chooser.profileMenu.rename'),
          delete: t('chooser.profileMenu.delete')
        }
      });
    });

    option.appendChild(left);
    options.appendChild(option);
  });

  container.appendChild(options);
  return container;
}

function matchesSearch(profile, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const fields = [
    profile.name,
    profile.id,
    profile.userName,
    profile.gaiaName
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return fields.some((value) => value.includes(q));
}

function renderTabContent() {
  const content = document.getElementById('tab-content');
  content.innerHTML = '';
  const browserIds = getBrowserIds();
  if (!browserIds.length || !activeTab) {
    content.appendChild(renderEmptyState());
    return;
  }
  content.appendChild(renderBrowserOptions(activeTab));
}

function selectDefaultTab() {
  const last = config.lastSelection || {};
  const available = getBrowserIds();
  if (last.browserId && available.includes(last.browserId)) {
      activeTab = last.browserId;
      selectedProfile = { browserId: last.browserId, profileId: last.profileId || '' };
      return;
  }
  const firstAvailable = available[0];
  activeTab = firstAvailable || 'edge';
}

function getPreviewPayload() {
  return {
    dict: {
      'chooser.title': 'Choose browser',
      'chooser.question': 'Select a browser to open this link',
      'chooser.question.file': 'Select a browser to open this file',
      'chooser.text.placeholder': 'Link or file path',
      'chooser.search.placeholder': 'Search profiles',
      'chooser.copy': 'Copy link',
      'chooser.settings': 'Settings',
      'chooser.cancel': 'Cancel',
      'chooser.open': 'Open',
      'chooser.lastUsed': 'Last used',
      'chooser.profile.default': 'Default',
      'chooser.notConfigured': 'Browser not detected',
      'chooser.search.empty': 'No matches'
    },
    config: {
      chooserColumns: previewColumns,
      chooserInputMode: previewInputMode,
      closeChooserOnBlur: false,
      debug: { showAllBrowsers: true },
      lastSelection: { browserId: 'edge', profileId: 'Default' },
      browsers: {
        edge: {
          enabled: true,
          detected: true,
          path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          displayName: 'Microsoft Edge',
          profiles: [
            { id: 'Default', name: 'Default', avatarData: '' },
            { id: 'Profile 1', name: 'Work', avatarData: '' }
          ]
        },
        chrome: {
          enabled: true,
          detected: true,
          path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          displayName: 'Google Chrome',
          profiles: [
            { id: 'Default', name: 'Default', avatarData: '' },
            { id: 'Profile 2', name: 'Personal', avatarData: '' }
          ]
        },
        firefox: {
          enabled: true,
          detected: true,
          path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
          displayName: 'Mozilla Firefox',
          profiles: [{ id: 'default-release', name: 'default-release', avatarData: '' }]
        }
      }
    },
    target: previewTarget,
    targetKind: 'link',
    debugOverride: true,
    browserIcons: {},
    theme: { dark: false, accent: '#0078d4' }
  };
}

function initUI() {
  document.title = t('chooser.title');
  const question = document.querySelector('.chooser-header .title');
  if (question) {
    question.setAttribute('data-i18n', targetKind === 'file' ? 'chooser.question.file' : 'chooser.question');
  }
  applyI18n();
  applyIconGlyphs();
  const columns = Number(config.chooserColumns);
  const columnCount = [1, 2, 3, 4].includes(columns) ? columns : 2;
  document.documentElement.style.setProperty('--option-columns', String(columnCount));
  const chooserTargetBox = document.getElementById('chooser-target-box');
  const chooserSearchBox = document.getElementById('chooser-search-box');
  const inputMode = config.chooserInputMode || 'link';
  const showSearch = inputMode === 'search';
  const showTarget = inputMode === 'link';
  if (chooserTargetBox) chooserTargetBox.style.display = showTarget ? '' : 'none';
  if (chooserSearchBox) chooserSearchBox.style.display = showSearch ? '' : 'none';
  const linkMenuTrigger = document.getElementById('chooser-link-menu-trigger');
  if (linkMenuTrigger) {
    linkMenuTrigger.addEventListener('click', (event) => {
      window.api.showLinkMenu({
        x: event.clientX,
        y: event.clientY,
        labels: {
          copy: t('chooser.linkMenu.copy'),
          keepDomain: t('chooser.linkMenu.keepDomain'),
          stripFile: t('chooser.linkMenu.stripFile'),
          stripTrailingSlash: t('chooser.linkMenu.stripTrailingSlash'),
          stripProtocol: t('chooser.linkMenu.stripProtocol'),
          stripQuery: t('chooser.linkMenu.stripQuery'),
          stripHash: t('chooser.linkMenu.stripHash'),
          stripTracking: t('chooser.linkMenu.stripTracking')
        }
      });
    });
  }

  const targetInput = document.getElementById('chooser-target-input');
  if (targetInput) {
    targetInput.value = target || '';
    targetInput.addEventListener('input', () => {
      target = String(targetInput.value || '');
    });
  }
  const searchInput = document.getElementById('chooser-search-input');
  if (searchInput) {
    searchInput.value = '';
    searchInput.addEventListener('input', () => {
      searchQuery = String(searchInput.value || '');
      renderTabContent();
    });
  }
  if (showSearch && searchInput) {
    searchInput.focus();
  } else if (showTarget && targetInput) {
    targetInput.focus();
  }
  const renameDialog = document.getElementById('rename-dialog');
  const renameInput = document.getElementById('rename-input');
  const renameCancel = document.getElementById('rename-cancel');
  const renameConfirm = document.getElementById('rename-confirm');
  if (renameDialog && renameInput && renameCancel && renameConfirm) {
    renameCancel.addEventListener('click', () => {
      renameDialog.close();
      if (renameResolver) {
        const resolver = renameResolver;
        renameResolver = null;
        resolver('');
      }
    });
    renameConfirm.addEventListener('click', () => {
      const value = String(renameInput.value || '').trim();
      renameDialog.close();
      if (renameResolver) {
        const resolver = renameResolver;
        renameResolver = null;
        resolver(value);
      }
    });
    renameDialog.addEventListener('cancel', () => {
      if (renameResolver) {
        const resolver = renameResolver;
        renameResolver = null;
        resolver('');
      }
    });
  }
  const cancel = document.getElementById('cancel-btn');
  cancel.addEventListener('click', () => window.api.closeChooser());
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      await window.api.showSettings();
      window.api.closeChooser();
    });
  }
  const openBtn = document.getElementById('open-btn');
  openBtn.addEventListener('click', async () => {
    if (!selectedProfile.browserId || !isBrowserAvailable(selectedProfile.browserId)) return;
    const result = await window.api.openTarget({
      browserId: selectedProfile.browserId,
      profileId: selectedProfile.profileId || '',
      target
    });
    if (result.ok) {
      window.api.closeChooser();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      window.api.closeChooser();
    }
  });

  const copyBtn = document.getElementById('copy-btn');
  copyBtn.addEventListener('click', async () => {
    await copyTargetToClipboard();
  });

  selectDefaultTab();
  renderTabs();
  renderTabContent();

  window.api.resizeChooser();
  if (previewMode) {
    document.body.classList.add('preview-mode');
    const ids = ['copy-btn', 'settings-btn', 'cancel-btn', 'open-btn'];
    ids.forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.disabled = true;
    });
  }
}

async function copyTargetToClipboard() {
  const value = String(target || '');
  try {
    await navigator.clipboard.writeText(value);
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

async function copyText(value) {
  const text = String(value || '');
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

async function getProfileDirPath(browserId, profileId) {
  if (!browserId || !profileId) return '';
  const result = await window.api.getProfileFiles({ browserId, profileId });
  if (!result || !result.ok || !result.files) return '';
  return result.files.profileDir || '';
}

function openRenameDialog(defaultValue) {
  const dialog = document.getElementById('rename-dialog');
  const input = document.getElementById('rename-input');
  if (!dialog || !input) return Promise.resolve('');
  input.value = defaultValue || '';
  dialog.showModal();
  input.focus();
  return new Promise((resolve) => {
    renameResolver = resolve;
  });
}

function updateTarget(value) {
  target = String(value || '');
  const input = document.getElementById('chooser-target-input');
  if (input) input.value = target;
}

function stripQueryParams(url) {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch (err) {
    const hashIndex = url.indexOf('#');
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const qIndex = base.indexOf('?');
    if (qIndex < 0) return url;
    return base.slice(0, qIndex) + hash;
  }
}

function stripHash(url) {
  const index = url.indexOf('#');
  if (index < 0) return url;
  return url.slice(0, index);
}

function stripTrackingParams(url) {
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    const keys = Array.from(params.keys());
    const toRemove = keys.filter((key) => {
      const lower = key.toLowerCase();
      return (
        lower.startsWith('utm_') ||
        lower === 'fbclid' ||
        lower === 'gclid' ||
        lower === 'igshid' ||
        lower === 'mc_cid' ||
        lower === 'mc_eid'
      );
    });
    toRemove.forEach((key) => params.delete(key));
    parsed.search = params.toString();
    return parsed.toString();
  } catch (err) {
    return url;
  }
}

function keepDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch (err) {
    return url;
  }
}

function stripFile(url) {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname || '/';
    if (!path.endsWith('/')) {
      path = path.replace(/\/[^/]*$/, '/');
    }
    parsed.pathname = path;
    return parsed.toString();
  } catch (err) {
    return url;
  }
}

function stripTrailingSlash(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch (err) {
    return url;
  }
}

function stripProtocol(url) {
  return String(url).replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
}

window.api.onLinkMenuAction(async (data) => {
  const action = data && data.action ? String(data.action) : '';
  if (action === 'copy') {
    await copyText(target);
    return;
  }
  if (action === 'strip-query') {
    updateTarget(stripQueryParams(target));
    return;
  }
  if (action === 'keep-domain') {
    updateTarget(keepDomain(target));
    return;
  }
  if (action === 'strip-file') {
    updateTarget(stripFile(target));
    return;
  }
  if (action === 'strip-trailing-slash') {
    updateTarget(stripTrailingSlash(target));
    return;
  }
  if (action === 'strip-protocol') {
    updateTarget(stripProtocol(target));
    return;
  }
  if (action === 'strip-hash') {
    updateTarget(stripHash(target));
    return;
  }
  if (action === 'strip-tracking') {
    updateTarget(stripTrackingParams(target));
  }
});

window.api.onProfileMenuAction(async (data) => {
  const action = data && data.action ? String(data.action) : '';
  const browserId = data && data.browserId ? String(data.browserId) : '';
  const profileId = data && data.profileId ? String(data.profileId) : '';
  if (!browserId || !profileId) return;
  if (action === 'reveal') {
    await window.api.openProfileFolder({ browserId, profileId });
    return;
  }
  if (action === 'copy-path') {
    const dir = await getProfileDirPath(browserId, profileId);
    if (!dir) return;
    await copyText(dir);
    return;
  }
  if (action === 'rename') {
    const browser = config && config.browsers ? config.browsers[browserId] : null;
    const list = browser && Array.isArray(browser.profiles) ? browser.profiles : [];
    const current = list.find((item) => (item && (item.id || '')) === profileId);
    const nextName = await openRenameDialog(current ? current.name || '' : '');
    if (!nextName) return;
    const result = await window.api.renameProfile({ browserId, profileId, name: nextName });
    if (result && result.ok) {
      config = result.config || config;
      renderTabs();
      renderTabContent();
    }
    return;
  }
  if (action === 'delete') {
    const confirmMsg = t('manager.deleteConfirmDetailed');
    if (!window.confirm(confirmMsg)) return;
    const result = await window.api.deleteProfiles({ items: [{ browserId, profileId }] });
    if (result && result.ok) {
      config = result.config || config;
      renderTabs();
      renderTabContent();
      if (result.undoToken) {
        const shouldUndo = window.confirm(t('manager.undo.ask'));
        if (shouldUndo) {
          const undone = await window.api.undoDeleteProfiles({ token: result.undoToken });
          if (undone && undone.ok) {
            config = undone.config || config;
            renderTabs();
            renderTabContent();
          }
        }
      }
    }
  }
});

window.api.onBrowserMenuAction(async (data) => {
  const action = data && data.action ? String(data.action) : '';
  const browserId = data && data.browserId ? String(data.browserId) : '';
  if (!browserId) return;
  const browser = config && config.browsers ? config.browsers[browserId] : null;
  const browserPath = browser && browser.path ? browser.path : '';
  if (action === 'reveal') {
    if (browserPath) await window.api.revealPath(browserPath);
    return;
  }
  if (action === 'copy-path') {
    if (!browserPath) return;
    await copyText(browserPath);
    return;
  }
  if (action === 'edit') {
    await window.api.editBrowser(browserId);
    return;
  }
  if (action === 'disable') {
    if (!browser) return;
    const name = (browser.displayName || browserId || '').trim() || browserId;
    const ok = window.confirm(t('chooser.browserDisableConfirm').replace('{name}', name));
    if (!ok) return;
    browser.enabled = false;
    config.browsers[browserId].enabled = false;
    await window.api.saveConfig(config);
    if (activeTab === browserId) {
      const nextTabs = getBrowserIds().filter((id) => id !== browserId);
      activeTab = nextTabs[0] || '';
      selectedProfile = { browserId: activeTab, profileId: '' };
    }
    renderTabs();
    renderTabContent();
  }
});

function handleInitPayload(payload) {
  dict = payload.dict || {};
  config = payload.config;
  target = payload.target || '';
  debugOverride = Boolean(payload.debugOverride);
  targetKind = payload.targetKind === 'file' ? 'file' : 'link';
  browserIcons = payload.browserIcons || {};
  applyTheme(payload.theme);
  window.api.onTheme(applyTheme);
  initUI();
}

if (previewMode) {
  handleInitPayload(getPreviewPayload());
} else {
  window.api.onInit((payload) => {
    handleInitPayload(payload);
  });
}

window.api.onBlur(() => {
  if (!config || config.closeChooserOnBlur === false) return;
  if (!(debugOverride || (config.debug && config.debug.showAllBrowsers))) {
    window.api.closeChooser();
  }
});
