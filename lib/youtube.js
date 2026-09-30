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
