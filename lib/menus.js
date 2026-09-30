export const LINK_PATTERNS = [
  '*://*.youtube.com/watch*',
  '*://*.youtube.com/shorts/*',
  '*://*.youtube.com/live/*',
  '*://*.youtube.com/embed/*',
  '*://*.youtube.com/v/*',
  '*://youtu.be/*',
  '*://*.youtube-nocookie.com/embed/*',
];

export const PAGE_PATTERNS = [
  '*://*.youtube.com/watch*',
  '*://*.youtube.com/shorts/*',
  '*://*.youtube.com/live/*',
  '*://*.youtube.com/embed/*',
  '*://*.youtube-nocookie.com/embed/*',
];

// The same menu tree is created once per surface. Firefox only shows the `page`
// context when nothing more specific (like a link) was right-clicked, so the two
// surfaces never appear together.
const SURFACES = {
  link: { contexts: ['link'], targetUrlPatterns: LINK_PATTERNS },
  page: { contexts: ['page', 'video'], documentUrlPatterns: PAGE_PATTERNS },
};

const ACTION_TITLES = {
  play: 'Play on Playlet',
  queue: 'Add to Playlet queue',
};

export function menuPlan(rokus) {
  const items = [];
  for (const [surface, filter] of Object.entries(SURFACES)) {
    if (rokus.length === 0) {
      items.push({ id: `setup|${surface}`, title: 'Playlet: set up a Roku…', ...filter });
      continue;
    }
    for (const [action, title] of Object.entries(ACTION_TITLES)) {
      if (rokus.length === 1) {
        items.push({ id: `${action}|${surface}|${rokus[0].id}`, title, ...filter });
        continue;
      }
      const parentId = `${action}|${surface}`;
      items.push({ id: parentId, title, ...filter });
      for (const roku of rokus) {
        items.push({ id: `${parentId}|${roku.id}`, parentId, title: roku.name, ...filter });
      }
    }
  }
  return items;
}

export function parseMenuId(id) {
  const [action, , rokuId] = String(id).split('|');
  if (action === 'setup') return { action };
  if ((action === 'play' || action === 'queue') && rokuId) return { action, rokuId };
  return null;
}
