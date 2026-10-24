(function () {
  'use strict';
  const epoch = globalThis.__fanserviceNativeEpoch;
  if (!location.pathname.startsWith('/fanservice/') || typeof epoch !== 'string' ||
      !/^[0-9-]{1,128}$/.test(epoch) || !/[0-9]/.test(epoch)) return;
  if (globalThis.FanserviceNativeTransport && globalThis.FanserviceNativeTransport.epoch === epoch) return;
  if (globalThis.FanserviceNativeTransport) globalThis.FanserviceNativeTransport.revoke();
  let revoked = false;
  let sequence = 0;
  let current = null;
  const queue = [];
  const actions = new Set(['state', 'purchase', 'enable', 'disable']);
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = element('button', 'Game packs');
  button.type = 'button';
  button.id = 'fanservice-native-game-packs';
  const dialog = element('dialog');
  dialog.id = 'fanservice-native-game-packs-dialog';
  dialog.hidden = true;
  dialog.setAttribute('aria-label', 'Game packs');
  dialog.style.cssText = 'width:min(42rem,90vw);max-height:85vh;overflow:auto;background:#202d3d;color:#eaf0f4;border:1px solid #8294ab;border-radius:12px;padding:20px;';
  const heading = element('h2', 'Game packs');
  const balance = element('p', 'Native game UP: loading.');
  const status = element('p', '');
  status.setAttribute('role', 'status');
  const packs = element('div');
  const refresh = element('button', 'Refresh game packs');
  refresh.type = 'button';
  const close = element('button', 'Close');
  close.type = 'button';
  dialog.append(heading, balance, status, packs, refresh, close);
  (document.querySelector('header') || document.body).append(button);
  document.body.append(dialog);

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
      if (!actions.has(action) || typeof packName !== 'string' || packName.length > 512 ||
          (action === 'state' ? packName !== '' : !packName)) {
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
      button.remove();
      dialog.remove();
      globalThis.removeEventListener('pagehide', onPageHide);
    }
  };
  globalThis.FanserviceNativeTransport = transport;
  function render(state) {
    balance.textContent = 'Native game UP: ' + state.unlock_points + '.';
    packs.replaceChildren();
    if (!state.packs.length) packs.append(element('p', 'No native custom packs are installed.'));
    for (const pack of state.packs) {
      const card = element('section');
      card.append(element('h3', pack.name), element('p', pack.description),
        element('p', pack.media_count + ' media · ' + (pack.owned ? 'Owned' : pack.unlock_cost + ' UP') +
          ' · ' + (pack.enabled ? 'Enabled' : 'Disabled')));
      const action = pack.owned ? (pack.enabled ? 'disable' : 'enable') : 'purchase';
      const control = element('button', pack.owned ? (pack.enabled ? 'Disable' : 'Enable') :
        'Purchase · ' + pack.unlock_cost + ' UP');
      control.type = 'button';
      control.addEventListener('click', () => update(action, pack.id));
      card.append(control);
      packs.append(card);
    }
  }
  let menuGeneration = 0;
  async function update(action = 'state', packName = '') {
    const generation = menuGeneration;
    status.textContent = 'Waiting for the native game.';
    try {
      const state = await request(action, packName);
      if (revoked || generation !== menuGeneration) return;
      render(state);
      status.textContent = '';
    } catch (error) {
      if (!revoked && generation === menuGeneration) status.textContent = error.message;
    }
  }
  function closeMenu() {
    menuGeneration++;
    cancelAll('The Game packs menu was closed.');
    status.textContent = '';
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    dialog.hidden = true;
  }
  button.addEventListener('click', () => {
    dialog.hidden = false;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    update();
  });
  refresh.addEventListener('click', () => update());
  close.addEventListener('click', closeMenu);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeMenu(); });
  dialog.addEventListener('close', () => {
    menuGeneration++;
    cancelAll('The Game packs menu was closed.');
    status.textContent = '';
    dialog.hidden = true;
  });
  function onPageHide() { transport.revoke(); }
  globalThis.addEventListener('pagehide', onPageHide);
})();
