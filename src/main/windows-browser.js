const { spawnSync } = require('child_process');
const { app } = require('electron');

const APP_ID = 'Open';
const CAPABILITIES_PATH = 'Software\\Clients\\StartMenuInternet\\Open\\Capabilities';
const HTTP_USER_CHOICE = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice';
const HTTPS_USER_CHOICE = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice';

function runReg(args) {
  const result = spawnSync('reg', args, { encoding: 'utf-8' });
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function readRegValue(keyPath, valueName) {
  const result = runReg(['query', keyPath, '/v', valueName]);
  if (!result.ok) return '';
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.toLowerCase().startsWith(valueName.toLowerCase())) continue;
    const parts = line.split(/\s{2,}/);
    return parts[2] ? parts[2].trim() : '';
  }
  return '';
}

function isRegistered() {
  if (process.platform !== 'win32') return false;
  const result = runReg(['query', 'HKCU\\Software\\RegisteredApplications', '/v', APP_ID]);
  return result.ok && result.stdout.includes(CAPABILITIES_PATH);
}

function isDefaultBrowser() {
  if (process.platform !== 'win32') return false;
  const httpProgId = readRegValue(HTTP_USER_CHOICE, 'ProgId').toLowerCase();
  const httpsProgId = readRegValue(HTTPS_USER_CHOICE, 'ProgId').toLowerCase();
  return httpProgId === 'openurl' && httpsProgId === 'openurl';
}

function getDefaultBrowserProgIds() {
  if (process.platform !== 'win32') return { http: '', https: '' };
  return {
    http: readRegValue(HTTP_USER_CHOICE, 'ProgId'),
    https: readRegValue(HTTPS_USER_CHOICE, 'ProgId')
  };
}

function registerBrowser() {
  if (process.platform !== 'win32') return { ok: false, message: 'Unsupported platform' };
  const exe = app.getPath('exe');
  const icon = `${exe},0`;
  const command = `"${exe}" "%1"`;

  const steps = [
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open', '/ve', '/t', 'REG_SZ', '/d', 'Open', '/f'],
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open', '/v', 'DefaultIcon', '/t', 'REG_SZ', '/d', icon, '/f'],
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', command, '/f'],
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open\\Capabilities', '/v', 'ApplicationName', '/t', 'REG_SZ', '/d', 'Open', '/f'],
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open\\Capabilities', '/v', 'ApplicationDescription', '/t', 'REG_SZ', '/d', 'Open web link manager', '/f'],
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open\\Capabilities\\URLAssociations', '/v', 'http', '/t', 'REG_SZ', '/d', 'OpenURL', '/f'],
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open\\Capabilities\\URLAssociations', '/v', 'https', '/t', 'REG_SZ', '/d', 'OpenURL', '/f'],
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open\\Capabilities\\FileAssociations', '/v', '.html', '/t', 'REG_SZ', '/d', 'OpenHTML', '/f'],
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open\\Capabilities\\FileAssociations', '/v', '.htm', '/t', 'REG_SZ', '/d', 'OpenHTML', '/f'],
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open\\Capabilities\\FileAssociations', '/v', '.mshtml', '/t', 'REG_SZ', '/d', 'OpenHTML', '/f'],
    ['add', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open\\Capabilities\\FileAssociations', '/v', '.xhtml', '/t', 'REG_SZ', '/d', 'OpenHTML', '/f'],
    ['add', 'HKCU\\Software\\Classes\\OpenURL', '/ve', '/t', 'REG_SZ', '/d', 'Open URL', '/f'],
    ['add', 'HKCU\\Software\\Classes\\OpenURL', '/v', 'URL Protocol', '/t', 'REG_SZ', '/d', '', '/f'],
    ['add', 'HKCU\\Software\\Classes\\OpenURL\\DefaultIcon', '/ve', '/t', 'REG_SZ', '/d', icon, '/f'],
    ['add', 'HKCU\\Software\\Classes\\OpenURL\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', command, '/f'],
    ['add', 'HKCU\\Software\\Classes\\OpenHTML', '/ve', '/t', 'REG_SZ', '/d', 'Open HTML Document', '/f'],
    ['add', 'HKCU\\Software\\Classes\\OpenHTML\\DefaultIcon', '/ve', '/t', 'REG_SZ', '/d', icon, '/f'],
    ['add', 'HKCU\\Software\\Classes\\OpenHTML\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', command, '/f'],
    ['add', 'HKCU\\Software\\RegisteredApplications', '/v', APP_ID, '/t', 'REG_SZ', '/d', CAPABILITIES_PATH, '/f']
  ];

  for (const args of steps) {
    const result = runReg(args);
    if (!result.ok) return { ok: false, message: result.stderr || result.stdout };
  }

  return { ok: true };
}

function unregisterBrowser() {
  if (process.platform !== 'win32') return { ok: false, message: 'Unsupported platform' };
  const steps = [
    ['delete', 'HKCU\\Software\\RegisteredApplications', '/v', APP_ID, '/f'],
    ['delete', 'HKCU\\Software\\Clients\\StartMenuInternet\\Open', '/f'],
    ['delete', 'HKCU\\Software\\Classes\\OpenURL', '/f'],
    ['delete', 'HKCU\\Software\\Classes\\OpenHTML', '/f']
  ];

  for (const args of steps) {
    runReg(args);
  }
  return { ok: true };
}

module.exports = {
  isRegistered,
  isDefaultBrowser,
  getDefaultBrowserProgIds,
  registerBrowser,
  unregisterBrowser
};
