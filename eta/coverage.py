"""Where do we lose arriving aircraft? Streams a day of adsb.lol traces (nothing stored but a tiny summary) and, for every
descending aircraft heading to a large Indian airport, records the altitude (feet above the airport) where its feed ends:
  seen      feed continues to the ground
  lost      feed stops in the air and never comes back before the trace ends
  unseen    feed stops in the air, then the aircraft reappears on the ground at that airport (it landed in our blind spot)
usage: .venv/bin/python coverage.py 2026.10.10   -> data/coverage-2026-10-10.json
"""
import gzip, json, math, os, subprocess, sys, tarfile, time
from multiprocessing import Pool
import orjson
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract


def adiff(a, b): return abs((a - b + 540) % 360 - 180)

HERE = os.path.dirname(os.path.abspath(__file__))
LARGE = [a for a in extract.APTS if a.get('type') in ('large', 'medium') and a.get('sched')]
BINS = [(0, 1000), (1000, 2000), (2000, 4000), (4000, 8000), (8000, 12000)]


def near_large(lat, lon, maxkm=120):
    best, bd = None, 9e9
    for a in LARGE:
        if abs(a['lat'] - lat) > 1.2 or abs(a['lon'] - lon) > 1.4: continue
        d = extract.hav(lat, lon, a['lat'], a['lon'])
        if d < bd: best, bd = a, d
    return (best, bd) if best and bd <= maxkm else (None, None)


def events(blob):
    if blob[:2] == b'\x1f\x8b': blob = gzip.decompress(blob)
    j = orjson.loads(blob); tr = j.get('trace') or []
    lat0, lat1, lon0, lon1 = extract.BOX
    if not any(p[1] is not None and lat0 < p[1] < lat1 and lon0 < p[2] < lon1 for p in tr[::8]): return []
    out = []
    n = len(tr)
    for e in range(n):
        p = tr[e]
        alt = p[3]
        if alt == 'ground' or not isinstance(alt, (int, float)) or p[5] is None: continue
        nxt = tr[e + 1] if e + 1 < n else None
        gap = (nxt[0] - p[0]) if nxt else 1e9
        if nxt and gap <= 120 and nxt[3] != 'ground': continue          # still tracked: not an end point
        apt, d = near_large(p[1], p[2])
        if not apt: continue
        agl = alt - (apt.get('elev') or 0)
        if agl > 25000 or agl < -200: continue
        if adiff(p[5], extract.brg((p[1], p[2]), (apt['lat'], apt['lon']))) > 55: continue   # heading to it
        prev = next((tr[k] for k in range(e - 1, max(e - 60, -1), -1) if p[0] - tr[k][0] >= 45 and isinstance(tr[k][3], (int, float))), None)
        vr = p[7] if len(p) > 7 and isinstance(p[7], (int, float)) else None
        if not ((vr is not None and vr < -300) or (prev and prev[3] - alt > 150)): continue            # descending
        if nxt and nxt[3] == 'ground' and extract.hav(nxt[1], nxt[2], apt['lat'], apt['lon']) < 8 and gap <= 120:
            kind = 'seen'
        elif nxt and nxt[3] == 'ground' and extract.hav(nxt[1], nxt[2], apt['lat'], apt['lon']) < 8 and gap <= 3600:
            kind = 'unseen'
        elif nxt is None or gap > 1800:
            kind = 'lost'
        else:
            continue                                                   # reappeared airborne: hold, go-around or something else
        out.append((apt['icao'], kind, int(agl), round(d)))
    return out


def run(day):
    out_path = os.path.join(HERE, 'data', f'coverage-{day.replace(".", "-")}.json')
    proc = subprocess.Popen(['sh', '-c', ' ; '.join(f'curl -sfL --retry 5 "{u}"' for u in extract.assets(day))], stdout=subprocess.PIPE, bufsize=1 << 20)
    ev, n, t0 = [], 0, time.time()
    try:
        with Pool(7) as pool, tarfile.open(fileobj=proc.stdout, mode='r|') as tf:
            for r in pool.imap_unordered(events, extract.members(tf), chunksize=32):
                n += 1; ev += r
                if n % 20000 == 0: print(f'{day} {n} traces, {len(ev)} arrivals, {time.time() - t0:.0f}s', flush=True)
    except tarfile.ReadError as e:
        proc.kill(); raise SystemExit(f'{day}: stream cut ({e}); rerun')
    if proc.wait() != 0: raise SystemExit(f'{day}: download failed')
    json.dump({'day': day, 'events': ev}, open(out_path, 'w'))
    print(day, 'done', len(ev), 'arrivals', f'{time.time() - t0:.0f}s')


if __name__ == '__main__':
    for d in sys.argv[1:]: run(d)
