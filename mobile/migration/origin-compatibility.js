(async () => {
  const migration = globalThis.Capacitor?.Plugins?.OriginMigration;
  if (!migration) return;
  const state = await migration.status();
  if (state.phase !== 'compatibility') return;
  const notice = document.createElement('section');
  notice.setAttribute('role', 'status');
  const title = document.createElement('strong');
  title.textContent = 'Viewer+ compatibility mode';
  const detail = document.createElement('p');
  detail.textContent = (state.reason || 'The saved-data migration is pending.')
    + ' Your previous profile, files and snapshots are available here.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry migration';
  retry.onclick = async () => {
    retry.disabled = true;
    try { await migration.retry(); }
    catch (error) { detail.textContent = error.message; retry.disabled = false; }
  };
  notice.append(title, detail, retry);
  document.body.prepend(notice);
})().catch(console.error);
