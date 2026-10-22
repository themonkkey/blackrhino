"""Stream one day of adsb.lol global traces and keep only approaches that end in a clean landing at an Indian airport.

usage: .venv/bin/python extract.py 2026.10.10 [more days...]
Raw archives (~3.5 GB/day) are never written to disk: curl -> tar stream -> worker pool -> data/approaches-YYYY-MM-DD.jsonl.gz
Each record: hex, reg, type, cat, cs, apt, rwy, T (touchdown unix s), pts [[t-T, lat, lon, alt_ft, gs_kt, trk, vr_fpm], ...] for the last hour.
"""
import gzip, json, math, os, subprocess, sys, tarfile, time
from multiprocessing import Pool
import orjson

HERE = os.path.dirname(os.path.abspath(__file__))
APTS = json.load(open(os.path.join(HERE, '..', 'public', 'airports.json')))
BOX = (5.0, 37.5, 66.0, 99.0)          # lat0, lat1, lon0, lon1: Indian airspace incl. approaches from the sea
WINDOW = 3600                          # seconds of approach kept before touchdown


def hav(la1, lo1, la2, lo2):
    r = math.pi / 180
    a = math.sin((la2 - la1) * r / 2) ** 2 + math.cos(la1 * r) * math.cos(la2 * r) * math.sin((lo2 - lo1) * r / 2) ** 2
    return 12742.0 * math.asin(math.sqrt(min(1, a)))


def nearest_apt(lat, lon):
    best, bd = None, 9e9
    for a in APTS:
        if abs(a['lat'] - lat) > .2 or abs(a['lon'] - lon) > .2: continue
        d = hav(lat, lon, a['lat'], a['lon'])
        if d < bd: best, bd = a, d
    return best, bd


def rwy_end(apt, trk):
    """Runway end being landed on, from the final track. Returns e.g. '27' or None."""
    best, bd = None, 30
    for rw in apt.get('runways', []):
        for end in (rw.get('id') or '').split('/'):
            num = ''.join(c for c in end if c.isdigit())
            if not num: continue
            d = abs((int(num) * 10 - trk + 540) % 360 - 180)
            if d < bd: best, bd = end, d
    return best


def thresholds(apt):
    """[(lat, lon, course, id)] for each landing direction."""
    out = []
    for rw in apt.get('runways', []):
        a, b = (rw['pts'][0], rw['pts'][1]), (rw['pts'][2], rw['pts'][3])
        ids = (rw.get('id') or '/').split('/') + ['', '']
        out.append((a[0], a[1], brg(a, b), ids[0])); out.append((b[0], b[1], brg(b, a), ids[1]))
    return out


def brg(a, b):
    r = math.pi / 180; dl = (b[1] - a[1]) * r
    return (math.atan2(math.sin(dl) * math.cos(b[0] * r), math.cos(a[0] * r) * math.sin(b[0] * r) - math.sin(a[0] * r) * math.cos(b[0] * r) * math.cos(dl)) / r + 360) % 360


def short_final(p):
    """Low, lined-up point on short final: (apt, rwy id, seconds to touchdown) or None. Uses GPS altitude when present."""
    alt = p[10] if len(p) > 10 and isinstance(p[10], (int, float)) else p[3]
    if not isinstance(alt, (int, float)) or p[4] is None or p[5] is None or p[4] < 90 or p[4] > 200: return None
    apt, d = nearest_apt(p[1], p[2])
    if apt is None or d > 9 or alt - (apt.get('elev') or 0) > 600: return None
    for la, lo, course, rid in thresholds(apt):
        dt = hav(p[1], p[2], la, lo)
        if dt > 6 or abs((p[5] - course + 540) % 360 - 180) > 20: continue
        if abs((brg((p[1], p[2]), (la, lo)) - course + 540) % 360 - 180) > 25: continue   # threshold must be ahead
        return apt, rid, (dt + .35) * 1000 / (p[4] * 0.514444) + 14   # +14 s: measured bias vs seen touchdowns (flare, deceleration)
    return None


def process(blob):
    if blob[:2] == b'\x1f\x8b': blob = gzip.decompress(blob)
    j = orjson.loads(blob)
    tr = j.get('trace') or []
    lat0, lat1, lon0, lon1 = BOX
    if not any(p[1] is not None and lat0 < p[1] < lat1 and lon0 < p[2] < lon1 for p in tr[::8]): return []
    base = j.get('timestamp', 0)
    out, cs, cat = [], None, None
    last_air = None                    # index of last airborne point
    cand = None                        # (index, apt, rwy, T) last low lined-up fix: used when coverage ends before touchdown

    def emit(k_end, apt, rid, T, how):
        pts, lastt, k = [], 1e9, k_end
        t_td = T - base
        while k >= 0 and tr[k][0] >= t_td - WINDOW:
            q = tr[k]
            if isinstance(q[3], (int, float)) and q[3] <= 26000 and lastt - q[0] >= 4:
                pts.append([round(q[0] - t_td, 1), round(q[1], 5), round(q[2], 5), q[3], q[4], q[5], q[7]])
                lastt = q[0]
            k -= 1
        pts.reverse()
        if len(pts) >= 20 and pts[0][0] < -600:
            out.append({'hex': j['icao'], 'reg': j.get('r'), 'type': j.get('t'), 'cat': cat, 'cs': cs, 'apt': apt['icao'], 'rwy': rid, 'T': round(T, 1), 'how': how, 'pts': pts})

    for i, p in enumerate(tr):
        if cand and cand[0] == i - 1 and p[0] - tr[i - 1][0] > 150 and p[3] != 'ground':   # coverage gap right after short final
            emit(cand[0], cand[1], cand[2], cand[3], 'x'); cand = None
        if p[8]:
            cs = (p[8].get('flight') or cs or '').strip() or cs
            cat = p[8].get('category') or cat
        alt = p[3]
        if alt == 'ground':
            if last_air is None: continue
            pa = tr[last_air]
            apt, d = nearest_apt(p[1], p[2])
            if apt is None or d > 6: last_air = None; continue
            # need a clean low airborne fix right before touchdown. Height is ABOVE THE AIRPORT: Bengaluru sits at 2,915 ft, so an absolute cap dropped every landing there
            if not isinstance(pa[3], (int, float)) or pa[3] - (apt.get('elev') or 0) > 2500 or p[0] - pa[0] > 30:
                last_air = None; continue
            T = base + p[0]
            emit(last_air, apt, rwy_end(apt, pa[5]) if pa[5] is not None else None, T, 'g'); cand = None
            last_air = None
        elif isinstance(alt, (int, float)):
            last_air = i
            sf = short_final(p)
            if sf: cand = (i, sf[0], sf[1], base + p[0] + sf[2])
            elif cand and p[0] - tr[cand[0]][0] > 60: cand = None          # still tracked well after: go-around or circuit, not a landing
    if cand and cand[0] == len(tr) - 1: emit(cand[0], cand[1], cand[2], cand[3], 'x')
    return out


def assets(day):
    tag = f'v{day}-planes-readsb-prod-0'
    r = subprocess.run(['gh', 'api', f'repos/adsblol/globe_history_{day[:4]}/releases/tags/{tag}', '--jq', '.assets[].browser_download_url'],
                       capture_output=True, text=True, check=True)
    return sorted(r.stdout.split())


def members(tf):
    for m in tf:
        if m.isfile() and m.size > 1500 and '/trace_full_' in m.name and '~' not in m.name:
            yield tf.extractfile(m).read()


def run(day):
    out_path = os.path.join(HERE, 'data', f'approaches-{day.replace(".", "-")}.jsonl.gz')
    if os.path.exists(out_path): print(day, 'exists, skip'); return
    urls = assets(day)
    cmd = ' ; '.join(f'curl -sfL --retry 5 "{u}"' for u in urls)
    proc = subprocess.Popen(['sh', '-c', cmd], stdout=subprocess.PIPE, bufsize=1 << 20)
    t0, n, kept = time.time(), 0, 0
    tmp = out_path + '.part'
    try:
        with gzip.open(tmp, 'wt') as f, Pool(7) as pool, tarfile.open(fileobj=proc.stdout, mode='r|') as tf:
            for recs in pool.imap_unordered(process, members(tf), chunksize=32):
                n += 1
                for r in recs: f.write(json.dumps(r, separators=(',', ':')) + '\n'); kept += 1
                if n % 20000 == 0: print(f'{day} {n} traces, {kept} landings, {time.time() - t0:.0f}s', flush=True)
    except tarfile.ReadError as e:
        proc.kill(); os.path.exists(tmp) and os.remove(tmp); raise SystemExit(f'{day}: stream cut ({e}); rerun')
    if proc.wait() != 0: os.remove(tmp); raise SystemExit(f'{day}: download failed')   # a truncated stream must never become a 'complete' day
    os.rename(tmp, out_path)
    print(f'{day} done: {n} traces, {kept} landings in India, {time.time() - t0:.0f}s, {os.path.getsize(out_path) / 1e6:.1f} MB')


if __name__ == '__main__':
    for d in sys.argv[1:]: run(d)
