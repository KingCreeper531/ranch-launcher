// Injected at document start: gives the launcher UI the same `window.ranch`
// API it has on Windows, backed by the native RanchNative interface.
(function () {
  if (window.ranch || typeof RanchNative === 'undefined') return;
  var pending = {};
  var nextId = 1;
  var changed = [];

  function call(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      try {
        RanchNative.call(method, JSON.stringify(args), id);
      } catch (e) {
        delete pending[id];
        reject(e);
      }
    });
  }

  window.__ranchResolve = function (id, value) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    p.resolve(value);
  };
  window.__ranchReject = function (id, message) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    p.reject(new Error(message));
  };
  window.__ranchEmit = function (type, payload) {
    if (type !== 'changed') return;
    changed.slice().forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  };

  window.ranch = {
    platform: 'android',
    list: function () { return call('list'); },
    refresh: function () { return call('refresh'); },
    install: function (id) { return call('install', id); },
    uninstall: function (id) { return call('uninstall', id); },
    open: function (id) { return call('open', id); },
    github: function (id) { return call('github', id); },
    getSettings: function () { return call('getSettings'); },
    setSettings: function (patch) { return call('setSettings', patch || {}); },
    appSettings: function () { return Promise.resolve(null); },
    setAppSettings: function () { return Promise.resolve(null); },
    onAppSettingsChanged: function () { return function () {}; },
    onChanged: function (fn) {
      changed.push(fn);
      return function () {
        var i = changed.indexOf(fn);
        if (i >= 0) changed.splice(i, 1);
      };
    },
  };
})();
