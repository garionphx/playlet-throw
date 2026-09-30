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
