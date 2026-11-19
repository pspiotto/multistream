# multistream

Domain facts for agents working in this repo. User-facing documentation is in README.md.

## Shape

- The whole app is `public/index.html`: vanilla JS, no build, no framework, no bundler. Keep it that way.
- `src/worker.js` is a Cloudflare Worker with two endpoints, `/api/yt` and `/api/hls`. Static assets are
  served before the Worker runs, so it never sees requests for files in `public/`.
- State is the URL hash (`#t:name,k:name,y:@handle,tc:name`). `parse()` is the single place user input is
  validated before it reaches an iframe `src` or a fetch; route new input forms through it.
- Tiles are absolutely positioned by `layout()` and never re-parented, because moving an iframe in the
  DOM reloads it. Reorder by changing the `streams` array and calling `render()`.
- `layout()` is pure (given `sizes`) and is also used to draw the preset previews.
- Per-tile player control goes through `el.mute(bool)` and `el.vol(0..1)`, set in `el.start()`.
  `el.cheap` is false when muting costs a reload (the iframe fallbacks).
- Browser-only persistence: localStorage keys `streams`, `sizes`, `saved`, `layouts`, `nochat`, `chatW`,
  `min`, `clean`.

## Platform facts (each one observed, with the date)

- Twitch embeds need `parent=<hostname>` and refuse `file://`; they work on `localhost` and on HTTPS hosts.
- Kick's embed (`player.kick.com/<slug>`) has no window message listener, so it cannot be muted or
  controlled from outside (2026-11-18). It shows "This embed seems to be misconfigured" for a channel
  that does not exist and "<Name> is offline" for one that does.
- `https://kick.com/api/v2/channels/<slug>` is unofficial. It echoed the request Origin back for `localhost:8080` and `stream.spiot.to`, returns
  `playback_url` (HLS), `livestream: null` when offline, and 404 for a missing channel (2026-11-18).
- Kick's master playlist sends Access-Control-Allow-Origin only for kick.com origins; variant playlists
  and segments send `*`. That is why `/api/hls` relays only the master, and why native-HLS browsers need
  no relay (2026-11-18).
- `youtube.com/@handle/live` returns the watch page when live and the channel page when not. Fetched from
  Cloudflare's network, the watch page often lacks its title and canonical link; `currentVideoEndpoint`
  is still present. Retrying inside one request does not change the answer (2026-11-18).
- `youtube.com/live_chat` needs `embed_domain=<hostname>` and a video id; a channel id has no chat URL.
- iOS and iPadOS ignore `video.volume` set from a page and block third-party cookies, so embedded chats
  are logged out there. Every browser on iPad is WebKit, including Firefox.
- The `spiot.to` zone has a redirect rule that sends every host to another domain unless the host is in
  its exception list. A new subdomain returns 301 until it is added there.

## Checks

- `npm run dev` then open `http://localhost:8080/?test`: parser and layout assertions, failures in the console.
- `?hlsjs` forces the hls.js path for Kick in a browser with native HLS.
- Not covered by any automated check: real pointer or touch drags, iPad behaviour, Firefox desktop.
- For test streams use music or 24/7 channels (`t:monstercat`, `y:@lofigirl`). Do not pick a gaming
  stream at random: the browser pane is on the owner's screen and he avoids spoilers.

## Deploy

- `npm run deploy` (wrangler). After a deploy, compare the live page with the local file
  (`curl -s https://stream.spiot.to/ | cmp - public/index.html`) and call both API endpoints.
- `NOTES.md` is the session log and is git-ignored because the repo is public. Keep names, email
  addresses and account ids out of every tracked file.
