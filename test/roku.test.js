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

// Playlet's CsrfMiddleware (Oct 2026) answers 403 to any POST without an X-Playlet header.
test('Playlet requests carry the X-Playlet CSRF header', async () => {
  for (const [send, path] of [
    [play, '/api/queue/play'],
    [queue, '/api/queue'],
  ]) {
    const fetchFn = fakeFetch([[`${PLAYLET}${path}`, respond(204)]]);
    await send({ host: HOST, videoId: ID }, fetchFn, FAST);
    assert.equal(fetchFn.calls[0].init.headers['X-Playlet'], '1', path);
  }
});
