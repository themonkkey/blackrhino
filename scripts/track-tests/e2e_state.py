# Deterministic state-machine tests for /track: fixed clock, mocked radar / history / route.
import json, datetime
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8656'
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
DEL, BOM, CCU = (28.5665, 77.1031), (19.0887, 72.8679), (22.6547, 88.4467)
ROUTE = {'response': {'flightroute': {'callsign': 'AI9998', 'callsign_icao': 'AIC9998', 'callsign_iata': 'AI9998',
  'airline': {'name': 'Air India', 'icao': 'AIC', 'iata': 'AI'},
  'origin': {'iata_code': 'DEL', 'icao_code': 'VIDP', 'name': 'Indira Gandhi International', 'municipality': 'New Delhi', 'latitude': DEL[0], 'longitude': DEL[1]},
  'destination': {'iata_code': 'BOM', 'icao_code': 'VABB', 'name': 'Chhatrapati Shivaji', 'municipality': 'Mumbai', 'latitude': BOM[0], 'longitude': BOM[1]}}}}
res = {}
def ok(n, c, info=''): res[n] = bool(c); print(('PASS ' if c else 'FAIL ') + n, '::', info)
def fix(ts, lat, lon, alt=34000, ground=False, hex='abc123', trk=200, gs=450):
    return {'hex': hex, 'flight': 'AIC9998', 'lat': lat, 'lon': lon, 'alt': None if ground else alt, 'ground': ground, 'gs': 0 if ground else gs, 'track': trk, 'vr': 0, 'ts': ts}
def run(name, now_ist, url, hexes, hist, wait=6):
    """hexes: list of /api/hex answers served in turn (last one repeats); hist: /hist/flight answer"""
    t0 = now_ist.timestamp(); calls = {'hex': 0}
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.clock.install(time=now_ist); pg.clock.resume()
        def hexh(r):
            a = hexes[min(calls['hex'], len(hexes) - 1)]; calls['hex'] += 1
            r.fulfill(status=200, content_type='application/json', body=json.dumps({'now': t0, 'ac': a}))
        pg.route('**/api/hex*', hexh)
        pg.route('**/api/flights', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'now': t0, 'ac': []})))
        pg.route('**/hist/flight*', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(hist)))
        pg.route('https://api.adsbdb.com/v0/callsign/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(ROUTE)))
        pg.goto(BASE + url); pg.wait_for_selector('#live:not(.hide)'); pg.wait_for_timeout(wait * 1000)
        out = pg.inner_text('#state') + ' | ' + pg.inner_text('#note') + ' | ' + pg.inner_text('.tiles').replace('\n', ' ') + ' | bar ' + pg.evaluate("getComputedStyle(document.querySelector('.line')).visibility")
        pg.screenshot(path=f'{S}/shots/state-{name}.png'); b.close()
        return out, errs, calls['hex']
import os; S = os.path.dirname(os.path.abspath(__file__))
D = datetime.date(2026, 11, 1); d = D.isoformat(); dm1 = (D - datetime.timedelta(days=1)).isoformat(); dp1 = (D + datetime.timedelta(days=1)).isoformat()
mid = datetime.datetime(2026, 11, 1, 0, 0, tzinfo=IST).timestamp()
mid_line = [(DEL[0] + BOM[0]) / 2, (DEL[1] + BOM[1]) / 2]

# A. today's link, 00:40 IST: yesterday's overnight AI9998 (same plane) is still in the air -> not today's flight
now = datetime.datetime(2026, 11, 1, 0, 40, tzinfo=IST)
hist = {'flights': [
  {'day': dm1, 'cs': 'AIC9998', 'hex': 'abc123', 'first': mid - 5400, 'last': mid - 60, 'track': [[mid - 5400, DEL[0], DEL[1], 0], [mid - 3000, 26, 76, 30000], [mid - 60, 24.5, 75.5, 34000]]},
  {'day': d, 'cs': 'AIC9998', 'hex': 'abc123', 'first': mid + 60, 'last': mid + 1800, 'track': [[mid + 60, 24.4, 75.4, 34000], [mid + 1800, 22, 74.5, 30000]]}]}
o, e, _ = run('overnight', now, f'/track/AI9998?d={d}', [[fix(now.timestamp() - 5, 21.5, 74.2)]], hist)
ok("today's link ignores yesterday's overnight flight", 'Not on radar yet' in o and not e, o[:200])

# B. yesterday's link opened the next afternoon: yesterday's leg landed; today's AI9998 is flying -> Landed, not In the air
now = datetime.datetime(2026, 11, 2, 14, 0, tzinfo=IST)
hist = {'flights': [{'day': d, 'cs': 'AIC9998', 'hex': 'abc123', 'first': mid + 3600 * 9, 'last': mid + 3600 * 11,
  'track': [[mid + 3600 * 9, DEL[0], DEL[1], 0], [mid + 3600 * 9.3, 26, 76, 30000], [mid + 3600 * 11, BOM[0] + .01, BOM[1], 0]]}]}
o, e, _ = run('yesterday', now, f'/track/AI9998?d={d}', [[fix(now.timestamp() - 5, *mid_line, hex='def456')]], hist)
ok("yesterday's link shows its own landing, not today's flight", o.startswith('Landed') and 'In the air' not in o and not e, o[:200])

# C. landed latch: ground at BOM, then the next leg takes off -> stays Landed
now = datetime.datetime(2026, 11, 1, 13, 0, tzinfo=IST)
t = now.timestamp()
o, e, n = run('latch', now, f'/track/AI9998?d={d}', [[fix(t - 5, BOM[0] + .01, BOM[1], ground=True)], [fix(t + 10, 19.5, 73.5, alt=8000, trk=30)]], {'flights': []}, wait=20)
ok('landed stays landed when the plane flies on', o.startswith('Landed') and not e, f'{o[:200]} hexcalls={n}')

# D. 40 minutes after landing (stale ground fix at BOM) -> Landed, never "Not on radar yet"
o, e, _ = run('stale', now, f'/track/AI9998?d={d}', [[fix(t - 2400, BOM[0] + .01, BOM[1], ground=True)]], {'flights': []})
ok('stale landing still reads Landed', o.startswith('Landed') and 'Not on radar' not in o and not e, o[:200])

# E. airborne far off the DEL-BOM route (over Kolkata) -> no progress bar, no landing time, honest note
o, e, _ = run('offroute', now, f'/track/AI9998?d={d}', [[fix(t - 5, *CCU)]], {'flights': []})
ok('off-route plane: no ETA, route not confirmed', 'Not on its usual route' in o and 'LANDS (IST) -' in o and 'bar hidden' in o and not e, o[:220])

# F. stale airborne fix far from destination -> Lost radar contact (no invented estimate)
o, e, _ = run('lost', now, f'/track/AI9998?d={d}', [[fix(t - 900, 26.5, 76.3, trk=200)]], {'flights': []})
ok('lost contact mid-route is said plainly', o.startswith('Lost radar contact') and not e, o[:200])
print('ALL PASS' if all(res.values()) else 'SOME FAILED')
