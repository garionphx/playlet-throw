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
