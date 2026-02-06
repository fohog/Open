let dict = {};
let config = null;
let debugOverride = false;
let browserIcons = {};

const browserOrder = ['edge', 'edge-beta', 'edge-dev', 'edge-canary', 'chrome', 'chrome-beta', 'chrome-dev', 'chrome-canary', 'firefox', 'brave', 'vivaldi', 'chromium', 'arc', 'zen'];
const selection = new Set();
let tableRenderId = 0;
const sizeCache = new Map();
const sizeInFlight = new Map();
let sortState = { key: 'profile', dir: 'asc' };
let sizePrefetchToken = 0;
let sizeSortRerenderTimer = null;
let searchQuery = '';
let lastRenderedSelectableKeys = [];
const isEmbedded = Boolean(document.querySelector('[data-manager-embed="true"]'));
let renameResolver = null;

function cssEscape(value) {
  const raw = String(value || '');
  if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(raw);
  return raw.replace(/["\\]/g, '\\$&');
}

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
    refresh: '\uE72C',
    open: '\uE8A7',
    copy: '\uE8C8',
    delete: '\uE74D',
    browser: '\uE774',
    edit: '\uE70F',
    info: '\uE946',
    star: '\uE734',
    reveal: '\uE8B7',
    search: '\uE721'
  };
  document.querySelectorAll('[data-icon]').forEach((node) => {
    const key = node.getAttribute('data-icon');
    if (glyphs[key]) node.textContent = glyphs[key];
  });
}

function loadSizeCacheFromConfig(cfg) {
  sizeCache.clear();
  sizeInFlight.clear();
  try {
    const cache = cfg && cfg.profileSizeCache ? cfg.profileSizeCache : null;
    if (cache && typeof cache === 'object') {
      for (const browserId of Object.keys(cache)) {
        const byBrowser = cache[browserId];
        if (!byBrowser || typeof byBrowser !== 'object') continue;
        for (const profileId of Object.keys(byBrowser)) {
          const entry = byBrowser[profileId];
          if (!entry) continue;
          sizeCache.set(keyFor(browserId, profileId), entry);
        }
      }
    }
  } catch (err) {
    // ignore
  }
}

function isIconDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/x-icon');
}

function keyFor(browserId, profileId) {
  return `${browserId}\u0000${profileId}`;
}

function parseKey(key) {
  const [browserId, profileId] = String(key).split('\u0000');
  return { browserId: browserId || '', profileId: profileId || '' };
}

function setStatus(message) {
  const status = document.getElementById('manager-status-text') || document.getElementById('status-text');
  if (!status) return;
  status.textContent = message || '';
  if (message) {
    setTimeout(() => {
      if (status) status.textContent = '';
    }, 2000);
  }
}

async function copyText(text) {
  const value = String(text || '');
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (err) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch (err2) {
      return false;
    }
  }
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

async function getProfileDirPath(browserId, profileId) {
  if (!browserId || !profileId) return '';
  const result = await window.api.getProfileFiles({ browserId, profileId });
  if (!result || !result.ok || !result.files) return '';
  return result.files.profileDir || '';
}

function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = b;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const shown = idx === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 1 : 2);
  return `${shown} ${units[idx]}`;
}

function isBrowserAvailable(browserId) {
  const browser = config && config.browsers ? config.browsers[browserId] : null;
  return Boolean(browser && browser.enabled && browser.path);
}

function getBrowserName(browserId) {
  const browser = config && config.browsers ? config.browsers[browserId] : null;
  return (browser && browser.displayName) || browserId;
}

function getAccountLabel(profile) {
  if (!profile) return '';
  const user = String(profile.userName || '').trim();
  const gaia = String(profile.gaiaName || '').trim();
  return user || gaia || '';
}

function getRows() {
  const rows = [];
  const showAll = Boolean(debugOverride || (config && config.debug && config.debug.showAllBrowsers));
  const allIds = config && config.browsers ? Object.keys(config.browsers) : [];
  const ids = [];
  browserOrder.forEach((id) => {
    if (allIds.includes(id) && !ids.includes(id)) ids.push(id);
  });
  allIds.forEach((id) => {
    if (!ids.includes(id)) ids.push(id);
  });
  for (const browserId of ids) {
    const browser = config.browsers[browserId] || {};
    const profiles = Array.isArray(browser.profiles) ? browser.profiles : [];
    const hasAnyProfiles = profiles.length > 0;
    const hasExecutable = Boolean(browser.path && browser.enabled);
    if (!showAll && !(hasAnyProfiles || hasExecutable)) continue;
    if (profiles.length === 0) {
      rows.push({
        browserId,
        profileId: '',
        profileName: t('manager.noProfiles'),
        avatarData: '',
        account: '',
        detected: Boolean(browser.detected),
        enabled: Boolean(browser.enabled),
        path: browser.path || '',
        isDefault: false
      });
      continue;
    }
    for (const profile of profiles) {
      rows.push({
        browserId,
        profileId: profile.id || '',
        profileName: profile.name || profile.id || '',
        avatarData: profile.avatarData || '',
        account: getAccountLabel(profile),
        detected: Boolean(browser.detected),
        enabled: Boolean(browser.enabled),
        path: browser.path || '',
        isDefault: Boolean(profile.isDefault)
      });
    }
  }
  return rows;
}

function compareStrings(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'en', { sensitivity: 'base' });
}

function matchesSearch(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const fields = [
    getBrowserName(row.browserId),
    row.profileName,
    row.profileId,
    row.account,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return fields.some((s) => s.includes(q));
}

function getSizeBytesForRow(row) {
  const k = keyFor(row.browserId, row.profileId);
  const cached = sizeCache.get(k);
  if (!cached) return null;
  if (!cached.ok) return null;
  return Number(cached.bytes) || 0;
}

function compareSize(aBytes, bBytes, dir) {
  const aUnknown = aBytes === null;
  const bUnknown = bBytes === null;
  if (aUnknown && bUnknown) return 0;
  if (aUnknown) return dir === 'asc' ? 1 : -1;
  if (bUnknown) return dir === 'asc' ? -1 : 1;
  return dir === 'asc' ? aBytes - bBytes : bBytes - aBytes;
}

function sortRows(rows) {
  const { key, dir } = sortState || { key: 'profile', dir: 'asc' };
  const mult = dir === 'desc' ? -1 : 1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (!a.profileId && b.profileId) return 1;
    if (a.profileId && !b.profileId) return -1;
    if (!a.profileId && !b.profileId) return 0;

    if (key === 'avatar') return mult * compareStrings(a.profileName, b.profileName);
    if (key === 'browser') return mult * compareStrings(getBrowserName(a.browserId), getBrowserName(b.browserId));
	    if (key === 'profile') return mult * compareStrings(a.profileName, b.profileName);
	    if (key === 'account') return mult * compareStrings(a.account, b.account);
	    if (key === 'size') {
	      return compareSize(getSizeBytesForRow(a), getSizeBytesForRow(b), dir);
	    }
	    return mult * compareStrings(a.profileName, b.profileName);
	  });
  return sorted;
}

function scheduleSizeSortRerender() {
  if (sizeSortRerenderTimer) return;
  sizeSortRerenderTimer = setTimeout(() => {
    sizeSortRerenderTimer = null;
    renderTable();
  }, 120);
}

async function fetchProfileSize(row, renderToken) {
  if (!row || !row.profileId) return;
  const k = keyFor(row.browserId, row.profileId);
  if (sizeCache.has(k)) return;
  if (sizeInFlight.has(k)) return;

  const p = window.api
    .getProfileSize({ browserId: row.browserId, profileId: row.profileId })
    .then((result) => {
      sizeCache.set(k, result || { ok: false, bytes: 0 });
    })
    .catch(() => {
      sizeCache.set(k, { ok: false, bytes: 0 });
    })
    .finally(() => {
      sizeInFlight.delete(k);
      const domKey = `${row.browserId}::${row.profileId}`;
      const sizeCell = document.querySelector(`[data-size-key="${cssEscape(domKey)}"]`);
      if (sizeCell) {
        const cached = sizeCache.get(k);
        if (!cached) sizeCell.textContent = t('manager.none');
        else if (!cached.ok) sizeCell.textContent = t('manager.unknown');
        else sizeCell.textContent = formatBytes(Number(cached.bytes) || 0);
      }
      if (renderToken === tableRenderId && sortState && sortState.key === 'size') {
        scheduleSizeSortRerender();
      }
    });
  sizeInFlight.set(k, p);
  await p;
}

function prefetchAllSizes(rows, renderToken) {
  sizePrefetchToken += 1;
  const token = sizePrefetchToken;
  const queue = rows.filter((r) => r.profileId);
  let idx = 0;

  async function run() {
    while (idx < queue.length) {
      if (token !== sizePrefetchToken) return;
      if (renderToken !== tableRenderId) return;
      const row = queue[idx++];
      const k = keyFor(row.browserId, row.profileId);
      if (sizeCache.has(k) || sizeInFlight.has(k)) continue;
      await fetchProfileSize(row, renderToken);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  void run();
}

function updateSortIndicators() {
  const nodes = Array.from(document.querySelectorAll('#table thead .manager-sort[data-sort-key]'));
  nodes.forEach((node) => {
    const sortKey = node.getAttribute('data-sort-key') || '';
    const i18nKey = node.getAttribute('data-i18n') || '';
    const label = i18nKey ? t(i18nKey) : node.textContent;
    let arrow = '';
    if (sortKey && sortState && sortState.key === sortKey) {
      arrow = sortState.dir === 'desc' ? ' ▼' : ' ▲';
    }
    node.textContent = `${label}${arrow}`;
  });
}

function initSortHandlers() {
  const nodes = Array.from(document.querySelectorAll('#table thead .manager-sort[data-sort-key]'));
  nodes.forEach((node) => {
    if (node.dataset.bound === '1') return;
    node.dataset.bound = '1';
    node.addEventListener('click', () => {
      const key = node.getAttribute('data-sort-key') || '';
      if (!key) return;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.dir = 'asc';
      }
      if (sortState.key !== 'size') {
        sizePrefetchToken += 1;
      }
      renderTable();
    });
  });
}

function updateActionStates() {
  const openBtn = document.getElementById('open-btn');
  const deleteBtn = document.getElementById('delete-btn');
  const duplicateBtn = document.getElementById('duplicate-btn');
  const renameBtn = document.getElementById('rename-btn');

  const selected = Array.from(selection).map(parseKey).filter((x) => x.browserId && x.profileId);
  const count = selected.length;
  const single = count === 1 ? selected[0] : null;
  const canOpenAll = selected.every((x) => isBrowserAvailable(x.browserId));

  openBtn.disabled = count === 0 || !canOpenAll;
  deleteBtn.disabled = count === 0;
  duplicateBtn.disabled = !single;
  renameBtn.disabled = !single;
}


function renderTable() {
  tableRenderId += 1;
  const renderToken = tableRenderId;
  const body = document.getElementById('table-body');
  body.innerHTML = '';

  const allRows = getRows();
  const filtered = allRows.filter((r) => matchesSearch(r, searchQuery));
  const rows = sortRows(filtered);
  const visibleRows = rows.filter((r) => r.profileId);
  lastRenderedSelectableKeys = visibleRows.map((r) => keyFor(r.browserId, r.profileId));

  if (visibleRows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'notice manager-empty-cell';
    td.textContent = t('manager.empty');
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const line = document.createElement('tr');
    line.className = 'manager-row';
    const disabled = !row.profileId;
    if (disabled) line.classList.add('disabled');

    const checkCell = document.createElement('td');
    checkCell.className = 'manager-cell manager-cell-check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.disabled = disabled;
    const k = keyFor(row.browserId, row.profileId);
    if (!disabled) {
      line.dataset.key = k;
    }
    checkbox.checked = selection.has(k);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selection.add(k);
      else selection.delete(k);
      syncSelectAll();
      updateActionStates();
    });
    checkCell.appendChild(checkbox);

    const avatarCell = document.createElement('td');
    avatarCell.className = 'manager-cell manager-cell-avatar';
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'manager-avatar-cell';
    if (!disabled && row.avatarData) {
      const img = document.createElement('img');
      img.src = row.avatarData;
      img.alt = row.profileName || '';
      if (isIconDataUrl(row.avatarData)) {
        img.classList.add('icon-avatar');
        avatarWrap.classList.add('icon-avatar');
        avatarWrap.classList.remove('text-avatar');
      } else {
        avatarWrap.classList.remove('icon-avatar');
        avatarWrap.classList.remove('text-avatar');
      }
      avatarWrap.appendChild(img);
    } else if (!disabled) {
      avatarWrap.classList.remove('icon-avatar');
      avatarWrap.classList.add('text-avatar');
      avatarWrap.textContent = (row.profileName || '').slice(0, 1).toUpperCase() || '?';
    }
    avatarCell.appendChild(avatarWrap);

    const browserCell = document.createElement('td');
    browserCell.className = 'manager-cell manager-cell-browser';
    const browserWrap = document.createElement('div');
    browserWrap.className = 'cell-flex';
    const iconDataUrl = browserIcons && browserIcons[row.browserId] ? browserIcons[row.browserId] : '';
    if (iconDataUrl) {
      const img = document.createElement('img');
      img.className = 'manager-browser-icon';
      img.src = iconDataUrl;
      img.alt = getBrowserName(row.browserId);
      browserWrap.appendChild(img);
    } else {
      const icon = document.createElement('span');
      icon.className = 'fluent-icon';
      icon.setAttribute('data-icon', 'browser');
      browserWrap.appendChild(icon);
    }
    const name = document.createElement('span');
    name.textContent = getBrowserName(row.browserId);
    browserWrap.appendChild(name);
    browserCell.appendChild(browserWrap);

    const profileCell = document.createElement('td');
    profileCell.className = 'manager-cell manager-cell-profile';
    profileCell.textContent = row.profileName || row.profileId || '';

    const accountCell = document.createElement('td');
    accountCell.className = 'manager-cell manager-cell-account';
    accountCell.textContent = disabled ? '' : (row.account || t('manager.none'));

    const sizeCell = document.createElement('td');
    sizeCell.className = 'manager-cell manager-cell-size';
    if (disabled) {
      sizeCell.textContent = '';
    } else {
      const bytes = getSizeBytesForRow(row);
      const cached = sizeCache.get(keyFor(row.browserId, row.profileId));
      if (!cached) sizeCell.textContent = t('manager.none');
      else if (!cached.ok) sizeCell.textContent = t('manager.unknown');
      else sizeCell.textContent = formatBytes(bytes || 0);
    }
    sizeCell.setAttribute('data-size-key', `${row.browserId}::${row.profileId}`);

    if (!disabled) {
      line.addEventListener('click', (event) => {
        if (event.target && (event.target.tagName || '').toLowerCase() === 'input') return;
        if (selection.has(k)) selection.delete(k);
        else selection.add(k);
        renderTable();
        updateActionStates();
      });

      line.addEventListener('contextmenu', async (event) => {
        event.preventDefault();
        const items = selection.has(k) ? getSelectedItems() : [{ browserId: row.browserId, profileId: row.profileId }];
        await window.api.showManagerMenu({
          x: event.clientX,
          y: event.clientY,
          items,
          labels: {
            open: t('manager.menu.open'),
            reveal: t('manager.menu.reveal'),
            copyPath: t('manager.menu.copyPath'),
            rename: t('manager.menu.rename'),
            delete: t('manager.menu.delete')
          }
        });
      });
    }

    line.appendChild(checkCell);
    line.appendChild(avatarCell);
    line.appendChild(browserCell);
    line.appendChild(profileCell);
    line.appendChild(accountCell);
    line.appendChild(sizeCell);
    body.appendChild(line);
  }

  applyIconGlyphs();
  initSortHandlers();
  updateSortIndicators();
  syncSelectAll();
  if (visibleRows.length > 0) {
    prefetchAllSizes(visibleRows, renderToken);
  }
}

function syncSelectAll() {
  const selectAll = document.getElementById('select-all');
  if (!selectAll) return;
  const selectable = Array.isArray(lastRenderedSelectableKeys) ? lastRenderedSelectableKeys : [];
  const selectedCount = selectable.filter((k) => selection.has(k)).length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < selectable.length;
  selectAll.checked = selectable.length > 0 && selectedCount === selectable.length;
}

function getSelectedItems() {
  return Array.from(selection)
    .map(parseKey)
    .filter((x) => x.browserId && x.profileId);
}

async function doOpen() {
  const items = getSelectedItems();
  if (!items.length) return;
  const result = await window.api.openProfiles({ items });
  if (result && result.ok) setStatus(t('manager.status.opened'));
}

async function doDelete() {
  const items = getSelectedItems();
  if (!items.length) return;
  if (!confirm(t('manager.deleteConfirmDetailed'))) return;
  const result = await window.api.deleteProfiles({ items });
  if (result && result.ok) {
    config = result.config || config;
    selection.clear();
    renderTable();
    updateActionStates();
    setStatus(t('manager.status.saved'));
    if (result.undoToken) {
      const shouldUndo = window.confirm(t('manager.undo.ask'));
      if (shouldUndo) {
        const undone = await window.api.undoDeleteProfiles({ token: result.undoToken });
        if (undone && undone.ok) {
          config = undone.config || config;
          selection.clear();
          renderTable();
          updateActionStates();
          setStatus(t('manager.undo.done'));
        }
      }
    }
  } else {
    setStatus(t('manager.status.failed'));
  }
}

function openDuplicateDialog(single) {
  const dialog = document.getElementById('duplicate-dialog');
  const desc = document.getElementById('duplicate-desc');
  const options = document.getElementById('duplicate-options');
  const nameInput = document.getElementById('dup-name');

  nameInput.value = '';
  if (single.browserId === 'firefox') {
    options.style.display = 'none';
    desc.textContent = t('manager.duplicate.firefoxNote');
  } else {
    options.style.display = 'grid';
    desc.textContent = t('manager.duplicate.desc');
    document.getElementById('dup-bookmarks').checked = true;
    document.getElementById('dup-extensions').checked = false;
    document.getElementById('dup-history').checked = false;
    document.getElementById('dup-site').checked = false;
  }

  dialog.showModal();
  nameInput.focus();
}

async function doDuplicate() {
  const items = getSelectedItems();
  const single = items.length === 1 ? items[0] : null;
  if (!single) return;
  openDuplicateDialog(single);
}

async function confirmDuplicate() {
  const items = getSelectedItems();
  const single = items.length === 1 ? items[0] : null;
  if (!single) return;

  const dialog = document.getElementById('duplicate-dialog');
  const nameInput = document.getElementById('dup-name');
  const name = String(nameInput.value || '').trim();

  const options =
    single.browserId === 'firefox'
      ? {}
      : {
          bookmarks: document.getElementById('dup-bookmarks').checked,
          extensions: document.getElementById('dup-extensions').checked,
          history: document.getElementById('dup-history').checked,
          siteData: document.getElementById('dup-site').checked
        };

  const result = await window.api.duplicateProfile({
    browserId: single.browserId,
    profileId: single.profileId,
    name,
    options
  });

  dialog.close();

  if (result && result.ok) {
    config = result.config || config;
    selection.clear();
    selection.add(keyFor(single.browserId, result.profileId));
    renderTable();
    updateActionStates();
    setStatus(t('manager.status.saved'));
  } else {
    setStatus(t('manager.status.failed'));
  }
}

async function doRename() {
  const items = getSelectedItems();
  const single = items.length === 1 ? items[0] : null;
  if (!single) return;
  const browser = config && config.browsers ? config.browsers[single.browserId] : null;
  const list = browser && Array.isArray(browser.profiles) ? browser.profiles : [];
  const current = list.find((item) => (item && (item.id || '')) === single.profileId);
  const nextName = await openRenameDialog(current ? current.name || '' : '');
  if (!nextName) return;
  const result = await window.api.renameProfile({
    browserId: single.browserId,
    profileId: single.profileId,
    name: nextName
  });
  if (result && result.ok) {
    config = result.config || config;
    renderTable();
    updateActionStates();
    setStatus(t('manager.status.saved'));
  } else {
    setStatus(t('manager.status.failed'));
  }
}

async function calcSizeForSelection() {
  const items = getSelectedItems();
  if (!items.length) return;
  for (const item of items) {
    const row = { browserId: item.browserId, profileId: item.profileId };
    const k = keyFor(row.browserId, row.profileId);
    if (sizeCache.has(k) || sizeInFlight.has(k)) continue;
    await fetchProfileSize(row, tableRenderId);
  }
  updateActionStates();
}

async function handleMenuAction(data) {
  const action = data && data.action ? String(data.action) : '';
  const items = Array.isArray(data && data.items) ? data.items : getSelectedItems();

  if (action === 'open') return await doOpen();
  if (action === 'reveal') {
    const single = items.length === 1 ? items[0] : null;
    if (!single) return;
    await window.api.openProfileFolder({ browserId: single.browserId, profileId: single.profileId });
    return;
  }
  if (action === 'copy-path') {
    const single = items.length === 1 ? items[0] : null;
    if (!single) return;
    const dir = await getProfileDirPath(single.browserId, single.profileId);
    if (!dir) return;
    await copyText(dir);
    setStatus(t('manager.status.saved'));
    return;
  }
  if (action === 'rename') return await doRename();
  if (action === 'delete') return await doDelete();
}

async function refresh() {
  const state = await window.api.getManagerState();
  config = state.config;
  dict = state.dict || {};
  debugOverride = Boolean(state.debugOverride);
  browserIcons = state.browserIcons || {};
  loadSizeCacheFromConfig(config);
  applyI18n();
  applyTheme(state.theme);
  applyIconGlyphs();
  selection.clear();
  renderTable();
  updateActionStates();
  setStatus(t('manager.status.scanDone'));
}

async function init() {
  const state = await window.api.getManagerState();
  config = state.config;
  dict = state.dict || {};
  debugOverride = Boolean(state.debugOverride);
  browserIcons = state.browserIcons || {};
  loadSizeCacheFromConfig(config);

  if (!isEmbedded) {
    document.title = t('manager.title');
  }
  applyI18n();
  applyTheme(state.theme);
  applyIconGlyphs();
  window.api.onTheme(applyTheme);
  window.addEventListener('open-refresh-manager', () => {
    refresh();
  });

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

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = '';
    searchInput.addEventListener('input', async () => {
      searchQuery = String(searchInput.value || '');
      selection.clear();
      renderTable();
      updateActionStates();
    });
  }
  document.getElementById('refresh-btn').addEventListener('click', refresh);
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => window.api.showSettings());
  }

  document.getElementById('open-btn').addEventListener('click', doOpen);
  document.getElementById('delete-btn').addEventListener('click', doDelete);
  document.getElementById('duplicate-btn').addEventListener('click', doDuplicate);
  document.getElementById('rename-btn').addEventListener('click', doRename);
  document.getElementById('dup-cancel').addEventListener('click', () => document.getElementById('duplicate-dialog').close());
  document.getElementById('dup-confirm').addEventListener('click', confirmDuplicate);

  window.api.onManagerMenuAction(handleMenuAction);

  const selectAll = document.getElementById('select-all');
  selectAll.addEventListener('change', () => {
    const selectable = Array.isArray(lastRenderedSelectableKeys) ? lastRenderedSelectableKeys : [];
    if (selectAll.checked) {
      selectable.forEach((k) => selection.add(k));
    } else {
      selection.clear();
    }
    renderTable();
    updateActionStates();
  });

  renderTable();
  updateActionStates();
  updateActionStates();
}

init();
