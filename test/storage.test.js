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
