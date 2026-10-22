// GET /api/hex?hex=801432 (or ?cs=IGO542Y) -> one aircraft, fresh (CDN-cached 2 s). Used to follow the selected
// flight smoothly between the slower whole-country refreshes. adsb.lol first so adsb.fi's
// 1 request/s budget stays with /api/flights.
import {tile} from './_adsb.js';

export default async function handler(req, res) {
  // strict: exactly one of hex / cs, nothing else (random params would bust the CDN cache and hit upstream)
  const keys = Object.keys(req.query || {}), h = String(req.query.hex || '').toLowerCase(), c = String(req.query.cs || '').toUpperCase();
  if (keys.length !== 1 || !(/^~?[0-9a-f]{6}$/.test(h) || /^[A-Z0-9]{2,8}$/.test(c))) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({error: 'bad query'}); }
  const hex = h.replace('~', ''), cs = c;
  const q = hex ? ['hex', hex] : ['callsign', cs];
  let ac = [];
  for (const [url, src] of [[`https://api.adsb.lol/v2/${q[0]}/${q[1]}`, 'adsb.lol'], [`https://opendata.adsb.fi/api/v2/${q[0]}/${q[1]}`, 'adsb.fi']]) {
    try { ac = await tile(url, src); if (ac.length) break; } catch {}
  }
  res.setHeader('Cache-Control', 'public, s-maxage=2, stale-while-revalidate=4');
  res.status(200).json({now: Date.now() / 1000, ac});
}
