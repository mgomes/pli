import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { movies as sampleMovies, shows as sampleShows, severanceS2 } from './fixtures/library.mjs';

const plexPort = Number(process.env.PLI_FIXTURE_PORT || 18400);
const port = Number(process.env.PLI_PREVIEW_PORT || 18080);
const requests = [];
let deleted = new Set();
let watched = new Map();
let mode = '';
const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const attrs = values => Object.entries(values).map(([key,value]) => ` ${key}="${escape(value)}"`).join('');
const now = Math.floor(Date.now()/1000);
const movies = sampleMovies.map((m,i) => ({ ...m, addedAt: now - Math.floor(i/5)*86400 }));
const episode = (show, season, n) => ({ ...severanceS2[(n-1)%10], id: `${show.id}-${season}-${n}`, show, season, number:n });
const allEpisodes = show => [1,2].flatMap(season => Array.from({length:10},(_,i)=>episode(show,season,i+1)));
const video = (node, isEpisode = false) => {
  const duration = node.duration * 60000;
  const done = watched.get(node.id) ?? (node.status === 'watched');
  return `<Video${attrs({ratingKey:node.id, type:isEpisode?'episode':'movie', title:node.title,
    ...(isEpisode ? {grandparentRatingKey:node.show.id,grandparentTitle:node.show.title,parentRatingKey:`${node.show.id}-${node.season}`,parentIndex:node.season,index:node.number} : {year:node.year}),
    addedAt:node.addedAt || now,viewCount:done?1:0,viewOffset:watched.has(node.id)?0:Math.floor(duration*(node.progress||0)/100),duration,
    summary:node.summary || node.logline,rating:node.rating,audienceRating:node.audience,tagline:node.tagline,contentRating:node.contentRating,studio:'Plex Fixture'})}>
    ${(node.genres || []).map(tag=>`<Genre tag="${escape(tag)}"/>`).join('')}
    ${node.director?`<Director tag="${escape(node.director)}"/>`:''}
    ${(node.cast || []).map(tag=>`<Role tag="${escape(tag)}"/>`).join('')}
    <Media videoResolution="4k" audioCodec="truehd" audioChannels="8"><Part key="http://localhost:32400/library/parts/${node.id}/file.mkv?download=1"/></Media>
    <Marker type="intro" startTimeOffset="15000" endTimeOffset="75000"/>
    <Marker type="credits" startTimeOffset="${duration-60000}" endTimeOffset="${duration}" final="1"/>
  </Video>`;
};
const showXml = s => `<Directory${attrs({ratingKey:s.id,type:'show',title:s.title,summary:s.logline,leafCount:20,viewedLeafCount:Math.min(20,s.watched)})}/>`;
const list = (res, nodes, url, paginate = false) => {
  const offset = Number(url.searchParams.get('X-Plex-Container-Start') || 0);
  const size = paginate ? 7 : Number(url.searchParams.get('X-Plex-Container-Size') || nodes.length);
  res.end(`<MediaContainer friendlyName="Cinema test server" totalSize="${nodes.length}">${nodes.slice(offset,offset+size).join('')}</MediaContainer>`);
};
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://127.0.0.1:${plexPort}`);
  let body = '';
  for await (const chunk of req) body += chunk;
  if (url.pathname === '/_fixture/reset') { deleted = new Set(); watched = new Map(); mode = ''; requests.length = 0; res.end('{}'); return; }
  if (url.pathname === '/_fixture/requests') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(requests)); return; }
  if (url.pathname === '/_fixture/mode') { mode = url.searchParams.get('value') || ''; res.end('{}'); return; }
  requests.push({method:req.method,path:url.pathname,query:Object.fromEntries(url.searchParams),body});
  res.setHeader('Content-Type','application/xml');
  if (mode === 'offline') { res.statusCode = 503; res.end('unavailable'); return; }
  if (url.pathname === '/') { res.end('<MediaContainer friendlyName="Cinema test server"/>'); return; }
  if (url.pathname === '/library/sections') { list(res,mode === 'empty'?[]:['<Directory key="1" type="movie"/>','<Directory key="2" type="show"/>'],url); return; }
  if (url.pathname === '/library/sections/1/all') { list(res,movies.filter(m=>!deleted.has(m.id)).map(m=>video(m)),url,true); return; }
  if (url.pathname === '/library/sections/2/all') { list(res,sampleShows.filter(s=>!deleted.has(s.id)).map(showXml),url,true); return; }
  if (url.pathname === '/library/recentlyAdded') {
    const ids = ['m7','m20','m18','m9','m5','m6','m19','m17','m2','m11'];
    list(res,mode==='empty'?[]:ids.filter(id=>!deleted.has(id)).map(id=>video(movies.find(m=>m.id===id))),url); return;
  }
  if (url.pathname === '/library/onDeck') {
    list(res,mode==='empty'?[]:[video(episode(sampleShows[0],2,5),true),...['m13','m23','m3'].filter(id=>!deleted.has(id)).map(id=>video(movies.find(m=>m.id===id)))],url); return;
  }
  if (url.pathname === '/status/sessions') { res.end('<MediaContainer><Video title="Dune: Part Two" ratingKey="m7" sessionKey="session1"/></MediaContainer>'); return; }
  if (url.pathname.startsWith('/:/')) {
    const id = url.searchParams.get('key');
    if (url.pathname === '/:/scrobble') watched.set(id,true);
    if (url.pathname === '/:/unscrobble') watched.set(id,false);
    res.end('<MediaContainer/>'); return;
  }
  if (url.pathname === '/photo/test') {
    res.setHeader('Content-Type','image/png');
    res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTf8AAAAASUVORK5CYII=','base64')); return;
  }
  const match = url.pathname.match(/^\/library\/metadata\/([^/]+)(?:\/(children|allLeaves))?$/);
  if (match) {
    const [,id,child] = match;
    if (req.method === 'DELETE') { deleted.add(id); res.statusCode = 204; res.end(); return; }
    const movie = movies.find(m=>m.id===id);
    const show = sampleShows.find(s=>s.id===id);
    if (movie && !deleted.has(id)) { list(res,[video(movie)],url); return; }
    if (show && !deleted.has(id)) {
      if (child === 'children') list(res,[1,2].map(n=>`<Directory ratingKey="${id}-${n}" type="season" index="${n}" title="Season ${n}" leafCount="10" viewedLeafCount="4"/>`),url);
      else if (child === 'allLeaves') list(res,allEpisodes(show).map(e=>video(e,true)),url,true);
      else list(res,[showXml(show)],url);
      return;
    }
    const parts = id.split('-');
    const parent = sampleShows.find(s=>s.id===parts[0]);
    if (parent && parts.length === 2 && child === 'children') { list(res,Array.from({length:10},(_,i)=>video(episode(parent,Number(parts[1]),i+1),true)),url,true); return; }
    if (parent && parts.length === 3 && !(mode === 'missing-next' && parts[2] === '6')) { list(res,[video(episode(parent,Number(parts[1]),Number(parts[2])),true)],url); return; }
  }
  res.statusCode = 404; res.end('not found');
});

await new Promise(resolve => server.listen(plexPort,'127.0.0.1',resolve));
const dir = await mkdtemp(join(tmpdir(),'pli-preview-'));
const child = spawn(process.env.PLI_TEST_BIN || './target/debug/pli', {env:{...process.env,PLI_ADDR:`127.0.0.1:${port}`,PLI_DB_PATH:join(dir,'pli.db'),PLI_IMAGE_CACHE_TTL_SECS:'2'},stdio:['ignore','inherit','inherit']});
child.on('error',error=>{ console.error(error); process.exit(1); });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  child.kill('SIGTERM');
  server.close();
  await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit',resolve));
  await rm(dir,{recursive:true,force:true});
  process.exit(0);
}
process.on('SIGINT',close);
process.on('SIGTERM',close);
for (let attempt=0;attempt<100;attempt++) {
  try {
    const result = await fetch(`http://127.0.0.1:${port}/api/config`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'plex.base_url',value:`http://127.0.0.1:${plexPort}`})});
    if (result.ok) { console.log(`Fixture preview: http://127.0.0.1:${port}`); break; }
  } catch {}
  await new Promise(resolve=>setTimeout(resolve,100));
}
