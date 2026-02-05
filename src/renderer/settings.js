let state = null;
let dict = {};
let config = null;
let debugOverride = false;
let browserRegistered = false;
let expandBrowserId = '';
let browserRules = [];
let browserIcons = {};
let customDialogResolver = null;
const enhancedSelects = new WeakMap();
let selectDocListenerBound = false;

function closeAllSelectMenus() {
  document.querySelectorAll('.select.open').forEach((node) => node.classList.remove('open'));
}

function enhanceSelect(select) {
  if (!select || enhancedSelects.has(select)) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'select';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  const label = document.createElement('span');
  const chevron = document.createElement('span');
  chevron.className = 'fluent-icon';
  chevron.setAttribute('data-icon', 'chevron');
  trigger.appendChild(label);
  trigger.appendChild(chevron);
  const menu = document.createElement('div');
  menu.className = 'select-menu';

  function syncLabel() {
    const option = select.options[select.selectedIndex];
    label.textContent = option ? option.textContent : '';
  }

  function rebuildOptions() {
    menu.innerHTML = '';
    Array.from(select.options).forEach((option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-option';
      item.textContent = option.textContent;
      item.dataset.value = option.value;
      if (option.disabled) item.disabled = true;
      item.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncLabel();
        closeAllSelectMenus();
      });
      menu.appendChild(item);
    });
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = wrapper.classList.contains('open');
    closeAllSelectMenus();
    wrapper.classList.toggle('open', !isOpen);
  });

  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      trigger.click();
    }
  });

  if (!selectDocListenerBound) {
    document.addEventListener('click', closeAllSelectMenus);
    selectDocListenerBound = true;
  }

  select.classList.add('select-native');
  const parent = select.parentNode;
  if (parent) parent.insertBefore(wrapper, select);
  wrapper.appendChild(select);
  wrapper.appendChild(trigger);
  wrapper.appendChild(menu);

  select.addEventListener('change', syncLabel);
  if (select.disabled) wrapper.classList.add('disabled');
  rebuildOptions();
  syncLabel();
  enhancedSelects.set(select, { wrapper, menu, label, rebuildOptions, syncLabel });
}

function enhanceSelectsIn(container = document) {
  container.querySelectorAll('select').forEach((select) => enhanceSelect(select));
  applyIconGlyphs();
}

function syncEnhancedSelect(select) {
  const data = enhancedSelects.get(select);
  if (data && typeof data.syncLabel === 'function') data.syncLabel();
}

const browserOrder = [
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

function mergeObjects(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    const next = source[key];
    if (next && typeof next === 'object' && !Array.isArray(next)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      mergeObjects(target[key], next);
    } else {
      target[key] = next;
    }
  }
  return target;
}

function getBaseRule(browserId) {
  return browserRules.find((rule) => rule && rule.id === browserId) || null;
}

function getCustomRuleIndex(browserId) {
  const list = Array.isArray(config && config.customBrowsers) ? config.customBrowsers : [];
  return list.findIndex((rule) => rule && rule.id === browserId);
}

function getCustomRule(browserId) {
  const list = Array.isArray(config && config.customBrowsers) ? config.customBrowsers : [];
  return list.find((rule) => rule && rule.id === browserId) || null;
}

function getMergedRule(browserId) {
  const base = getCustomRule(browserId) || getBaseRule(browserId);
  if (!base) return null;
  return JSON.parse(JSON.stringify(base));
}

function ensureBrowserConfig(browserId, displayName = '') {
  if (!config.browsers) config.browsers = {};
  if (!config.browsers[browserId]) {
    config.browsers[browserId] = {
      enabled: true,
      detected: false,
      path: '',
      profiles: [],
      excludedProfiles: [],
      lastProfileId: '',
      displayName: displayName || ''
    };
  } else if (displayName && !config.browsers[browserId].displayName) {
    config.browsers[browserId].displayName = displayName;
  }
}

function ensureSystemBrowserState(browserId) {
  if (!config.systemBrowsers) config.systemBrowsers = {};
  if (!config.systemBrowsers[browserId]) {
    config.systemBrowsers[browserId] = { enabled: true };
  }
}

async function saveAndRescan(message) {
  await window.api.saveConfig(config);
  const updated = await window.api.scanBrowsers();
  if (updated) {
    config = updated;
  }
  const refreshed = await window.api.getState();
  if (refreshed) {
    browserIcons = refreshed.browserIcons || {};
    config = refreshed.config || config;
  }
  renderBrowsers();
  if (message) setStatus(message);
}

function parseList(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatList(list) {
  return Array.isArray(list) ? list.filter(Boolean).join('\n') : '';
}

function buildRuleFromForm(fields, id) {
  const rule = {
    id,
    name: fields.name.value.trim() || id,
    type: fields.type.value === 'firefox' ? 'firefox' : 'chromium',
    exeCandidates: { win32: parseList(fields.exe.value) }
  };
  if (rule.type === 'chromium') {
    if (fields.userData && fields.userData.value.trim()) {
      rule.userDataDir = { win32: parseList(fields.userData.value) };
    }
    const profileArg = fields.profileArg.value.trim();
    const profileArgName = parseList(fields.profileArgName.value);
    const profileArgPath = parseList(fields.profileArgPath.value);
    rule.launch = profileArg
      ? { profileArg }
      : { profileArgName: profileArgName.length ? profileArgName : undefined, profileArgPath: profileArgPath.length ? profileArgPath : undefined };
    rule.profileImage = {
      pictureFiles: parseList(fields.pictureFiles.value),
      iconFiles: parseList(fields.iconFiles.value),
      avatarsDir: fields.avatarsDir.value.trim(),
      avatarsExtensions: parseList(fields.avatarsExt.value)
    };
  }
  return rule;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    if (!key) return;
    node.textContent = t(key);
  });
}

function setStatus(message) {
  const status = document.getElementById('status-text');
  status.textContent = message || '';
  if (message) {
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  }
}

function updateDebugUI() {
  const toggle = document.getElementById('debug-toggle');
  const enabled = Boolean(config.debug && config.debug.showAllBrowsers) || debugOverride;
  toggle.checked = enabled;
  toggle.disabled = debugOverride;
}

function updateIntegrationUI() {
  const status = document.getElementById('integration-status');
  const registerBtn = document.getElementById('integration-register');
  const unregisterBtn = document.getElementById('integration-unregister');
  const regText = browserRegistered ? t('settings.integration.registered') : t('settings.integration.unregistered');
  status.textContent = regText;
  registerBtn.style.display = browserRegistered ? 'none' : '';
  unregisterBtn.style.display = browserRegistered ? '' : 'none';
  updateRoutingUI();
}

async function refreshIntegrationState() {
  const result = await window.api.checkBrowser();
  if (!result) return;
  browserRegistered = Boolean(result.registered);
  updateIntegrationUI();
}

function updateRoutingUI() {
  const toggle = document.getElementById('routing-chooser-toggle');
  if (!toggle) return;
  const enabled = !(config && config.routing && config.routing.chooser === false);
  toggle.checked = enabled;
}

async function applyRouting() {
  const toggle = document.getElementById('routing-chooser-toggle');
  if (!toggle) return;
  if (!config.routing) config.routing = {};
  config.routing.chooser = toggle.checked;
  await window.api.saveConfig(config);
  updateRoutingUI();
  setStatus(t('settings.status.saved'));
}

function applyDebug() {
  const toggle = document.getElementById('debug-toggle');
  if (!config.debug) config.debug = {};
  config.debug.showAllBrowsers = toggle.checked;
  window.api.saveConfig(config);
  updateDebugUI();
  renderBrowsers();
  setStatus(t('settings.status.saved'));
}

async function registerSystemBrowser() {
  const result = await window.api.registerBrowser();
  if (result && result.ok) {
    await refreshIntegrationState();
    setStatus(t('settings.status.saved'));
  }
}

async function unregisterSystemBrowser() {
  const result = await window.api.unregisterBrowser();
  if (result && result.ok) {
    await refreshIntegrationState();
    setStatus(t('settings.status.saved'));
  }
}

function getBrowserIds() {
  const ids = [];
  const systemIds = browserRules.map((rule) => rule && rule.id).filter(Boolean);
  browserOrder.forEach((id) => {
    if (systemIds.includes(id) && !ids.includes(id)) ids.push(id);
  });
  systemIds.forEach((id) => {
    if (!ids.includes(id)) ids.push(id);
  });
  const custom = Array.isArray(config.customBrowsers) ? config.customBrowsers.map((rule) => rule && rule.id).filter(Boolean) : [];
  custom.forEach((id) => {
    if (!ids.includes(id)) ids.push(id);
  });
  return ids;
}

function isConfiguredOrDetected(browserId, browser) {
  if (!browser) return false;
  if (browser.detected) return true;
  if (browser.path) return true;
  const rule = getCustomRule(browserId);
  const candidates = rule && rule.exeCandidates && rule.exeCandidates.win32;
  return Array.isArray(candidates) && candidates.length > 0;
}

function getVisibleBrowserIds() {
  const debugEnabled = Boolean(config.debug && config.debug.showAllBrowsers) || debugOverride;
  const allIds = getBrowserIds();
  if (debugEnabled) return allIds;
  return allIds.filter((id) => {
    const browser = config.browsers && config.browsers[id];
    return isConfiguredOrDetected(id, browser);
  });
}

function renderBrowsers() {
  const list = document.getElementById('browsers-list');
  list.innerHTML = '';

  const browserIds = getVisibleBrowserIds();
  if (browserIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notice';
    empty.textContent = t('settings.browsers.empty');
    list.appendChild(empty);
    return;
  }

  browserIds.forEach((browserId) => {
    const customRule = getCustomRule(browserId);
    const customIndex = getCustomRuleIndex(browserId);
    const isCustom = customIndex >= 0;
    if (isCustom) {
      ensureBrowserConfig(browserId, customRule && customRule.name ? customRule.name : '');
    } else {
      ensureSystemBrowserState(browserId);
    }
    const browser = config.browsers && config.browsers[browserId] ? config.browsers[browserId] : {
      enabled: false,
      detected: false,
      path: '',
      profiles: [],
      excludedProfiles: []
    };

    const item = document.createElement('div');
    item.className = 'browser-item';

    const header = document.createElement('div');
    header.className = 'browser-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'browser-title-wrap';
    const title = document.createElement('h4');
    const displayName = config.browsers[browserId] && config.browsers[browserId].displayName;
    title.textContent = displayName || browserId;
    title.className = 'browser-title';
    const iconData = browser.detected ? browserIcons[browserId] : '';
    if (iconData) {
      const icon = document.createElement('img');
      icon.className = 'browser-icon';
      icon.src = iconData;
      icon.alt = title.textContent;
      titleWrap.appendChild(icon);
    } else {
      const icon = document.createElement('span');
      icon.className = 'fluent-icon browser-icon';
      icon.setAttribute('data-icon', 'browser');
      titleWrap.appendChild(icon);
    }
    titleWrap.appendChild(title);

    const headerActions = document.createElement('div');
    headerActions.className = 'browser-actions';
    let expandButton = null;
    if (isCustom) {
      const toggleWrap = document.createElement('label');
      toggleWrap.className = 'toggle';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = Boolean(browser.enabled);
      toggle.addEventListener('change', () => {
        browser.enabled = toggle.checked;
        config.browsers[browserId].enabled = browser.enabled;
        window.api.saveConfig(config);
      });
      header.addEventListener('click', (event) => {
        const target = event.target;
        if (!target) return;
        if (target.closest('button')) return;
        if (target.closest('input')) return;
        if (target.closest('select') || target.closest('.select')) return;
        if (target.closest('.toggle')) return;
        toggle.checked = !toggle.checked;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      });
      toggleWrap.appendChild(toggle);
      headerActions.appendChild(toggleWrap);
      expandButton = document.createElement('button');
      expandButton.className = 'browser-toggle';
      expandButton.setAttribute('data-expanded', 'false');
      expandButton.innerHTML = '<span class="fluent-icon" data-icon="chevron"></span>';
    } else {
      const toggleWrap = document.createElement('label');
      toggleWrap.className = 'toggle';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = config.systemBrowsers && config.systemBrowsers[browserId]
        ? config.systemBrowsers[browserId].enabled !== false
        : true;
      toggle.addEventListener('change', () => {
        ensureSystemBrowserState(browserId);
        config.systemBrowsers[browserId].enabled = toggle.checked;
        window.api.saveConfig(config);
        renderBrowsers();
      });
      header.addEventListener('click', (event) => {
        const target = event.target;
        if (!target) return;
        if (target.closest('button')) return;
        if (target.closest('input')) return;
        if (target.closest('select') || target.closest('.select')) return;
        if (target.closest('.toggle')) return;
        toggle.checked = !toggle.checked;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      });
      toggleWrap.appendChild(toggle);
      headerActions.appendChild(toggleWrap);
    }
    if (isCustom) {
      const removeButton = document.createElement('button');
      removeButton.className = 'button ghost';
      removeButton.textContent = t('settings.custom.remove');
      removeButton.addEventListener('click', () => {
        const list = Array.isArray(config.customBrowsers) ? config.customBrowsers : [];
        list.splice(customIndex, 1);
        config.customBrowsers = list;
        if (config.browsers && config.browsers[browserId]) {
          delete config.browsers[browserId];
        }
        if (config.browserRuleOverrides) {
          delete config.browserRuleOverrides[browserId];
        }
        window.api.saveConfig(config);
        renderBrowsers();
        setStatus(t('settings.status.saved'));
      });
      headerActions.appendChild(removeButton);
    }
    if (expandButton) headerActions.appendChild(expandButton);

    header.appendChild(titleWrap);
    header.appendChild(headerActions);

    if (isCustom) {
      const body = document.createElement('div');
      body.className = 'browser-body collapsed';

      function toggleExpand() {
        const expanded = expandButton.getAttribute('data-expanded') === 'true';
        const next = !expanded;
        expandButton.setAttribute('data-expanded', String(next));
        body.classList.toggle('collapsed', !next);
      }

      expandButton.addEventListener('click', toggleExpand);
      header.addEventListener('click', (event) => {
        const target = event.target;
        if (!target) return;
        if (target.closest('button')) return;
        if (target.closest('input')) return;
        if (target.closest('select') || target.closest('.select')) return;
        toggleExpand();
      });

      item.appendChild(header);
      const form = document.createElement('div');
      form.className = 'rule-form';
      const mergedRule = getMergedRule(browserId) || { id: browserId, name: browserId, type: 'chromium' };

    const nameField = document.createElement('div');
    nameField.className = 'rule-field';
    const nameLabel = document.createElement('div');
    nameLabel.className = 'section-desc';
    nameLabel.textContent = t('settings.browsers.rule.name');
    const nameInput = document.createElement('input');
    nameInput.className = 'input';
    nameInput.value = mergedRule.name || browserId;
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    form.appendChild(nameField);

    const typeField = document.createElement('div');
    typeField.className = 'rule-field';
    const typeLabel = document.createElement('div');
    typeLabel.className = 'section-desc';
    typeLabel.textContent = t('settings.browsers.rule.type');
    const typeSelect = document.createElement('select');
    typeSelect.className = 'input';
    typeSelect.innerHTML = '<option value="chromium">Chromium</option><option value="firefox">Firefox</option>';
    typeSelect.value = mergedRule.type === 'firefox' ? 'firefox' : 'chromium';
    typeField.appendChild(typeLabel);
    typeField.appendChild(typeSelect);
    form.appendChild(typeField);
    enhanceSelect(typeSelect);

    const exeField = document.createElement('div');
    exeField.className = 'rule-field';
    const exeLabel = document.createElement('div');
    exeLabel.className = 'section-desc';
    exeLabel.textContent = t('settings.browsers.rule.exe');
    const exeInput = document.createElement('textarea');
    exeInput.className = 'input rule-input';
    exeInput.value = formatList(mergedRule.exeCandidates && mergedRule.exeCandidates.win32);
    exeField.appendChild(exeLabel);
    exeField.appendChild(exeInput);
    form.appendChild(exeField);

    const launchRow = document.createElement('div');
    launchRow.className = 'rule-row';
    const profileArgField = document.createElement('div');
    profileArgField.className = 'rule-field';
    const profileArgLabel = document.createElement('div');
    profileArgLabel.className = 'section-desc';
    profileArgLabel.textContent = t('settings.browsers.rule.profileArg');
    const profileArgInput = document.createElement('input');
    profileArgInput.className = 'input';
    profileArgInput.value = (mergedRule.launch && mergedRule.launch.profileArg) || '';
    profileArgField.appendChild(profileArgLabel);
    profileArgField.appendChild(profileArgInput);
    launchRow.appendChild(profileArgField);

    const profileArgNameField = document.createElement('div');
    profileArgNameField.className = 'rule-field';
    const profileArgNameLabel = document.createElement('div');
    profileArgNameLabel.className = 'section-desc';
    profileArgNameLabel.textContent = t('settings.browsers.rule.profileArgName');
    const profileArgNameInput = document.createElement('textarea');
    profileArgNameInput.className = 'input rule-input';
    profileArgNameInput.value = formatList(mergedRule.launch && mergedRule.launch.profileArgName);
    profileArgNameField.appendChild(profileArgNameLabel);
    profileArgNameField.appendChild(profileArgNameInput);
    launchRow.appendChild(profileArgNameField);
    form.appendChild(launchRow);

    const profileArgPathField = document.createElement('div');
    profileArgPathField.className = 'rule-field';
    const profileArgPathLabel = document.createElement('div');
    profileArgPathLabel.className = 'section-desc';
    profileArgPathLabel.textContent = t('settings.browsers.rule.profileArgPath');
    const profileArgPathInput = document.createElement('textarea');
    profileArgPathInput.className = 'input rule-input';
    profileArgPathInput.value = formatList(mergedRule.launch && mergedRule.launch.profileArgPath);
    profileArgPathField.appendChild(profileArgPathLabel);
    profileArgPathField.appendChild(profileArgPathInput);
    form.appendChild(profileArgPathField);

    const imageRow = document.createElement('div');
    imageRow.className = 'rule-row';
    const pictureField = document.createElement('div');
    pictureField.className = 'rule-field';
    const pictureLabel = document.createElement('div');
    pictureLabel.className = 'section-desc';
    pictureLabel.textContent = t('settings.browsers.rule.pictureFiles');
    const pictureInput = document.createElement('textarea');
    pictureInput.className = 'input rule-input';
    pictureInput.value = formatList(mergedRule.profileImage && mergedRule.profileImage.pictureFiles);
    pictureField.appendChild(pictureLabel);
    pictureField.appendChild(pictureInput);
    imageRow.appendChild(pictureField);

    const iconField = document.createElement('div');
    iconField.className = 'rule-field';
    const iconLabel = document.createElement('div');
    iconLabel.className = 'section-desc';
    iconLabel.textContent = t('settings.browsers.rule.iconFiles');
    const iconInput = document.createElement('textarea');
    iconInput.className = 'input rule-input';
    iconInput.value = formatList(mergedRule.profileImage && mergedRule.profileImage.iconFiles);
    iconField.appendChild(iconLabel);
    iconField.appendChild(iconInput);
    imageRow.appendChild(iconField);
    form.appendChild(imageRow);

    const avatarsRow = document.createElement('div');
    avatarsRow.className = 'rule-row';
    const avatarsDirField = document.createElement('div');
    avatarsDirField.className = 'rule-field';
    const avatarsDirLabel = document.createElement('div');
    avatarsDirLabel.className = 'section-desc';
    avatarsDirLabel.textContent = t('settings.browsers.rule.avatarsDir');
    const avatarsDirInput = document.createElement('input');
    avatarsDirInput.className = 'input';
    avatarsDirInput.value = (mergedRule.profileImage && mergedRule.profileImage.avatarsDir) || '';
    avatarsDirField.appendChild(avatarsDirLabel);
    avatarsDirField.appendChild(avatarsDirInput);
    avatarsRow.appendChild(avatarsDirField);

    const avatarsExtField = document.createElement('div');
    avatarsExtField.className = 'rule-field';
    const avatarsExtLabel = document.createElement('div');
    avatarsExtLabel.className = 'section-desc';
    avatarsExtLabel.textContent = t('settings.browsers.rule.avatarsExt');
    const avatarsExtInput = document.createElement('textarea');
    avatarsExtInput.className = 'input rule-input';
    avatarsExtInput.value = formatList(mergedRule.profileImage && mergedRule.profileImage.avatarsExtensions);
    avatarsExtField.appendChild(avatarsExtLabel);
    avatarsExtField.appendChild(avatarsExtInput);
    avatarsRow.appendChild(avatarsExtField);
    form.appendChild(avatarsRow);

    const userDataInput = null;
    const fields = {
      name: nameInput,
      type: typeSelect,
      exe: exeInput,
      userData: userDataInput,
      profileArg: profileArgInput,
      profileArgName: profileArgNameInput,
      profileArgPath: profileArgPathInput,
      pictureFiles: pictureInput,
      iconFiles: iconInput,
      avatarsDir: avatarsDirInput,
      avatarsExt: avatarsExtInput
    };

    function saveRule() {
      const rule = buildRuleFromForm(fields, browserId);
      const list = Array.isArray(config.customBrowsers) ? config.customBrowsers : [];
      rule.id = browserId;
      list[customIndex] = rule;
      config.customBrowsers = list;
      ensureBrowserConfig(browserId, rule.name || browserId);
      saveAndRescan(t('settings.status.saved'));
    }

    Object.values(fields).forEach((input) => {
      input.addEventListener('change', saveRule);
    });

      body.appendChild(form);
      item.appendChild(body);
    } else {
      item.appendChild(header);
    }

    list.appendChild(item);

    if (browserId === expandBrowserId) {
      if (expandButton) toggleExpand();
      applyIconGlyphs();
    }
  });
  expandBrowserId = '';
  enhanceSelectsIn(list);
  applyIconGlyphs();
}

function applyTheme(theme) {
  if (!theme) return;
  document.documentElement.setAttribute('data-theme', theme.dark ? 'dark' : 'light');
  if (theme.accent) {
    document.documentElement.style.setProperty('--accent', theme.accent);
    document.documentElement.style.setProperty('--accent-2', theme.accent);
  }
}

function openCustomBrowserDialog() {
  const dialog = document.getElementById('custom-browser-dialog');
  const idInput = document.getElementById('custom-browser-id');
  const nameInput = document.getElementById('custom-browser-name');
  const typeSelect = document.getElementById('custom-browser-type');
  const exeInput = document.getElementById('custom-browser-exe');
  const userDataInput = document.getElementById('custom-browser-userdata');
  const userDataPick = document.getElementById('custom-browser-userdata-pick');
  if (!dialog || !idInput || !nameInput || !typeSelect || !exeInput) {
    return Promise.resolve(null);
  }
  idInput.value = '';
  nameInput.value = '';
  typeSelect.value = 'chromium';
  syncEnhancedSelect(typeSelect);
  exeInput.value = '';
  if (userDataInput) userDataInput.value = '';
  if (userDataPick && userDataInput) {
    userDataPick.onclick = async () => {
      const picked = await window.api.pickFolder();
      if (picked) userDataInput.value = picked;
    };
  }
  dialog.showModal();
  return new Promise((resolve) => {
    customDialogResolver = resolve;
  });
}

function bindControlToggles() {
  document.querySelectorAll('.control').forEach((control) => {
    if (control.dataset.toggleBound === '1') return;
    const checkbox = control.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    control.dataset.toggleBound = '1';
    control.addEventListener('click', (event) => {
      const target = event.target;
      if (!target) return;
      if (target.closest('button')) return;
      if (target.closest('input')) return;
      if (target.closest('select') || target.closest('.select')) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

function applyIconGlyphs() {
  const glyphs = {
    app: '\uE7C5',
    settings: '\uE713',
    close: '\uE8BB',
    minimize: '\uE921',
    link: '\uE71B',
    browser: '\uE774',
    refresh: '\uE72C',
    shield: '\uE730',
    add: '\uE710',
    remove: '\uE711',
    debug: '\uE7BA',
    save: '\uE74E',
    chevron: '\uE70D',
    open: '\uE8A7',
    appearance: '\uE790',
    language: '\uE774',
    folder: '\uE838',
    file: '\uE7C3',
    person: '\uE77B',
    window: '\uE8A5',
    search: '\uE721',
    grid: '\uE80A'
  };
  document.querySelectorAll('[data-icon]').forEach((node) => {
    const key = node.getAttribute('data-icon');
    if (glyphs[key]) {
      node.textContent = glyphs[key];
    }
  });
}

function initSidebar() {
  const main = document.getElementById('settings-main');
  if (!main) return;

  const items = Array.from(document.querySelectorAll('.sidebar-item[data-target]'));
  const sections = items
    .map((item) => {
      const id = item.getAttribute('data-target');
      const el = id ? document.getElementById(id) : null;
      return el ? { id, el, item } : null;
    })
    .filter(Boolean);

  function setActive(id) {
    items.forEach((item) => item.classList.toggle('active', item.getAttribute('data-target') === id));
  }

  items.forEach((item) => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');
      const section = targetId ? document.getElementById(targetId) : null;
      if (!section) return;
      setActive(targetId);
      section.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0))[0];
        if (!visible) return;
        const id = visible.target && visible.target.id;
        if (id) setActive(id);
      },
      { root: main, threshold: [0.6] }
    );
    sections.forEach(({ el }) => observer.observe(el));
  }
}

async function init() {
  state = await window.api.getState();
  config = state.config;
  dict = state.dict || {};
  debugOverride = Boolean(state.debugOverride);
  browserRegistered = Boolean(state.browserRegistered);
  browserRules = Array.isArray(state.browserRules) ? state.browserRules : [];
  browserIcons = state.browserIcons || {};

  document.title = t('settings.title');
  applyI18n();
  applyTheme(state.theme);
  applyIconGlyphs();
  window.api.onTheme(applyTheme);

  updateIntegrationUI();
  updateDebugUI();
  renderBrowsers();
  bindControlToggles();
  initSidebar();

  const avatarSelect = document.getElementById('avatar-preference');
  if (avatarSelect) {
    const current = config.avatarPreference === 'icon' ? 'icon' : 'picture';
    avatarSelect.value = current;
    config.avatarPreference = current;
    avatarSelect.addEventListener('change', async () => {
      config.avatarPreference = avatarSelect.value === 'icon' ? 'icon' : 'picture';
      await window.api.saveConfig(config);
      setStatus(t('settings.status.saved'));
      window.dispatchEvent(new CustomEvent('open-refresh-manager'));
    });
  }

  const windowEffect = document.getElementById('window-effect');
  if (windowEffect) {
    const allowed = ['mica', 'acrylic', 'tabbed'];
    const current = allowed.includes(config.windowEffect) ? config.windowEffect : 'mica';
    windowEffect.value = current;
    config.windowEffect = current;
    windowEffect.addEventListener('change', async () => {
      const value = allowed.includes(windowEffect.value) ? windowEffect.value : 'mica';
      config.windowEffect = value;
      await window.api.setWindowEffect(value);
      setStatus(t('settings.status.saved'));
    });
  }

  const chooserInputMode = document.getElementById('chooser-input-mode');
  if (chooserInputMode) {
    const current = ['link', 'search', 'hidden'].includes(config.chooserInputMode)
      ? config.chooserInputMode
      : 'link';
    chooserInputMode.value = current;
    config.chooserInputMode = current;
    chooserInputMode.addEventListener('change', async () => {
      const value = chooserInputMode.value;
      config.chooserInputMode = ['link', 'search', 'hidden'].includes(value) ? value : 'link';
      await window.api.saveConfig(config);
      setStatus(t('settings.status.saved'));
    });
  }

  const chooserColumns = document.getElementById('chooser-columns');
  if (chooserColumns) {
    const current = [1, 2, 3, 4].includes(Number(config.chooserColumns))
      ? String(config.chooserColumns)
      : '2';
    chooserColumns.value = current;
    config.chooserColumns = Number(current);
    chooserColumns.addEventListener('change', async () => {
      const value = Number(chooserColumns.value);
      config.chooserColumns = [1, 2, 3, 4].includes(value) ? value : 2;
      await window.api.saveConfig(config);
      setStatus(t('settings.status.saved'));
    });
  }

  const chooserWindowControls = document.getElementById('chooser-window-controls');
  if (chooserWindowControls) {
    const current = Boolean(config.chooserWindowControls);
    chooserWindowControls.checked = current;
    config.chooserWindowControls = current;
    chooserWindowControls.addEventListener('change', async () => {
      config.chooserWindowControls = chooserWindowControls.checked;
      await window.api.saveConfig(config);
      await window.api.setChooserWindowControls(config.chooserWindowControls);
      setStatus(t('settings.status.saved'));
    });
  }

  const chooserCloseOnBlur = document.getElementById('chooser-close-on-blur');
  if (chooserCloseOnBlur) {
    const current = config.closeChooserOnBlur !== false;
    chooserCloseOnBlur.checked = current;
    config.closeChooserOnBlur = current;
    chooserCloseOnBlur.addEventListener('change', async () => {
      config.closeChooserOnBlur = chooserCloseOnBlur.checked;
      await window.api.saveConfig(config);
      setStatus(t('settings.status.saved'));
    });
  }

  const languageSelect = document.getElementById('language-select');
  if (languageSelect) {
    const resolvedLocale = state.locale || config.locale || 'en-US';
    languageSelect.value = resolvedLocale;
    config.locale = resolvedLocale;
    languageSelect.addEventListener('change', async () => {
      config.locale = languageSelect.value;
      await window.api.saveConfig(config);
      window.location.reload();
    });
  }

  enhanceSelectsIn(document);

  window.api.onEditBrowser((payload) => {
    const browserId = payload && payload.browserId ? String(payload.browserId) : '';
    if (!browserId) return;
    expandBrowserId = browserId;
    renderBrowsers();
  });

  const customDialog = document.getElementById('custom-browser-dialog');
  const customCancel = document.getElementById('custom-browser-cancel');
  const customConfirm = document.getElementById('custom-browser-confirm');
  if (customDialog && customCancel && customConfirm) {
    customCancel.addEventListener('click', () => {
      customDialog.close();
      if (customDialogResolver) {
        const resolver = customDialogResolver;
        customDialogResolver = null;
        resolver(null);
      }
    });
    customConfirm.addEventListener('click', () => {
      const idInput = document.getElementById('custom-browser-id');
      const nameInput = document.getElementById('custom-browser-name');
      const typeSelect = document.getElementById('custom-browser-type');
      const exeInput = document.getElementById('custom-browser-exe');
      const userDataInput = document.getElementById('custom-browser-userdata');
      const id = idInput ? idInput.value.trim() : '';
      if (!id) {
        setStatus(t('settings.custom.idPrompt'));
        return;
      }
      const fields = {
        name: nameInput || { value: id },
        type: typeSelect || { value: 'chromium' },
        exe: exeInput || { value: '' },
        userData: userDataInput || { value: '' },
        profileArg: { value: '--profile-directory={profileId}' },
        profileArgName: { value: '' },
        profileArgPath: { value: '' },
        pictureFiles: { value: 'Profile Picture.png' },
        iconFiles: { value: 'Profile Picture.ico' },
        avatarsDir: { value: 'Avatars' },
        avatarsExt: { value: '.png\n.jpg\n.jpeg\n.ico' }
      };
      const rule = buildRuleFromForm(fields, id);
      customDialog.close();
      if (customDialogResolver) {
        const resolver = customDialogResolver;
        customDialogResolver = null;
        resolver({ id, rule });
      }
    });
    customDialog.addEventListener('cancel', () => {
      if (customDialogResolver) {
        const resolver = customDialogResolver;
        customDialogResolver = null;
        resolver(null);
      }
    });
  }

  document.getElementById('integration-default').addEventListener('click', async () => {
    await window.api.openSystemSettings('default-apps');
  });
  const assocHttp = document.getElementById('assoc-http');
  const assocHttps = document.getElementById('assoc-https');
  const assocFiles = document.getElementById('assoc-files');
  if (!config.associations) {
    config.associations = { http: true, https: true, files: true };
  }
  if (assocHttp) assocHttp.checked = config.associations.http !== false;
  if (assocHttps) assocHttps.checked = config.associations.https !== false;
  if (assocFiles) assocFiles.checked = config.associations.files !== false;
  const applyAssociations = async () => {
    config.associations = {
      http: assocHttp ? assocHttp.checked : true,
      https: assocHttps ? assocHttps.checked : true,
      files: assocFiles ? assocFiles.checked : true
    };
    await window.api.saveConfig(config);
    await window.api.setAssociations(config.associations);
    setStatus(t('settings.status.saved'));
  };
  if (assocHttp) assocHttp.addEventListener('change', applyAssociations);
  if (assocHttps) assocHttps.addEventListener('change', applyAssociations);
  if (assocFiles) assocFiles.addEventListener('change', applyAssociations);
  document.getElementById('appearance-open').addEventListener('click', async () => {
    await window.api.openSystemSettings('appearance');
  });
  document.getElementById('integration-register').addEventListener('click', registerSystemBrowser);
  document.getElementById('integration-unregister').addEventListener('click', unregisterSystemBrowser);
  const routingToggle = document.getElementById('routing-chooser-toggle');
  if (routingToggle) routingToggle.addEventListener('change', applyRouting);
  updateRoutingUI();
  document.getElementById('debug-toggle').addEventListener('change', applyDebug);
  const testLinkBtn = document.getElementById('debug-test-link');
  if (testLinkBtn) {
    testLinkBtn.addEventListener('click', async () => {
      await window.api.openChooser({ kind: 'test-link' });
    });
  }
  const testFileBtn = document.getElementById('debug-test-file');
  if (testFileBtn) {
    testFileBtn.addEventListener('click', async () => {
      await window.api.openChooser({ kind: 'test-file' });
    });
  }
  document.getElementById('scan-browsers').addEventListener('click', async () => {
    const updated = await window.api.scanBrowsers();
    config = updated;
    const refreshed = await window.api.getState();
    if (refreshed) {
      browserIcons = refreshed.browserIcons || {};
      config = refreshed.config || config;
    }
    renderBrowsers();
    bindControlToggles();
    setStatus(t('settings.status.scanDone'));
  });
  const addCustomBtn = document.getElementById('add-custom-browser');
  if (addCustomBtn) {
    addCustomBtn.addEventListener('click', async () => {
      const result = await openCustomBrowserDialog();
      if (!result) return;
      const trimmed = result.id;
      const list = Array.isArray(config.customBrowsers) ? config.customBrowsers : [];
      if (list.some((item) => item && item.id === trimmed)) {
        setStatus(t('settings.custom.exists'));
        return;
      }
      list.push(result.rule);
      config.customBrowsers = list;
      ensureBrowserConfig(trimmed, result.rule.name || trimmed);
      saveAndRescan(t('settings.status.saved'));
    });
  }
}

init();
