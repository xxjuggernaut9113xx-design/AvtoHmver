/* Arrival and navigation motion never gates commands or resource teardown. */
(() => {
  'use strict';
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set();
  const animate = (element, type = 'arrival') => {
    if (preference.matches || !element?.animate) return;
    // Cancel interrupted motion immediately; it has no completion action.
    element.getAnimations().forEach(animation => animation.cancel());
    const frames = type === 'status'
      ? [{ outline: '2px solid transparent' }, { outline: '2px solid var(--accent)' }, { outline: '2px solid transparent' }]
      : [{ opacity: .65, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }];
    const animation = element.animate(frames, { duration: type === 'status' ? 320 : 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    active.add(animation); animation.finished.catch(() => {}).finally(() => active.delete(animation));
  };
  const cancel = () => { for (const animation of active) animation.cancel(); active.clear(); };
  preference.addEventListener('change', () => { if (preference.matches) cancel(); });
  document.addEventListener('avto-playback-pause', cancel);
  const selector = '#explorer-panel, #feed, #portrait-wall, #lightbox, #slideshow, dialog, .feed-review-card, .discover-result, .pw-media, .playback-stage, #goon-stage-title';
  new MutationObserver(records => {
    if (preference.matches) return;
    for (const record of records) {
      if (record.type === 'attributes') {
        if (!record.target.hidden && record.target.matches(selector)) animate(record.target);
      } else {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches(selector)) animate(node);
        }
        if (record.target.matches?.('#explorer-panel, #goon-stage-title')) animate(record.target);
        // Status changes stay fully opaque, including error text.
        if (record.target.matches?.('[role="status"], #discover-status')) animate(record.target, 'status');
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] });
})();
