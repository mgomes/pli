import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerURL } from '../static/player.js';

test('IINA links preserve stream authorization, episode titles, resume time, and callbacks', () => {
  const handoff = new URL(playerURL({
    stream_url:'http://darwin:32400/library/parts/42/file.mkv?download=1&X-Plex-Token=fixture%2Btoken',
    display_title:"Severance · S02E05 · Trojan's Horse",
    rating_key:'42', duration_ms:2760000, view_offset_ms:966000,
  }, 'iina', 'http://localhost:8080', 123));
  assert.equal(handoff.protocol, 'iina:');
  assert.equal(handoff.hostname, 'weblink');
  const stream = new URL(handoff.searchParams.get('url'));
  assert.equal(stream.origin, 'http://darwin:32400');
  assert.equal(stream.pathname, '/library/parts/42/file.mkv');
  assert.deepEqual(Object.fromEntries(stream.searchParams), {
    download:'1', 'X-Plex-Token':'fixture+token',
    'X-Pli-Display-Title':"Severance · S02E05 · Trojan's Horse",
    'X-Pli-Rating-Key':'42', 'X-Pli-Duration':'2760000', 'X-Pli-Start':'966000',
    'X-Pli-Callback':'http://localhost:8080/api/timeline', 'X-Pli-Session':'123',
  });
});

test('VLC links start unwatched titles at zero', () => {
  const link = playerURL({stream_url:'http://localhost:32400/file'}, 'vlc', 'http://localhost:8080', 456);
  assert.ok(link.startsWith('vlc://http://localhost:32400/file?'));
  const stream = new URL(link.slice('vlc://'.length));
  assert.equal(stream.searchParams.get('X-Pli-Start'), '0');
  assert.equal(stream.searchParams.get('X-Pli-Session'), '456');
});
