#!/usr/bin/env python3
"""Live approach recorder: our own training data for airports the open history archive can't see (Delhi etc.).

Polls adsb.fi and adsb.lol around watched airports (each source <= 1 request/s, their published limit), follows every aircraft,
and writes
  data/live/approaches-YYYY-MM-DD.jsonl   a completed approach with a seen touchdown, same record format as extract.py (how='g')
  data/live/lost-YYYY-MM-DD.jsonl         an inbound aircraft whose feed ended in the air: where we lose coverage, per airport
Run: launchd com.blackrhino.eta-recorder (KeepAlive). Everything here is local; nothing is uploaded.
"""
import json, math, os, sys, threading, time, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'data', 'live'); os.makedirs(OUT, exist_ok=True)
APTS = {a['icao']: a for a in json.load(open(os.path.join(HERE, '..', 'public', 'airports.json')))}
# priority six + the busiest hubs we also want ground truth for
WATCH = ['VIDP', 'VOBL', 'VECC', 'VEPT', 'VILK', 'VOBZ', 'VABB', 'VOHS', 'VOMM', 'VAAH', 'VIJP', 'VOGO', 'VOCI', 'VANP']
RADIUS_NM = 55                       # ~100 km: covers the approach from ~8-10k ft down
SOURCES = {'adsb.fi': 'https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}', 'adsb.lol': 'https://api.adsb.lol/v2/point/{lat}/{lon}/{nm}'}
UA = {'User-Agent': 'blackrhino-eta-recorder/1.0 (+https://blackrhino.in; non-commercial research)'}
SPACING = 1.15                       # s between requests to one source (their limit: 1/s)
KT = 0.514444
R = math.pi / 180


def hav(a, b, c, d):
    x = math.sin((c - a) * R / 2) ** 2 + math.cos(a * R) * math.cos(c * R) * math.sin((d - b) * R / 2) ** 2
    return 12742.0 * math.asin(math.sqrt(min(1, x)))


def brg(a, b):
    dl = (b[1] - a[1]) * R
    return (math.atan2(math.sin(dl) * math.cos(b[0] * R), math.cos(a[0] * R) * math.sin(b[0] * R) - math.sin(a[0] * R) * math.cos(b[0] * R) * math.cos(dl)) / R + 360) % 360


def adiff(a, b): return abs((a - b + 540) % 360 - 180)


def rwy_end(apt, trk):
    best, bd = None, 30
    for rw in apt.get('runways', []):
        for end in (rw.get('id') or '').split('/'):
            num = ''.join(c for c in end if c.isdigit())
            if num and adiff(int(num) * 10, trk) < bd: best, bd = end, adiff(int(num) * 10, trk)
    return best


tracks = {}          # hex -> {'pts': [[t, lat, lon, alt|None(ground), gs, trk, vr]], 'seen': t, 'cs','type','reg','cat'}
lock = threading.Lock()
stats = {'polls': 0, 'errors': 0, 'arrivals': 0, 'lost': 0}


def ingest(a, now):
    try:
        hx = str(a['hex']).lower(); lat, lon = a['lat'], a['lon']
    except KeyError: return
    ts = now - (a.get('seen_pos') or 0)
    alt = a.get('alt_baro')
    p = [round(ts, 1), round(lat, 5), round(lon, 5), None if alt == 'ground' else alt if isinstance(alt, (int, float)) else None,
         a.get('gs'), a.get('track'), a.get('baro_rate') if a.get('baro_rate') is not None else a.get('geom_rate')]
    if alt != 'ground' and p[3] is None: return
    with lock:
        t = tracks.setdefault(hx, {'pts': [], 'seen': 0, 'cs': None, 'type': None, 'reg': None, 'cat': None})
        if t['pts'] and ts <= t['pts'][-1][0]: return
        t['pts'].append(p); t['seen'] = max(t['seen'], ts)
        t['cs'] = (a.get('flight') or t['cs'] or '').strip() or t['cs']; t['type'] = a.get('t') or t['type']; t['reg'] = a.get('r') or t['reg']; t['cat'] = a.get('category') or t['cat']
        if len(t['pts']) > 900: del t['pts'][:100]


def poll_loop(src, url_fmt):
    i = 0
    while True:
        icao = WATCH[i % len(WATCH)]; i += 1
        a = APTS[icao]
        try:
            req = urllib.request.Request(url_fmt.format(lat=a['lat'], lon=a['lon'], nm=RADIUS_NM), headers=UA)
            j = json.load(urllib.request.urlopen(req, timeout=15))
            now = j['now'] / 1000 if j.get('now', 0) > 1e12 else (j.get('now') or time.time())
            for ac in (j.get('aircraft') or j.get('ac') or []): ingest(ac, now)
            stats['polls'] += 1
        except Exception as e:
            stats['errors'] += 1
            if '429' in str(e): time.sleep(30)
        time.sleep(SPACING)


def emit(kind, rec):
    day = datetime.fromtimestamp(rec.get('T', time.time()), timezone.utc).strftime('%Y-%m-%d')
    with open(os.path.join(OUT, f'{kind}-{day}.jsonl'), 'a') as f: f.write(json.dumps(rec, separators=(',', ':')) + '\n')


def nearest(lat, lon, maxkm):
    best, bd = None, 9e9
    for k in WATCH:
        a = APTS[k]
        if abs(a['lat'] - lat) > 1.5 or abs(a['lon'] - lon) > 1.7: continue
        d = hav(lat, lon, a['lat'], a['lon'])
        if d < bd: best, bd = a, d
    return (best, bd) if best and bd <= maxkm else (None, None)


def finalize(hx, t, now):
    pts = t['pts']
    # 1. touchdown seen: first ground fix within 6 km of a watched airport, preceded by a low airborne fix
    for k, p in enumerate(pts):
        if p[3] is not None or k == 0: continue
        apt, d = nearest(p[1], p[2], 6)
        if not apt: continue
        pa = next((q for q in reversed(pts[:k]) if q[3] is not None), None)
        if not pa or pa[3] - (apt.get('elev') or 0) > 2500 or p[0] - pa[0] > 40: continue
        T = (pa[0] + p[0]) / 2                                     # touchdown happened between the last airborne and first ground fix
        win = [[round(q[0] - T, 1), q[1], q[2], q[3], q[4], q[5], q[6]] for q in pts[:k] if q[3] is not None and q[0] >= T - 3600]
        if len(win) >= 20 and win[0][0] < -600:
            emit('approaches', {'hex': hx, 'reg': t['reg'], 'type': t['type'], 'cat': t['cat'], 'cs': t['cs'], 'apt': apt['icao'],
                                'rwy': rwy_end(apt, pa[5]) if pa[5] is not None else None, 'T': round(T, 1), 'how': 'g', 'src': 'live', 'pts': win})
            stats['arrivals'] += 1
        return
    # 2. feed ended in the air while inbound to a watched airport: this is the coverage hole we want to quantify
    last = next((q for q in reversed(pts) if q[3] is not None), None)
    if not last or last is not pts[-1] or last[5] is None: return
    apt, d = nearest(last[1], last[2], 120)
    if not apt: return
    agl = last[3] - (apt.get('elev') or 0)
    if agl > 25000 or adiff(last[5], brg((last[1], last[2]), (apt['lat'], apt['lon']))) > 55: return
    prev = next((q for q in reversed(pts) if last[0] - q[0] >= 45 and q[3] is not None), None)
    if not ((last[6] is not None and last[6] < -300) or (prev and prev[3] - last[3] > 150)): return
    emit('lost', {'hex': hx, 'cs': t['cs'], 'apt': apt['icao'], 'agl': int(agl), 'km': round(d), 'T': round(last[0], 1)})
    stats['lost'] += 1


def sweep():
    while True:
        time.sleep(20)
        now = time.time()
        with lock: done = [(h, t) for h, t in tracks.items() if now - t['seen'] > 300]
        for h, t in done:
            try: finalize(h, t, now)
            except Exception as e: print('finalize error', h, e, file=sys.stderr)
            with lock: tracks.pop(h, None)
        with lock:
            # a landed aircraft keeps being tracked on the ground until it leaves coverage: finalize once it has a ground fix and sits still
            landed = [(h, t) for h, t in tracks.items() if t['pts'] and t['pts'][-1][3] is None and now - t['pts'][-1][0] < 300 and len(t['pts']) > 25 and
                      any(q[3] is not None for q in t['pts'][:-5]) and sum(1 for q in t['pts'] if q[3] is None) >= 3]
        for h, t in landed:
            try: finalize(h, t, now)
            except Exception as e: print('finalize error', h, e, file=sys.stderr)
            with lock: tracks.pop(h, None)
        if int(now) % 600 < 20:
            print(datetime.now(timezone.utc).strftime('%F %T'), 'tracking', len(tracks), stats, flush=True)


if __name__ == '__main__':
    print('recorder starting, watching', WATCH, flush=True)
    for s, u in SOURCES.items(): threading.Thread(target=poll_loop, args=(s, u), daemon=True).start()
    sweep()
