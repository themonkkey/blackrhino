#!/usr/bin/env python3
"""Generate the static, crawlable airport pages (public/airport/*.html), the airports hub and sitemap.xml.
Run from the repo root:  python3 scripts/gen-seo.py
Each airport page has real content (facts, runways, nearby airports) plus a live list of aircraft within 25 km that the
browser fills in from /api/flights. No page is generated for an airport without runway data."""
import json, math, os, re, html, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
SITE = 'https://blackrhino.in'
TODAY = datetime.date.today().isoformat()
A = [a for a in json.load(open(os.path.join(PUB, 'airports.json'))) if a.get('iata') and a.get('city') and a.get('runways')]
PAGES = [a for a in A if a['type'] == 'large']
SURF = {'ASPH': 'asphalt', 'CONC': 'concrete', 'ASP': 'asphalt', 'GRVL': 'gravel', 'GRS': 'grass', 'TURF': 'grass'}
esc = html.escape
slug = lambda a: a['iata'].lower()
km = lambda a, b: 12742 * math.asin(math.sqrt(math.sin(math.radians(b['lat'] - a['lat']) / 2) ** 2 + math.cos(math.radians(a['lat'])) * math.cos(math.radians(b['lat'])) * math.sin(math.radians(b['lon'] - a['lon']) / 2) ** 2))
term = open(os.path.join(PUB, 'terms.html')).read()
HEAD_SVG = re.search(r'<a class="wm" href="/">(.*?)</a>', term, re.S).group(1)
FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat+Alternates:wght@400;500&family=Montserrat:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap">'
HEADER = f'<header><div class="wrap"><a class="wm" href="/">{HEAD_SVG}</a><nav><a href="/map">Radar</a><a href="/track">Track</a><a href="/airports">Airports</a><a href="/3d">3D India</a><a href="/about">About</a><a href="/privacy">Privacy</a></nav></div></header>'
FOOTER = '<footer><div class="wrap"><span>© 2026 BlackRhino · blackrhino.in · free educational project, not for profit</span><span>Positions from community ADS-B. Not for navigation. Not affiliated with any airline, airport or data provider.</span></div></footer>'
CSS = '<style>.wrap.wide{max-width:900px}main h2{text-transform:none}h1.ap{text-transform:none;font-size:clamp(34px,6vw,60px);line-height:1}.lead{font-size:18px;color:var(--ink-2);max-width:680px}.cta{display:inline-block;margin:6px 0 0;padding:11px 20px;border-radius:999px;background:var(--sky);color:#04101a;font:600 14px var(--sans)}.cta:hover{text-decoration:none;filter:brightness(1.08)}#nowList td:first-child{font-family:var(--mono);font-size:14px}.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}.chips a{display:block;padding:6px 14px;border:1px solid var(--line);border-radius:999px;color:var(--ink-2);font-size:14px}.chips a:hover{border-color:var(--sky);text-decoration:none;color:var(--ink)}.muted{color:var(--mute);font-size:13px}details{border-bottom:1px solid var(--line);padding:12px 0}summary{cursor:pointer;color:var(--ink);font-weight:500}</style>'

def page(path, title, desc, body, ld, extra_head=''):
    out = f'''<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title><meta name="description" content="{esc(desc)}"><meta name="theme-color" content="#030405">
<link rel="canonical" href="{SITE}{path}"><link rel="icon" type="image/svg+xml" href="/icons/mark.svg">
<meta property="og:type" content="website"><meta property="og:site_name" content="BlackRhino"><meta property="og:locale" content="en_IN"><meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{SITE}{path}"><meta property="og:image" content="{SITE}/og.jpg">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{esc(title)}"><meta name="twitter:description" content="{esc(desc)}"><meta name="twitter:image" content="{SITE}/og.jpg">
{FONTS}<link rel="stylesheet" href="/legal.css">{CSS}{extra_head}
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script></head><body>
{HEADER}
{body}
{FOOTER}
</body></html>
'''
    os.makedirs(os.path.dirname(os.path.join(PUB, path.lstrip('/') + '.html')), exist_ok=True)
    open(os.path.join(PUB, path.lstrip('/') + '.html'), 'w').write(out)

LIVE_JS = '''<script>
(function(){const A=%s,tb=document.getElementById('nowBody'),ct=document.getElementById('nowCount');
const hav=(a,b,c,d)=>{const p=Math.PI/180,x=Math.sin((c-a)*p/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin((d-b)*p/2)**2;return 12742*Math.asin(Math.sqrt(x))};
const e=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
fetch('/api/flights').then(r=>{if(!r.ok)throw 0;return r.json()}).then(j=>{
  const L=(j.ac||[]).filter(d=>d.lat!=null&&hav(A.lat,A.lon,d.lat,d.lon)<25).sort((a,b)=>hav(A.lat,A.lon,a.lat,a.lon)-hav(A.lat,A.lon,b.lat,b.lon));
  ct.textContent=L.length?L.length+' aircraft within 25 km right now':'No aircraft within 25 km right now';
  tb.innerHTML=L.slice(0,12).map(d=>'<tr><td>'+e(d.flight||d.hex)+'</td><td>'+e(d.type||'')+'</td><td>'+(d.ground?'on the ground':Math.round((d.alt||0)/100)*100+' ft')+'</td><td>'+Math.round(hav(A.lat,A.lon,d.lat,d.lon))+' km</td></tr>').join('');
}).catch(()=>{ct.textContent='Live data is not available right now.'});})();
</script>'''

def airport_page(a):
    nm = a['name']; city = a['city']; iata = a['iata']; icao = a['icao']
    elev_m = round(a['elev'] * 0.3048) if a.get('elev') is not None else None
    rw = a['runways']; longest = max(rw, key=lambda r: r['len'])
    near = sorted([b for b in PAGES if b is not a], key=lambda b: km(a, b))[:6]
    rows = ''.join(f'<tr><td>{esc(r["id"])}</td><td>{r["len"]:,} ft · {round(r["len"] * 0.3048):,} m</td><td>{esc(SURF.get(r.get("surf"), (r.get("surf") or "unknown").lower()))}</td><td>{"yes" if r.get("lit") else "no"}</td></tr>' for r in rw)
    desc = f'Live flights at {nm} ({iata}/{icao}), {city}: aircraft nearby right now, runways, elevation and a live radar map. Free, no sign-up.'
    title = f'{city} Airport ({iata}) Live Flight Radar | BlackRhino'
    qa = [(f'Where is {nm}?', f'{nm} ({iata}, {icao}) serves {city}, India. It sits at {a["lat"]:.3f}°N, {a["lon"]:.3f}°E' + (f', {a["elev"]:,} ft ({elev_m:,} m) above sea level.' if elev_m is not None else '.')),
          (f'How long is the longest runway at {iata}?', f'The longest runway at {iata} is {longest["id"]}, {longest["len"]:,} ft ({round(longest["len"] * 0.3048):,} m). The airport has {len(rw)} runway{"s" if len(rw) != 1 else ""}.'),
          (f'How do I see flights at {city} airport live?', f'The list on this page shows aircraft within 25 km of {iata} from live ADS-B data. Open the radar map for every flight, with altitude, speed and route where known. Positions are community-sourced and not for navigation.')]
    ld = [{'@context': 'https://schema.org', '@type': 'Airport', 'name': nm, 'iataCode': iata, 'icaoCode': icao, 'url': f'{SITE}/airport/{slug(a)}',
           'address': {'@type': 'PostalAddress', 'addressLocality': city, 'addressCountry': 'IN'}, 'geo': {'@type': 'GeoCoordinates', 'latitude': a['lat'], 'longitude': a['lon']}},
          {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
              {'@type': 'ListItem', 'position': 1, 'name': 'BlackRhino', 'item': SITE + '/'}, {'@type': 'ListItem', 'position': 2, 'name': 'Airports', 'item': SITE + '/airports'},
              {'@type': 'ListItem', 'position': 3, 'name': f'{city} ({iata})', 'item': f'{SITE}/airport/{slug(a)}'}]},
          {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': t}} for q, t in qa]}]
    chips = ''.join(f'<li><a href="/airport/{slug(b)}">{esc(b["city"])} ({b["iata"]})</a></li>' for b in near)
    body = f'''<main class="wrap wide"><div class="lbl">Airport · {esc(iata)} · {esc(icao)}</div><h1 class="ap">{esc(city)} airport live flights</h1>
<p class="lead">{esc(nm)} ({esc(iata)}) serves {esc(city)}. See which aircraft are around it right now, then open the live radar map for arrivals, departures and the full picture.</p>
<p><a class="cta" href="/map?airport={esc(iata)}">Open {esc(iata)} on the live radar map</a></p>
<h2>near {esc(iata)} right now</h2>
<p class="muted" id="nowCount">Loading live aircraft…</p>
<table id="nowList"><thead><tr><th>Flight</th><th>Type</th><th>Altitude</th><th>Distance</th></tr></thead><tbody id="nowBody"></tbody></table>
<h2>airport facts</h2>
<table><tr><td>Name</td><td>{esc(nm)}</td></tr><tr><td>City</td><td>{esc(city)}, India</td></tr><tr><td>IATA / ICAO</td><td>{esc(iata)} / {esc(icao)}</td></tr><tr><td>Position</td><td>{a["lat"]:.4f}°N, {a["lon"]:.4f}°E</td></tr>{f'<tr><td>Elevation</td><td>{a["elev"]:,} ft ({elev_m:,} m)</td></tr>' if elev_m is not None else ''}</table>
<h2>runways</h2>
<table><thead><tr><th>Runway</th><th>Length</th><th>Surface</th><th>Lit</th></tr></thead><tbody>{rows}</tbody></table>
<h2>questions</h2>
{''.join(f'<details><summary>{esc(q)}</summary><p>{esc(t)}</p></details>' for q, t in qa)}
<h2>other airports</h2><ul class="chips">{chips}<li><a href="/airports">All airports</a></li></ul>
<p class="muted">Positions come from community ADS-B receivers and can be late or wrong. Not for navigation. BlackRhino is a free educational project and is not affiliated with {esc(nm)} or any airline.</p>
</main>
{LIVE_JS % json.dumps({"lat": a["lat"], "lon": a["lon"]})}'''
    page(f'/airport/{slug(a)}', title, desc, body, ld)

def hub():
    items = ''.join(f'<li><a href="/airport/{slug(a)}">{esc(a["city"])} ({a["iata"]})</a></li>' for a in sorted(PAGES, key=lambda a: a['city']))
    ld = [{'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': 'Live flight radar for Indian airports', 'url': SITE + '/airports'},
          {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [{'@type': 'ListItem', 'position': 1, 'name': 'BlackRhino', 'item': SITE + '/'}, {'@type': 'ListItem', 'position': 2, 'name': 'Airports', 'item': SITE + '/airports'}]}]
    body = f'''<main class="wrap wide"><div class="lbl">Airports</div><h1 class="ap">live flights at indian airports</h1>
<p class="lead">Pick an airport to see the aircraft around it right now, its runways and facts, and open it on the live radar map. {len(PAGES)} major airports, from Delhi and Mumbai to Guwahati and Kochi.</p>
<p><a class="cta" href="/map">Open the live flight radar map</a></p>
<h2>major airports</h2><ul class="chips">{items}</ul>
<p class="muted">The radar map covers every airport in India, including smaller ones: search any airport name or code in the search box.</p></main>'''
    page('/airports', 'Live Flights at Indian Airports: Delhi, Mumbai, Bengaluru | BlackRhino', f'Live flight radar for {len(PAGES)} major Indian airports: aircraft nearby right now, runways and facts for Delhi, Mumbai, Bengaluru, Hyderabad and more. Free.', body, ld)

def sitemap():
    urls = [('/', '1.0', 'daily'), ('/map', '0.9', 'daily'), ('/about', '0.8', 'monthly'), ('/3d', '0.8', 'daily'), ('/track', '0.8', 'weekly'), ('/globe', '0.5', 'weekly'), ('/airports', '0.8', 'weekly'), ('/share', '0.5', 'monthly'),
            ('/credits', '0.3', 'monthly'), ('/privacy', '0.2', 'monthly'), ('/terms', '0.2', 'monthly')] + [(f'/airport/{slug(a)}', '0.7', 'daily') for a in PAGES]
    x = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'<url><loc>{SITE}{p}</loc><lastmod>{TODAY}</lastmod><changefreq>{f}</changefreq><priority>{pr}</priority></url>\n' for p, pr, f in urls) + '</urlset>\n'
    open(os.path.join(PUB, 'sitemap.xml'), 'w').write(x)
    bots = ['OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot', 'Applebot-Extended', 'bingbot', 'DuckAssistBot', 'MistralAI-User', 'cohere-ai']
    r = 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /hist/\nDisallow: /live\n\n'
    r += '# AI assistants and AI search: welcome. The public pages are meant to be found, read and cited.\n'
    for b in bots: r += f'User-agent: {b}\nAllow: /\nDisallow: /api/\nDisallow: /hist/\nDisallow: /live\n\n'
    r += f'Sitemap: {SITE}/sitemap.xml\n'
    open(os.path.join(PUB, 'robots.txt'), 'w').write(r)

ABOUT_FACTS = [
 ('What it is', 'BlackRhino (blackrhino.in) is a free live flight radar for India. It shows every aircraft over Indian airspace on a 2D map and a 3D map, with altitude, speed, route and airline where known.'),
 ('Who it is for', 'People curious about flights: plane spotters, students, travellers following a flight, and anyone who wants to know which plane is above them.'),
 ('Cost and purpose', 'It is free, with no sign-up, no ads and no subscription. It is an educational, not-for-profit project. Commercial use of the site or its data is not permitted.'),
 ('Where the data comes from', 'Aircraft positions come from community ADS-B receiver networks (adsb.fi, adsb.lol and OpenSky). Registration, type and route come from public databases such as adsbdb. Maps come from OpenStreetMap-based tiles (OpenFreeMap), satellite imagery from Esri, terrain from open elevation data and clouds from EUMETSAT. See the credits page.'),
 ('How fresh it is', 'Positions refresh about every 15 seconds. Between updates the position is estimated from speed and heading. Near airports, where receivers often lose the signal, landing positions are modelled and marked as estimates.'),
 ('Features', 'Live 2D radar map; tilted 3D map and a 3D India view with terrain, sun and live satellite clouds; airport pages with live aircraft nearby; Near me, which shows which aircraft is above you using your device location, kept in your browser; search in plain words such as "hyd to blr" or "indigo above 30k ft", handled by a small language model that runs in your browser; Track a flight, which follows one flight by its number or your boarding pass and gives a link to share (the pass is read in your browser and never stored); and Share my flight, which records your phone GPS on board and lets family follow the flight.'),
 ('Privacy', 'No accounts, no cookies, no ads and no analytics. Your location for Near me never leaves your browser. Boarding passes and tickets read on Track a flight are read in your browser: only the flight number and date are used, and nothing is stored. Details are on the privacy page.'),
 ('Limits', 'Not for navigation, flying or safety decisions. Positions can be late, missing or wrong. Military-flagged and blocked aircraft are not shown. BlackRhino is not affiliated with any airline, airport or data provider.'),
 ('Open source', 'The code is open source under the MIT licence: https://github.com/themonkkey/blackrhino'),
]

def about():
    ld = [{'@context': 'https://schema.org', '@type': 'AboutPage', 'name': 'About BlackRhino', 'url': SITE + '/about', 'inLanguage': 'en-IN', 'dateModified': TODAY,
           'mainEntity': {'@type': 'WebApplication', 'name': 'BlackRhino', 'url': SITE + '/', 'applicationCategory': 'TravelApplication', 'operatingSystem': 'Any (web browser)', 'isAccessibleForFree': True,
                          'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'INR'}, 'sameAs': ['https://github.com/themonkkey/blackrhino'], 'license': 'https://opensource.org/licenses/MIT'}},
          {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [{'@type': 'ListItem', 'position': 1, 'name': 'BlackRhino', 'item': SITE + '/'}, {'@type': 'ListItem', 'position': 2, 'name': 'About', 'item': SITE + '/about'}]}]
    rows = ''.join(f'<h2>{esc(k)}</h2><p>{esc(v)}</p>' for k, v in ABOUT_FACTS)
    body = f'''<main class="wrap"><div class="lbl">About</div><h1 class="ap">about blackrhino</h1>
<p class="lead">BlackRhino is a free, educational live flight radar for India: every aircraft over Indian airspace, on a 2D and 3D map.</p>
{rows}
<h2>explore</h2><ul class="chips"><li><a href="/map">Live flight radar map</a></li><li><a href="/track">Track a flight</a></li><li><a href="/3d">3D India</a></li><li><a href="/airports">Airport pages</a></li><li><a href="/credits">Data credits</a></li><li><a href="/privacy">Privacy</a></li><li><a href="/terms">Terms</a></li></ul>
<p class="muted">Last updated {TODAY}.</p></main>'''
    page('/about', 'About BlackRhino: a Free Live Flight Radar for India', 'What BlackRhino is, where its flight data comes from, what it shows, how it handles privacy and what its limits are. A free educational project.', body, ld)

def llms():
    t = [f'# BlackRhino', '', '> BlackRhino (https://blackrhino.in) is a free, educational live flight radar for India. It shows every aircraft over Indian airspace on a 2D map and a 3D map, with airport pages, a "Near me" view of the aircraft above you, and search in plain words. No sign-up, no ads. Not for navigation. Not-for-profit; commercial use is not permitted.', '',
         '## Key facts', ''] + [f'- {k}: {v}' for k, v in ABOUT_FACTS] + ['', '## Main pages', '',
         f'- [Live flight radar map of India]({SITE}/map): every aircraft with altitude, speed and route; flight search; airport boards; tilt to 3D.',
         f'- [3D India flight tracker]({SITE}/3d): terrain, sun, live satellite clouds, chase and cockpit views.',
         f'- [Track a flight]({SITE}/track): where one flight is now and when it lands, by flight number or boarding pass (read in the browser), with a share link that carries only the flight number and date.',
         f'- [Airports]({SITE}/airports): live aircraft near {len(PAGES)} major Indian airports, with runways and facts.',
         f'- [About]({SITE}/about): what BlackRhino is, data sources, privacy and limits.',
         f'- [Data credits]({SITE}/credits): the community networks and open datasets used.',
         f'- [Privacy]({SITE}/privacy) and [Terms]({SITE}/terms).', '', '## Airport pages', ''] + [f'- [{a["city"]} ({a["iata"]}) live flights]({SITE}/airport/{slug(a)})' for a in sorted(PAGES, key=lambda a: a['city'])] + ['', '## Source code', '', '- https://github.com/themonkkey/blackrhino (MIT licence)', '']
    open(os.path.join(PUB, 'llms.txt'), 'w').write('\n'.join(t))

def indexnow():
    kf = os.path.join(ROOT, 'scripts', '.indexnow-key')
    key = open(kf).read().strip() if os.path.exists(kf) else __import__('uuid').uuid4().hex
    open(kf, 'w').write(key)
    open(os.path.join(PUB, key + '.txt'), 'w').write(key)
    return key

for a in PAGES: airport_page(a)
hub(); sitemap(); about(); llms(); indexnow()
print(len(PAGES), 'airport pages + hub + sitemap + robots')
