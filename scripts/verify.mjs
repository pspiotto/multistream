// npm run verify [origin]: after a deploy, check that the live site serves this checkout's page and
// that every API endpoint answers. Exits non-zero when something is off.
import { readFile } from 'node:fs/promises';

const origin = (process.argv[2] ?? 'https://stream.spiot.to').replace(/\/$/, '');
let failed = 0;
const check = async (name, run) => {
  let note;
  try { note = await run(); } catch (e) { note = e; }
  const ok = !(note instanceof Error);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${note ? ': ' + (note.message ?? note) : ''}`);
};
const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const get = path => fetch(origin + path);

await check('page matches public/index.html', async () => {
  const [live, local] = await Promise.all([get('/').then(r => r.text()), readFile(new URL('../public/index.html', import.meta.url), 'utf8')]);
  need(live === local, 'the live page differs from the local file');
});
await check('/api/yt?handle=', async () => {
  const r = await get('/api/yt?handle=lofigirl'), j = await r.json();
  need(r.ok && /^UC[\w-]{22}$/.test(j.channelId), `${r.status} ${JSON.stringify(j)}`);
  return j.live ? 'live, video ' + j.videoId : 'not live';
});
await check('/api/yt?channel=', async () => {
  const r = await get('/api/yt?channel=UCSJ4gkVC6NrvII8umztf0Ow'), j = await r.json();
  need(r.ok && j.channelId === 'UCSJ4gkVC6NrvII8umztf0Ow', `${r.status} ${JSON.stringify(j)}`);
});
await check('/api/yt?video=', async () => {
  const r = await get('/api/yt?video=jfKfPfyJRdk'), j = await r.json();
  need(r.ok && j.channelId, `${r.status} ${JSON.stringify(j)}`);
  return j.handle ? '@' + j.handle : 'no handle in the page (channel id only)';
});
let liveNow;
await check('/api/live', async () => {
  const r = await get('/api/live?t=monstercat'), j = await r.json();
  need(r.ok && typeof j.monstercat === 'boolean', `${r.status} ${JSON.stringify(j)}`);
  liveNow = j.monstercat;
  return 'monstercat is ' + (liveNow ? 'live' : 'offline');
});
await check('/api/tw?c=', async () => {
  const r = await get('/api/tw?c=monstercat');
  need(r.status === (liveNow ? 200 : 404), `expected ${liveNow ? 200 : 404}, got ${r.status}`);
  if (r.ok) need((await r.text()).startsWith('#EXTM3U'), 'not a playlist');
});
await check('/api/tw?v= refuses other hosts', async () => need((await get('/api/tw?v=https://example.com/x.m3u8')).status === 400, 'not refused'));
await check('/api/hls refuses other hosts', async () => need((await get('/api/hls?u=https://example.com/x.m3u8')).status === 400, 'not refused'));
process.exit(failed ? 1 : 0);
