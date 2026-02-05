const fs = require('fs');
const path = require('path');

const cache = {};

function loadLocale(locale) {
  if (cache[locale]) return cache[locale];
  const localesDir = path.join(__dirname, '..', '..', 'locales');
  const filePath = path.join(localesDir, `${locale}.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    cache[locale] = JSON.parse(raw);
  } catch (err) {
    cache[locale] = {};
  }
  return cache[locale];
}

function resolveLocale(preferred) {
  const localesDir = path.join(__dirname, '..', '..', 'locales');
  function exists(locale) {
    try {
      return fs.existsSync(path.join(localesDir, `${locale}.json`));
    } catch (err) {
      return false;
    }
  }

  const raw = String(preferred || '').trim();
  if (!raw) return exists('en-US') ? 'en-US' : 'zh-CN';

  const normalized = raw.replace('_', '-');
  const lower = normalized.toLowerCase();

  if (lower === 'en') return exists('en-US') ? 'en-US' : (exists('zh-CN') ? 'zh-CN' : 'en-US');
  if (lower === 'zh') return exists('zh-CN') ? 'zh-CN' : (exists('zh-TW') ? 'zh-TW' : 'en-US');
  if (lower === 'zh-hk' || lower === 'zh-mo') return exists('zh-TW') ? 'zh-TW' : (exists('zh-CN') ? 'zh-CN' : 'en-US');

  const mapped = normalized;
  if (exists(mapped)) return mapped;

  // Windows may provide a tag like "en-US" (supported), or other locales.
  if (lower.startsWith('en-')) return exists('en-US') ? 'en-US' : (exists('zh-CN') ? 'zh-CN' : 'en-US');
  if (lower.startsWith('zh-')) return exists('zh-TW') ? 'zh-TW' : (exists('zh-CN') ? 'zh-CN' : 'en-US');
  return exists('en-US') ? 'en-US' : (exists('zh-CN') ? 'zh-CN' : 'en-US');
}

function t(locale, key, vars = {}) {
  const dict = loadLocale(locale);
  const fallback = loadLocale('en-US');
  const template = dict[key] || fallback[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    return vars[name] !== undefined ? String(vars[name]) : '';
  });
}

module.exports = {
  loadLocale,
  resolveLocale,
  t
};
