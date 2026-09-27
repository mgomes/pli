import { test, expect } from '@playwright/test';

const fixture = 'http://127.0.0.1:18400';

test.beforeEach(async ({request}) => {
  await request.get(`${fixture}/_fixture/reset`);
  const response = await request.put('/api/config',{data:{key:'plex.base_url',value:fixture}});
  expect(response.ok()).toBeTruthy();
});

test('API preserves Plex browsing and playback contracts across pagination', async ({request}) => {
  const get = async path => { const r = await request.get(path); expect(r.ok(),await r.text()).toBeTruthy(); return r.json(); };
  expect((await get('/api/movies')).movies).toHaveLength(23);
  expect((await get('/api/tv/shows')).shows).toHaveLength(8);
  expect((await get('/api/tv/shows/s1/seasons')).seasons).toHaveLength(2);
  const episodes = (await get('/api/tv/seasons/s1-2/episodes?show_id=s1')).episodes;
  expect(episodes).toHaveLength(10);
  expect(episodes[4].title).toBe("Trojan's Horse");
  expect((await get('/api/continue-watching')).items).toHaveLength(4);
  const cold = await request.get('/api/recently-added');
  expect(cold.headers()['x-cache']).toBe('MISS');
  expect((await request.get('/api/recently-added')).headers()['x-cache']).toBe('HIT');
  const playback = await (await request.post('/api/play',{data:{type:'episode',id:'s1-2-5'}})).json();
  expect(playback.display_title).toBe("Severance · S02E05 · Trojan's Horse");
  expect(new URL(playback.stream_url).origin).toBe(fixture);
  expect(playback.view_offset_ms).toBe(966000);
  const context = await get('/api/player/context?rating_key=s1-2-5');
  expect(context.markers).toEqual([{type:'intro',start_ms:15000,end_ms:75000,final:false},{type:'credits',start_ms:2700000,end_ms:2760000,final:true}]);
  expect(context.next.rating_key).toBe('s1-2-6');
  await request.get(`${fixture}/_fixture/mode?value=missing-next`);
  const degraded = await get('/api/player/context?rating_key=s1-2-5');
  expect(degraded.next).toBeNull();
  expect(degraded.markers).toHaveLength(2);
  expect((await get('/api/sessions')).sessions[0].session_key).toBe('session1');
  const calls = await (await request.get(`${fixture}/_fixture/requests`)).json();
  expect(calls.filter(c=>c.path === '/library/metadata/s1-2-5').every(c=>c.query.includeMarkers === '1')).toBeTruthy();
  expect(calls.some(c=>c.query['X-Plex-Container-Start'] === '14')).toBeTruthy();
});

test('writes invalidate caches and reject invalid inputs', async ({request}) => {
  await request.get('/api/recently-added');
  expect((await request.post('/api/watched',{data:{rating_key:'m7',watched:false}})).ok()).toBeTruthy();
  const movie = (await (await request.get('/api/movies')).json()).movies.find(m=>m.id==='m7');
  expect(movie.watched).toBe(false);
  expect(movie.view_offset).toBe(0);
  expect((await request.get('/api/recently-added')).headers()['x-cache']).toBe('MISS');
  expect((await request.post('/api/timeline',{data:{rating_key:'m7',time_ms:950,duration_ms:1000,state:'playing'}})).ok()).toBeTruthy();
  const calls = await (await request.get(`${fixture}/_fixture/requests`)).json();
  expect(calls.some(c=>c.path==='/:/progress' && c.query.time==='0')).toBeTruthy();
  expect(calls.some(c=>c.path==='/:/scrobble' && c.query.key==='m7')).toBeTruthy();
  expect((await request.delete('/api/media/m7')).ok()).toBeTruthy();
  expect((await (await request.get('/api/movies')).json()).movies).toHaveLength(22);
  for (const data of [{key:'unknown',value:'x'}, {key:'plex.base_url',value:'file:///tmp/data'}, {key:'player.default',value:'shell'}]) {
    expect((await request.put('/api/config',{data})).status()).toBe(400);
  }
  expect((await request.post('/api/play',{data:{type:'movie',id:'../settings'}})).status()).toBe(400);
  expect((await request.post('/api/timeline',{data:{rating_key:'m1',time_ms:-1,duration_ms:1000,state:'playing'}})).status()).toBe(400);
  const malformed = await request.post('/api/play',{data:'{',headers:{'Content-Type':'application/json'}});
  expect(malformed.status()).toBe(400);
  expect((await malformed.json()).error).toBeTruthy();
  expect((await request.get('/api/plex/image?path=https%3A%2F%2Fexample.com')).status()).toBe(400);
  const image = await request.get('/api/plex/image?path=%2Fphoto%2Ftest');
  expect(image.headers()['content-type']).toBe('image/png');
  expect(image.headers()['x-cache']).toBe('MISS');
  expect((await image.body()).length).toBeGreaterThan(50);
  expect((await request.get('/api/plex/image?path=%2Fphoto%2Ftest')).headers()['x-cache']).toBe('HIT');
  const after = await (await request.get(`${fixture}/_fixture/requests`)).json();
  expect(after.filter(c=>c.path==='/photo/test')).toHaveLength(1);
  await expect.poll(async () => (await request.get('/api/plex/image?path=%2Fphoto%2Ftest')).headers()['x-cache'],{intervals:[250],timeout:5000}).toBe('MISS');
  const refreshed = await (await request.get(`${fixture}/_fixture/requests`)).json();
  expect(refreshed.filter(c=>c.path==='/photo/test')).toHaveLength(2);
});

test('Cinema home, hero controls, movies, filters, details and history', async ({page}) => {
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.hero-copy h1')).toHaveText('Dune: Part Two');
  await expect(page.locator('.cw-card')).toHaveCount(4);
  await page.getByRole('button',{name:'Next featured title'}).click();
  await expect(page.locator('.hero-copy h1')).toHaveText('Sinners');
  await page.getByRole('button',{name:'Previous featured title'}).click();
  await page.getByRole('button',{name:'More about this film'}).click();
  await expect(page).toHaveURL(/\/movies\/m7$/);
  await expect(page.locator('.movie-detail-title')).toHaveText('Dune: Part Two');
  await page.getByRole('button',{name:'Back to Movies'}).click();
  await expect(page.locator('.movie-card')).toHaveCount(23);
  await page.locator('[data-watch-filter="unwatched"]').click();
  const unwatched = await page.locator('.movie-card').count();
  expect(unwatched).toBeGreaterThan(0);
  expect(unwatched).toBeLessThan(23);
  await page.selectOption('#movie-genre','Horror');
  await expect(page.locator('.movie-card')).toHaveCount(2);
  await page.selectOption('#movie-runtime','short');
  await expect(page.locator('.movie-card')).toHaveCount(0);
  await page.selectOption('#movie-runtime','all');
  await page.selectOption('#movie-genre','');
  await page.locator('[data-watch-filter="all"]').click();
  await page.selectOption('#movie-sort','title-desc');
  await expect(page.locator('.movie-card').first()).toHaveAttribute('data-movie-id','m23');
  await page.locator('[data-movie-id="m3"]').click();
  await expect(page.locator('.movie-detail-title')).toHaveText('Arrival');
  await page.reload();
  await expect(page.locator('.movie-detail-title')).toHaveText('Arrival');
  await page.getByRole('button',{name:'Movies',exact:true}).click();
  await page.goBack();
  await expect(page.locator('.movie-detail-title')).toHaveText('Arrival');
  expect(errors).toEqual([]);
});

test('TV navigation, episode expansion and global search', async ({page}) => {
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/tv/s1/season/s1-2');
  await expect(page.locator('.tv-show-header')).toContainText('Severance');
  await expect(page.locator('.episode-item-wrapper')).toHaveCount(10);
  await page.locator('[data-episode-id="s1-2-5"] [data-episode-toggle]').click();
  await expect(page.locator('[data-episode-id="s1-2-5"]')).toHaveClass(/expanded/);
  await page.locator('[data-season-id="s1-1"]').click();
  await expect(page).toHaveURL(/\/tv\/s1\/season\/s1-1$/);
  await page.locator('[data-show-id="s3"]').click();
  await expect(page.locator('.tv-show-header')).toContainText('Shōgun');
  await page.getByRole('searchbox').fill('Denis Villeneuve');
  await expect(page.locator('.movie-card')).toHaveCount(3);
  await page.getByRole('searchbox').fill("Trojan's Horse");
  await expect(page.locator('.episode-search-item').first()).toBeVisible();
  await page.locator('[data-search-episode-id="s1-2-5"]').click();
  await expect(page).toHaveURL(/\/tv\/s1\/season\/s1-2$/);
  await expect(page.locator('[data-episode-id="s1-2-5"]')).toHaveClass(/episode-highlight/);
  expect(errors).toEqual([]);
});

test('settings, watched toggle and confirmed deletion work through the UI', async ({page,request}) => {
  await page.goto('/settings');
  await page.locator('#plex-token').fill('fixture-token');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('#settings-status')).toHaveText('Settings saved.');
  await page.getByRole('button',{name:'Test Connection'}).click();
  await expect(page.locator('#settings-status')).toContainText('Cinema test server');
  await page.reload();
  await expect(page.locator('#plex-token')).toHaveValue('fixture-token');
  await page.goto('/movies/m7');
  await page.getByRole('button',{name:'More options'}).click();
  await page.getByRole('button',{name:'Mark Unwatched',exact:true}).click();
  await expect(page.locator('.movie-detail-meta-line')).toContainText('Unwatched');
  await page.getByRole('button',{name:'More options'}).click();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'Delete Movie',exact:true}).click();
  await expect(page.locator('.movie-detail-title')).toHaveText('Dune: Part Two');
  await page.getByRole('button',{name:'More options'}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Delete Movie',exact:true}).click();
  await expect(page).toHaveURL(/\/movies$/);
  await expect(page.locator('.movie-card')).toHaveCount(22);
  const calls = await (await request.get(`${fixture}/_fixture/requests`)).json();
  expect(calls.filter(c=>c.method==='DELETE' && c.path==='/library/metadata/m7')).toHaveLength(1);
});

test('episode indexing survives navigation while a show request is pending', async ({page}) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let started;
  const indexing = new Promise(resolve => { started = resolve; });
  await page.route('**/api/tv/shows/s3/seasons', async route => {
    started();
    await pending;
    await route.continue();
  });
  await page.goto('/movies');
  await expect(page.locator('.movie-card')).toHaveCount(23);
  const lastSeason = page.waitForResponse('**/api/tv/seasons/s8-2/episodes?*');
  await page.getByRole('searchbox').fill("Trojan's Horse");
  await indexing;
  await page.getByRole('button',{name:'Movies',exact:true}).click();
  await expect(page.locator('.movie-card')).toHaveCount(23);
  release();
  await lastSeason;
  await page.getByRole('searchbox').fill("Trojan's Horse");
  await expect(page.locator('[data-search-episode-id="s3-2-5"]')).toBeVisible();
});

test('episode search retries a season that failed during indexing', async ({page}) => {
  let fail = true;
  await page.route('**/api/tv/seasons/s3-2/episodes?*', async route => {
    if (fail) {
      fail = false;
      await route.fulfill({status:503,json:{error:'Temporary episode lookup failure'}});
    } else {
      await route.continue();
    }
  });
  await page.goto('/movies');
  await page.getByRole('searchbox').fill("Trojan's Horse");
  await expect(page.locator('#notification')).toHaveText('Temporary episode lookup failure');
  await page.getByRole('searchbox').fill('Trojan');
  await expect(page.locator('[data-search-episode-id="s3-2-5"]')).toBeVisible();
});

test('Plex sign-in survives blocked popups and saves the authorized token', async ({page,request}) => {
  await page.addInitScript(() => { window.open = () => null; });
  await page.route('**/api/plex/auth/start', route => route.fulfill({json:{pin_id:123,code:'test-code',auth_url:'https://app.plex.tv/auth#?test'}}));
  let polls = 0;
  await page.route('**/api/plex/auth/poll/**', async route => {
    polls++;
    if (polls > 1) await request.put('/api/config',{data:{key:'plex.token',value:'new-fixture-token'}});
    await route.fulfill({json:{done:polls > 1}});
  });
  await page.goto('/settings');
  await page.locator('#plex-url').fill('http://darwin:32400');
  await page.locator('#plex-auth-btn').click();
  await expect(page.getByRole('link',{name:'Open Plex sign-in'})).toHaveAttribute('href','https://app.plex.tv/auth#?test');
  await expect(page.locator('#plex-auth-btn')).toBeDisabled();
  await expect(page.locator('#settings-status')).toContainText('Authenticated successfully.',{timeout:12000});
  await expect(page.locator('#plex-token')).toHaveValue('new-fixture-token');
  await expect(page.locator('#plex-url')).toHaveValue('http://darwin:32400');
  await expect(page.locator('#plex-auth-btn')).toBeEnabled();
  await page.reload();
  await expect(page.locator('#plex-token')).toHaveValue('new-fixture-token');
});

test('one settings Save rejects invalid batches without partial changes', async ({page,request}) => {
  await request.put('/api/config',{data:{key:'plex.token',value:'original-fixture-token'}});
  await request.put('/api/config',{data:{key:'player.default',value:'iina'}});
  await page.goto('/settings');
  await page.locator('#plex-token').fill('replacement-fixture-token');
  await page.selectOption('#player-default','vlc');
  await page.locator('#plex-url').fill('file:///invalid-server');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('#settings-status')).toHaveClass('settings-status error');
  const config = async () => Object.fromEntries((await (await request.get('/api/config')).json()).configs.map(c=>[c.key,c.value]));
  expect(await config()).toMatchObject({'plex.base_url':fixture,'plex.token':'original-fixture-token','player.default':'iina'});
  await page.reload();
  await expect(page.locator('#plex-token')).toHaveValue('original-fixture-token');
  await expect(page.locator('#player-default')).toHaveValue('iina');
  await page.locator('#plex-token').fill('replacement-fixture-token');
  await page.selectOption('#player-default','vlc');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('#settings-status')).toHaveText('Settings saved.');
  expect(await config()).toMatchObject({'plex.base_url':fixture,'plex.token':'replacement-fixture-token','player.default':'vlc'});
});

test('search expands smoothly on focus and respects reduced motion', async ({page}) => {
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/settings');
  const search = page.getByRole('searchbox');
  expect((await search.boundingBox()).width).toBe(260);
  await expect(search).toHaveCSS('transition-duration','0.18s, 0.24s, 0.18s');
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await expect.poll(async () => (await search.boundingBox()).width).toBe(320);
  await expect(search).toHaveCSS('border-color','rgb(242, 169, 59)');
  await search.blur();
  await expect.poll(async () => (await search.boundingBox()).width).toBe(260);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(search).toHaveCSS('transition-duration','0s');
  await page.setViewportSize({width:390,height:844});
  await search.focus();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('offline and empty libraries remain usable', async ({page,request}) => {
  await request.get(`${fixture}/_fixture/mode?value=offline`);
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Open settings'})).toBeVisible();
  await page.getByRole('button',{name:'Open settings'}).click();
  await expect(page.locator('#plex-url')).toBeVisible();
  await request.get(`${fixture}/_fixture/mode?value=empty`);
  await page.getByRole('button',{name:'Recently Added',exact:true}).click();
  await expect(page.locator('.empty-state')).toContainText('A little room for something great.');
  await page.getByRole('button',{name:'Movies',exact:true}).click();
  await expect(page.locator('.empty-state')).toHaveText('No movies found.');
});

test('desktop and mobile views fit the viewport and retain keyboard navigation', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.hero-copy h1')).toBeVisible();
  await page.screenshot({path:'docs/screenshots/cinema-home.jpg',type:'jpeg',quality:85,fullPage:true});
  await page.goto('/movies');
  await expect(page.locator('.movie-card')).toHaveCount(23);
  await page.screenshot({path:'docs/screenshots/cinema-movies.jpg',type:'jpeg',quality:85,fullPage:true});
  await page.goto('/tv/s1/season/s1-2');
  await expect(page.locator('.episode-item-wrapper')).toHaveCount(10);
  await page.screenshot({path:'docs/screenshots/cinema-tv.jpg',type:'jpeg',quality:85,fullPage:true});
  await page.goto('/movies/m7');
  await expect(page.locator('.movie-detail-title')).toBeVisible();
  await page.screenshot({path:'docs/screenshots/cinema-detail.jpg',type:'jpeg',quality:85,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  for (const path of ['/','/movies','/tv/s1/season/s1-2','/movies/m7','/settings']) {
    await page.goto(path);
    await expect(page.locator('.empty-state')).toHaveCount(0);
    const overflow = await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>window.innerWidth+1).slice(0,8).map(e=>e.className)}));
    expect(overflow.scroll, `${path}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.width+1);
  }
  await page.goto('/');
  await expect(page.locator('.hero-copy h1')).toBeVisible();
  await page.screenshot({path:'docs/screenshots/cinema-mobile.jpg',type:'jpeg',quality:85,fullPage:true});
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();
});
