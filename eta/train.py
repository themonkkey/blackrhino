"""Train the landing-time correction model.

Approaches (data/approaches-*.jsonl.gz) give exact touchdown times at Indian airports with good low-level coverage.
At sample moments along each approach we pretend radar went silent, run the same physics plan the site uses
(shared.js makePlan: fly to a FAF 15 km out on the runway in use, then a 3 deg glide), and learn the residual
(actual - physics) from features that transfer to airports we never see landings at.

usage: .venv/bin/python train.py            -> public/eta-model.json + report
"""
import glob, gzip, json, math, os, sys, urllib.request, csv, io, time
from datetime import datetime, timezone, timedelta
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

HERE = os.path.dirname(os.path.abspath(__file__))
APTS = {a['icao']: a for a in json.load(open(os.path.join(HERE, '..', 'public', 'airports.json')))}
KT = 0.514444
R = math.pi / 180


def km(la1, lo1, la2, lo2):
    a = math.sin((la2 - la1) * R / 2) ** 2 + math.cos(la1 * R) * math.cos(la2 * R) * math.sin((lo2 - lo1) * R / 2) ** 2
    return 12742.0 * math.asin(math.sqrt(min(1, a)))


def bearing(a, b):
    dl = (b[1] - a[1]) * R
    return (math.atan2(math.sin(dl) * math.cos(b[0] * R), math.cos(a[0] * R) * math.sin(b[0] * R) - math.sin(a[0] * R) * math.cos(b[0] * R) * math.cos(dl)) / R + 360) % 360


def dest(p, brg, d):
    dd, br, p1, l1 = d / 6371, brg * R, p[0] * R, p[1] * R
    p2 = math.asin(math.sin(p1) * math.cos(dd) + math.cos(p1) * math.sin(dd) * math.cos(br))
    l2 = l1 + math.atan2(math.sin(br) * math.sin(dd) * math.cos(p1), math.cos(dd) - math.sin(p1) * math.sin(p2))
    return (p2 / R, l2 / R)


def adiff(a, b): return abs((a - b + 540) % 360 - 180)


def runways(t):
    out = []
    for rw in t.get('runways', []):
        A, B = (rw['pts'][0], rw['pts'][1]), (rw['pts'][2], rw['pts'][3])
        ids = (rw.get('id') or '/').split('/') + ['', '']
        out.append((A, bearing(A, B), ids[0], rw.get('len') or 0))
        out.append((B, bearing(B, A), ids[1], rw.get('len') or 0))
    return out


def pick_rwy(t, inbound, wdir):
    """shared.js FT.landingRunway: into the wind if >= 5 kt, else closest to inbound track, slight preference for long runways."""
    best = None
    for thr, course, rid, ln in runways(t):
        ref = wdir if wdir is not None else (inbound if inbound is not None else course)
        score = adiff(course, ref) - ln / 2000
        if best is None or score < best[0]: best = (score, thr, course, rid)
    return best


def plan_T(t, lat, lon, alt, gs, rw):
    """shared.js makePlan total duration (s) and path length (km)."""
    elev, v0 = t.get('elev') or 0, max(gs or 0, 150) * KT
    if rw:
        _, thr, course, _ = rw
        faf, td = dest(thr, (course + 180) % 360, 15), dest(thr, course, .35)
        if km(lat, lon, thr[0], thr[1]) > 16: pts, spd = [(lat, lon), faf, td], [v0, 180 * KT, 135 * KT]
        else: pts, spd = [(lat, lon), td], [v0, 135 * KT]
    else: pts, spd = [(lat, lon), (t['lat'], t['lon'])], [v0, 135 * KT]
    T = L_tot = 0
    for i in range(len(pts) - 1):
        L = max(km(*pts[i], *pts[i + 1]) * 1000, 1); va, vb = spd[i], spd[i + 1]; b = (vb - va) / L
        T += L / va if abs(b) < 1e-9 else math.log(1 + b * L / va) / b
        L_tot += L
    return T, L_tot / 1000


# ---------- METAR wind (Iowa Environmental Mesonet archive) ----------
def metar(icaos, t0, t1):
    path = os.path.join(HERE, 'data', f'metar-{t0:%Y%m%d}-{t1:%Y%m%d}.csv')
    if not os.path.exists(path):
        q = ''.join(f'&station={i}' for i in sorted(icaos))
        url = (f'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?data=drct&data=sknt&tz=Etc/UTC&format=onlycomma&latlon=no&missing=M&trace=T'
               f'&direct=no&report_type=3&report_type=4&year1={t0.year}&month1={t0.month}&day1={t0.day}&year2={t1.year}&month2={t1.month}&day2={t1.day}{q}')
        open(path, 'wb').write(urllib.request.urlopen(url, timeout=120).read())
    W = {}
    for r in csv.DictReader(open(path)):
        try: ts = datetime.strptime(r['valid'], '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc).timestamp()
        except ValueError: continue
        d = float(r['drct']) if r['drct'] not in ('M', '') else None
        s = float(r['sknt']) if r['sknt'] not in ('M', '') else 0
        W.setdefault(r['station'], []).append((ts, d, s))
    for v in W.values(): v.sort()
    return W


def wind_at(W, icao, ts):
    """Latest report at or before ts (within 90 min), as the live site would have it. Returns wdir used for runway pick or None."""
    obs = W.get(icao)
    if not obs: return None
    lo, hi = 0, len(obs)
    while lo < hi:
        m = (lo + hi) // 2
        if obs[m][0] <= ts: lo = m + 1
        else: hi = m
    if lo == 0 or ts - obs[lo - 1][0] > 5400: return None
    _, d, s = obs[lo - 1]
    return d if (d is not None and s >= 5) else None


# ---------- features ----------
TURBO = ('AT4', 'AT7', 'ATR', 'DH8', 'Q40', 'DHC', 'B190', 'C208', 'D228', 'SF34', 'J41', 'E120')
FEATS = ['phys_T', 'path_km', 'alt_agl', 'gs', 'vr', 'dist_apt', 'dist_thr', 'off_axis', 'trk_vs_rwy', 'trk_vs_apt',
         'alt_excess', 'by_wind', 'n_rwy', 'max_len', 'heavy', 'turbo', 'hour_sin', 'hour_cos', 'alt_band_lo']


def cls(typ, cat):
    t = (typ or '').upper()
    heavy = 1 if cat == 'A5' or t[:3] in ('B77', 'B78', 'B74', 'A33', 'A34', 'A35', 'A38', 'B76', 'MD1', 'IL7') else 0
    turbo = 1 if t.startswith(TURBO) or cat == 'A2' and t[:2] in ('AT', 'DH') else 0
    return heavy, turbo


def features(t, q, ts, wdir, typ, cat):
    lat, lon, alt, gs, trk, vr = q
    rw = pick_rwy(t, trk, wdir)
    T, L = plan_T(t, lat, lon, alt, gs, rw)
    elev = t.get('elev') or 0
    thr, course = (rw[1], rw[2]) if rw else ((t['lat'], t['lon']), trk or 0)
    d_thr = km(lat, lon, thr[0], thr[1])
    off = adiff(bearing(thr, (lat, lon)), (course + 180) % 360)       # 0 = on the extended centreline
    alt_agl = (alt or 0) - elev
    glide_alt = d_thr * 1000 * math.tan(3 * R) / .3048                 # ft a 3 deg path would have here
    hour = ((ts + 5.5 * 3600) % 86400) / 3600                          # IST
    heavy, turbo = cls(typ, cat)
    rws = t.get('runways', [])
    return [T, L, alt_agl, gs or 0, max(-6000, min(3000, vr or 0)), km(lat, lon, t['lat'], t['lon']), d_thr, off,
            adiff(trk or 0, course), adiff(trk or 0, bearing((lat, lon), (t['lat'], t['lon']))),
            alt_agl - glide_alt, 1 if wdir is not None else 0, len(rws), max([r.get('len') or 0 for r in rws] or [0]) / 1000,
            heavy, turbo, math.sin(hour / 24 * 2 * math.pi), math.cos(hour / 24 * 2 * math.pi), 1 if alt_agl < 9000 else 0]


def build():
    files = sorted(glob.glob(os.path.join(HERE, 'data', 'approaches-*.jsonl.gz')) + glob.glob(os.path.join(HERE, 'data', 'live', 'approaches-*.jsonl')))
    if not files: sys.exit('no approach data')
    recs = []
    for f in files:          # archive days (adsb.lol history) + our own live recordings (adsb.fi + adsb.lol around the priority airports)
        d = os.path.basename(f)[11:21]
        for l in (gzip.open(f, 'rt') if f.endswith('.gz') else open(f)):
            r = json.loads(l); r['_d'] = d; recs.append(r)
    recs = [r for r in recs if r['apt'] in APTS and APTS[r['apt']].get('runways')]
    t0 = datetime.fromtimestamp(min(r['T'] for r in recs), timezone.utc) - timedelta(days=1)
    t1 = datetime.fromtimestamp(max(r['T'] for r in recs), timezone.utc) + timedelta(days=1)
    W = metar({r['apt'] for r in recs}, t0, t1)
    X, y, base, grp, band, howl, dayl = [], [], [], [], [], [], []
    rng = np.random.default_rng(7)
    for r in recs:
        t = APTS[r['apt']]
        pts = r['pts']
        nxt = -1e9
        for p in pts:                                   # sample a "radar went silent here" moment every ~45 s
            tq, lat, lon, alt, gs, trk, vr = p
            if tq < -2700 or tq > -45 or tq < nxt: continue
            if not isinstance(alt, (int, float)) or alt - (t.get('elev') or 0) < 1500 or alt > 24000 or gs is None or trk is None: continue
            nxt = tq + 45 + rng.uniform(-10, 10)
            ts = r['T'] + tq
            f = features(t, (lat, lon, alt, gs, trk, vr), ts, wind_at(W, r['apt'], ts), r.get('type'), r.get('cat'))
            X.append(f); y.append(-tq); base.append(f[0]); grp.append(r['apt']); band.append(alt - (t.get('elev') or 0)); howl.append(r.get('how', 'g')); dayl.append(r['_d'])
    return np.array(X), np.array(y), np.array(base), np.array(grp), np.array(band), recs, np.array(howl), np.array(dayl)


def tree_json(model):
    out = []
    for preds in model._predictors:
        nodes = preds[0].nodes
        out.append([[int(n['feature_idx']), float(n['num_threshold']), int(n['left']), int(n['right']), int(n['is_leaf']),   # full-precision thresholds: rounding flips borderline samples
                     round(float(n['value']), 3), int(n['missing_go_to_left'])] for n in nodes])
    return {'base': float(model._baseline_prediction.ravel()[0]), 'trees': out}


PARAMS = dict(max_iter=220, max_depth=5, learning_rate=.06, min_samples_leaf=40, l2_regularization=1.0, early_stopping=False, random_state=0)   # no early stopping: sklearn turns it on silently above 10k rows with a random split
CANDIDATES = {                       # what we compare and why: each is a simpler/rival way to get the same answer
    'physics':      lambda: None,                                                   # the plan already on the site
    'physics+bias': lambda: 'bias',                                                 # physics shifted by the median error (is it just a constant?)
    'ridge':        lambda: 'ridge',                                                # linear correction (is the signal simple?)
    'gbm':          lambda: HistGradientBoostingRegressor(loss='absolute_error', **PARAMS),
}


def fit_pred(name, Xtr, rtr, Xte):
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline
    if name == 'physics': return np.zeros(len(Xte))
    if name == 'physics+bias': return np.full(len(Xte), np.median(rtr))
    if name == 'ridge': return make_pipeline(StandardScaler(), Ridge(alpha=10)).fit(Xtr, rtr).predict(Xte)
    return HistGradientBoostingRegressor(loss='absolute_error', **PARAMS).fit(Xtr, rtr).predict(Xte)


def mae(a, b): return float(np.abs(a - b).mean())


def main():
    X, y, base, grp, band, recs, how, day = build()
    resid = y - base
    true_lab = how == 'g'                               # touchdowns actually seen: the honest test set. Extrapolated ones (x) only train.
    days = sorted(set(day))
    print(f'{len(recs)} landings ({sum(1 for r in recs if r.get("how") == "g")} seen, {sum(1 for r in recs if r.get("how") == "x")} extrapolated), '
          f'{len(set(grp))} airports, {len(y)} samples, {len(days)} days')
    report = {}

    # ---- 1. model selection: leave-airports-out CV (can it help airports it has never seen?) ----
    gk = GroupKFold(n_splits=min(5, len(set(grp))))
    oof = {n: np.zeros(len(y)) for n in CANDIDATES}
    for tr, te in gk.split(X, y, grp):
        for n in CANDIDATES: oof[n][te] = base[te] + fit_pred(n, X[tr], resid[tr], X[te])
    def line(name, m):
        e = {n: np.abs(oof[n][m] - y[m]) for n in CANDIDATES}
        r = {n: {'mae_s': round(float(e[n].mean()), 1), 'p90_s': round(float(np.percentile(e[n], 90)), 1), 'within2m': round(float((e[n] < 120).mean()), 3)} for n in CANDIDATES}
        print(f'{name:>20} n={int(m.sum()):6d} ' + ' | '.join(f'{n} {r[n]["mae_s"]:5.0f}s ({r[n]["within2m"]:.0%})' for n in CANDIDATES))
        return r
    print('\n[1] model selection, leave-airports-out, real touchdowns only (MAE, share within 2 min):')
    report['selection'] = {'all': line('all', true_lab), 'lost_6k_10k': line('lost 6-10k ft', true_lab & (band >= 6000) & (band < 10000)),
                           'lost_2k_6k': line('lost 2-6k ft', true_lab & (band >= 2000) & (band < 6000)), 'lost_10k+': line('lost 10k+ ft', true_lab & (band >= 10000))}
    print('   (sanity) same band incl. extrapolated labels, label error ~5 s:'); report['selection']['lost_6k_10k_all_labels'] = line('6-10k, all labels', (band >= 6000) & (band < 10000))
    winner = min(CANDIDATES, key=lambda n: report['selection']['lost_6k_10k'][n]['mae_s'])
    print('   -> chosen on the 6-10k ft band (the case we care about):', winner)

    # ---- 2. does it hold up in time? train on earlier days, test on the newest day ----
    if len(days) >= 2:
        print('\n[2] learning curve: train on the first k days, test on the last day (all airports, real touchdowns):')
        big = [d for d in days if int(((day == d) & true_lab).sum()) >= 1500]      # a day with too few real touchdowns (e.g. today's live file) can't be a test set
        tday = big[-1]; days_tr = [d for d in days if d < tday]
        test = (day == tday) & true_lab
        print(f'   (test day {tday}: {int(test.sum())} real-touchdown samples)')
        curve = []
        for k in range(1, len(days_tr) + 1):
            tr = np.isin(day, days_tr[:k])
            p = base[test] + fit_pred('gbm', X[tr], resid[tr], X[test])
            curve.append({'train_days': k, 'train_landings': sum(1 for r in recs if r['_d'] in days_tr[:k]),
                          'gbm_mae_s': round(mae(p, y[test]), 1), 'physics_mae_s': round(mae(base[test], y[test]), 1), 'gbm_within2m': round(float((np.abs(p - y[test]) < 120).mean()), 3)})
            print(f'   {k} day(s): GBM MAE {curve[-1]["gbm_mae_s"]:6.1f}s  within 2 min {curve[-1]["gbm_within2m"]:.0%}   (physics {curve[-1]["physics_mae_s"]:.1f}s)')
        report['learning_curve'] = curve

    # ---- 3. the range: quantile models, then conformal calibration so "80% of landings fall inside" is actually true ----
    oof10, oof90 = np.zeros(len(y)), np.zeros(len(y))
    for tr, te in gk.split(X, y, grp):
        oof10[te] = base[te] + HistGradientBoostingRegressor(loss='quantile', quantile=.1, **PARAMS).fit(X[tr], resid[tr]).predict(X[te])
        oof90[te] = base[te] + HistGradientBoostingRegressor(loss='quantile', quantile=.9, **PARAMS).fit(X[tr], resid[tr]).predict(X[te])
    lo, hi = np.minimum(oof10, oof90), np.maximum(oof10, oof90)
    raw_cov = float(((y >= lo) & (y <= hi))[true_lab].mean())
    score = np.maximum(lo - y, y - hi)[true_lab]
    cqr = float(np.quantile(score, 0.8 * (1 + 1 / len(score))))     # widen (or narrow) both ends by this many seconds
    cov = float(((y >= lo - cqr) & (y <= hi + cqr))[true_lab].mean())
    width = float((hi - lo + 2 * cqr)[true_lab].mean())
    print(f'\n[3] 80% range: raw quantile models cover {raw_cov:.0%}; after calibration ({cqr:+.0f} s each side) cover {cov:.0%}, mean width {width / 60:.1f} min')
    report['range'] = {'raw_coverage': round(raw_cov, 3), 'calibrated_coverage': round(cov, 3), 'cqr_shift_s': round(cqr, 1), 'mean_width_min': round(width / 60, 2)}

    # ---- 4. per airport sanity + the ship/no-ship gate ----
    per = {}
    for a in sorted(set(grp), key=lambda a: -(grp == a).sum())[:10]:
        m = (grp == a) & true_lab
        if m.sum() < 30: continue
        per[a] = {'n': int(m.sum()), 'physics_s': round(mae(oof['physics'][m], y[m]), 1), 'gbm_s': round(mae(oof['gbm'][m], y[m]), 1)}
    print('\n[4] per airport (never seen in training):', {k: f'{v["physics_s"]:.0f}->{v["gbm_s"]:.0f}s (n={v["n"]})' for k, v in per.items()})
    sel = report['selection']['lost_6k_10k']
    gate = winner == 'gbm' and sel['gbm']['mae_s'] < .9 * sel['physics']['mae_s'] and len(recs) >= 300
    report['ship'] = bool(gate)
    print('\nship gate (GBM wins and beats physics by >10% on the 6-10k band, >=300 landings):', 'PASS' if gate else 'FAIL')

    final = {'v': 2, 'feats': FEATS, 'cqr': round(cqr, 1)}
    ms = {'q50': HistGradientBoostingRegressor(loss='absolute_error', **PARAMS).fit(X, resid),
          'q10': HistGradientBoostingRegressor(loss='quantile', quantile=.1, **PARAMS).fit(X, resid),
          'q90': HistGradientBoostingRegressor(loss='quantile', quantile=.9, **PARAMS).fit(X, resid)}
    for k, m in ms.items(): final[k] = tree_json(m)
    ci = np.random.default_rng(3).choice(len(X), 25, replace=False)      # self-check for the browser: eta/parity.py replays these through public/eta.js logic
    final['check'] = {'x': [[float(v) for v in row] for row in X[ci]], **{k: [round(float(v), 3) for v in m.predict(X[ci])] for k, m in ms.items()}}
    final['meta'] = {'trained': datetime.now(timezone.utc).strftime('%Y-%m-%d'), 'landings': len(recs), 'airports': len(set(grp)), 'days': days,
                     'mae_6k_10k_s': sel['gbm']['mae_s'], 'physics_mae_6k_10k_s': sel['physics']['mae_s'], 'range80_width_min': report['range']['mean_width_min']}
    out = os.path.join(HERE, '..', 'public', 'eta-model.json')
    if gate:
        json.dump(final, open(out, 'w'), separators=(',', ':')); print('wrote', out, f'{os.path.getsize(out) / 1e3:.0f} KB')
    else: print('NOT writing model (gate failed); keeping whatever is deployed')
    json.dump({**final['meta'], **report, 'per_airport': per, 'landings': len(recs)}, open(os.path.join(HERE, 'report.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
