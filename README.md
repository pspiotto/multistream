# Multistream

Watch Twitch, Kick and YouTube streams side by side in one browser tab, with chat.
Live at https://stream.spiot.to/

One static page (`public/index.html`, no build step, no framework) plus a small Cloudflare Worker
(`src/worker.js`) for the three things a page cannot do on its own.

## Using it

Paste a stream URL into the toolbar, or pick a platform and type a channel name.

| Input | Result |
|---|---|
| `twitch.tv/name`, or a name with Twitch selected | Twitch stream |
| `kick.com/name`, or a name with Kick selected | Kick stream |
| `youtube.com/@handle`, `@handle`, or a name with YouTube selected | That channel's current live stream |
| `youtube.com/watch?v=ID`, `youtu.be/ID` | A specific YouTube video or stream |
| `youtube.com/channel/UC...` | A channel by id (no chat) |

Toolbar:

- **Menu**: collapse the toolbar. On touch screens this also hides every stream's controls.
- **Chat**: show or hide the chat panel on the right. Its dropdown picks which stream's chat to show; drag
  its left edge to resize it.
- **Mute all**: silence every stream.
- **Layout**: grid presets (auto, or 1 to 4 columns), one big stream with the rest in a strip below or a
  column on the right, and named custom layouts that remember dragged sizes and the chat panel.
- **Hide overlays**: stop the players showing their own title bars and controls on hover. While it is on
  you cannot click inside a player; turn it off to use a player's own controls.
- **Saved**: named sets of streams, kept in this browser. Press **Fav** on a stream to list it here too,
  then pick it later to add it to whatever is open.
- **Share**: copy the address. The address holds the whole canvas, so a bookmark is also a saved canvas.
- **Fullscreen**, **Clear**.

Each stream has its own controls (on hover, or always visible on touch screens):

- The `::` grip: drag onto another stream to swap places.
- **Sound**: make this the only stream with sound. The stream with sound gets a volume slider where the
  platform allows it (not on iPad or iPhone, where only the hardware buttons set volume).
- **Chat**: show this stream's chat as its own tile, so two chats can be open at once.
- **Max**: make this stream the big one. **Reload**, **Remove**.

Drag the edge between two streams to resize them. Double-click an edge to reset.

Every stream starts muted, because browsers block autoplay with sound.

### The address format

`https://stream.spiot.to/#t:alfie,k:odablock,y:@lofigirl,tc:alfie`

A comma-separated list. `t`, `k`, `y` are Twitch, Kick, YouTube; a `c` after the letter (`tc:`, `kc:`,
`yc:`) is that stream's chat as a tile.

## How each platform is played

- **Twitch**: plays in a plain `<video>` element, ad-free. Twitch decides whether to stitch ads into a
  stream based on the playback token's `playerType`, so the Worker (`/api/tw`) mints an anonymous
  `embed`-type token, which comes back ad-free from any IP (observed 2026-11-19, including from
  Cloudflare's edge). If Twitch closes that door, tiles fall back to Twitch's own embed, which carries
  ads and reloads when sound is switched.
- **YouTube**: the standard embed, controlled with its postMessage commands. An `@handle` is resolved to
  the live video by `/api/yt` each time the stream loads, so a saved canvas keeps working on later days.
- **Kick**: Kick's embed accepts no commands, so the stream plays in a plain `<video>` element instead.
  The stream URL comes from Kick's channel API. Browsers with native HLS (Safari, everything on iPad and
  iPhone, recent Chrome) play it directly; others (Firefox desktop) use hls.js, loaded on demand, which
  reads the master playlist through `/api/hls`. If any step fails, or the channel is offline, the tile
  falls back to Kick's embed. Twitch works the same way, with `/api/tw` in place of the channel API.

## Known limits

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

Checks, both in the browser:

- `http://localhost:8080/?test` runs the parser and layout assertions; failures appear in the console.
- Adding `?hlsjs` forces the hls.js path for Kick and Twitch in a browser that has native HLS.

## Deploying

```sh
npm run deploy     # wrangler deploy
```

`wrangler.jsonc` serves `public/` as static assets and routes the custom domain to the Worker. Requests
that match a file never reach the Worker; it only answers:

| Endpoint | Purpose |
|---|---|
| `/api/yt?handle=name` | `{ videoId, channelId }` for a YouTube handle. `videoId` is present when the channel is live. |
| `/api/hls?u=url` | Relays a Kick master playlist. Only Kick's stream playlist URLs are accepted. |
| `/api/tw?c=name` | Mints an anonymous ad-free Twitch playback token and relays the master playlist it unlocks. |
| `/api/tw?v=url` | Relays one Twitch variant playlist for hls.js, which Twitch refuses to serve to other sites. |

To host your own copy, change `routes` in `wrangler.jsonc` to your domain. Nothing else is tied to the
hostname: the page passes whatever host it is served from to Twitch and YouTube.

## Icons

Source art is in `art/`. `node scripts/build-icons.cjs` regenerates the favicons, the Apple touch icon
and the web app icons into `public/`. It uses `sharp`, which is present in `node_modules` through wrangler.

## Layout of the repo

```
public/index.html      the whole app
public/                icons and web app manifest
src/worker.js          /api/yt, /api/hls and /api/tw
scripts/build-icons.cjs
art/                   icon source images
wrangler.jsonc
```
