// GET /api/flights -> every aircraft over India. Vercel's CDN caches the answer (s-maxage), so one
// function run is shared by all users; adsb.fi allows ~1 request/s, so tiles are fetched in sequence.
import {TILES, tile, sleep, tag, valid, hidden} from './_adsb.js';

export const config = {maxDuration: 30};

export default async function handler(req, res) {
  // only ?rec is known: any other param would just mint a fresh CDN cache key and a 12-call upstream fan-out
  if (Object.keys(req.query || {}).some(k => k !== 'rec')) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({error: 'unknown parameter'}); }
  const merged = new Map(), status = {fi: 0, fiErr: 0, lol: 0, lolErr: 0};
  const failed = [];
  for (const [i, [la, lo]] of TILES.entries()) {
    if (i) await sleep(1050);
    try {
      for (const f of await tile(`https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/250`, 'adsb.fi')) {
        const prev = merged.get(f.hex);
        if (!prev || f.ts > prev.ts) merged.set(f.hex, f);
      }
      status.fi++;
    } catch { status.fiErr++; failed.push([la, lo]); }
  }
  // fill gaps from adsb.lol (also rate-limited: only for tiles adsb.fi failed, plus the busiest one)
  for (const [la, lo] of [...failed, [28.5, 77]].slice(0, 4)) {
    try {
      for (const f of await tile(`https://api.adsb.lol/v2/lat/${la}/lon/${lo}/dist/250`, 'adsb.lol'))
        if (!merged.has(f.hex) || f.ts > merged.get(f.hex).ts + 2) merged.set(f.hex, f);
      status.lol++;
    } catch { status.lolErr++; }
  }
  // OpenSky via the relay (OpenSky refuses cloud hosts; a home machine pushes snapshots to the history worker)
  // HISTORY_API env var = your flight-history worker origin; unset -> no OpenSky merge
  let os = {n: 0, age: null, quota: null};
  if (process.env.HISTORY_API) try {
    const r = await fetch(process.env.HISTORY_API.replace(/\/$/, '') + '/opensky', {signal: AbortSignal.timeout(5000)});
    const j = r.ok ? await r.json() : null;
    if (j && j.t && Date.now() / 1000 - j.t < 1200) {
      os = {n: 0, age: Math.round(Date.now() / 1000 - j.t), quota: j.quota};
      for (const o of Array.isArray(j.ac) ? j.ac : []) {
        // relay records: keep only well-formed ones, strings forced to safe shapes
        const f = o && {...o, hex: String(o.hex || '').toLowerCase(), flight: tag(o.flight) || '', reg: tag(o.reg), type: tag(o.type),
          squawk: /^\d{4}$/.test(o.squawk) ? o.squawk : undefined, country: typeof o.country === 'string' ? o.country.slice(0, 40) : undefined};
        if (!valid(f) || hidden(f)) continue;
        const prev = merged.get(f.hex);
        if (!prev) { merged.set(f.hex, f); os.n++; }               // aircraft the ADS-B aggregators don't see
        else if (f.ts > prev.ts + 5) merged.set(f.hex, {...prev, lat: f.lat, lon: f.lon, alt: f.alt, ground: f.ground,
          gs: f.gs, track: f.track, vr: f.vr, ts: f.ts, country: f.country});   // fresher position, keep rich fields
        else if (!prev.country) prev.country = f.country;
      }
    }
  } catch {}
  const ac = [...merged.values()].filter(f => f.lat > 3 && f.lat < 39 && f.lon > 64 && f.lon < 101);
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=3600');   // after a quiet spell the first visitor gets the last snapshot instantly, not a 13 s rebuild
  res.status(200).json({now: Date.now() / 1000, ac, apts: {}, meta: {
    adsbfi: `${status.fi}/${TILES.length} areas` + (status.fiErr ? ` (${status.fiErr} failed)` : ''),
    adsblol: status.lol || status.lolErr ? `${status.lol} ok${status.lolErr ? `, ${status.lolErr} failed` : ''}` : 'not needed',
    opensky: os.age == null ? 'relay offline' : `+${os.n} aircraft via relay (${Math.round(os.age / 60)} min old)`,
    routes: 'looked up on this device'}});
}
