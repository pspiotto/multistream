// Static files in ./public are served by the platform before this runs. This Worker answers:
//   /api/yt?handle=  a YouTube @handle -> { videoId, channelId, handle, live }; videoId only when live
//   /api/yt?channel= the same for a UC... channel id
//   /api/yt?video=   the channel a video belongs to, and whether that video is live right now
//   /api/live?t=a,b  which of these Twitch channels are live -> { a: true, b: false }
//   /api/hls?u=      a Kick stream's master playlist, relayed so a script HLS player can read it
//   /api/tw?c=       a Twitch channel's master playlist, fetched with an ad-free playback token
//   /api/tw?v=       one of that playlist's variant playlists, relayed for hls.js (Twitch blocks our Origin)
const CID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // Twitch's public web client id
const m3u8 = res => new Response(res.body, {
  status: res.status,
  headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' },
});
const bad = (error, status = 400) => Response.json({ error }, { status });
const gql = query => fetch('https://gql.twitch.tv/gql', {
  method: 'POST',
  headers: { 'client-id': CID, 'content-type': 'application/json' },
  body: JSON.stringify({ query }),
}).then(r => r.json()).catch(() => null);

export default {
  async fetch(request, env) {
    const url = new URL(request.url), q = url.searchParams;
    // Per-address limit on everything that makes us call another site on the caller's behalf. The
    // variant relay is left out: hls.js re-reads it every couple of seconds for every open tile.
    if (env?.RL && !q.has('v')) {
      const { success } = await env.RL.limit({ key: request.headers.get('cf-connecting-ip') ?? 'anon' });
      if (!success) return bad('slow down', 429);
    }
    if (url.pathname === '/api/hls') {
      // Kick's master playlist only allows cross-origin reads from kick.com, which blocks hls.js in
      // browsers without native HLS (Firefox desktop). Everything the playlist points at allows any
      // origin, so relaying this one small text file is enough.
      // Strict allowlist so this is not an open proxy: only Kick's (Amazon IVS) channel playlists.
      const u = q.get('u') ?? '';
      if (!/^https:\/\/[a-z0-9]+\.[a-z0-9-]+\.playback\.live-video\.net\/api\/video\/v1\/[\w.-]+\.m3u8\?token=[\w.-]+$/.test(u)) {
        return bad('bad playlist url');
      }
      return m3u8(await fetch(u));
    }
    if (url.pathname === '/api/tw' && q.has('v')) {
      // A Twitch variant playlist. *.playlist.ttvnw.net answers 403 to any request whose Origin is
      // not Twitch's or localhost (observed 2026-11-19, for every playerType), and hls.js always sends
      // one, so it reads these through here. Native HLS players send no Origin and fetch directly.
      // Strict allowlist so this is not an open proxy.
      const v = q.get('v');
      if (!/^https:\/\/[a-z0-9-]+\.playlist\.ttvnw\.net\/v1\/playlist\/[\w-]+\.m3u8$/.test(v)) return bad('bad playlist url');
      return m3u8(await fetch(v));
    }
    if (url.pathname === '/api/tw') {
      // Twitch stitches ads into the HLS playlist based on the playback token's playerType: an
      // anonymous "site" token gets a 30 s pre-roll, an "embed" token a clean playlist (observed
      // 2026-11-19, same IP). We mint the token ourselves, so no proxy is needed. usher sends no
      // CORS header, so the master is relayed here. Segments allow any origin and load directly;
      // native HLS players fetch the variants directly too, hls.js goes through ?v= above.
      const c = q.get('c') ?? '';
      if (!/^\w{2,25}$/.test(c)) return bad('bad channel');
      // c is [\w]{2,25}, so it cannot break out of the quotes
      const tok = (await gql(`{ streamPlaybackAccessToken(channelName: "${c}", params: {platform: "web", playerBackend: "mediaplayer", playerType: "embed"}) { value signature } }`))?.data?.streamPlaybackAccessToken;
      if (!tok) {
        console.warn('tw: no playback token for', c); // the page falls back to Twitch's embed; this is the trace of why
        return bad('no token', 502);
      }
      const u = new URL(`https://usher.ttvnw.net/api/channel/hls/${c}.m3u8`);
      for (const [k, v] of Object.entries({
        client_id: CID, token: tok.value, sig: tok.signature,
        supported_codecs: 'av1,h264', allow_source: 'true', allow_audio_only: 'true',
        player: 'twitchweb', p: String(Math.floor(Math.random() * 1e6)),
      })) u.searchParams.set(k, v);
      const res = await fetch(u); // 404 = channel offline; the client falls back to Twitch's embed
      if (!res.ok && res.status !== 404) console.warn('tw: usher answered', res.status, 'for', c);
      return m3u8(res);
    }
    if (url.pathname === '/api/live') {
      // One GQL request for the whole list. A channel that does not exist comes back as not live.
      const names = (q.get('t') ?? '').split(',').filter(Boolean);
      if (!names.length || names.length > 50 || names.some(n => !/^\w{2,25}$/.test(n))) return bad('bad channels');
      const data = (await gql(`{ ${names.map((n, i) => `u${i}: user(login: "${n}") { stream { id } }`).join(' ')} }`))?.data;
      if (!data) return bad('no answer', 502);
      return Response.json(Object.fromEntries(names.map((n, i) => [n, !!data['u' + i]?.stream])),
        { headers: { 'cache-control': 'public, max-age=30' } });
    }
    if (url.pathname !== '/api/yt') return new Response('Not found', { status: 404 });

    // Strict allowlists: the id is the only user input that reaches the upstream URL.
    const video = q.get('video'), channel = q.get('channel'), handle = q.get('handle') ?? '';
    let path;
    if (video !== null) {
      if (!/^[\w-]{11}$/.test(video)) return bad('bad video');
      path = 'watch?v=' + video;
    } else if (channel !== null) {
      if (!/^UC[\w-]{22}$/.test(channel)) return bad('bad channel');
      path = `channel/${channel}/live`;
    } else {
      if (!/^[\w.-]{3,30}$/.test(handle)) return bad('bad handle');
      path = `@${handle}/live`;
    }
    const res = await fetch('https://www.youtube.com/' + path, {
      // SOCS skips the EU consent interstitial, which has no channel data in it.
      headers: { cookie: 'SOCS=CAI', 'accept-language': 'en', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' },
    });
    if (!res.ok) return bad('not found', 404);

    // shortcut: scrapes ids out of the page, breaks if YouTube changes it; upgrade to the Data API (needs a key)
    // A live channel answers with its watch page. From Cloudflare's network that page often comes without
    // its title and canonical link (seen 2026-11-18), so currentVideoEndpoint is the fallback; an offline
    // channel answers with its channel page, which has neither.
    const html = await res.text();
    const videoId = video !== null
      ? html.match(/"videoDetails":\{"videoId":"([\w-]{11})"/)?.[1]
      : html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1]
        ?? html.match(/"currentVideoEndpoint":.{0,400}?"videoId":"([\w-]{11})"/)?.[1];
    // The page's own channel first: a channel page also lists the ids of other channels it features.
    const channelId = (html.match(/"(?:externalChannelId|externalId)":"(UC[\w-]{22})"/)
      ?? html.match(/"channelId":"(UC[\w-]{22})"/))?.[1];
    if (!videoId && !channelId) return bad('not found', 404);
    // Only ASCII handles, the same ones ?handle= accepts; other channels are known by channelId.
    const owner = html.match(/"(?:ownerProfileUrl|vanityChannelUrl)":"https?:\/\/www\.youtube\.com\/@([\w.-]{3,30})"/)?.[1].toLowerCase();
    // About one page in four reaches Cloudflare stripped of its player data (seen 2026-11-21): no
    // handle, no live flag, for a video not even its own id. So: a video is live only when the page
    // says so, and null (unknown) when its page came back stripped; a channel's /live page counts a
    // video id as live unless the page says ended or upcoming. Stripped answers are not cached, so
    // asking again can get the full page.
    const live = video !== null ? (videoId ? /"isLiveNow":true/.test(html) : null)
      : !!videoId && (/"isLiveNow":true/.test(html) || !/"isLiveNow":false|"isUpcoming":true/.test(html));
    return Response.json({ videoId, channelId, handle: owner, live },
      { headers: { 'cache-control': owner ? 'public, max-age=60' : 'no-store' } });
  },
};
