// Static files in ./public are served by the platform before this runs.
// This Worker only answers /api/yt, which turns a YouTube @handle into what the page can embed:
// { videoId } when the channel is live, else { channelId }.
export default {
  async fetch(request) {
    const url = new URL(request.url);
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
