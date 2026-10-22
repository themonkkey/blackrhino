// Shared by the Vercel functions: readsb-format (adsb.fi / adsb.lol) -> app flight records.
// upstream feeds ask for a contact: set CONTACT_URL to your repo or site
export const UA = {'User-Agent': `blackrhino/1.0 (+${process.env.CONTACT_URL || 'https://github.com/themonkkey/blackrhino'})`};
// 12 circles of 250 nm cover India + approaches
export const TILES = [[28.5, 77], [26, 85], [22.5, 88.5], [19, 73], [17.5, 78.5], [13, 77.5], [10, 77], [23, 72], [23, 80], [26, 92], [32, 75], [20, 84]];
const X_FIELDS = ['alt_geom', 'ias', 'tas', 'mach', 'wd', 'ws', 'oat', 'tat', 'track_rate', 'roll', 'mag_heading',
  'true_heading', 'baro_rate', 'geom_rate', 'nav_qnh', 'nav_altitude_mcp', 'nav_altitude_fms', 'nav_heading', 'nav_modes',
  'category', 'version', 'nic', 'rc', 'nac_p', 'nac_v', 'sil', 'sil_type', 'gva', 'sda', 'nic_baro', 'messages', 'seen',
  'rssi', 'type', 'mlat', 'tisb', 'emergency', 'alert', 'spi', 'desc', 'ownOp', 'year', 'dbFlags'];

// strict shapes for strings that reach page markup: hex (optionally ~ for non-ICAO), flight/reg/type
export const HEX_OK = /^~?[0-9a-f]{6}$/;
export const tag = v => { const s = String(v ?? '').trim().toUpperCase(); return /^[A-Z0-9-]{1,12}$/.test(s) ? s : undefined; };
export const valid = f => f && HEX_OK.test(f.hex) && Number.isFinite(f.lat) && Number.isFinite(f.lon);

// Hidden aircraft, dropped before anything is served or recorded:
// - military: readsb dbFlags bit 1, set by adsb.fi / adsb.lol from their aircraft databases
// - BLOCK_LIST env var (comma separated ICAO hex codes or registrations): owners who asked to be hidden.
//   Kept in the deployment's environment, not the repo, so the list itself stays private.
const BLOCK = new Set(String(process.env.BLOCK_LIST || '').split(',').map(v => v.trim().toUpperCase().replace(/^~/, '')).filter(Boolean));
export const MIL_SEEN = new Set();   // hexes flagged military by any source this instance has seen (OpenSky has no such flag)
export const hidden = f => {
  if (f.x && (f.x.dbFlags & 1)) { MIL_SEEN.add(f.hex); return true; }
  return MIL_SEEN.has(f.hex) || BLOCK.has(f.hex.toUpperCase().replace(/^~/, '')) || (!!f.reg && BLOCK.has(f.reg));
};

export function convert(a, now, src) {
  const ground = a.alt_baro === 'ground', x = {};
  for (const k of X_FIELDS) if (k in a) x[k] = a[k];
  return {hex: String(a.hex || '').toLowerCase(), flight: tag(a.flight) || '', reg: tag(a.r), type: tag(a.t), lat: a.lat, lon: a.lon,
    alt: ground ? null : a.alt_baro, ground, gs: a.gs || 0, track: a.track ?? a.true_heading ?? 0,
    vr: a.baro_rate ?? a.geom_rate ?? 0, squawk: /^\d{4}$/.test(a.squawk) ? a.squawk : undefined, emergency: a.emergency != null && a.emergency !== 'none',
    ts: now - (a.seen_pos || 0), src, x};
}

export async function tile(url, src) {
  const r = await fetch(url, {headers: UA, signal: AbortSignal.timeout(8000)});
  if (!r.ok) throw new Error(src + ' http ' + r.status);
  const d = await r.json();
  const now = d.now > 1e12 ? d.now / 1000 : d.now || Date.now() / 1000;
  return (d.aircraft || d.ac || []).filter(a => 'lat' in a).map(a => convert(a, now, src)).filter(f => valid(f) && !hidden(f));
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
