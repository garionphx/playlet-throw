# Playlet Throw — Design

Date: 2026-09-29
Status: Approved in conversation; pending written-spec review

## Goal

A personal Firefox extension: right-click a YouTube video (link, thumbnail,
player, or embedded player) and choose "Play on Playlet" or "Add to Playlet
queue" to send it to the Playlet app on a Roku on the home network. Supports
several named Rokus. When sent from a playing video, playback resumes on the
TV at the same position.

## Scope

In scope:
- YouTube videos only (Playlet is a YouTube client; arbitrary video URLs are out).
- Two actions: Play (replace current playback) and Queue (append).
- Multiple Rokus, configured manually by name + IP.
- Current-position carry-over when right-clicking a player / watch page.

Out of scope:
- Non-YouTube video, playlists (`&list=` is ignored; the single video is sent).
- Roku auto-discovery (extensions can't do SSDP; user enters IPs).
- AMO publishing/signing (loaded as a temporary add-on, or self-signed unlisted later).

## Playlet / Roku interfaces (verified against iBicha/playlet source)

Playlet channel ID: `693751`.

| Path | Request | Needs Playlet running? |
|------|---------|------------------------|
| Play (fast) | `POST http://<ip>:8888/api/queue/play` JSON `{"videoId": "...", "timestamp": N?}` → 204 | Yes |
| Queue | `POST http://<ip>:8888/api/queue` JSON `{"videoId": "...", "timestamp": N?}` → 204 | Yes |
| Launch + play | `POST http://<ip>:8060/launch/693751?contentId=<id>[&timestamp=N]` | No (launches it) |
| Health check | `GET http://<ip>:8060/query/apps` → XML listing installed apps | No |

Playlet's web server sends `Access-Control-Allow-Origin: *`. `timestamp` is
integer seconds (see `VideoQueueRouter.bs`, `EcpArgs.bs`).

Roku OS setting **Settings → System → Advanced system settings → Control by
mobile apps** must allow network control, otherwise port 8060 is refused.

## Architecture

Manifest V3 Firefox extension, plain JavaScript (ES modules), no build step,
no runtime dependencies.

```
playlet-throw/
  manifest.json
  background.js          # menus, click handling, notifications
  lib/youtube.js         # extractVideoId(url) — pure
  lib/roku.js            # play/queue/testRoku with fallback — fetch injected
  lib/storage.js         # get/set Roku list in storage.sync
  content/timestamp.js   # replies with current player time
  options/options.html
  options/options.js
  test/youtube.test.js
  test/roku.test.js
  package.json           # "test": "node --test" (no dependencies)
  README.md
```

### manifest.json

- `manifest_version: 3`
- `browser_specific_settings.gecko.id` set (required for `storage.sync`).
- `background: { "scripts": ["background.js"], "type": "module" }`
- `permissions`: `menus`, `storage`, `notifications`
- `host_permissions`: `*://*.youtube.com/*`, `*://*.youtube-nocookie.com/*`
  (for the content script)
- `optional_host_permissions`: `http://*/*` — the specific
  `http://<ip>/*` origins are requested per Roku from the options page.
- `content_scripts`: `content/timestamp.js` on the YouTube hosts above,
  `all_frames: true`.
- `options_ui: { "page": "options/options.html", "open_in_tab": true }`

Firefox MV3 treats host permissions as user-grantable; the options page shows
a notice with a "Grant" button if the YouTube host permission is missing.

### lib/youtube.js

`extractVideoId(url: string) → string | null`

Accepts hosts `youtube.com`, `www.`, `m.`, `music.` subdomains,
`youtube-nocookie.com`, `youtu.be`. Recognized forms:
- `/watch?v=ID`
- `youtu.be/ID`
- `/shorts/ID`, `/embed/ID`, `/live/ID`, `/v/ID`

Returns the ID only if it matches `^[A-Za-z0-9_-]{11}$`; otherwise `null`.
Invalid URLs, non-YouTube hosts, and `blob:` URLs return `null`.

### lib/storage.js

Roku list stored in `browser.storage.sync` under key `rokus`:
`[{ id: string, name: string, host: string }]` where `host` is an IP or
hostname without port or scheme. `id` is a random UUID used as a stable menu
key. Exposes `getRokus()`, `saveRokus(list)`.

### lib/roku.js

All functions take a `fetch`-compatible function as a dependency so tests can
inject a fake.

- `play({host, videoId, timestamp}, fetch)`:
  1. `POST :8888/api/queue/play` with JSON body, 3 s timeout (AbortController).
  2. On 2xx → `{ ok: true, via: "playlet" }`.
  3. On HTTP non-2xx → `{ ok: false, error: "Playlet rejected the request (HTTP <status>)" }`. No fallback.
  4. On network error / timeout → fall back to `POST :8060/launch/693751?contentId=<id>[&timestamp=N]`, 5 s timeout.
     2xx → `{ ok: true, via: "launch" }`; otherwise `{ ok: false, error: <unreachable message> }`.
- `queue({host, videoId, timestamp}, fetch)`: same as `play` but step 1 hits
  `POST :8888/api/queue`. Fallback is the same launch (with Playlet not
  running the queue is empty, so launch-and-play is the equivalent outcome);
  result `via: "launch"` lets the UI say "Playlet wasn't open — started playing".
- `testRoku(host, fetch)` → `"ok" | "no-playlet" | "unreachable"` via
  `GET :8060/query/apps`, checking the response text for `id="693751"`.

`timestamp` is omitted from requests when null/undefined/0.

### content/timestamp.js

Listens for `runtime.onMessage` `{ type: "getTimestamp" }` and responds with
`Math.floor(video.currentTime)` for the first `<video>` element in the frame
that has `currentTime > 0`, else `null`.

### background.js

**Menus.** Rebuilt on startup and on `storage.onChanged` for `rokus`.
- Contexts: `link`, `video`, `page`, `frame`.
- 0 Rokus: single item "Playlet: set up a Roku…" → opens options.
- 1 Roku: top-level items "Play on Playlet" and "Add to Playlet queue".
- 2+ Rokus: the same two parents, each with one child per Roku (by name).
- Visibility: `menus.onShown` computes the video ID from the click info; if
  none is found, items are hidden (`menus.update` + `menus.refresh`).

**Video ID resolution order** (first non-null wins):
`info.linkUrl` → `info.frameUrl` → `info.pageUrl`.
(`info.srcUrl` for `<video>` is a `blob:` URL and is not used.)

**Timestamp.** Requested only when the ID did *not* come from `linkUrl`:
`tabs.sendMessage(tab.id, { type: "getTimestamp" }, { frameId: info.frameId })`
with errors swallowed → `null`. Timestamp failure never blocks the send.

**Result notifications** (`notifications.create`):
- Play OK: "▶ Playing on <name>"
- Queue OK via playlet: "➕ Queued on <name>"
- Queue OK via launch: "▶ Playlet wasn't open — playing on <name>"
- Failure: "Couldn't reach <name> (<host>). Check the IP, and that Settings →
  System → Advanced system settings → Control by mobile apps is enabled."
  or the HTTP-rejection message.
- Missing host permission for that Roku: "Permission for <host> not granted —
  open the extension options to grant it."

### options page

- Table of Rokus: name, host, **Test**, **Remove**; an add/edit form.
- On Save of a new/changed host: `permissions.request({ origins: ["http://<host>/*"] })`
  (called directly in the click handler to satisfy the user-gesture rule).
- **Test** shows: "Reachable — Playlet installed" / "Reachable — Playlet not
  found" / "Unreachable".
- Notice + "Grant" button if the YouTube host permission isn't granted.
- Basic validation: name non-empty; host non-empty, no scheme, no path.

## Error handling summary

| Situation | Behavior |
|-----------|----------|
| No video ID in click context | Menu items hidden |
| Timestamp lookup fails | Send without timestamp |
| 8888 unreachable / timeout | Fall back to 8060 launch |
| 8888 returns non-2xx | Report error, no fallback |
| 8060 fails too | "Couldn't reach…" notification with the Control-by-mobile-apps hint |
| Host permission missing | Notification pointing to options |

## Testing

- **Unit (`npm test` → `node --test`)**, no dependencies:
  - `youtube.test.js`: table of URLs — all accepted forms and hosts, with
    extra query params, `&t=`, `&list=`; and rejections (non-YouTube,
    malformed, `blob:`, wrong-length IDs, channel/playlist-only pages).
  - `roku.test.js` with a fake fetch: 8888 success; 8888 network error →
    launch success; 8888 timeout → launch; 8888 HTTP 500 → no fallback;
    both fail; timestamp included in JSON and query string; timestamp omitted
    when null; queue fallback reports `via: "launch"`; `testRoku` three outcomes.
- **Lint:** `npx web-ext lint`.
- **Manual (real Roku):** load via `about:debugging` → This Firefox → Load
  Temporary Add-on. Check: link on YouTube home, thumbnail, player on a watch
  page mid-video (resumes at position), embedded player on a third-party
  page, youtu.be link on another site; each with Playlet open and closed;
  single-Roku and multi-Roku menus; Test button; wrong IP error message.
