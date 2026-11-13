/* Arrival and navigation motion never gates commands or resource teardown. */
(() => {
  'use strict';
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Map();
  const current = new WeakMap();
  const cancelElement = element => {
    const animation = current.get(element);
    if (!animation) return;
    current.delete(element);
    active.delete(animation);
    animation.cancel();
  };
  const animate = (element, type = 'arrival') => {
    if (preference.matches || !element?.animate) return;
    // Cancel interrupted motion immediately; it has no completion action.
    cancelElement(element);
    const frames = type === 'status'
      ? [{ outline: '2px solid transparent' }, { outline: '2px solid var(--accent)' }, { outline: '2px solid transparent' }]
      : [{ opacity: .65, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }];
    const animation = element.animate(frames, { duration: type === 'status' ? 320 : 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    current.set(element, animation);
    active.set(animation, element);
    animation.finished.catch(() => {}).finally(() => {
      active.delete(animation);
      if (current.get(element) === animation) current.delete(element);
    });
  };
  const cancelAll = () => { for (const element of active.values()) cancelElement(element); };
  const cancelTree = node => {
    if (node?.nodeType !== 1) return;
    cancelElement(node);
    for (const child of node.children || []) cancelTree(child);
  };
  preference.addEventListener('change', () => { if (preference.matches) cancelAll(); });
  document.addEventListener('avto-playback-pause', cancelAll);
  const selector = '#explorer-panel, #feed, #portrait-wall, #lightbox, #slideshow, dialog, .feed-review-card, .discover-result, .pw-media, .playback-stage, #goon-stage-title';
  new MutationObserver(records => {
    if (preference.matches) return;
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.hidden) cancelTree(record.target);
        else if (record.target.matches(selector)) animate(record.target);
      } else {
        for (const node of record.removedNodes || []) cancelTree(node);
        for (const node of record.addedNodes || []) {
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
