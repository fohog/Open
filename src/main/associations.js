const path = require('path');
const { app } = require('electron');
const { htmlExtensions } = require('./browsers');

const protocols = ['http', 'https'];

function registerProtocol(protocol) {
  if (process.defaultApp) {
    const appPath = path.resolve(process.argv[1]);
    app.setAsDefaultProtocolClient(protocol, process.execPath, [appPath]);
  } else {
    app.setAsDefaultProtocolClient(protocol);
  }
}

function unregisterProtocol(protocol) {
  if (process.defaultApp) {
    const appPath = path.resolve(process.argv[1]);
    app.removeAsDefaultProtocolClient(protocol, process.execPath, [appPath]);
  } else {
    app.removeAsDefaultProtocolClient(protocol);
  }
}

function registerFileAssociations() {
  // Electron cannot reliably set file associations cross-platform at runtime.
  // On Windows packaged apps, setAsDefaultApp is available.
  if (typeof app.setAsDefaultApp === 'function') {
    for (const ext of htmlExtensions) {
      try {
        app.setAsDefaultApp(ext);
      } catch (err) {
        // ignore
      }
    }
  }
}

function unregisterFileAssociations() {
  if (typeof app.removeAsDefaultApp === 'function') {
    for (const ext of htmlExtensions) {
      try {
        app.removeAsDefaultApp(ext);
      } catch (err) {
        // ignore
      }
    }
  }
}

function registerDefaultHandlers(associations) {
  const assoc = associations || {};
  if (assoc.http !== false) registerProtocol('http');
  else unregisterProtocol('http');
  if (assoc.https !== false) registerProtocol('https');
  else unregisterProtocol('https');
  if (assoc.files !== false) registerFileAssociations();
  else unregisterFileAssociations();
}

function unregisterDefaultHandlers(associations) {
  const assoc = associations || {};
  if (assoc.http !== false) unregisterProtocol('http');
  if (assoc.https !== false) unregisterProtocol('https');
  if (assoc.files !== false) unregisterFileAssociations();
}

module.exports = {
  protocols,
  registerDefaultHandlers,
  unregisterDefaultHandlers
};
