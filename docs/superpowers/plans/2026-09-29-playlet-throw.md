# Playlet Throw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Firefox extension that adds "Play on Playlet" / "Add to Playlet queue" to the right-click menu for YouTube videos and sends them to the Playlet app on one of several configured Rokus.

**Architecture:** Manifest V3 Firefox extension in plain ES-module JavaScript with no build step. Pure logic (URL parsing, Roku HTTP calls with fallback, menu layout, message text, host validation) lives in `lib/` and is unit-tested with `node --test`. `background.js` wires those into Firefox's `menus`/`notifications` APIs, a content script reads the YouTube player's current time, and an options page manages the Roku list.

**Tech Stack:** Firefox WebExtensions (MV3), vanilla JS (ES modules), Node 20+ built-in test runner (`node:test`, `node:assert/strict`), `web-ext` (via `npx`) for linting.

**Spec:** `docs/superpowers/specs/2026-09-29-playlet-throw-design.md`

## Global Constraints

- Playlet channel ID: `693751`.
- Playlet web server: port `8888`; endpoints `POST /api/queue/play` and `POST /api/queue`, JSON body `{"videoId": "...", "timestamp": N}` (timestamp optional, integer seconds).
- Roku ECP: port `8060`; `POST /launch/693751?contentId=<id>[&timestamp=N]`; `GET /query/apps`.
- Timeouts: 3000 ms for port 8888, 5000 ms for port 8060.
- Fallback rule: 8888 network error/timeout → 8060 launch. 8888 HTTP non-2xx → report, **no** fallback.
- Timestamp is sent only when it is an integer > 0.
- No runtime dependencies, no build step. Only dev tooling is `npx web-ext`.
- Roku list lives in `browser.storage.sync` under key `rokus` as `[{ id, name, host }]`; `host` has no scheme, port, or path.
- Menu titles: "Play on Playlet", "Add to Playlet queue", "Playlet: set up a Roku…".
- Roku OS hint text (used verbatim in errors): "Check the IP, and that Settings → System → Advanced system settings → Control by mobile apps is enabled."

## Review Focus

1. Host typed as `http://192.168.1.50/` or with surrounding spaces → saved as `192.168.1.50`; `192.168.1.50:8060` → rejected with "Enter the IP address without a port (e.g. 192.168.1.50)." (Task 4 tests)
2. Lookalike hosts such as `https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ` or `https://notyoutube.com/watch?v=…` → not treated as YouTube. (Task 1 tests)
3. Shared links carrying a start time (`youtu.be/ID?t=90`, `&t=1m30s`) → video starts at 90 s on the TV. (Task 1 tests)
4. Roku names containing `|` or duplicated names → menus still map to the right Roku (IDs use the UUID, not the name). (Task 3 tests)
5. Missing or corrupted `rokus` storage value (first install, non-array, entries missing fields) → treated as an empty/filtered list, never a crash. (Task 4 tests)

---

### Task 1: Project scaffold + YouTube URL parsing

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `lib/youtube.js`
- Test: `test/youtube.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `extractVideoId(url: string) → string | null`
  - `extractStartTime(url: string) → number | null` (whole seconds > 0)
  - `resolveClick(info: { linkUrl?, frameUrl?, pageUrl? }) → { videoId: string, fromLink: boolean, startTime: number | null } | null`

- [ ] **Step 1: Create `package.json` and `.gitignore`**

`package.json`:
```json
{
  "name": "playlet-throw",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "lint": "npx --yes web-ext lint --ignore-files \"docs/**\" \"test/**\" package.json README.md"
  }
}
```

`.gitignore`:
```
node_modules/
web-ext-artifacts/
.DS_Store
```

- [ ] **Step 2: Write the failing tests**

`test/youtube.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoId, extractStartTime, resolveClick } from '../lib/youtube.js';

const ID = 'dQw4w9WgXcQ';

test('extractVideoId accepts all supported URL forms', () => {
  const accepted = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?feature=share&v=${ID}&t=42s`,
    `https://www.youtube.com/watch?v=${ID}&list=PL1234567890`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=90`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}?autoplay=1`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/v/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ];
  for (const url of accepted) {
    assert.equal(extractVideoId(url), ID, url);
  }
});

test('extractVideoId rejects non-video and non-YouTube URLs', () => {
  const rejected = [
    '',
    'not a url',
    `blob:https://www.youtube.com/5f1c1f0e-0000-0000-0000-000000000000`,
    `https://vimeo.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/watch?v=${ID}x`,
    `https://www.youtube.com/watch`,
    `https://www.youtube.com/playlist?list=PL1234567890`,
    `https://www.youtube.com/@somechannel`,
    `https://www.youtube.com/`,
    `ftp://www.youtube.com/watch?v=${ID}`,
  ];
  for (const url of rejected) {
    assert.equal(extractVideoId(url), null, url);
  }
});

test('extractStartTime parses t= and start= formats', () => {
  assert.equal(extractStartTime(`https://youtu.be/${ID}?t=90`), 90);
  assert.equal(extractStartTime(`https://youtu.be/${ID}?t=90s`), 90);
  assert.equal(extractStartTime(`https://www.youtube.com/watch?v=${ID}&t=1m30s`), 90);
  assert.equal(extractStartTime(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`), 3723);
  assert.equal(extractStartTime(`https://www.youtube.com/watch?v=${ID}&t=2m`), 120);
  assert.equal(extractStartTime(`https://www.youtube.com/embed/${ID}?start=45`), 45);
});

test('extractStartTime returns null when absent, zero, or malformed', () => {
  assert.equal(extractStartTime(`https://youtu.be/${ID}`), null);
  assert.equal(extractStartTime(`https://youtu.be/${ID}?t=0`), null);
  assert.equal(extractStartTime(`https://youtu.be/${ID}?t=abc`), null);
  assert.equal(extractStartTime(`https://youtu.be/${ID}?t=`), null);
  assert.equal(extractStartTime('not a url'), null);
});

test('resolveClick prefers linkUrl, then frameUrl, then pageUrl', () => {
  const OTHER = 'aaaaaaaaaaa';
  assert.deepEqual(
    resolveClick({
      linkUrl: `https://youtu.be/${ID}?t=90`,
      pageUrl: `https://www.youtube.com/watch?v=${OTHER}`,
    }),
    { videoId: ID, fromLink: true, startTime: 90 },
  );
  assert.deepEqual(
    resolveClick({
      frameUrl: `https://www.youtube-nocookie.com/embed/${ID}`,
      pageUrl: 'https://news.example/article',
    }),
    { videoId: ID, fromLink: false, startTime: null },
  );
  assert.deepEqual(
    resolveClick({ pageUrl: `https://www.youtube.com/watch?v=${ID}&t=5` }),
    { videoId: ID, fromLink: false, startTime: 5 },
  );
});

test('resolveClick skips a non-YouTube link and falls through', () => {
  assert.deepEqual(
    resolveClick({
      linkUrl: 'https://example.com/',
      pageUrl: `https://www.youtube.com/watch?v=${ID}`,
    }),
    { videoId: ID, fromLink: false, startTime: null },
  );
});

test('resolveClick returns null when nothing matches', () => {
  assert.equal(resolveClick({ pageUrl: 'https://example.com/' }), null);
  assert.equal(resolveClick({}), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/youtube.js'`.

- [ ] **Step 4: Implement `lib/youtube.js`**

```js
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_DOMAINS = ['youtube.com', 'youtube-nocookie.com'];
const ID_PATH_PREFIXES = ['shorts', 'embed', 'live', 'v'];

function parseUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function isYouTubeHost(hostname) {
  return YOUTUBE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function extractVideoId(url) {
  const parsed = parseUrl(url);
  if (!parsed) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  let id = null;
  if (parsed.hostname === 'youtu.be') {
    id = segments[0];
  } else if (isYouTubeHost(parsed.hostname)) {
    if (segments[0] === 'watch') id = parsed.searchParams.get('v');
    else if (ID_PATH_PREFIXES.includes(segments[0])) id = segments[1];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export function extractStartTime(url) {
  const parsed = parseUrl(url);
  if (!parsed) return null;

  const raw = parsed.searchParams.get('t') ?? parsed.searchParams.get('start');
  if (!raw) return null;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
  if (!match || match.slice(1).every((part) => part === undefined)) return null;

  const [hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

export function resolveClick(info) {
  const candidates = [
    [info.linkUrl, true],
    [info.frameUrl, false],
    [info.pageUrl, false],
  ];
  for (const [url, fromLink] of candidates) {
    if (!url) continue;
    const videoId = extractVideoId(url);
    if (videoId) return { videoId, fromLink, startTime: extractStartTime(url) };
  }
  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 7 tests in `test/youtube.test.js`.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore lib/youtube.js test/youtube.test.js
git commit -m "Add YouTube URL parsing with start-time support"
```

---

### Task 2: Roku / Playlet client with fallback

**Files:**
- Create: `lib/roku.js`
- Test: `test/roku.test.js`

**Interfaces:**
- Consumes: nothing (a `fetch`-compatible function is injected).
- Produces:
  - `PLAYLET_CHANNEL_ID = '693751'`
  - `DEFAULT_TIMEOUTS = { playlet: 3000, ecp: 5000 }`
  - `play(target, fetchFn, options?) → Promise<Result>`
  - `queue(target, fetchFn, options?) → Promise<Result>`
    - `target: { host: string, videoId: string, timestamp?: number | null }`
    - `options: { timeouts?: { playlet: number, ecp: number } }`
    - `Result: { ok: true, via: 'playlet' | 'launch' } | { ok: false, reason: 'rejected' | 'launch-failed' | 'unreachable', status?: number }`
  - `testRoku(host, fetchFn, options?) → Promise<'ok' | 'no-playlet' | 'blocked' | 'unreachable'>`

- [ ] **Step 1: Write the failing tests**

`test/roku.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { play, queue, testRoku } from '../lib/roku.js';

const HOST = '192.168.1.50';
const ID = 'dQw4w9WgXcQ';
const FAST = { timeouts: { playlet: 20, ecp: 20 } };

// Routes: array of [urlPrefix, handler(url, init)]. Unmatched URLs throw a network error.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    for (const [prefix, handler] of routes) {
      if (url.startsWith(prefix)) return handler(url, init);
    }
    throw new TypeError('NetworkError when attempting to fetch resource.');
  };
  fn.calls = calls;
  return fn;
}
const respond = (status, text = '') => () => ({ ok: status >= 200 && status < 300, status, text: async () => text });
const hang = (url, init) =>
  new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));

const PLAYLET = `http://${HOST}:8888`;
const ECP = `http://${HOST}:8060`;

test('play posts to /api/queue/play when Playlet is running', async () => {
  const fetchFn = fakeFetch([[`${PLAYLET}/api/queue/play`, respond(204)]]);
  const result = await play({ host: HOST, videoId: ID, timestamp: 125 }, fetchFn, FAST);

  assert.deepEqual(result, { ok: true, via: 'playlet' });
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(fetchFn.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(fetchFn.calls[0].init.body), { videoId: ID, timestamp: 125 });
});

test('queue posts to /api/queue when Playlet is running', async () => {
  const fetchFn = fakeFetch([[`${PLAYLET}/api/queue`, respond(204)]]);
  const result = await queue({ host: HOST, videoId: ID }, fetchFn, FAST);

  assert.deepEqual(result, { ok: true, via: 'playlet' });
  assert.equal(fetchFn.calls[0].url, `${PLAYLET}/api/queue`);
  assert.deepEqual(JSON.parse(fetchFn.calls[0].init.body), { videoId: ID });
});

test('play falls back to ECP launch when Playlet is unreachable', async () => {
  const fetchFn = fakeFetch([[`${ECP}/launch/`, respond(200)]]);
  const result = await play({ host: HOST, videoId: ID, timestamp: 125 }, fetchFn, FAST);

  assert.deepEqual(result, { ok: true, via: 'launch' });
  assert.equal(fetchFn.calls.length, 2);
  assert.equal(fetchFn.calls[1].url, `${ECP}/launch/693751?contentId=${ID}&timestamp=125`);
  assert.equal(fetchFn.calls[1].init.method, 'POST');
});

test('play falls back to ECP launch when Playlet times out', async () => {
  const fetchFn = fakeFetch([
    [`${PLAYLET}/`, hang],
    [`${ECP}/launch/`, respond(200)],
  ]);
  const result = await play({ host: HOST, videoId: ID }, fetchFn, FAST);

  assert.deepEqual(result, { ok: true, via: 'launch' });
  assert.equal(fetchFn.calls[1].url, `${ECP}/launch/693751?contentId=${ID}`);
});

test('queue falls back to ECP launch and reports via launch', async () => {
  const fetchFn = fakeFetch([[`${ECP}/launch/`, respond(200)]]);
  const result = await queue({ host: HOST, videoId: ID }, fetchFn, FAST);

  assert.deepEqual(result, { ok: true, via: 'launch' });
});

test('Playlet HTTP error is reported without fallback', async () => {
  const fetchFn = fakeFetch([[`${PLAYLET}/`, respond(500)]]);
  const result = await play({ host: HOST, videoId: ID }, fetchFn, FAST);

  assert.deepEqual(result, { ok: false, reason: 'rejected', status: 500 });
  assert.equal(fetchFn.calls.length, 1);
});

test('both endpoints unreachable reports unreachable', async () => {
  const fetchFn = fakeFetch([]);
  const result = await play({ host: HOST, videoId: ID }, fetchFn, FAST);

  assert.deepEqual(result, { ok: false, reason: 'unreachable' });
  assert.equal(fetchFn.calls.length, 2);
});

test('ECP timing out reports unreachable', async () => {
  const fetchFn = fakeFetch([[`${ECP}/`, hang]]);
  const result = await play({ host: HOST, videoId: ID }, fetchFn, FAST);

  assert.deepEqual(result, { ok: false, reason: 'unreachable' });
});

test('ECP HTTP error reports launch-failed', async () => {
  const fetchFn = fakeFetch([[`${ECP}/launch/`, respond(403)]]);
  const result = await play({ host: HOST, videoId: ID }, fetchFn, FAST);

  assert.deepEqual(result, { ok: false, reason: 'launch-failed', status: 403 });
});

test('invalid timestamps are omitted', async () => {
  for (const timestamp of [null, undefined, 0, -5, 1.5, NaN]) {
    const fetchFn = fakeFetch([[`${ECP}/launch/`, respond(200)]]);
    await play({ host: HOST, videoId: ID, timestamp }, fetchFn, FAST);
    assert.equal(fetchFn.calls[0].init.body, JSON.stringify({ videoId: ID }), String(timestamp));
    assert.equal(fetchFn.calls[1].url, `${ECP}/launch/693751?contentId=${ID}`, String(timestamp));
  }
});

test('testRoku reports ok when Playlet is installed', async () => {
  const apps = '<apps><app id="12" type="appl">Netflix</app><app id="693751" type="appl">Playlet</app></apps>';
  const fetchFn = fakeFetch([[`${ECP}/query/apps`, respond(200, apps)]]);
  assert.equal(await testRoku(HOST, fetchFn, FAST), 'ok');
});

test('testRoku reports no-playlet when Playlet is missing', async () => {
  const fetchFn = fakeFetch([[`${ECP}/query/apps`, respond(200, '<apps><app id="12">Netflix</app></apps>')]]);
  assert.equal(await testRoku(HOST, fetchFn, FAST), 'no-playlet');
});

test('testRoku reports blocked on HTTP error', async () => {
  const fetchFn = fakeFetch([[`${ECP}/query/apps`, respond(403)]]);
  assert.equal(await testRoku(HOST, fetchFn, FAST), 'blocked');
});

test('testRoku reports unreachable on network error', async () => {
  assert.equal(await testRoku(HOST, fakeFetch([]), FAST), 'unreachable');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/roku.js'`.

- [ ] **Step 3: Implement `lib/roku.js`**

```js
export const PLAYLET_CHANNEL_ID = '693751';
export const DEFAULT_TIMEOUTS = { playlet: 3000, ecp: 5000 };

async function fetchWithTimeout(fetchFn, url, init, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isValidTimestamp(timestamp) {
  return Number.isInteger(timestamp) && timestamp > 0;
}

async function launch({ host, videoId, timestamp }, fetchFn, timeouts) {
  const params = new URLSearchParams({ contentId: videoId });
  if (isValidTimestamp(timestamp)) params.set('timestamp', String(timestamp));

  let response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      `http://${host}:8060/launch/${PLAYLET_CHANNEL_ID}?${params}`,
      { method: 'POST' },
      timeouts.ecp,
    );
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (response.ok) return { ok: true, via: 'launch' };
  return { ok: false, reason: 'launch-failed', status: response.status };
}

async function sendToPlaylet(path, target, fetchFn, timeouts) {
  const body = { videoId: target.videoId };
  if (isValidTimestamp(target.timestamp)) body.timestamp = target.timestamp;

  let response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      `http://${target.host}:8888${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      timeouts.playlet,
    );
  } catch {
    // Playlet isn't running (or the Roku is slow to answer): launch it with the video instead.
    return launch(target, fetchFn, timeouts);
  }
  if (response.ok) return { ok: true, via: 'playlet' };
  return { ok: false, reason: 'rejected', status: response.status };
}

export function play(target, fetchFn, { timeouts = DEFAULT_TIMEOUTS } = {}) {
  return sendToPlaylet('/api/queue/play', target, fetchFn, timeouts);
}

export function queue(target, fetchFn, { timeouts = DEFAULT_TIMEOUTS } = {}) {
  return sendToPlaylet('/api/queue', target, fetchFn, timeouts);
}

export async function testRoku(host, fetchFn, { timeouts = DEFAULT_TIMEOUTS } = {}) {
  let response;
  try {
    response = await fetchWithTimeout(fetchFn, `http://${host}:8060/query/apps`, {}, timeouts.ecp);
  } catch {
    return 'unreachable';
  }
  if (!response.ok) return 'blocked';
  const apps = await response.text();
  return apps.includes(`id="${PLAYLET_CHANNEL_ID}"`) ? 'ok' : 'no-playlet';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `test/youtube.test.js` and `test/roku.test.js`.

- [ ] **Step 5: Commit**

```bash
git add lib/roku.js test/roku.test.js
git commit -m "Add Roku/Playlet client with ECP launch fallback"
```

---

### Task 3: Menu layout and message text

**Files:**
- Create: `lib/menus.js`
- Create: `lib/messages.js`
- Test: `test/menus.test.js`
- Test: `test/messages.test.js`

**Interfaces:**
- Consumes: `Result` shape from Task 2; `testRoku` states from Task 2.
- Produces:
  - `LINK_PATTERNS: string[]`, `PAGE_PATTERNS: string[]`
  - `menuPlan(rokus: {id, name, host}[]) → MenuItem[]` where `MenuItem = { id: string, title: string, contexts: string[], parentId?: string, targetUrlPatterns?: string[], documentUrlPatterns?: string[] }` — each item is passed straight to `browser.menus.create`.
  - `parseMenuId(id: string | number) → { action: 'setup' } | { action: 'play' | 'queue', rokuId: string } | null`
  - `CONTROL_HINT: string`
  - `resultMessage(action: 'play' | 'queue', roku: {name, host}, result: Result) → string`
  - `testLabel(state: 'ok' | 'no-playlet' | 'blocked' | 'unreachable') → string`

- [ ] **Step 1: Write the failing tests**

`test/menus.test.js`:
```js
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
      assert.deepEqual(item.contexts, ['page', 'video']);
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
```

`test/messages.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultMessage, testLabel, CONTROL_HINT } from '../lib/messages.js';

const ROKU = { name: 'Living room', host: '192.168.1.50' };

test('success messages', () => {
  assert.equal(resultMessage('play', ROKU, { ok: true, via: 'playlet' }), '▶ Playing on Living room');
  assert.equal(resultMessage('play', ROKU, { ok: true, via: 'launch' }), '▶ Playing on Living room');
  assert.equal(resultMessage('queue', ROKU, { ok: true, via: 'playlet' }), '➕ Queued on Living room');
  assert.equal(
    resultMessage('queue', ROKU, { ok: true, via: 'launch' }),
    "▶ Playlet wasn't open — playing on Living room",
  );
});

test('failure messages', () => {
  assert.equal(
    resultMessage('play', ROKU, { ok: false, reason: 'unreachable' }),
    `Couldn't reach Living room (192.168.1.50). ${CONTROL_HINT}`,
  );
  assert.equal(
    resultMessage('play', ROKU, { ok: false, reason: 'rejected', status: 500 }),
    'Playlet on Living room rejected the request (HTTP 500).',
  );
  assert.equal(
    resultMessage('queue', ROKU, { ok: false, reason: 'launch-failed', status: 403 }),
    `Living room refused to launch Playlet (HTTP 403). Is Playlet installed? ${CONTROL_HINT}`,
  );
});

test('CONTROL_HINT matches the Roku menu path', () => {
  assert.equal(
    CONTROL_HINT,
    'Check the IP, and that Settings → System → Advanced system settings → Control by mobile apps is enabled.',
  );
});

test('test button labels', () => {
  assert.equal(testLabel('ok'), 'Reachable — Playlet installed');
  assert.equal(testLabel('no-playlet'), 'Reachable — Playlet not found');
  assert.equal(testLabel('blocked'), 'Reachable, but Control by mobile apps is restricted');
  assert.equal(testLabel('unreachable'), 'Unreachable');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/menus.js'` and `'.../lib/messages.js'`.

- [ ] **Step 3: Implement `lib/menus.js`**

```js
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
```

- [ ] **Step 4: Implement `lib/messages.js`**

```js
export const CONTROL_HINT =
  'Check the IP, and that Settings → System → Advanced system settings → Control by mobile apps is enabled.';

export function resultMessage(action, roku, result) {
  if (result.ok) {
    if (action === 'queue' && result.via === 'launch') {
      return `▶ Playlet wasn't open — playing on ${roku.name}`;
    }
    return action === 'queue' ? `➕ Queued on ${roku.name}` : `▶ Playing on ${roku.name}`;
  }
  switch (result.reason) {
    case 'rejected':
      return `Playlet on ${roku.name} rejected the request (HTTP ${result.status}).`;
    case 'launch-failed':
      return `${roku.name} refused to launch Playlet (HTTP ${result.status}). Is Playlet installed? ${CONTROL_HINT}`;
    default:
      return `Couldn't reach ${roku.name} (${roku.host}). ${CONTROL_HINT}`;
  }
}

const TEST_LABELS = {
  ok: 'Reachable — Playlet installed',
  'no-playlet': 'Reachable — Playlet not found',
  blocked: 'Reachable, but Control by mobile apps is restricted',
  unreachable: 'Unreachable',
};

export function testLabel(state) {
  return TEST_LABELS[state] ?? 'Unreachable';
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in the four test files.

- [ ] **Step 6: Commit**

```bash
git add lib/menus.js lib/messages.js test/menus.test.js test/messages.test.js
git commit -m "Add context-menu layout and notification text"
```

---

### Task 4: Roku storage + options page

**Files:**
- Create: `lib/storage.js`
- Create: `options/options.html`
- Create: `options/options.js`
- Test: `test/storage.test.js`

**Interfaces:**
- Consumes: `testRoku(host, fetchFn)` from Task 2; `testLabel(state)` from Task 3.
- Produces:
  - `normalizeHost(input: string) → { host: string } | { error: string }`
  - `validateRoku({ name, host }) → { ok: true, value: { name, host } } | { ok: false, error: string }`
  - `getRokus(area = browser.storage.sync) → Promise<{id, name, host}[]>`
  - `saveRokus(list, area = browser.storage.sync) → Promise<void>`
  - `YOUTUBE_ORIGINS: string[]` (the YouTube host permissions)

- [ ] **Step 1: Write the failing tests**

`test/storage.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHost, validateRoku, getRokus, saveRokus } from '../lib/storage.js';

function fakeArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(key) {
      return key in data ? { [key]: data[key] } : {};
    },
    async set(values) {
      Object.assign(data, values);
    },
  };
}

test('normalizeHost strips scheme, slashes, whitespace, and case', () => {
  assert.deepEqual(normalizeHost('192.168.1.50'), { host: '192.168.1.50' });
  assert.deepEqual(normalizeHost('  http://192.168.1.50/  '), { host: '192.168.1.50' });
  assert.deepEqual(normalizeHost('HTTPS://Roku-Living.lan'), { host: 'roku-living.lan' });
});

test('normalizeHost rejects empty, port, and path input', () => {
  assert.deepEqual(normalizeHost('   '), { error: "Enter the Roku's IP address." });
  assert.deepEqual(normalizeHost(undefined), { error: "Enter the Roku's IP address." });
  assert.deepEqual(normalizeHost('192.168.1.50:8060'), {
    error: 'Enter the IP address without a port (e.g. 192.168.1.50).',
  });
  assert.deepEqual(normalizeHost('192.168.1.50/query'), {
    error: 'Enter just the IP address or hostname, with no path.',
  });
  assert.deepEqual(normalizeHost('192.168 .1.50'), {
    error: 'Enter just the IP address or hostname, with no path.',
  });
});

test('validateRoku trims the name and normalizes the host', () => {
  assert.deepEqual(validateRoku({ name: '  Living room ', host: 'http://192.168.1.50/' }), {
    ok: true,
    value: { name: 'Living room', host: '192.168.1.50' },
  });
});

test('validateRoku rejects a blank name or bad host', () => {
  assert.deepEqual(validateRoku({ name: ' ', host: '192.168.1.50' }), {
    ok: false,
    error: 'Enter a name for this Roku.',
  });
  assert.deepEqual(validateRoku({ name: 'TV', host: '192.168.1.50:8060' }), {
    ok: false,
    error: 'Enter the IP address without a port (e.g. 192.168.1.50).',
  });
});

test('getRokus returns [] when nothing is stored', async () => {
  assert.deepEqual(await getRokus(fakeArea()), []);
});

test('getRokus ignores corrupted values', async () => {
  assert.deepEqual(await getRokus(fakeArea({ rokus: 'oops' })), []);
  const good = { id: 'a', name: 'TV', host: '10.0.0.2' };
  assert.deepEqual(
    await getRokus(fakeArea({ rokus: [good, null, { id: 'b', name: 'No host' }, 7] })),
    [good],
  );
});

test('saveRokus round-trips through getRokus', async () => {
  const area = fakeArea();
  const list = [{ id: 'a', name: 'TV', host: '10.0.0.2' }];
  await saveRokus(list, area);
  assert.deepEqual(await getRokus(area), list);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../lib/storage.js'`.

- [ ] **Step 3: Implement `lib/storage.js`**

```js
export const YOUTUBE_ORIGINS = ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'];

export function normalizeHost(input) {
  const host = String(input ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!host) return { error: "Enter the Roku's IP address." };
  if (host.includes(':')) return { error: 'Enter the IP address without a port (e.g. 192.168.1.50).' };
  if (/[/\s?#@]/.test(host)) return { error: 'Enter just the IP address or hostname, with no path.' };
  return { host: host.toLowerCase() };
}

export function validateRoku({ name, host }) {
  const trimmedName = String(name ?? '').trim();
  if (!trimmedName) return { ok: false, error: 'Enter a name for this Roku.' };
  const normalized = normalizeHost(host);
  if (normalized.error) return { ok: false, error: normalized.error };
  return { ok: true, value: { name: trimmedName, host: normalized.host } };
}

function isRoku(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.host === 'string'
  );
}

export async function getRokus(area = browser.storage.sync) {
  const { rokus } = await area.get('rokus');
  return Array.isArray(rokus) ? rokus.filter(isRoku) : [];
}

export async function saveRokus(list, area = browser.storage.sync) {
  await area.set({ rokus: list });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in the five test files.

- [ ] **Step 5: Create `options/options.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Playlet Throw — Rokus</title>
  <style>
    :root { color-scheme: light dark; --muted: #666; --error: #b00020; --border: #ccc; }
    @media (prefers-color-scheme: dark) { :root { --muted: #aaa; --error: #ff6b81; --border: #444; } }
    body { font: 15px/1.5 system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.4rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
    th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid var(--border); }
    td.status { color: var(--muted); font-size: .9em; }
    td.actions { white-space: nowrap; }
    td.actions button { margin-left: .25rem; }
    form { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1rem; align-items: center; }
    form .buttons { grid-column: 2; }
    .error { color: var(--error); grid-column: 1 / -1; min-height: 1.5em; }
    .notice { border: 1px solid var(--border); border-radius: 6px; padding: .75rem 1rem; margin-bottom: 1.5rem; }
    .hint { color: var(--muted); font-size: .9em; }
  </style>
</head>
<body>
  <h1>Playlet Throw — Rokus</h1>

  <div id="youtube-notice" class="notice" hidden>
    Playlet Throw needs access to YouTube pages to resume videos at the position you're watching.
    <button id="youtube-grant" type="button">Grant access</button>
  </div>

  <table>
    <thead><tr><th>Name</th><th>IP address</th><th>Status</th><th></th></tr></thead>
    <tbody id="roku-list"></tbody>
  </table>
  <p id="empty" class="hint">No Rokus yet. Add one below.</p>

  <h2 id="form-title">Add a Roku</h2>
  <form id="roku-form" novalidate>
    <input id="roku-id" type="hidden">
    <label for="roku-name">Name</label>
    <input id="roku-name" placeholder="Living room" autocomplete="off">
    <label for="roku-host">IP address</label>
    <input id="roku-host" placeholder="192.168.1.50" autocomplete="off">
    <p id="form-error" class="error" role="alert"></p>
    <div class="buttons">
      <button type="submit">Save</button>
      <button id="cancel-edit" type="button" hidden>Cancel</button>
    </div>
  </form>

  <p class="hint">
    Find the IP on the Roku under Settings → Network → About. Give it a DHCP reservation on your
    router so it doesn't change. If Test says the Roku is unreachable or restricted, set
    Settings → System → Advanced system settings → Control by mobile apps to Enabled.
  </p>

  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 6: Create `options/options.js`**

```js
import { getRokus, saveRokus, validateRoku, YOUTUBE_ORIGINS } from '../lib/storage.js';
import { testRoku } from '../lib/roku.js';
import { testLabel } from '../lib/messages.js';

const list = document.getElementById('roku-list');
const empty = document.getElementById('empty');
const form = document.getElementById('roku-form');
const formTitle = document.getElementById('form-title');
const idInput = document.getElementById('roku-id');
const nameInput = document.getElementById('roku-name');
const hostInput = document.getElementById('roku-host');
const formError = document.getElementById('form-error');
const cancelEdit = document.getElementById('cancel-edit');
const youtubeNotice = document.getElementById('youtube-notice');
const youtubeGrant = document.getElementById('youtube-grant');

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function button(label, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function rowFor(roku) {
  const status = cell('', 'status');
  const actions = cell('', 'actions');
  actions.append(
    button('Test', async () => {
      status.textContent = 'Testing…';
      status.textContent = testLabel(await testRoku(roku.host, (...args) => fetch(...args)));
    }),
    button('Edit', () => {
      idInput.value = roku.id;
      nameInput.value = roku.name;
      hostInput.value = roku.host;
      formTitle.textContent = `Edit ${roku.name}`;
      cancelEdit.hidden = false;
      nameInput.focus();
    }),
    button('Remove', async () => {
      await saveRokus((await getRokus()).filter((r) => r.id !== roku.id));
      if (idInput.value === roku.id) resetForm();
      await render();
    }),
  );
  const tr = document.createElement('tr');
  tr.append(cell(roku.name), cell(roku.host), status, actions);
  return tr;
}

async function render() {
  const rokus = await getRokus();
  list.replaceChildren(...rokus.map(rowFor));
  empty.hidden = rokus.length > 0;
}

function resetForm() {
  form.reset();
  idInput.value = '';
  formTitle.textContent = 'Add a Roku';
  formError.textContent = '';
  cancelEdit.hidden = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';
  const result = validateRoku({ name: nameInput.value, host: hostInput.value });
  if (!result.ok) {
    formError.textContent = result.error;
    return;
  }
  // permissions.request must be the first await so it still counts as a user action.
  const granted = await browser.permissions.request({ origins: [`http://${result.value.host}/*`] });
  if (!granted) {
    formError.textContent = 'Firefox needs permission to talk to this Roku. Click Save again and choose Allow.';
    return;
  }
  const rokus = await getRokus();
  const editingId = idInput.value;
  const next = editingId
    ? rokus.map((r) => (r.id === editingId ? { ...r, ...result.value } : r))
    : [...rokus, { id: crypto.randomUUID(), ...result.value }];
  await saveRokus(next);
  resetForm();
  await render();
});

cancelEdit.addEventListener('click', resetForm);

async function refreshYouTubeNotice() {
  youtubeNotice.hidden = await browser.permissions.contains({ origins: YOUTUBE_ORIGINS });
}

youtubeGrant.addEventListener('click', async () => {
  await browser.permissions.request({ origins: YOUTUBE_ORIGINS });
  await refreshYouTubeNotice();
});

render();
refreshYouTubeNotice();
```

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS. (The options page itself is verified manually in Task 6.)

- [ ] **Step 8: Commit**

```bash
git add lib/storage.js test/storage.test.js options/
git commit -m "Add Roku storage, validation, and options page"
```

---

### Task 5: Manifest, content script, and background wiring

**Files:**
- Create: `manifest.json`
- Create: `content/timestamp.js`
- Create: `background.js`

**Interfaces:**
- Consumes: `resolveClick` (Task 1); `play`, `queue` (Task 2); `menuPlan`, `parseMenuId` (Task 3); `resultMessage` (Task 3); `getRokus` (Task 4).
- Produces: the loadable extension. Content script answers `runtime` message `{ type: 'getTimestamp' }` with `number | null`.

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Playlet Throw",
  "version": "0.1.0",
  "description": "Right-click a YouTube video to play or queue it in Playlet on your Roku.",
  "browser_specific_settings": {
    "gecko": {
      "id": "playlet-throw@garion.local",
      "strict_min_version": "128.0",
      "data_collection_permissions": { "required": ["none"] }
    }
  },
  "background": {
    "scripts": ["background.js"],
    "type": "module"
  },
  "permissions": ["menus", "storage", "notifications"],
  "host_permissions": ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"],
  "optional_host_permissions": ["http://*/*"],
  "content_scripts": [
    {
      "matches": ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"],
      "js": ["content/timestamp.js"],
      "all_frames": true
    }
  ],
  "options_ui": {
    "page": "options/options.html",
    "open_in_tab": true
  }
}
```

- [ ] **Step 2: Create `content/timestamp.js`**

```js
// Answers the background script with the current playback position (whole seconds)
// of the video playing in this frame, or null when nothing has started playing.
browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'getTimestamp') return undefined;
  const video = [...document.querySelectorAll('video')].find((v) => v.currentTime > 0);
  return Promise.resolve(video ? Math.floor(video.currentTime) : null);
});
```

- [ ] **Step 3: Create `background.js`**

```js
import { resolveClick } from './lib/youtube.js';
import { play, queue } from './lib/roku.js';
import { menuPlan, parseMenuId } from './lib/menus.js';
import { resultMessage } from './lib/messages.js';
import { getRokus } from './lib/storage.js';

const SENDERS = { play, queue };

async function rebuildMenus() {
  await browser.menus.removeAll();
  for (const item of menuPlan(await getRokus())) {
    browser.menus.create(item);
  }
}

function notify(message) {
  return browser.notifications.create({ type: 'basic', title: 'Playlet Throw', message });
}

async function getPlayerTime(tab, frameId) {
  if (tab?.id === undefined) return null;
  try {
    const time = await browser.tabs.sendMessage(tab.id, { type: 'getTimestamp' }, { frameId: frameId ?? 0 });
    return Number.isInteger(time) && time > 0 ? time : null;
  } catch {
    return null; // No content script in that frame (e.g. YouTube permission not granted).
  }
}

async function handleClick(info, tab) {
  const menu = parseMenuId(info.menuItemId);
  if (!menu) return;
  if (menu.action === 'setup') {
    await browser.runtime.openOptionsPage();
    return;
  }

  const roku = (await getRokus()).find((r) => r.id === menu.rokuId);
  if (!roku) {
    await notify('That Roku was removed. Right-click the video again.');
    return;
  }

  const target = resolveClick(info);
  if (!target) {
    await notify("Couldn't find a YouTube video in what you right-clicked.");
    return;
  }

  if (!(await browser.permissions.contains({ origins: [`http://${roku.host}/*`] }))) {
    await notify(`Permission for ${roku.host} not granted — open the Playlet Throw options to grant it.`);
    return;
  }

  const timestamp = target.fromLink
    ? target.startTime
    : (await getPlayerTime(tab, info.frameId)) ?? target.startTime;

  const result = await SENDERS[menu.action](
    { host: roku.host, videoId: target.videoId, timestamp },
    (...args) => fetch(...args),
  );
  await notify(resultMessage(menu.action, roku, result));
}

browser.runtime.onInstalled.addListener(rebuildMenus);
browser.runtime.onStartup.addListener(rebuildMenus);
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.rokus) rebuildMenus();
});
browser.menus.onClicked.addListener((info, tab) => {
  handleClick(info, tab).catch((error) => notify(`Something went wrong: ${error.message ?? error}`));
});
```

- [ ] **Step 4: Run unit tests and lint**

Run: `npm test`
Expected: PASS (unchanged).

Run: `npm run lint`
Expected: `errors 0`. Warnings about missing icons are acceptable. If lint reports `data_collection_permissions` as unknown with the installed web-ext version, delete that key and re-run; if it reports it as *required*, keep it.

- [ ] **Step 5: Smoke-load in Firefox**

1. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `manifest.json`.
2. Confirm it loads with no errors on the card; click **Inspect** and check the console is clean.
3. Right-click a YouTube link anywhere: "Playlet: set up a Roku…" appears; clicking it opens the options page.

- [ ] **Step 6: Commit**

```bash
git add manifest.json content/timestamp.js background.js
git commit -m "Wire up context menus, player timestamp, and notifications"
```

---

### Task 6: README and end-to-end verification on a real Roku

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the complete extension from Tasks 1–5.
- Produces: user documentation; verified behavior.

- [ ] **Step 1: Write `README.md`**

````markdown
# Playlet Throw

A Firefox extension that sends YouTube videos to [Playlet](https://github.com/iBicha/playlet) on your Roku.
Right-click a YouTube video → **Play on Playlet** or **Add to Playlet queue**.

## Roku setup

1. Install the Playlet channel on the Roku.
2. Find the Roku's IP: **Settings → Network → About**. Give it a DHCP reservation on your router so it doesn't change.
3. Make sure **Settings → System → Advanced system settings → Control by mobile apps** is set to **Enabled**
   (Firefox talks to the Roku on port 8060 for launching, and to Playlet on port 8888).

## Install in Firefox

Temporary (removed when Firefox restarts):

1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → pick `manifest.json` from this folder.

Permanent: sign it as an unlisted add-on with your own AMO API keys:

```bash
npx web-ext sign --channel=unlisted --api-key=... --api-secret=...
```

then install the `.xpi` from `web-ext-artifacts/`.

After installing, open the extension's options (**about:addons → Playlet Throw → Options**), add each
Roku (name + IP), allow the permission prompt, and click **Test**. If a "Grant access" notice appears,
grant it — that's what lets Play resume at the position you're watching.

## Using it

- **Links and thumbnails** — right-click any YouTube link, on YouTube or any other site.
  A `?t=` in the link is honored.
- **The video you're watching** — right-click the watch page outside the player, or
  **Shift+right-click the player itself** (YouTube replaces the normal right-click menu inside the player).
  The TV picks up at your current position.
- **Embedded players** on other sites — Shift+right-click the player.

With more than one Roku configured, each menu item has a submenu to pick the TV.

If Playlet isn't open on the TV, it's launched with your video. "Add to Playlet queue" does the same
(an empty queue would just play it anyway).

## Development

```bash
npm test       # unit tests (node --test, no dependencies)
npm run lint   # web-ext lint
```
````

- [ ] **Step 2: Run tests and lint one last time**

Run: `npm test && npm run lint`
Expected: all tests PASS; lint `errors 0`.

- [ ] **Step 3: Manual end-to-end checklist (with the user's real Roku)**

Reload the temporary add-on, then in the options page add the Roku(s) and click **Test** (expect "Reachable — Playlet installed"). Check each item; note Playlet state before each.

| # | Action | Playlet state | Expected |
|---|--------|---------------|----------|
| 1 | Right-click a thumbnail on youtube.com home → Play | closed | Playlet launches, plays video; "▶ Playing on …" |
| 2 | Same → Add to queue | open, playing | Video added to queue; "➕ Queued on …" |
| 3 | Same → Add to queue | closed | Playlet launches with video; "▶ Playlet wasn't open — playing on …" |
| 4 | Watch page, 2 min in, right-click beside the player → Play | open | TV plays from ~2:00 |
| 5 | Shift+right-click the player itself → Play | open | TV plays from current position |
| 6 | `youtu.be/<id>?t=90` link on another site → Play | open | TV plays from 1:30 |
| 7 | Embedded YouTube on a third-party page, Shift+right-click player → Play | open | Plays that video |
| 8 | Right-click a non-YouTube link or page | — | No Playlet menu items |
| 9 | Add a second Roku | — | Menu items become submenus listing both names |
| 10 | Edit a Roku to a wrong IP (e.g. `192.168.1.254`) → Play | — | After ~8 s: "Couldn't reach … Check the IP, and that …" |
| 11 | Remove all Rokus, right-click a YouTube link | — | Only "Playlet: set up a Roku…" |

Record any failures and fix them before committing.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Add README with setup and usage"
```
