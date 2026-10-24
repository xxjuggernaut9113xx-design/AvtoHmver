(function () {
  'use strict';
  const epoch = globalThis.__fanserviceNativeEpoch;
  if (!location.pathname.startsWith('/fanservice/') || typeof epoch !== 'string' ||
      !/^[0-9-]{1,128}$/.test(epoch) || !/[0-9]/.test(epoch)) return;
  if (globalThis.FanserviceNativeTransport && globalThis.FanserviceNativeTransport.epoch === epoch) return;
  if (globalThis.FanserviceNativeTransport) globalThis.FanserviceNativeTransport.revoke();
  const draftsButton = document.querySelector('#unlocks');
  const previousLabel = draftsButton ? draftsButton.textContent : '';
  if (draftsButton) draftsButton.textContent = 'Pack drafts';
  let revoked = false;
  let sequence = 0;
  let current = null;
  const queue = [];
  function cancelAll(message) {
    if (current) {
      clearTimeout(current.timer);
      current.reject(new Error(message));
      current = null;
    }
    for (const pending of queue.splice(0)) pending.reject(new Error(message));
    document.title = '';
  }
  function pump() {
    if (revoked || current || !queue.length) return;
    current = queue.shift();
    const pending = current;
    pending.timer = setTimeout(() => {
      if (current !== pending) return;
      finish(new Error('The native game did not respond within 10 seconds.'));
    }, 10000);
    document.title = 'FANSERVICE_RPC:' + epoch + ':' + pending.id + ':' + pending.action + ':' +
      encodeURIComponent(pending.packName);
  }
  function finish(error, state) {
    const pending = current;
    clearTimeout(pending.timer);
    current = null;
    document.title = '';
    if (error) pending.reject(error);
    else pending.resolve(state);
    pump();
  }
  function request(action, packName = '') {
    return new Promise((resolve, reject) => {
      if (globalThis.__fanserviceNativeEpoch !== epoch) transport.revoke();
      if (revoked) return reject(new Error('The native game connection is closed.'));
      if (action !== 'state' || packName !== '') {
        return reject(new Error('Invalid native pack request.'));
      }
      if (queue.length + (current ? 1 : 0) >= 16) {
        return reject(new Error('The native request queue is full.'));
      }
      if (sequence >= 2147483647) return reject(new Error('Reopen the native menu to renew request IDs.'));
      queue.push({id: ++sequence, action, packName, resolve, reject});
      pump();
    });
  }
  function validateState(state) {
    const number = value => Number.isSafeInteger(value) && value >= 0;
    const text = (value, length) => typeof value === 'string' && value.length <= length;
    if (!state || !number(state.unlock_points) || !Array.isArray(state.packs) || state.packs.length > 10000) {
      throw new Error('The native game returned an invalid pack state.');
    }
    const ids = new Set();
    const clean = state.packs.map(pack => {
      if (!pack || !text(pack.id, 512) || !pack.id || ids.has(pack.id) || !text(pack.name, 512) ||
          !text(pack.description, 2000) || !number(pack.unlock_cost) || !number(pack.media_count) ||
          typeof pack.owned !== 'boolean' || typeof pack.enabled !== 'boolean') {
        throw new Error('The native game returned an invalid pack entry.');
      }
      ids.add(pack.id);
      return {id: pack.id, name: pack.name, description: pack.description, unlock_cost: pack.unlock_cost,
        owned: pack.owned, enabled: pack.enabled, media_count: pack.media_count};
    });
    return {unlock_points: state.unlock_points, packs: clean};
  }
  const transport = {
    epoch,
    request,
    receive(id, payload) {
      if (globalThis.__fanserviceNativeEpoch !== epoch) transport.revoke();
      if (revoked || !current || !Number.isInteger(id) || id !== current.id) return false;
      try {
        if (!payload || payload.ok !== true) {
          throw new Error(payload && typeof payload.error === 'string' ? payload.error.slice(0, 2000) :
            'The native game rejected this request.');
        }
        finish(null, validateState(payload.state));
      } catch (error) {
        finish(error);
      }
      return true;
    },
    revoke() {
      if (revoked) return;
      revoked = true;
      cancelAll('The native game connection is closed.');
      if (draftsButton) draftsButton.textContent = previousLabel;
      globalThis.removeEventListener('pagehide', onPageHide);
    }
  };
  globalThis.FanserviceNativeTransport = transport;
  function onPageHide() { transport.revoke(); }
  globalThis.addEventListener('pagehide', onPageHide);
})();
