# blackrhino

Open-source live flight tracker for India. A 2D radar map, a 3D India scene with terrain, live clouds and real sun,
a Cesium globe, arrival/departure boards for 153 Indian airports, live GPS sharing from the cabin, and a learned
landing-time model that keeps aircraft visible as "estimated" ghosts where receiver coverage ends.
Installable as a PWA. Runs entirely on free tiers.

**Live:** https://blackrhino.in · MIT licensed · Not for navigation.

## Features

- **Live aircraft** from [adsb.fi](https://adsb.fi) (12 areas over India) and [adsb.lol](https://adsb.lol), plus
  [OpenSky](https://opensky-network.org) through an optional home relay. Merged by ICAO address; planes are dead-reckoned
  between updates so motion stays smooth.
- **Flight card** with ~40 fields when available: route and progress, ETA (IST), airline, registration, type, photo,
  autopilot targets, wind, temperature, squawk, ADS-B integrity.
- **Airports**: runways, live METAR, boards (arrivals, departures, on ground, nearby, earlier).
- **3D India** (Three.js): terrain + imagery, live EUMETSAT infrared clouds, chase / cockpit / orbit cameras. `/globe` is the CesiumJS version.
- **Flights panel**: sortable list, filters, fleet per airline, bookmarks, recently viewed.
- **2D map extras**: aircraft silhouettes by type (jet, widebody, turboprop, light, helicopter), trails coloured by altitude,
  squawk 7500 / 7600 / 7700 alert banner with a pulsing beacon, shareable URLs (`/map?ll=lat,lon,zoom&sel=hex`),
  keyboard shortcuts (`?` lists them), and **replay**: the device keeps the last 3 h of snapshots in IndexedDB and scrubs back through them.
- **History**: a Cloudflare Worker records the feed every 10 minutes into D1 (per-flight paths, airport "earlier" boards).
- **Estimated approaches**: runway-aware physics plan corrected by a gradient-boosted model (`eta/`), shown with an 80% range.
- **Live sharing**: `/share` records your phone's GPS on board (works offline, uploads on reconnect); friends watch on `/live`.

## Architecture

```
browser (public/)                Vercel (api/)                   Cloudflare Worker (history-worker/)
 map / 3d / globe / live  ──►  /api/flights  adsb.fi + adsb.lol ──► /opensky ◄── relay/ (home machine, OpenSky)
 share, boards, flight card     /api/hex /api/metar /api/clouds     /flight /airport /status   cron: records feed → D1
 adsbdb lookups (CORS ok) ──────────────────────────────────────►  /share  (live GPS sharing)
```

| Path | What |
|---|---|
| `public/` | Static app. `config.js` holds the one deployment setting the browser needs. |
| `api/` | Vercel functions, CDN-cached so one upstream fetch serves every visitor. |
| `history-worker/` | Cloudflare Worker + D1: history, live-share storage, OpenSky relay inbox. |
| `relay/` | OpenSky relay. OpenSky blocks cloud IPs, so a normal connection (laptop, Pi, Termux) pushes snapshots. |
| `eta/` | Landing-time model: extract from the adsb.lol archive, train, check browser parity. Training data is not in the repo. |
| `data/` | Build scripts for `airports.json` and the 3D airliner models. |
| `film/` | Three.js studio that renders the landing-page films. |
| `server.py` | Local dev server (Python stdlib), same API plus OpenSky directly. |

## Run locally

```bash
python3 server.py      # http://localhost:8650
```

## Self-hosting

Everything fits the free plans (Vercel Hobby, Cloudflare Workers Free + D1). Nothing here needs a card on file.

1. **App (Vercel).** Fork, import into Vercel, deploy. Set env vars:
   - `CONTACT_URL`: your repo or site; adsb.fi and adsb.lol ask for a contact in the User-Agent.
   - `HISTORY_API`: your worker origin (step 2). Leave unset to skip the OpenSky merge.
2. **History worker (optional, Cloudflare).**
   ```bash
   cd history-worker
   cp wrangler.example.jsonc wrangler.jsonc        # gitignored
   npx wrangler d1 create flight-history           # paste the id into wrangler.jsonc
   npx wrangler d1 execute flight-history --remote --file schema.sql
   npx wrangler secret put RUN_KEY                 # manual /run trigger
   npx wrangler secret put INGEST_KEY              # relay pushes
   npx wrangler deploy
   ```
   Set `FEED_URL` and `ALLOWED_ORIGINS` in `wrangler.jsonc` to your app.
3. **Point the browser at it.** Edit `public/config.js` (`historyApi`) and add the worker origin to `connect-src` in `vercel.json`.
   Without a worker, set `historyApi: ''`: history, sharing and OpenSky are off, everything else works.
4. **OpenSky relay (optional).**
   `BR_HISTORY_API=<worker> RELAY_KEY=<INGEST_KEY> python3 relay/opensky_relay.py`. Free OpenSky API credentials
   (`OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET`) raise the refresh from ~13 min to ~90 s. On macOS it can read these from Keychain instead.

Please don't point a fork at someone else's worker or hammer the upstream feeds: adsb.fi allows about one request
per second, which is why `api/flights.js` fetches tiles in sequence and the CDN caches for 15 s.

## Data and licences

Code is MIT. Data files and live services keep their own terms: adsb.fi is **non-commercial**, OpenSky is research /
non-commercial, `fir.json` is CC BY-SA 4.0, `eta-model.json` is ODbL. See [NOTICE.md](NOTICE.md) and `/credits`.

Coverage in India is thin at low altitude. Feeding a receiver to adsb.fi or adsb.lol is the best way to help.

## Refresh airport data

```bash
cd data
curl -O https://davidmegginson.github.io/ourairports-data/airports.csv
curl -O https://davidmegginson.github.io/ourairports-data/runways.csv
python3 build_airports.py
```

## Contributing

Issues and pull requests welcome. Keep it vanilla JS with no build step, keep it inside free tiers, and run
`node --check` on changed files. Security reports: see [SECURITY.md](SECURITY.md).
