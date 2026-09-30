import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuPlan, parseMenuId, LINK_PATTERNS, PAGE_PATTERNS } from '../lib/menus.js';

const LIVING = { id: 'aaaa-1111', name: 'Living room', host: '192.168.1.50' };
const BEDROOM = { id: 'bbbb-2222', name: 'Bedroom', host: '192.168.1.51' };

function surfaceOf(item) {
  return item.targetUrlPatterns ? 'link' : 'page';
}

test('no Rokus: one setup item per surface', () => {
  const plan = menuPlan([]);
  assert.deepEqual(
    plan.map((item) => [item.id, item.title]),
    [
      ['setup|link', 'Playlet: set up a Roku…'],
      ['setup|page', 'Playlet: set up a Roku…'],
    ],
  );
  assert.deepEqual(parseMenuId('setup|link'), { action: 'setup' });
});

test('one Roku: flat play and queue items per surface', () => {
  const plan = menuPlan([LIVING]);
  assert.deepEqual(
    plan.map((item) => [item.id, item.title, item.parentId]),
    [
      ['play|link|aaaa-1111', 'Play on Playlet', undefined],
      ['queue|link|aaaa-1111', 'Add to Playlet queue', undefined],
      ['play|page|aaaa-1111', 'Play on Playlet', undefined],
      ['queue|page|aaaa-1111', 'Add to Playlet queue', undefined],
    ],
  );
});

test('several Rokus: parents with one child per Roku', () => {
  const plan = menuPlan([LIVING, BEDROOM]);
  const linkItems = plan.filter((item) => surfaceOf(item) === 'link');
  assert.deepEqual(
    linkItems.map((item) => [item.id, item.title, item.parentId]),
    [
      ['play|link', 'Play on Playlet', undefined],
      ['play|link|aaaa-1111', 'Living room', 'play|link'],
      ['play|link|bbbb-2222', 'Bedroom', 'play|link'],
      ['queue|link', 'Add to Playlet queue', undefined],
      ['queue|link|aaaa-1111', 'Living room', 'queue|link'],
      ['queue|link|bbbb-2222', 'Bedroom', 'queue|link'],
    ],
  );
  assert.equal(plan.length, 12);
  assert.equal(parseMenuId('play|link'), null);
});

test('every item carries its surface filter, including children', () => {
  for (const item of menuPlan([LIVING, BEDROOM])) {
    if (surfaceOf(item) === 'link') {
      assert.deepEqual(item.contexts, ['link']);
      assert.deepEqual(item.targetUrlPatterns, LINK_PATTERNS);
      assert.equal(item.documentUrlPatterns, undefined);
    } else {
      assert.deepEqual(item.contexts, ['page', 'frame', 'video']);
      assert.deepEqual(item.documentUrlPatterns, PAGE_PATTERNS);
    }
  }
});

test('menu IDs use the Roku id, so odd or duplicate names are safe', () => {
  const odd = { id: 'cccc-3333', name: 'TV | Den', host: '10.0.0.2' };
  const dupe = { id: 'dddd-4444', name: 'TV | Den', host: '10.0.0.3' };
  const plan = menuPlan([odd, dupe]);
  const ids = plan.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(parseMenuId('queue|page|dddd-4444'), { action: 'queue', rokuId: 'dddd-4444' });
});

test('parseMenuId rejects unknown IDs', () => {
  assert.equal(parseMenuId('bogus|link|x'), null);
  assert.equal(parseMenuId(''), null);
  assert.equal(parseMenuId(42), null);
});
