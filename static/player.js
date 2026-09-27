/** Builds the player handoff URL while preserving Plex credentials and pli callbacks. */
export function playerURL(playback, player, origin, session = Date.now()) {
  const stream = new URL(playback.stream_url);
  if (playback.display_title) stream.searchParams.set('X-Pli-Display-Title', playback.display_title);
  if (playback.rating_key) stream.searchParams.set('X-Pli-Rating-Key', playback.rating_key);
  if (playback.duration_ms) stream.searchParams.set('X-Pli-Duration', String(playback.duration_ms));
  stream.searchParams.set('X-Pli-Start', String(playback.view_offset_ms || 0));
  stream.searchParams.set('X-Pli-Callback', origin + '/api/timeline');
  stream.searchParams.set('X-Pli-Session', String(session));
  return player === 'vlc' ? 'vlc://' + stream : 'iina://weblink?url=' + encodeURIComponent(stream);
}
