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
