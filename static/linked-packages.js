(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const open = byId('linked-package-open');
  const modal = byId('linked-package-modal');
  if (!open || !modal) return;
  // A linked package lives on the library computer. Other devices use portable export.
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname)) return;
  open.hidden = false;
  const start = byId('linked-package-start');
  const cancel = byId('linked-package-cancel');
  const close = byId('linked-package-close');
  const status = byId('linked-package-status');
  const path = byId('linked-package-path');
  const progress = byId('linked-package-progress');
  let generation = 0, statusRequest = 0, timer = null, job = null, pending = false, request = null;
  const busy = () => Boolean(job && ['running', 'cancelling'].includes(job.phase));
  function render() {
    start.disabled = pending || busy();
    cancel.hidden = !busy();
    cancel.disabled = pending || job?.phase === 'cancelling';
    progress.hidden = !busy();
    path.hidden = !job?.path;
    path.textContent = job?.path || '';
    const messages = {
      running: 'Staging library media...', cancelling: 'Cancelling and cleaning up partial staging...',
      complete: 'Package ready on this computer.', cancelled: 'Staging cancelled. Original media is preserved.',
      failed: 'Staging failed.', invalidated: 'Managed package is no longer available.'
    };
    status.textContent = job ? `${messages[job.phase] || job.phase}${job.error ? ` ${job.error}` : ''}` : 'Ready to stage.';
  }
  async function send(method = 'GET', id = null) {
    const response = await fetch(`/api/export/chpack/linked${id ? `/${encodeURIComponent(id)}` : ''}`, {
      method, signal: request?.signal,
      ...(method === 'POST' ? {headers: {'Content-Type': 'application/json'}, body: '{}'} : {})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Package request failed');
    return data.job;
  }
  function schedule() {
    clearTimeout(timer);
    if (!modal.hidden && !document.hidden && busy()) timer = setTimeout(refresh, 750);
  }
  async function refresh() {
    if (modal.hidden || pending) return;
    const current = generation;
    const latestRequest = ++statusRequest;
    try {
      const latest = await send();
      if (current !== generation || latestRequest !== statusRequest) return;
      job = latest; render(); schedule();
    } catch (error) {
      if (current !== generation || latestRequest !== statusRequest || error.name === 'AbortError') return;
      status.textContent = `Status unavailable: ${error.message}. Reopen to retry.`;
      schedule();
    }
  }
  async function mutate(method) {
    if (pending || (method === 'DELETE' && !busy())) return;
    const current = generation;
    ++statusRequest;
    pending = true; render();
    try {
      const latest = await send(method, method === 'DELETE' ? job.id : null);
      if (current !== generation) return;
      job = latest; render();
    } catch (error) {
      if (current === generation && error.name !== 'AbortError') status.textContent = error.message;
    } finally {
      if (current === generation) { pending = false; start.disabled = busy(); cancel.disabled = job?.phase === 'cancelling'; schedule(); }
    }
  }
  open.addEventListener('click', () => {
    generation++; ++statusRequest; request?.abort(); request = new AbortController(); pending = false;
    modal.hidden = false; render(); close.focus(); refresh();
  });
  function dismiss() {
    generation++; ++statusRequest; request?.abort(); clearTimeout(timer); pending = false;
    modal.hidden = true; open.focus();
  }
  close.addEventListener('click', dismiss);
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key === 'Tab') {
      const controls = [close, cancel, start].filter(control => !control.hidden && !control.disabled);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  start.addEventListener('click', () => mutate('POST'));
  cancel.addEventListener('click', () => mutate('DELETE'));
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden && !modal.hidden) refresh();
  });
})();
