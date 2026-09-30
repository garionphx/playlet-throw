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
