// Static files in ./public are served by the platform before this runs. This Worker answers:
//   /api/yt?handle=  a YouTube @handle -> { videoId } when the channel is live, else { channelId }
//   /api/hls?u=      a Kick stream's master playlist, relayed so a script HLS player can read it
//   /api/tw?c=       a Twitch channel's master playlist, fetched with an ad-free playback token
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/hls') {
      // Kick's master playlist only allows cross-origin reads from kick.com, which blocks hls.js in
      // browsers without native HLS (Firefox desktop). Everything the playlist points at allows any
      // origin, so relaying this one small text file is enough.
      // Strict allowlist so this is not an open proxy: only Kick's (Amazon IVS) channel playlists.
      const u = url.searchParams.get('u') ?? '';
      if (!/^https:\/\/[a-z0-9]+\.[a-z0-9-]+\.playback\.live-video\.net\/api\/video\/v1\/[\w.-]+\.m3u8\?token=[\w.-]+$/.test(u)) {
        return Response.json({ error: 'bad playlist url' }, { status: 400 });
      }
      const res = await fetch(u);
      return new Response(res.body, {
        status: res.status,
        headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' },
      });
    }
    if (url.pathname === '/api/tw') {
      // Twitch stitches ads into the HLS playlist based on the playback token's playerType: an
      // anonymous "site" token gets a 30 s pre-roll, an "embed" token a clean playlist (observed
      // 2026-11-19, same IP). We mint the token ourselves, so no proxy is needed. usher sends no
      // CORS header, so the master is relayed here; the variant playlists and segments it points
      // at allow any origin and load directly.
      const c = url.searchParams.get('c') ?? '';
      if (!/^\w{2,25}$/.test(c)) return Response.json({ error: 'bad channel' }, { status: 400 });
      const CID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // Twitch's public web client id
      const gql = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'client-id': CID, 'content-type': 'application/json' },
        // c is [\w]{2,25}, so it cannot break out of the quotes
        body: JSON.stringify({ query: `{ streamPlaybackAccessToken(channelName: "${c}", params: {platform: "web", playerBackend: "mediaplayer", playerType: "embed"}) { value signature } }` }),
      });
      const tok = (await gql.json().catch(() => null))?.data?.streamPlaybackAccessToken;
      if (!tok) return Response.json({ error: 'no token' }, { status: 502 });
      const u = new URL(`https://usher.ttvnw.net/api/channel/hls/${c}.m3u8`);
      for (const [k, v] of Object.entries({
        client_id: CID, token: tok.value, sig: tok.signature,
        supported_codecs: 'av1,h264', allow_source: 'true', allow_audio_only: 'true',
        player: 'twitchweb', p: String(Math.floor(Math.random() * 1e6)),
      })) u.searchParams.set(k, v);
      const res = await fetch(u); // 404 = channel offline; the client falls back to Twitch's embed
      return new Response(res.body, {
        status: res.status,
        headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' },
      });
    }
    if (url.pathname !== '/api/yt') return new Response('Not found', { status: 404 });

    // Strict allowlist: the handle is the only user input that reaches the upstream URL.
    const handle = url.searchParams.get('handle') ?? '';
    if (!/^[\w.-]{3,30}$/.test(handle)) return Response.json({ error: 'bad handle' }, { status: 400 });

    const res = await fetch(`https://www.youtube.com/@${handle}/live`, {
      // SOCS skips the EU consent interstitial, which has no channel data in it.
      headers: { cookie: 'SOCS=CAI', 'accept-language': 'en', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' },
    });
    if (!res.ok) return Response.json({ error: 'not found' }, { status: 404 });

    // shortcut: scrapes ids out of the page, breaks if YouTube changes it; upgrade to the Data API (needs a key)
    // A live channel answers with its watch page. From Cloudflare's network that page often comes without
    // its title and canonical link (seen 2026-11-18), so currentVideoEndpoint is the fallback; an offline
    // channel answers with its channel page, which has neither.
    const html = await res.text();
    const videoId = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1]
      ?? html.match(/"currentVideoEndpoint":.{0,400}?"videoId":"([\w-]{11})"/)?.[1];
    const channelId = html.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/)?.[1];
    if (!videoId && !channelId) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ videoId, channelId }, { headers: { 'cache-control': 'public, max-age=60' } });
  },
};
