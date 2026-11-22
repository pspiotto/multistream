// node --test. Upstream sites are stubbed: these check what the Worker lets through and what it
// makes of the answers, not what Twitch, Kick or YouTube do today.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

let calls, upstream;
beforeEach(() => {
  calls = [];
  upstream = () => new Response('#EXTM3U');
  globalThis.fetch = async (u, init) => { calls.push(String(u)); return upstream(String(u), init); };
});
const get = (path, env) => worker.fetch(new Request('https://x.test' + path), env);
const enc = encodeURIComponent;

test('/api/hls relays only Kick playlist URLs', async () => {
  const ok = 'https://abc123.us-west-2.playback.live-video.net/api/video/v1/us-west-2.1.channel.x.m3u8?token=a.b-c_d';
  assert.equal((await get('/api/hls?u=' + enc(ok))).status, 200);
  assert.deepEqual(calls, [ok]);
  for (const u of [
    'https://example.com/a.m3u8?token=x',
    'http://abc123.us-west-2.playback.live-video.net/api/video/v1/x.m3u8?token=x',
    'https://abc123.us-west-2.playback.live-video.net.evil.com/api/video/v1/x.m3u8?token=x',
    'https://evil.com/?https://abc123.us-west-2.playback.live-video.net/api/video/v1/x.m3u8?token=x',
    ok + '&next=https://evil.com',
    '',
  ]) assert.equal((await get('/api/hls?u=' + enc(u))).status, 400, u);
  assert.equal(calls.length, 1);
});

test('/api/tw?v= relays only Twitch variant playlists', async () => {
  const ok = 'https://use14.playlist.ttvnw.net/v1/playlist/Cabc-DEF_123.m3u8';
  assert.equal((await get('/api/tw?v=' + enc(ok))).status, 200);
  for (const u of [
    'https://evil.com/v1/playlist/x.m3u8',
    'https://a.playlist.ttvnw.net.evil.com/v1/playlist/x.m3u8',
    'https://a.playlist.ttvnw.net/v1/playlist/../../x.m3u8',
    'https://a.playlist.ttvnw.net/v1/playlist/x.m3u8?redirect=1',
    '',
  ]) assert.equal((await get('/api/tw?v=' + enc(u))).status, 400, u);
  assert.equal(calls.length, 1);
});

test('/api/tw?c= rejects bad names, mints an embed token, relays usher', async () => {
  for (const c of ['', 'a', 'a"b', 'x'.repeat(26), 'a/b']) assert.equal((await get('/api/tw?c=' + enc(c))).status, 400, c);
  assert.equal(calls.length, 0);
  let body;
  upstream = (u, init) => u.includes('gql.twitch.tv')
    ? (body = init.body, Response.json({ data: { streamPlaybackAccessToken: { value: 'V', signature: 'S' } } }))
    : new Response('#EXTM3U', { status: 404 });
  const res = await get('/api/tw?c=monstercat');
  assert.equal(res.status, 404); // offline is passed on as usher said it
  assert.match(body, /playerType: \\"embed\\"/);
  assert.match(calls[1], /^https:\/\/usher\.ttvnw\.net\/api\/channel\/hls\/monstercat\.m3u8\?.*token=V&sig=S/);
  upstream = () => Response.json({ errors: [{}] });
  assert.equal((await get('/api/tw?c=monstercat')).status, 502);
});

test('/api/live answers per channel from one request', async () => {
  for (const t of ['', 'a"b', 'ok,b ad', Array(51).fill('name').join(',')]) assert.equal((await get('/api/live?t=' + enc(t))).status, 400, t);
  upstream = () => Response.json({ data: { u0: { stream: { id: '1' } }, u1: { stream: null }, u2: null } });
  assert.deepEqual(await (await get('/api/live?t=on,off,gone')).json(), { on: true, off: false, gone: false });
  assert.equal(calls.length, 1);
});

test('/api/yt validates ids and reads the page', async () => {
  for (const p of ['handle=', 'handle=a/b', 'handle=' + 'x'.repeat(31), 'channel=UCshort', 'channel=' + 'x'.repeat(24), 'video=short', 'video=' + enc('aaaaaaaaaa/')]) {
    assert.equal((await get('/api/yt?' + p)).status, 400, p);
  }
  assert.equal(calls.length, 0);
  const UC = 'UC' + 'a'.repeat(22), OTHER = 'UC' + 'b'.repeat(22);

  // live channel, full watch page
  upstream = () => new Response(`<link rel="canonical" href="https://www.youtube.com/watch?v=AAAAAAAAAAA">"channelId":"${OTHER}" "externalChannelId":"${UC}" "ownerProfileUrl":"http://www.youtube.com/@Some.Name" "isLiveNow":true`);
  assert.deepEqual(await (await get('/api/yt?handle=some.name')).json(), { videoId: 'AAAAAAAAAAA', channelId: UC, handle: 'some.name', live: true });
  assert.equal(calls[0], 'https://www.youtube.com/@some.name/live');

  // live channel, stripped page: no canonical, no live flag
  upstream = () => new Response(`"currentVideoEndpoint":{"x":1,"watchEndpoint":{"videoId":"BBBBBBBBBBB"}} "channelId":"${UC}"`);
  assert.deepEqual(await (await get('/api/yt?channel=' + UC)).json(), { videoId: 'BBBBBBBBBBB', channelId: UC, live: true });
  assert.equal(calls[1], `https://www.youtube.com/channel/${UC}/live`);

  // scheduled stream: a video id, but not live
  upstream = () => new Response(`<link rel="canonical" href="https://www.youtube.com/watch?v=CCCCCCCCCCC">"channelId":"${UC}" "isUpcoming":true`);
  assert.equal((await (await get('/api/yt?handle=abc')).json()).live, false);

  // offline channel: channel page, which lists other channels before its own id
  upstream = () => new Response(`"channelId":"${OTHER}" "externalId":"${UC}" "vanityChannelUrl":"http://www.youtube.com/@Abc"`);
  assert.deepEqual(await (await get('/api/yt?handle=abc')).json(), { channelId: UC, handle: 'abc', live: false });

  // a video that is not live says so, and a page without the flag is not assumed live
  upstream = () => new Response(`"videoDetails":{"videoId":"DDDDDDDDDDD" "externalChannelId":"${UC}" "ownerProfileUrl":"http://www.youtube.com/@Abc"`);
  assert.deepEqual(await (await get('/api/yt?video=DDDDDDDDDDD')).json(), { videoId: 'DDDDDDDDDDD', channelId: UC, handle: 'abc', live: false });

  // a video page that came back stripped: the channel is still there, live is unknown
  upstream = () => new Response(`"channelId":"${UC}"`);
  const stripped = await get('/api/yt?video=DDDDDDDDDDD');
  assert.deepEqual(await stripped.json(), { channelId: UC, live: null });
  assert.equal(stripped.headers.get('cache-control'), 'no-store');

  upstream = () => new Response('nothing here');
  assert.equal((await get('/api/yt?handle=abc')).status, 404);
  upstream = () => new Response('', { status: 404 });
  assert.equal((await get('/api/yt?handle=abc')).status, 404);
});

test('rate limit covers lookups and spares the variant relay', async () => {
  const env = { RL: { limit: async () => ({ success: false }) } };
  assert.equal((await get('/api/yt?handle=abc', env)).status, 429);
  assert.equal((await get('/api/tw?c=monstercat', env)).status, 429);
  assert.equal((await get('/api/tw?v=' + enc('https://a.playlist.ttvnw.net/v1/playlist/x.m3u8'), env)).status, 200);
  assert.equal(calls.length, 1);
});

test('anything else is 404', async () => {
  assert.equal((await get('/api/nope')).status, 404);
});
