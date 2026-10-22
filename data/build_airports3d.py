#!/usr/bin/env python3
"""Build public/apt3d/<ICAO>.json airport layouts from OpenStreetMap (Overpass).
Data (c) OpenStreetMap contributors, ODbL 1.0. Stdlib only: run with python3 -I.
Usage: python3 -I data/build_airports3d.py [--force] [--types large,medium] [ICAO ...]
"""
import json, math, os, sys, time, random, urllib.request, urllib.error, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'data', 'cache_osm')
OUT = os.path.join(ROOT, 'public', 'apt3d')
ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
UA = 'blackrhino-airports3d/1.0 (+https://blackrhino.in)'
SRC = '© OpenStreetMap contributors (ODbL)'
MAX_BYTES = 250 * 1024
AEROWAY = 'aerodrome|runway|taxiway|taxilane|apron|terminal|hangar|control_tower|tower|gate|parking_position|helipad|holding_position|stopway|blast_pad|navigationaid'
R = 6371000.0


# ---------- geometry helpers (local metres) ----------
class Proj:
    def __init__(s, lat0, lon0):
        s.lat0, s.lon0 = lat0, lon0
        s.kx = math.pi / 180 * R * math.cos(math.radians(lat0))
        s.ky = math.pi / 180 * R
    def fwd(s, p): return ((p[1] - s.lon0) * s.kx, (p[0] - s.lat0) * s.ky)
    def inv(s, xy): return (s.lat0 + xy[1] / s.ky, s.lon0 + xy[0] / s.kx)


def dp(pts, tol):
    n = len(pts)
    if n < 3: return list(pts)
    keep = [False] * n; keep[0] = keep[-1] = True
    st = [(0, n - 1)]
    while st:
        a, b = st.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        md, mi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L == 0: d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
                d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > md: md, mi = d, i
        if md > tol:
            keep[mi] = True; st.append((a, mi)); st.append((mi, b))
    return [p for p, k in zip(pts, keep) if k]


def area(r):
    return 0.5 * sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))


def pip(pt, ring):
    x, y = pt; c = False; n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c


def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def near_ring(pt, ring, buf):
    n = len(ring)
    return any(seg_dist(pt, ring[i], ring[(i + 1) % n]) <= buf for i in range(n))


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def stitch(segs):
    """Join open way point lists into closed rings."""
    segs = [list(s) for s in segs if len(s) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        while cur[0] != cur[-1]:
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]
                elif s[-1] == cur[-1]: cur += s[::-1][1:]
                elif s[-1] == cur[0]: cur = s[:-1] + cur
                elif s[0] == cur[0]: cur = s[::-1][:-1] + cur
                else: continue
                segs.pop(i); break
            else: break
        if cur[0] == cur[-1] and len(cur) >= 4: rings.append(cur[:-1])
    return rings


def el_rings(e):
    """Return list of outer rings ([[lat,lon]..], open) for a way or relation."""
    if e['type'] == 'way':
        g = [(p['lat'], p['lon']) for p in e.get('geometry', []) or []]
        return [g[:-1]] if len(g) >= 4 and g[0] == g[-1] else []
    segs = []
    for m in e.get('members', []):
        if m.get('type') == 'way' and m.get('role', 'outer') in ('outer', ''):
            g = [(p['lat'], p['lon']) for p in m.get('geometry', []) or []]
            if g: segs.append(g)
    return stitch(segs)


def el_line(e):
    if e['type'] != 'way': return None
    g = [(p['lat'], p['lon']) for p in e.get('geometry', []) or []]
    return g if len(g) >= 2 else None


def num(v):
    try:
        return float(str(v).lower().replace('m', '').replace(',', '.').split(';')[0].strip())
    except Exception:
        return None


# ---------- Overpass ----------
def query_for(lat, lon):
    dl = 0.07; dn = 0.07 / math.cos(math.radians(lat))
    bb = '%.5f,%.5f,%.5f,%.5f' % (lat - dl, lon - dn, lat + dl, lon + dn)
    return ('[out:json][timeout:180];(way["aeroway"~"^(%s)$"](%s);relation["aeroway"~"^(%s)$"](%s);'
            'way["building"](%s);relation["building"](%s);node["aeroway"~"^(parking_position|gate)$"](%s););out geom;'
            % (AEROWAY, bb, AEROWAY, bb, bb, bb, bb))


def fetch(icao, lat, lon):
    cp = os.path.join(CACHE, icao + '.json')
    if os.path.exists(cp):
        with open(cp) as f: return json.load(f)
    data = ('data=' + urllib.request.quote(query_for(lat, lon))).encode()
    last = None
    for attempt in range(6):
        ep = ENDPOINTS[attempt % 2 if attempt >= 2 else 0]
        try:
            req = urllib.request.Request(ep, data=data, headers={'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded'})
            with urllib.request.urlopen(req, timeout=240) as r:
                j = json.loads(r.read().decode('utf-8'))
            if 'elements' not in j or (j.get('remark') and 'error' in j['remark'].lower()):
                raise RuntimeError('overpass remark: %s' % j.get('remark'))
            os.makedirs(CACHE, exist_ok=True)
            with open(cp, 'w') as f: json.dump(j, f, separators=(',', ':'))
            return j
        except Exception as ex:
            last = ex
            code = getattr(ex, 'code', None)
            wait = min(120, 10 * 2 ** attempt) + random.random() * 3
            print('  retry %d (%s) wait %.0fs' % (attempt + 1, code or ex, wait), flush=True)
            time.sleep(wait)
    raise RuntimeError('fetch failed: %s' % last)


# ---------- build ----------
def rnd(p): return [round(p[0], 6), round(p[1], 6)]


def build(ap, osm):
    lat0, lon0 = ap['lat'], ap['lon']
    pr = Proj(lat0, lon0)
    F = pr.fwd
    els = osm['elements']
    # aerodrome boundary
    cands = []
    for e in els:
        if e.get('tags', {}).get('aeroway') == 'aerodrome' and e['type'] != 'node':
            for r in el_rings(e):
                cands.append([F(p) for p in r])
    bound = None
    if cands:
        ins = [r for r in cands if pip((0, 0), r)]
        if ins: bound = [min(ins, key=lambda r: abs(area(r)))] if len(ins) > 1 and False else [max(ins, key=lambda r: abs(area(r)))]
        else:
            bound = [min(cands, key=lambda r: min(math.hypot(*(centroid(r))), 1e12))]
        # include other outer rings of same element family if they are inside/near? keep single main ring plus rings from same relation
    rwy_xy = []
    for r in ap.get('runways', []):
        if r.get('pts') and len(r['pts']) == 4:
            rwy_xy += [F(r['pts'][:2]), F(r['pts'][2:])]
    if not bound:
        pts = rwy_xy or [(0, 0)]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        bound = [[(min(xs) - 400, min(ys) - 400), (max(xs) + 400, min(ys) - 400), (max(xs) + 400, max(ys) + 400), (min(xs) - 400, max(ys) + 400)]]
        synth = True
    else: synth = False

    def inside(pt, buf):
        return any(pip(pt, r) or (buf and near_ring(pt, r, buf)) for r in bound)

    runways, taxiways, aprons, builds, stands = [], [], [], [], []
    seen = set()
    for e in els:
        t = e.get('tags', {}); aw = t.get('aeroway'); bd = t.get('building')
        key = (e['type'], e['id'])
        if key in seen: continue
        if e['type'] == 'node':
            if aw in ('parking_position', 'gate') and 'lat' in e and inside(F((e['lat'], e['lon'])), 150):
                stands.append([round(e['lat'], 6), round(e['lon'], 6), t.get('ref', t.get('name', ''))])
            continue
        if aw == 'runway':
            seen.add(key)
            ln = el_line(e)
            w = num(t.get('width'))
            rings = el_rings(e) if not ln or ln[0] == ln[-1] else []
            if ln and ln[0] == ln[-1]: rings = [ln[:-1]]
            if rings:
                xy = [F(p) for p in max(rings, key=len)]
                cx, cy = centroid(xy)
                sxx = sum((p[0] - cx) ** 2 for p in xy); syy = sum((p[1] - cy) ** 2 for p in xy)
                sxy = sum((p[0] - cx) * (p[1] - cy) for p in xy)
                th = 0.5 * math.atan2(2 * sxy, sxx - syy)
                ux, uy = math.cos(th), math.sin(th)
                a = [(p[0] - cx) * ux + (p[1] - cy) * uy for p in xy]
                b = [-(p[0] - cx) * uy + (p[1] - cy) * ux for p in xy]
                ln = [pr.inv((cx + ux * min(a), cy + uy * min(a))), pr.inv((cx + ux * max(a), cy + uy * max(a)))]
                w = w or max(b) - min(b)
            if not ln: continue
            xy = [F(p) for p in ln]
            if not inside(centroid(xy), 150): continue
            L = sum(math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]) for i in range(len(xy) - 1))
            runways.append({'ref': t.get('ref') or t.get('name') or '', 'w': round(w or (45 if L > 2500 else 30)),
                            'line': dp(xy, 1.5), '_xy': xy})
        elif aw in ('taxiway', 'taxilane'):
            seen.add(key)
            ln = el_line(e)
            if not ln: continue
            xy = [F(p) for p in ln]
            if not inside(centroid(xy), 150): continue
            if ln[0] == ln[-1] and len(ln) >= 4:  # polygon taxiway -> apron-like surface
                aprons.append({'ring': xy[:-1]}); continue
            taxiways.append({'w': round(num(t.get('width')) or (23 if aw == 'taxiway' else 15), 1), 'line': xy})
        elif aw == 'apron':
            seen.add(key)
            for r in el_rings(e):
                xy = [F(p) for p in r]
                if inside(centroid(xy), 150): aprons.append({'ring': xy})
        elif aw in ('terminal', 'hangar', 'control_tower', 'tower') or bd:
            seen.add(key)
            for r in el_rings(e):
                xy = [F(p) for p in r]
                if not inside(centroid(xy), 0): continue
                name = t.get('name', '')
                if aw in ('control_tower', 'tower') or t.get('man_made') == 'tower' and t.get('tower:type') == 'airport_control':
                    kind, dh = 'tower', 45
                elif aw == 'terminal' or bd == 'terminal' or 'terminal' in name.lower(): kind, dh = 'terminal', 20
                elif aw == 'hangar' or bd == 'hangar': kind, dh = 'hangar', 22
                else: kind, dh = 'other', 8
                h = num(t.get('height'))
                if h is None:
                    lv = num(t.get('building:levels'))
                    h = lv * 3.5 if lv else dh
                b = {'ring': xy, 'h': round(h, 1), 'kind': kind}
                if name: b['name'] = name
                builds.append(b)

    # cross-check with airports.json runways
    def ends(ref): return set(x.strip().upper() for x in ref.replace('-', '/').split('/') if x.strip())
    for r in ap.get('runways', []):
        pts = r.get('pts')
        if not pts or len(pts) != 4: continue
        a, b = F(pts[:2]), F(pts[2:]); mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        found = False
        for o in runways:
            if ends(o['ref']) and ends(o['ref']) == ends(r['id']): found = True; break
            xy = o['_xy']
            for i in range(len(xy) - 1):
                if seg_dist(mid, xy[i], xy[i + 1]) < 60: found = True; break
            if found: break
        if not found:
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            runways.append({'ref': r['id'], 'w': 45 if L > 2500 else 30, 'line': [a, b], '_xy': [a, b]})
    for o in runways: o.pop('_xy', None)
    return pr, bound, runways, taxiways, aprons, builds, stands, synth


def emit(ap, parts, tol_b, tol_t):
    pr, bound, runways, taxiways, aprons, builds, stands, synth = parts
    out = lambda xy: rnd(pr.inv(xy))
    def ring(r, tol):
        s = dp(r + [r[0]], tol)[:-1]
        return [out(p) for p in s] if len(s) >= 3 else None
    o = {'icao': ap['icao'], 'elev_m': round((ap.get('elev') or 0) * 0.3048, 1), 'center': [ap['lat'], ap['lon']]}
    o['bound'] = [x for x in (ring(r, max(tol_b, 3)) for r in bound) if x]
    o['runways'] = [{'ref': r['ref'], 'w': r['w'], 'line': [out(p) for p in dp(r['line'], 1.5)]} for r in runways]
    o['taxiways'] = [{'w': t['w'], 'line': [out(p) for p in dp(t['line'], tol_t)]} for t in taxiways if len(t['line']) >= 2]
    o['aprons'] = [{'ring': x} for x in (ring(a['ring'], tol_t) for a in aprons) if x]
    bl = []
    for b in builds:
        rr = ring(b['ring'], tol_b)
        if rr:
            d = {'ring': rr, 'h': b['h'], 'kind': b['kind']}
            if b.get('name'): d['name'] = b['name']
            bl.append(d)
    o['buildings'] = bl
    o['stands'] = stands[:400]
    o['src'] = SRC
    o['t'] = datetime.date.today().isoformat()
    return o


def process(ap, osm):
    parts = build(ap, osm)
    pr, bound = parts[0], parts[1]
    tol_b, tol_t = 1.5, 1.5
    for _ in range(8):
        o = emit(ap, parts, tol_b, tol_t)
        s = json.dumps(o, separators=(',', ':'), ensure_ascii=False)
        if len(s.encode()) <= MAX_BYTES: break
        tol_b *= 1.8
        if tol_b > 6: tol_t = min(tol_t * 1.5, 5)
        if tol_b > 12:  # drop tiny 'other' buildings
            parts[5][:] = sorted(parts[5], key=lambda b: (b['kind'] == 'other', -abs(area(b['ring']))))[:max(50, len(parts[5]) * 2 // 3)]
    rad = max([math.hypot(*p) for r in bound for p in r] or [1000]) / 1000
    return o, s, round(rad, 1)


def main():
    args = sys.argv[1:]
    force = '--force' in args
    types = {'large', 'medium'}
    if '--types' in args: types = set(args[args.index('--types') + 1].split(','))
    only = [a.upper() for a in args if len(a) == 4 and a.isalpha()]
    aps = json.load(open(os.path.join(ROOT, 'public', 'airports.json')))
    aps = [a for a in aps if (a['icao'] in only if only else a['type'] in types)]
    os.makedirs(OUT, exist_ok=True)
    fails = {}
    for i, ap in enumerate(aps):
        icao = ap['icao']; dst = os.path.join(OUT, icao + '.json')
        if os.path.exists(dst) and not force: continue
        print('[%d/%d] %s' % (i + 1, len(aps), icao), flush=True)
        cached = os.path.exists(os.path.join(CACHE, icao + '.json'))
        try:
            osm = fetch(icao, ap['lat'], ap['lon'])
            o, s, rad = process(ap, osm)
            with open(dst, 'w') as f: f.write(s)
            print('  ok %d B rw=%d tw=%d ap=%d bl=%d' % (len(s.encode()), len(o['runways']), len(o['taxiways']), len(o['aprons']), len(o['buildings'])), flush=True)
        except Exception as ex:
            fails[icao] = str(ex); print('  FAIL', ex, flush=True)
        if not cached: time.sleep(random.uniform(2, 4))
    # index
    idx = {}
    for ap in json.load(open(os.path.join(ROOT, 'public', 'airports.json'))):
        dst = os.path.join(OUT, ap['icao'] + '.json')
        if os.path.exists(dst):
            d = json.load(open(dst))
            r = max([math.hypot((p[0] - ap['lat']) * 111.2, (p[1] - ap['lon']) * 111.2 * math.cos(math.radians(ap['lat']))) for ring in d['bound'] for p in ring] or [1])
            idx[ap['icao']] = [ap['lat'], ap['lon'], round(r, 1), os.path.getsize(dst)]
    with open(os.path.join(OUT, 'index.json'), 'w') as f: json.dump(idx, f, separators=(',', ':'))
    print('done. files=%d fails=%s' % (len(idx), json.dumps(fails)))


if __name__ == '__main__':
    main()
