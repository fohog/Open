const fs = require('fs');
const path = require('path');
const { parentPort } = require('worker_threads');

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

function getDirSizeStats(dirPath, { maxFiles = 500000, maxDepth = 64 } = {}) {
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

if (parentPort) {
  parentPort.on('message', (msg) => {
    const { id, dirPath, options } = msg || {};
    try {
      const result = getDirSizeStats(dirPath, options || {});
      parentPort.postMessage({ id, ok: true, result });
    } catch (err) {
      parentPort.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
    }
  });
}

