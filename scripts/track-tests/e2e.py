import json, os, sys, time, subprocess, urllib.request, base64, datetime
from playwright.sync_api import sync_playwright
S = os.path.dirname(os.path.abspath(__file__)); FX = S + '/fx'; OUT = S + '/shots'; os.makedirs(OUT, exist_ok=True)
BASE = 'http://127.0.0.1:8656'
today = (datetime.datetime.now(datetime.UTC).replace(tzinfo=None) + datetime.timedelta(hours=5, minutes=30)).date()
iso = lambda d: d.isoformat()
res = {}
def ok(name, cond, info=''): res[name] = bool(cond); print(('PASS ' if cond else 'FAIL ') + name, info)

# a flight that is airborne over India right now, with its IATA number from adsbdb
live = json.load(urllib.request.urlopen(urllib.request.Request('https://flight-tracker-india.vercel.app/api/flights', headers={'User-Agent': 'Mozilla/5.0'}), timeout=60))
cands = [a for a in live['ac'] if (a.get('flight') or '').startswith(('IGO', 'AKJ', 'SEJ', 'AXB')) and not a.get('ground') and (a.get('alt') or 0) > 15000]
LIVE = None
for a in cands[:12]:
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(f"https://api.adsbdb.com/v0/callsign/{a['flight']}", headers={'User-Agent': 'blackrhino-test'}), timeout=15))
        fr = r['response']['flightroute']
        if fr and fr.get('callsign_iata') and fr.get('callsign_icao') == a['flight'] and __import__('re').fullmatch(r'[A-Z0-9]{2}\d{1,4}', fr['callsign_iata']): LIVE = (fr['callsign_iata'], a['flight'], fr['origin']['iata_code'], fr['destination']['iata_code']); break
    except Exception: pass
print('live flight for test:', LIVE)
CODED = None
for a in [x for x in live['ac'] if __import__('re').fullmatch(r'AIC\d[A-Z]{2}', x.get('flight') or '') and not x.get('ground')][:10]:
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(f"https://api.adsbdb.com/v0/callsign/{a['flight']}", headers={'User-Agent': 'blackrhino-test'}), timeout=15))
        fr = r['response']['flightroute']
        if fr and fr['origin'].get('icao_code') and fr['destination'].get('icao_code'): CODED = (a['flight'], fr); break
    except Exception: pass
print('coded flight for test:', CODED and (CODED[0], CODED[1]['origin']['iata_code'], CODED[1]['destination']['iata_code']))

pass_html = lambda img: f'''<html><body style="margin:0;background:#fff;font:16px Arial;width:390px">
<div style="background:#1a237e;color:#fff;padding:18px">IndiGo · Boarding pass</div><div style="padding:18px">
<div style="font-size:28px;font-weight:bold">BBI → DEL</div><div>Flight 6E 2024 · 05 Nov 2026 · Seat 12A · Gate 4</div>
<div>Passenger KUMAR/TESTPASSENGER · PNR XYZ123</div>
<img src="data:image/png;base64,{base64.b64encode(open(img,'rb').read()).decode()}" style="width:340px;margin-top:20px;image-rendering:pixelated"></div></body></html>'''

with sync_playwright() as p:
    # fixtures: phone screenshot of a pass, and a PDF pass
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 390, 'height': 760}, device_scale_factor=2)
    pg.set_content(pass_html(FX + '/pdf417.png')); pg.screenshot(path=FX + '/pass-shot.png')
    pg.set_content(pass_html(FX + '/aztec.png')); pg.screenshot(path=FX + '/pass-aztec.png')
    pg.set_content(pass_html(FX + '/pdf417.png')); pg.pdf(path=FX + '/pass.pdf', width='390px', height='760px', print_background=True)
    b.close()
    # camera feed: the pass screenshot as a looping video
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-loop', '1', '-i', FX + '/pdf417.png', '-t', '3', '-vf', 'scale=900:-2:flags=neighbor,pad=1280:720:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p', '-r', '10', FX + '/cam.y4m'], check=True)

    def run(engine, name, steps, viewport={'width': 1280, 'height': 800}, args=None, perms=None):
        br = getattr(p, engine).launch(args=args or [])
        ctx = br.new_context(viewport=viewport, permissions=perms or [])
        pg = ctx.new_page(); errs, reqs = [], []
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('request', lambda r: reqs.append(r.url + ' ' + (r.post_data or '')))
        try: steps(pg)
        except Exception as e: errs.append('STEP FAILED: ' + str(e)[:300])
        pg.screenshot(path=f'{OUT}/{engine}-{name}.png')
        store = pg.evaluate('() => JSON.stringify(localStorage)')
        br.close()
        real = [e for e in errs if 'favicon' not in e and 'arcgisonline' not in e]
        return real, reqs, store

    def upload(path):
        def f(pg):
            pg.goto(BASE + '/track'); pg.wait_for_selector('#fno')
            pg.set_input_files('#file', path)
            pg.wait_for_selector('#pick:not(.hide)', timeout=45000)
        return f
    for engine in ['chromium', 'webkit']:
        for fx in ['pass-shot.png', 'pass-aztec.png', 'pass.pdf', 'two-legs.png']:
            errs, reqs, store = run(engine, 'upload-' + fx.split('.')[0], lambda pg, fx=fx: (upload(FX + '/' + fx)(pg), res.__setitem__('_found', pg.inner_text('#found'))))
            found = res.pop('_found', '')
            want = '6E 2024' in found and ('Thu, 5 Nov' in found or '5 Nov' in found) and 'BBI → DEL' in found
            if fx == 'two-legs.png': want = want and 'AI 868' in found and 'DEL → BOM' in found
            leak = [r for r in reqs if 'KUMAR' in r or 'XYZ123' in r or 'ABC789' in r]
            ok(f'{engine} upload {fx}', want and not errs and not leak, f'found={found!r} errs={errs[:3]} leak={leak[:2]}')

    # pick -> track url
    def pick(pg):
        upload(FX + '/pass-shot.png')(pg); pg.click('#found button'); pg.wait_for_url('**/track/6E2024?d=2026-11-05', timeout=15000)
        res['_url'] = pg.url
    errs, reqs, store = run('chromium', 'pick', pick)
    ok('confirm -> share url has only flight+date', res.pop('_url', '').endswith('/track/6E2024?d=2026-11-05') and 'KUMAR' not in store and 'XYZ' not in store, f'store={store[:200]} errs={errs[:2]}')

    # paste ticket text
    def paste(pg):
        pg.goto(BASE + '/track'); pg.click('summary'); pg.fill('#paste', 'PNR 6EK2PQ  Flight 6E 2024 BBI-DEL  Departure 05 Nov 2026 06:10'); pg.click('#pasteGo')
        pg.wait_for_selector('#pick:not(.hide)'); res['_t'] = pg.inner_text('#found')
    errs, _, _ = run('chromium', 'paste', paste)
    t = res.pop('_t', ''); ok('paste ticket text', '6E 2024' in t and '5 Nov' in t and not errs, f'{t!r} {errs[:2]}')

    # camera with a fake video of the pass
    def cam(pg):
        pg.goto(BASE + '/track'); pg.click('#scan'); pg.wait_for_selector('#pick:not(.hide)', timeout=40000); res['_c'] = pg.inner_text('#found')
    errs, _, _ = run('chromium', 'camera', cam, args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={FX}/cam.y4m'], perms=['camera'])
    c = res.pop('_c', ''); ok('camera scan', '6E 2024' in c and not errs, f'{c!r} {errs[:2]}')

    # tracking states
    def st(url, wait=12):
        def f(pg):
            pg.goto(BASE + url); pg.wait_for_selector('#live:not(.hide)'); pg.wait_for_timeout(wait * 1000)
            res['_s'] = pg.inner_text('#state') + ' | ' + pg.inner_text('#note') + ' | ' + pg.inner_text('.tiles').replace('\n', ' ') + ' | ' + pg.inner_text('.route').replace('\n', ' ')
        return f
    if LIVE:
        errs, reqs, _ = run('chromium', 'live', st(f'/track/{LIVE[0]}?d={iso(today)}', 14))
        s = res.pop('_s', ''); ok('live flight shows in the air', any(k in s for k in ('In the air', 'climbing', 'Descending', 'Landing soon')) and 'ft' in s and not errs, f'{LIVE} :: {s[:260]} {errs[:2]}')
        errs, _, _ = run('chromium', 'live-phone', st(f'/track/{LIVE[0]}?d={iso(today)}', 10), viewport={'width': 390, 'height': 844})
        res.pop('_s', None); ok('live flight phone layout no errors', not errs, str(errs[:2]))
        errs, _, _ = run('chromium', 'past', st(f'/track/{LIVE[0]}?d={iso(today - datetime.timedelta(days=3))}', 8))
        s = res.pop('_s', ''); ok('past date shows record or no-record', any(k in s for k in ('Landed', 'Flew', 'No record')) and not errs, f'{s[:260]} {errs[:2]}')
    errs, _, _ = run('chromium', 'future', st(f'/track/6E2024?d={iso(today + datetime.timedelta(days=4))}', 4))
    s = res.pop('_s', ''); ok('future date shows coming up', 'Coming up' in s and not errs, f'{s[:200]} {errs[:2]}')
    errs, _, _ = run('chromium', 'form', lambda pg: (pg.goto(BASE + '/track'), pg.wait_for_timeout(2500)))
    ok('form loads clean', not errs, str(errs[:3]))
    errs, _, _ = run('webkit', 'form-phone', lambda pg: (pg.goto(BASE + '/track'), pg.wait_for_timeout(2500)), viewport={'width': 390, 'height': 844})
    ok('form loads clean in webkit phone', not errs, str(errs[:3]))
    def bad(pg):
        pg.goto(BASE + '/track/12345?d=garbage'); pg.wait_for_timeout(1500); res['_b'] = pg.inner_text('#askmsg')
    errs, _, _ = run('chromium', 'bad', bad)
    ok('bad link falls back to form', 'no valid flight' in res.pop('_b', '') and not errs, str(errs[:2]))
    if CODED:
        cs, fr = CODED
        mock = {'response': {'flightroute': {**fr, 'callsign': 'AI9999', 'callsign_icao': 'AIC9999', 'callsign_iata': 'AI9999'}}}
        def coded(pg):
            pg.route('https://api.adsbdb.com/v0/callsign/AI9999', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(mock)))
            pg.goto(BASE + '/track/AI9999?d=' + iso(today)); pg.wait_for_selector('#cands:not(.hide)', timeout=40000)
            res['_k'] = pg.inner_text('#cands') + ' || chip=' + pg.inner_text('#state')
            pg.click(f'#candsList button[data-cs="{cs}"]'); pg.wait_for_timeout(3000)
            res['_k2'] = pg.url + ' || ' + pg.inner_text('#state')
        errs, _, _ = run('chromium', 'coded', coded)
        k, k2 = res.pop('_k', ''), res.pop('_k2', '')
        ok('coded callsign offered, not auto-picked', cs in k and "That's mine" in k and 'Not on radar' in k, k[:300])
        ok('picking a coded callsign tracks it and keeps it in the link', k2.split(' || ')[0].endswith(f'&cs={cs}') and any(w in k2 for w in ('In the air', 'climbing', 'Descending', 'Landing', 'No signal')), k2[:200] + str(errs[:2]))
    def unk(pg):
        pg.goto(BASE + '/track/ZZ9?d=' + iso(today)); pg.wait_for_timeout(5000); res['_u'] = pg.inner_text('#state') + ' ' + pg.inner_text('#note')
    errs, _, _ = run('chromium', 'unknown', unk)
    u = res.pop('_u', ''); ok('unknown airline explained', 'Unknown airline' in u, u[:160])
print(json.dumps({k: v for k, v in res.items()}, indent=0))
print('ALL PASS' if all(res.values()) else 'SOME FAILED')
