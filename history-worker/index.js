// flight-history: records the live feed of flight-tracker-india every 10 minutes into D1,
// and serves /flight?cs=IGO542Y&days=7 and /airport?icao=VIDP&day=2026-10-08 (CORS open for reads).
// Free plan budget: 1 multi-row upsert per run (~1 row written per aircraft), <=30 adsbdb lookups per run.
// All SQL uses bound params; bulk rows travel as one JSON param expanded by json_each (D1: 100 params/query max).
const ROUTE_TTL = 3 * 86400, SHARE_TTL = 7 * 86400, FLIGHT_DAYS = 30;
const MAX_SHARES = 5000, MAX_PTS = 80000, CREATES_PER_HOUR = 6;   // 80k pts = 1 Hz for 22 h (long-haul safe)
// deployment-specific settings come from wrangler vars: FEED_URL (your app's /api/flights?rec=1), ALLOWED_ORIGINS (comma list)
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const originOk = (env, o) => LOCAL.test(o) || String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).includes(o);
const clean = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
const nul = s => s ? clean(s) : null;
const istDay = t => new Date((t + 5.5 * 3600) * 1000).toISOString().slice(0, 10);
const cols = n => Array.from({length: n}, (_, i) => `json_extract(value, '$[${i}]')`);
const enc = new TextEncoder(), sha = s => crypto.subtle.digest('SHA-256', enc.encode(s));
// constant-time key check on SHA-256 digests (equal length); keys travel only in the X-Key header, never the URL
async function keyOk(given, want) {
  if (!given || !want) return false;
  const [a, b] = await Promise.all([sha(given), sha(want)]);
  return crypto.subtle.timingSafeEqual(a, b);
}
const keyOf = req => req.headers.get('X-Key') || '';

async function record(env) {
  const now = Math.floor(Date.now() / 1000);
  if (!env.FEED_URL) throw new Error('FEED_URL not set');
  const r = await fetch(env.FEED_URL, {headers: {'User-Agent': 'flight-history-recorder'}});
  if (!r.ok) throw new Error('feed ' + r.status);
  const {ac} = await r.json();
  const flights = (Array.isArray(ac) ? ac : []).filter(a => a.flight && /^[A-Z0-9]{3,8}$/.test(String(a.flight).trim()) &&
    Number.isFinite(+a.lat) && Number.isFinite(+a.lon));
  // known routes
  const known = new Map();
  const {results} = await env.DB.prepare('SELECT cs, o, d FROM routes WHERE t > ?').bind(now - ROUTE_TTL).all();
  for (const x of results) known.set(x.cs, x);
  // look up a few missing routes (adsbdb), airborne first
  const missing = [...new Set(flights.filter(a => !known.has(clean(a.flight))).sort((a, b) => (a.ground ? 1 : 0) - (b.ground ? 1 : 0)).map(a => clean(a.flight)))].slice(0, 30);
  const found = await Promise.all(missing.map(async cs => {
    try {
      const res = await fetch('https://api.adsbdb.com/v0/callsign/' + cs);
      const j = res.ok ? await res.json() : null, fr = j && j.response && j.response.flightroute;
      return {cs, o: fr ? nul(fr.origin.icao_code) : null, d: fr ? nul(fr.destination.icao_code) : null};
    } catch (e) { return null; }
  }));
  const newRoutes = found.filter(Boolean);
  for (const x of newRoutes) known.set(x.cs, x);
  const stmts = [];
  if (newRoutes.length) stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO routes (cs, o, d, t) SELECT ${cols(3)}, ? FROM json_each(?)`)
    .bind(now, JSON.stringify(newRoutes.map(x => [x.cs, x.o, x.d]))));
  // one multi-row upsert: append a track point per aircraft
  const day = istDay(now);
  const rows = flights.map(a => {
    const cs = clean(a.flight), hex = String(a.hex).toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 6), rt = known.get(cs) || {};
    const ts = Math.round(+a.ts || now);
    const pt = `${ts},${(+a.lat).toFixed(3)},${(+a.lon).toFixed(3)},${a.ground ? 0 : Math.round(+a.alt || 0)}`;
    return [`${day}|${cs}|${hex}`, day, cs, hex, nul(a.reg), nul(a.type), nul(rt.o), nul(rt.d), ts, pt];
  });
  const c = cols(10);
  // WHERE true: required so SQLite does not read ON CONFLICT as a join clause after INSERT ... SELECT
  if (rows.length) stmts.push(env.DB.prepare(`INSERT INTO flights (key, day, cs, hex, reg, type, o, d, first, last, track)
    SELECT ${c.slice(0, 9).join(', ')}, ${c[8]}, ${c[9]} FROM json_each(?) WHERE true
    ON CONFLICT(key) DO UPDATE SET last = excluded.last, track = flights.track || ';' || excluded.track,
      reg = COALESCE(flights.reg, excluded.reg), type = COALESCE(flights.type, excluded.type),
      o = COALESCE(flights.o, excluded.o), d = COALESCE(flights.d, excluded.d)`).bind(JSON.stringify(rows)));
  stmts.push(env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('since', ?)").bind(new Date(now * 1000).toISOString()));
  stmts.push(env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('last_run', ?)").bind(`${now}|${rows.length}|${newRoutes.length}`));
  await env.DB.batch(stmts);
  return {aircraft: rows.length, routes_added: newRoutes.length};
}

// housekeeping: prune rate-limit buckets every run; hourly purge old shares/flights + cache the row count for /status
async function tidy(env) {
  const now = Math.floor(Date.now() / 1000), stmts = [env.DB.prepare('DELETE FROM rl WHERE t < ?').bind(Math.floor(now / 3600) - 2)];
  if (new Date().getUTCMinutes() < 10) {
    const old = now - SHARE_TTL;
    stmts.push(env.DB.prepare('DELETE FROM share_pts WHERE id IN (SELECT id FROM share WHERE created < ?)').bind(old),
      env.DB.prepare('DELETE FROM share_cnt WHERE id IN (SELECT id FROM share WHERE created < ?)').bind(old),
      env.DB.prepare('DELETE FROM share WHERE created < ?').bind(old),
      env.DB.prepare('DELETE FROM flights WHERE day < ?').bind(istDay(now - FLIGHT_DAYS * 86400)),
      env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('count', (SELECT COUNT(*) FROM flights))"));
  }
  await env.DB.batch(stmts);
}

const base = {'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff'};
const cors = {...base, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60'};
const json = (o, s = 200, h = cors) => new Response(JSON.stringify(o), {status: s, headers: h});
const parseTrack = t => (t || '').split(';').filter(Boolean).map(p => p.split(',').map(Number));
// short edge cache for public GETs, keyed on the validated params only (random params can't bust it).
// Note: Cache API is a no-op on *.workers.dev; it starts working if the worker gets a custom domain.
async function cached(ctx, key, ttl, make) {
  const k = new Request('https://cache.flight-history/' + key), hit = await caches.default.match(k).catch(() => null);
  if (hit) return hit;
  const res = await make();
  if (res.status === 200) { res.headers.set('Cache-Control', `public, max-age=${ttl}`); ctx.waitUntil(caches.default.put(k, res.clone()).catch(() => {})); }
  return res;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(record(env).catch(e => console.error('record', e)).finally(() => tidy(env))); },
  async fetch(req, env, ctx) {
    const u = new URL(req.url), p = u.searchParams;
    if (u.pathname === '/opensky' || u.pathname === '/ingest/opensky') return this.relay(req, env, u, p, ctx);
    if (u.pathname.startsWith('/share')) return this.share(req, env, u, p);
    const since = async () => (await env.DB.prepare("SELECT v FROM meta WHERE k = 'since'").first())?.v;
    if (u.pathname === '/flight') {
      const cs = clean(p.get('cs')), days = Math.max(1, Math.min(Math.floor(+p.get('days')) || 7, 30));
      if (!cs) return json({error: 'cs required'}, 400);
      return cached(ctx, `flight/${cs}/${days}`, 60, async () => {
        const from = istDay(Date.now() / 1000 - days * 86400);
        const {results} = await env.DB.prepare('SELECT day, cs, hex, reg, type, o, d, first, last, track FROM flights WHERE cs = ? AND day >= ? ORDER BY first DESC LIMIT 30').bind(cs, from).all();
        return json({since: await since(), flights: results.map(r => ({...r, track: parseTrack(r.track)}))});
      });
    }
    if (u.pathname === '/airport') {
      const icao = clean(p.get('icao')).slice(0, 4), today = istDay(Date.now() / 1000), d = p.get('day') || '';
      const day = /^\d{4}-\d\d-\d\d$/.test(d) && d <= today && d >= istDay(Date.now() / 1000 - FLIGHT_DAYS * 86400) ? d : today;   // last 30 days only
      if (!/^[A-Z0-9]{3,4}$/.test(icao)) return json({error: 'icao required'}, 400);
      return cached(ctx, `airport/${icao}/${day}`, 60, async () => {
        const {results} = await env.DB.prepare('SELECT cs, hex, reg, type, o, d, first, last FROM flights WHERE day = ? AND o = ? UNION ALL SELECT cs, hex, reg, type, o, d, first, last FROM flights WHERE day = ? AND d = ? ORDER BY first').bind(day, icao, day, icao).all();
        return json({since: await since(), day, flights: results});
      });
    }
    if (u.pathname === '/status') return cached(ctx, 'status', 60, async () => {
      const {results} = await env.DB.prepare("SELECT k, v FROM meta WHERE k IN ('since', 'last_run', 'count')").all();
      const m = Object.fromEntries(results.map(r => [r.k, r.v]));
      return json({since: m.since, last_run: m.last_run, flights_recorded: m.count != null ? +m.count : null});   // count refreshed hourly by cron
    });
    if (u.pathname === '/run' && await keyOk(keyOf(req), env.RUN_KEY)) return json(await record(env), 200, {...base, 'Cache-Control': 'no-store'});
    return json({error: 'not found', endpoints: ['/flight?cs=', '/airport?icao=&day=', '/status', '/opensky']}, 404);
  },
  // ---------- live GPS sharing: a passenger's phone posts its GPS fixes, anyone with the link can watch ----------
  async share(req, env, u, p) {
    const origin = req.headers.get('Origin') || '', okOrigin = originOk(env, origin);
    const hdr = {...base, 'Access-Control-Allow-Origin': okOrigin ? origin : 'https://blackrhino.in', 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Key', 'Cache-Control': 'no-store'};
    const out = (o, s = 200) => new Response(JSON.stringify(o), {status: s, headers: hdr});
    if (req.method === 'OPTIONS') return new Response(null, {headers: hdr});
    if (req.method === 'POST' && origin && !okOrigin) return out({error: 'origin not allowed'}, 403);
    const now = Date.now() / 1000 | 0;
    const parts = u.pathname.split('/').filter(Boolean);   // ['share'] | ['share', id] | ['share', id, 'points'|'meta']
    const rnd = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
    const body = async (max, def) => {   // size-capped JSON body
      if (+(req.headers.get('Content-Length') || 0) > max) return def;
      const t = await req.text().catch(() => '');
      if (t.length > max) return def;
      try { return JSON.parse(t); } catch (e) { return def; }
    };
    if (parts.length === 1 && req.method === 'POST') {          // create
      // per-IP limit: one D1 write per create (rl row = kind|ip|hour bucket, pruned by cron)
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown', hr = Math.floor(now / 3600);
      const hit = await env.DB.prepare('INSERT INTO rl (k, t, n) VALUES (?, ?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n').bind(`c|${ip}|${hr}`, hr).first();
      if ((hit?.n || 0) > CREATES_PER_HOUR) return out({error: 'too many shares, try later'}, 429);
      const active = (await env.DB.prepare('SELECT COUNT(*) AS n FROM share WHERE created > ?').bind(now - SHARE_TTL).first())?.n || 0;
      if (active >= MAX_SHARES) return out({error: 'sharing is busy, try later'}, 503);
      const id = rnd(12), key = rnd(24), b = await body(2000, {}) || {};
      const meta = JSON.stringify({callsign: String(b.callsign || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8),
        name: String(b.name || '').slice(0, 40), note: String(b.note || '').slice(0, 80)});
      await env.DB.prepare('INSERT INTO share (id, key, created, last, meta) VALUES (?, ?, ?, 0, ?)').bind(id, key, now, meta).run();
      return out({id, key});
    }
    const id = (parts[1] || '').replace(/[^a-z0-9]/g, '').slice(0, 12);
    const row = id && await env.DB.prepare('SELECT key, created, last, meta FROM share WHERE id = ?').bind(id).first();
    if (!row) return out({error: 'unknown share'}, 404);
    if (req.method === 'POST') {
      if (!await keyOk(keyOf(req), row.key)) return out({error: 'forbidden'}, 403);
      if (parts[2] === 'meta') {
        const b = await body(2000, {}) || {};
        const m = {...JSON.parse(row.meta || '{}'), ...(b.callsign != null ? {callsign: String(b.callsign).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)} : {}),
          ...(b.name != null ? {name: String(b.name).slice(0, 40)} : {}), ...(b.ended != null ? {ended: !!b.ended} : {})};
        await env.DB.prepare('UPDATE share SET meta = ? WHERE id = ?').bind(JSON.stringify(m), id).run();
        return out({ok: true});
      }
      if (parts[2] === 'points') {
        const raw = await body(60000, null);
        if (!Array.isArray(raw)) return out({error: 'points must be an array'}, 400);
        const f = (x, lo, hi) => x != null && x !== '' && Number.isFinite(+x) && +x >= lo && +x <= hi ? +(+x).toFixed(6) : null;
        const pts = raw.slice(0, 300).filter(q => Array.isArray(q) && f(q[0], now - 86400, now + 86400) != null && f(q[1], -90, 90) != null && f(q[2], -180, 180) != null)
          .map(q => [+(+q[0]).toFixed(1), f(q[1], -90, 90), f(q[2], -180, 180), f(q[3], -1000, 20000), f(q[4], 0, 400), f(q[5], 0, 360), f(q[6], 0, 1e5)]);
        if (!pts.length) return out({ok: true, stored: 0});   // 200 so the phone drops junk/stale fixes instead of retrying forever
        // cap: MAX_PTS per share, and no faster than ~1.5 fixes/s since creation (phone records <=1.1 Hz, even offline)
        const have = (await env.DB.prepare('SELECT n FROM share_cnt WHERE id = ?').bind(id).first())?.n || 0;
        if (have + pts.length > Math.min(MAX_PTS, (now - row.created) * 1.5 + 600)) return out({ok: true, stored: 0, full: true});
        await env.DB.batch([env.DB.prepare(`INSERT INTO share_pts (id, ts, lat, lon, alt, spd, hdg, acc) SELECT ?, ${cols(7)} FROM json_each(?)`).bind(id, JSON.stringify(pts)),
          env.DB.prepare('INSERT INTO share_cnt (id, n) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET n = n + excluded.n').bind(id, pts.length),
          env.DB.prepare('UPDATE share SET last = MAX(last, ?) WHERE id = ?').bind(Math.max(...pts.map(q => q[0])), id)]);
        return out({ok: true, stored: pts.length});
      }
      return out({error: 'bad request'}, 400);
    }
    // GET: viewer (positions rounded to 4 decimals, ~11 m)
    const since = +p.get('since') || 0, r4 = x => x == null ? null : Math.round(x * 1e4) / 1e4;
    const {results} = await env.DB.prepare('SELECT ts, lat, lon, alt, spd, hdg, acc FROM share_pts WHERE id = ? AND ts > ? ORDER BY ts LIMIT 5000').bind(id, since).all();
    return out({id, created: row.created, last: row.last, meta: JSON.parse(row.meta || '{}'), pts: results.map(r => [r.ts, r4(r.lat), r4(r.lon), r.alt, r.spd, r.hdg, r.acc])});
  },
  async relay(req, env, u, p, ctx) {
    // OpenSky relay: a non-cloud machine (OpenSky blocks cloud IPs) pushes snapshots here; the app merges them
    if (u.pathname === '/ingest/opensky' && req.method === 'POST') {
      const nc = {...base, 'Cache-Control': 'no-store'};
      if (!await keyOk(keyOf(req), env.INGEST_KEY)) return json({error: 'forbidden'}, 403, nc);
      if (+(req.headers.get('Content-Length') || 0) > 1.5e6) return json({error: 'too large'}, 413, nc);
      const body = await req.text();
      if (body.length > 1.5e6) return json({error: 'too large'}, 413, nc);
      let j;
      try { j = JSON.parse(body); } catch (e) { return json({error: 'bad json'}, 400, nc); }
      if (!j || !Number.isFinite(j.t) || !Array.isArray(j.ac) || j.ac.length > 20000) return json({error: 'bad shape'}, 400, nc);
      await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('opensky', ?)").bind(body).run();
      return json({ok: true, bytes: body.length}, 200, nc);
    }
    if (u.pathname === '/opensky' && req.method === 'GET') return cached(ctx, 'opensky', 20, async () => {
      const v = (await env.DB.prepare("SELECT v FROM meta WHERE k = 'opensky'").first())?.v;
      return new Response(v || '{"t":0,"ac":[]}', {headers: {...cors, 'Cache-Control': 'public, max-age=20'}});
    });
    return json({error: 'bad request'}, 400);
  },
};
