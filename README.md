# Multistream

Watch Twitch, Kick and YouTube streams side by side in one browser tab, with chat.
Live at https://stream.spiot.to/

One static page (`public/index.html`, no build step, no framework) plus a small Cloudflare Worker
(`src/worker.js`) for the lookups a page cannot do on its own.

## Using it

The page opens on **Home**: your favorite channels from all three platforms, each with a dot that is
green while the channel is live. Pick the ones you want, pick a layout, press **Watch**. Add favorites
there, or with **Fav** on any open stream. Home also lists your saved canvases. With streams open, the
**Home** button (or `H`) brings it back; unpicking a favorite there closes it.

To open one stream directly, paste its URL into the toolbar, or pick a platform and type a channel name.

| Input | Result |
|---|---|
| `twitch.tv/name`, or a name with Twitch selected | Twitch stream |
| `kick.com/name`, or a name with Kick selected | Kick stream |
| `youtube.com/@handle`, `@handle`, or a name with YouTube selected | That channel's current live stream |
| `youtube.com/watch?v=ID`, `youtu.be/ID` | That video. If it is its channel's current live stream, the channel instead (see below) |
| `youtube.com/channel/UC...` | That channel's current live stream |

YouTube gives every stream a new link. So a pasted link to a stream that is live right now is turned
into its channel (`y:@handle`): the tile, the address, favorites and saved canvases then keep working
for the channel's next stream, and an open tile switches to the new stream by itself. A link to a
recording, or to one of several streams a channel runs at once, stays that exact video.

Toolbar:

- **Menu**: collapse the toolbar. On touch screens this also hides every stream's controls.
- **Chat**: show or hide the chat panel on the right. Its dropdown picks which stream's chat to show; drag
  its left edge to resize it.
- **Mute all**: silence every stream.
- **Layout**: grid presets (auto, or 1 to 4 columns), one big stream with the rest in a strip below or a
  column on the right, and named custom layouts that remember dragged sizes and the chat panel.
- **Hide overlays**: stop the players showing their own title bars and controls on hover. While it is on
  you cannot click inside a player; turn it off to use a player's own controls.
- **Saved**: named sets of streams, kept in this browser. Your favorites are here too, grouped by
  platform with the same live dots as Home: click one to put it on the canvas or take it off, without
  leaving what you are watching.
- **Share**: copy the address. The address holds the whole canvas, so a bookmark is also a saved canvas.
  The copied link also carries the layout (grid columns, or which stream is the big one).
- **Fullscreen**, **Clear**.

Each stream has its own controls (on hover, or always visible on touch screens):

- The `::` grip: drag onto another stream to swap places.
- **Sound**: make this the only stream with sound. The stream with sound gets a volume slider where the
  platform allows it (not on iPad or iPhone, where only the hardware buttons set volume). Each stream's
  volume is remembered.
- **Delay** (Twitch and Kick): hold this stream back by up to 30 seconds, to line it up with another
  view of the same event.
- An **Offline** tag means the channel is not live; the stream starts by itself when it is. An amber
  **Embed** tag means a live Twitch or Kick stream is in the platform's own player, where ads are
  possible; hover the tag for the reason, and press Reload to try the ad-free player again.
- **Chat**: show this stream's chat as its own tile, so two chats can be open at once.
- **Max**: make this stream the big one. **Reload**, **Remove**.

Drag the edge between two streams to resize them. Double-click an edge to reset.

With **Hide overlays** on, click a stream to give it sound and double-click it to make it the big one.

Keys: `1` to `9` give sound to that stream (again to mute it), `M` mutes all, `F` fullscreen, `C` chat,
`H` home. They do not work while a player has the keyboard focus; click outside it first.

Twitch and Kick streams keep themselves live: a stream that has fallen more than 20 seconds behind
where it normally sits (after buffering, or after you paused it) skips forward. Small tiles load a
lower quality in browsers that use hls.js (Firefox desktop); other browsers choose quality themselves.

Every stream starts muted, because browsers block autoplay with sound.

### The address format

`https://stream.spiot.to/#t:alfie,k:odablock,y:@lofigirl,tc:alfie`

A comma-separated list. `t`, `k`, `y` are Twitch, Kick, YouTube; a `c` after the letter (`tc:`, `kc:`,
`yc:`) is that stream's chat as a tile. A link from Share ends in a layout item: `l:3` is a 3-column
grid (`l:0` is auto), `l:r1` and `l:b1` are the second stream big with the rest on the right or below.

## How each platform is played

- **Twitch**: plays in a plain `<video>` element, ad-free. Twitch decides whether to stitch ads into a
  stream based on the playback token's `playerType`, so the Worker (`/api/tw`) mints an anonymous
  `embed`-type token, which comes back ad-free from any IP (observed 2026-11-19, including from
  Cloudflare's edge). If Twitch closes that door, tiles fall back to Twitch's own embed, which carries
  ads and reloads when sound is switched.
- **YouTube**: the standard embed, controlled with its postMessage commands. An `@handle` is resolved to
  the live video by `/api/yt` each time the stream loads, so a saved canvas keeps working on later days.
  Channel ids (`UC...`) work the same way.
- **Kick**: Kick's embed accepts no commands, so the stream plays in a plain `<video>` element instead.
  The stream URL comes from Kick's channel API. Browsers with native HLS (Safari, everything on iPad and
  iPhone, recent Chrome) play it directly; others (Firefox desktop) use hls.js, loaded on demand, which
  reads the master playlist through `/api/hls`. If any step fails, or the channel is offline, the tile
  falls back to Kick's embed. Twitch works the same way, with `/api/tw` in place of the channel API.

## Known limits

- Live status is checked once a minute while the tab is visible, so a stream can start up to a minute
  late. A YouTube stream that is scheduled but not started counts as offline.
- Chats embedded on iPad and iPhone will usually show you as logged out, because WebKit blocks
  third-party cookies. You can read chat but not type.
- A Kick tile saying "This embed seems to be misconfigured" means that channel name does not exist on Kick.
- Saved canvases, custom layouts and settings live in the browser's local storage. They do not sync
  between devices.
- `/api/yt` reads YouTube's public channel page, the Kick player uses an unofficial Kick API, and the
  Twitch player uses Twitch's unofficial GQL and playlist endpoints. Any of them can break if those
  sites change; every path has a fallback.
- YouTube handles are matched as ASCII (`a-z`, `0-9`, `.`, `_`, `-`).

## Running locally

Needs Node. Twitch refuses to embed from `file://`, so the page must be served.

```sh
npm install
npm run dev        # http://localhost:8080
```

Checks:

- `npm test` runs the Worker's tests (what each endpoint lets through, with the upstream sites stubbed).
- `http://localhost:8080/?test` runs the parser and layout assertions; failures appear in the console.
- Adding `?hlsjs` forces the hls.js path for Kick and Twitch in a browser that has native HLS.

## Deploying

```sh
npm run deploy     # wrangler deploy
npm run verify     # the live page matches this checkout, and every endpoint answers
```

`wrangler.jsonc` serves `public/` as static assets and routes the custom domain to the Worker. Requests
that match a file never reach the Worker; it only answers:

| Endpoint | Purpose |
|---|---|
| `/api/yt?handle=name` | `{ videoId, channelId, handle, live }` for a YouTube handle. `videoId` is present when the channel is live or has a stream scheduled. |
| `/api/yt?channel=UC...` | The same for a channel id. |
| `/api/yt?video=ID` | The channel a video belongs to, and whether that video is live now. |
| `/api/live?t=a,b` | `{ a: true, b: false }`: which of up to 50 Twitch channels are live. |
| `/api/hls?u=url` | Relays a Kick master playlist. Only Kick's stream playlist URLs are accepted. |
| `/api/tw?c=name` | Mints an anonymous ad-free Twitch playback token and relays the master playlist it unlocks. |
| `/api/tw?v=url` | Relays one Twitch variant playlist for hls.js, which Twitch refuses to serve to other sites. |

Lookups are limited to 300 a minute per address (`ratelimits` in `wrangler.jsonc`); the variant relay
is exempt because hls.js reads it every few seconds per stream.

To host your own copy, change `routes` in `wrangler.jsonc` to your domain. Nothing else is tied to the
hostname: the page passes whatever host it is served from to Twitch and YouTube.

## Icons

Source art is in `art/`. `node scripts/build-icons.cjs` regenerates the favicons, the Apple touch icon
and the web app icons into `public/`. It uses `sharp`, which is present in `node_modules` through wrangler.

## Layout of the repo

```
public/index.html      the whole app
public/                icons and web app manifest
src/worker.js          /api/yt, /api/live, /api/hls and /api/tw
test/worker.test.mjs   npm test
scripts/build-icons.cjs
scripts/verify.mjs     npm run verify
art/                   icon source images
wrangler.jsonc
```
