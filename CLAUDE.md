# multistream

Domain facts for agents working in this repo. User-facing documentation is in README.md.

## Shape

- The whole app is `public/index.html`: vanilla JS, no build, no framework, no bundler. Keep it that way.
- `src/worker.js` is a Cloudflare Worker with four endpoints, `/api/yt`, `/api/live`, `/api/hls` and `/api/tw`.
  Static assets are served before the Worker runs, so it never sees requests for files in `public/`.
- State is the URL hash (`#t:name,k:name,y:@handle,tc:name`). `parse()` is the single place user input is
  validated before it reaches an iframe `src` or a fetch; route new input forms through it.
  A Share link adds a layout item (`l:3`, `l:r1`), read by `readLay()` in `load()` and then dropped from the hash.
- Tiles are absolutely positioned by `layout()` and never re-parented, because moving an iframe in the
  DOM reloads it. Reorder by changing the `streams` array and calling `render()`.
- `layout()` is pure (given `sizes`) and is also used to draw the preset previews.
- Per-tile player control goes through `el.mute(bool)` and `el.vol(0..1)`, set in `el.start()`.
  `el.cheap` is false when muting costs a reload (the iframe fallbacks).
- `el.start()` is async and guarded by `el.gen`: check `stale()` after every await before touching the tile.
  `el.stop()` is the only way to end a player (it also unloads the `<video>`).
- `el.watch` marks tiles that `poll()` (once a minute) may restart when their channel goes live. Twitch and
  Kick restart only after being seen offline (`el.wasOff`), so a live tile on the embed fallback does not loop.
- `durable()` turns a pasted YouTube video id into `y:@handle` when that video is the channel's current
  live stream. Both input boxes go through `readBox()`, which calls it.
- Home (`#home`) is shown when no stream is open or `body.home` is set; it is built from `favs`.
- Browser-only persistence: localStorage keys `streams`, `sizes`, `saved`, `favs`, `layouts`, `nochat`, `chatW`,
  `min`, `clean`, `vols`.

## Platform facts (each one observed, with the date)

- Twitch embeds need `parent=<hostname>` and refuse `file://`; they work on `localhost` and on HTTPS hosts.
- Twitch ad-stitching rides on the playback token's playerType, not the viewer's IP: an anonymous GQL token
  (`PlaybackAccessToken_Template`, public client-id `kimne78kx3ncx6brgo4mv6wki5h1ko`) with playerType `site`
  gets a 30 s pre-roll stitched into the variant playlist (`CLASS="twitch-stitched-ad"` DATERANGE); `embed`,
  `frontpage` and `mobile` came back clean from the same IP, and `embed` also clean through Cloudflare Worker
  egress (`wrangler dev --remote`). That is why `/api/tw` mints an `embed` token and no proxy is needed
  (2026-11-19). If ads return, the playerType constant in `src/worker.js` is the one line to change.
- `usher.ttvnw.net` master playlists send no CORS header (the Worker relays them). Variant playlists
  (`*.playlist.ttvnw.net`) send `*` but answer 403 to any Origin other than Twitch's or `localhost`, for
  every playerType, so hls.js reads them through `/api/tw?v=` and a localhost test does not catch it.
  Native HLS sends no Origin. Segments (`*.cloudfront.hls.ttvnw.net`) allow any origin (2026-11-19).
- usher answers 404 `[{"error":"Can not find channel"}]` both for a missing channel and for an offline one;
  check `stream: null` in GQL to tell them apart (monstercat itself was offline 2026-11-19).
- pixeltris/TwitchAdSolutions is archived (2026-03-05); the maintained list is zGato/ScrewTwitchAds.
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
- A YouTube watch page carries `"ownerProfileUrl":"http://www.youtube.com/@Handle"`, `externalChannelId` and
  `"isLiveNow":true|false`; a recording has no `isLiveNow` at all. A channel page lists other channels'
  `channelId`s before its own, so read `externalId` first. oEmbed returned no `author_url` for a stream
  video, which is why `/api/yt?video=` reads the watch page (2026-11-20, home IP).
- From Cloudflare's network about one YouTube page in four comes back stripped (8 samples per endpoint,
  2026-11-21): `/live` pages then lack the handle but keep the video id; a watch page lacks `videoDetails`,
  handle and `isLiveNow` but keeps a `channelId`; `channel/UC.../live` sometimes has nothing usable at all.
  A separate request usually gets the full page. So nothing may depend on one lookup's `handle` or `live`:
  `/api/yt` answers `live: null` for a stripped video page and does not let stripped answers be cached.
- `@lofigirl/live` picks one of the several streams that channel runs at once, and not the oldest one
  (2026-11-20). `youtube.com/channel/UC.../live` behaves like `@handle/live`.
- Twitch GQL takes aliased batches (`u0: user(login: "a") { stream { id } }`); a missing user is `null`,
  an offline one has `stream: null` (2026-11-20).
- With hls.js, a Twitch stream sits 16 to 18 s behind `video.seekable.end`, and that end moves in steps of
  a few seconds, so a single lag reading is noisy (2026-11-20).
- `youtube.com/live_chat` needs `embed_domain=<hostname>` and a video id; a channel id has no chat URL.
- iOS and iPadOS ignore `video.volume` set from a page and block third-party cookies, so embedded chats
  are logged out there. Every browser on iPad is WebKit, including Firefox.
- The `spiot.to` zone has a redirect rule that sends every host to another domain unless the host is in
  its exception list. A new subdomain returns 301 until it is added there.

## Checks

- `npm test`: Worker tests with upstream sites stubbed.
- `npm run dev` then open `http://localhost:8080/?test`: parser and layout assertions, failures in the console.
- Headless Chrome reports native HLS but fails to play it (`MediaError` code 4 on `/api/tw?c=`, 2026-11-20),
  so headless runs need `?hlsjs`. The native path can only be checked in a real browser.
- `?hlsjs` forces the hls.js path for Kick in a browser with native HLS.
- Not covered by any automated check: real pointer or touch drags, iPad behaviour, Firefox desktop, a live
  Kick stream, and the native-HLS path of catch-up and Delay.
- For test streams use music or 24/7 channels (`t:monstercat`, `y:@lofigirl`). Do not pick a gaming
  stream at random: the browser pane is on the owner's screen and he avoids spoilers.

## Deploy

- `npm run deploy` (wrangler), then `npm run verify`: it compares the live page with the local file and
  calls every API endpoint.
- `NOTES.md` is the session log and is git-ignored because the repo is public. Keep names, email
  addresses and account ids out of every tracked file.
