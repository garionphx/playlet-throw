# Playlet Throw

A Firefox extension that sends YouTube videos to [Playlet](https://github.com/iBicha/playlet) on your Roku.
Right-click a YouTube video → **Playlet Throw ▸ Play on Playlet** or **Add to Playlet queue**.

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

With more than one Roku configured, each item becomes a submenu to pick the TV
(**Playlet Throw ▸ Play on Playlet ▸ <Roku>**).

If Playlet isn't open on the TV, it's launched with your video. "Add to Playlet queue" does the same
(an empty queue would just play it anyway).

## Development

```bash
npm test       # unit tests (node --test, no dependencies)
npm run lint   # web-ext lint
```
