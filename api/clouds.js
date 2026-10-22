// GET /api/clouds -> live Meteosat IODC infrared cloud image over India (EPSG:4326, bbox 5..37N, 66..99E).
// EUMETSAT's WMS is slow/flaky for big images, so the CDN keeps one copy for 15 minutes for everyone.
export const config = {maxDuration: 30};
const BASE = 'https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&layers=msg_iodc:ir108&styles=&format=image/png&crs=EPSG:4326&bbox=5,66,37,99';
export default async function handler(req, res) {
  // only ?_t=<current 15-min bucket> (client cache buster) is allowed; anything else would bypass the shared CDN copy
  const q = req.query || {};
  if (Object.keys(q).some(k => k !== '_t') || (q._t != null && !(/^\d{1,10}$/.test(q._t) && Math.abs(q._t - Math.floor(Date.now() / 9e5)) <= 1))) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({error: 'bad query'}); }
  for (const w of [1024, 768, 512]) {
    try {
      const r = await fetch(`${BASE}&width=${w}&height=${w}`, {signal: AbortSignal.timeout(12000)});
      if (!r.ok || !(r.headers.get('content-type') || '').includes('image')) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
      return res.status(200).send(buf);
    } catch {}
  }
  res.setHeader('Cache-Control', 'public, s-maxage=60');
  res.status(502).json({error: 'cloud imagery unavailable'});
}
