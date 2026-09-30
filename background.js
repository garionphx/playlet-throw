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
