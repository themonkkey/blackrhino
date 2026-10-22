// GET /api/metar?icao=VIDP -> latest METAR (aviationweather.gov has no CORS). CDN-cached 10 min.
export default async function handler(req, res) {
  const icao = String(req.query.icao || '');
  if (Object.keys(req.query || {}).length !== 1 || !/^[A-Z]{4}$/.test(icao)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({error: 'bad query'}); }
  try {
    const r = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`, {signal: AbortSignal.timeout(8000)});
    const d = r.ok ? await r.json() : [];
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    res.status(200).json(d[0] || null);
  } catch {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    res.status(200).json(null);
  }
}
