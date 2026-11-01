# Local mirror of production for /track testing: vercel.json headers, cleanUrls, the /track/<flight> rewrite; /api and /hist proxied to the live site.
import http.server, urllib.request, json, re, mimetypes
ROOT = '/Users/thesinghaa/flight-tracker/public'
V = json.load(open('/Users/thesinghaa/flight-tracker/vercel.json'))
GLOBAL = {h['key']: h['value'] for h in V['headers'][0]['headers']}
mimetypes.add_type('application/wasm', '.wasm'); mimetypes.add_type('text/javascript', '.js'); mimetypes.add_type('text/javascript', '.mjs')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(s):
        p0 = s.path.split('?')[0]   # per-route Permissions-Policy, as in vercel.json
        pp = [r for r in V['headers'] if r['source'] in ('/track', '/track/:path+')][0]['headers'][0]['value'] if (p0 in ('/track', '/track.html') or p0.startswith('/track/')) else [r for r in V['headers'] if r['source'].startswith('/((?!track')][0]['headers'][0]['value']
        s.send_header('Permissions-Policy', pp)
        for k, v in GLOBAL.items():
            if k != 'Strict-Transport-Security' and not (k == 'Content-Security-Policy'): s.send_header(k, v)
        s.send_header('Content-Security-Policy', GLOBAL['Content-Security-Policy'].replace('; upgrade-insecure-requests', ''))
        super().end_headers()
    def do_GET(s):
        if s.path.startswith('/api/') or s.path.startswith('/hist/'):
            r = urllib.request.Request('https://flight-tracker-india.vercel.app' + s.path, headers={'User-Agent': 'Mozilla/5.0'})
            try:
                d = urllib.request.urlopen(r, timeout=30); b = d.read(); s.send_response(200); s.send_header('Content-Type', d.headers.get('Content-Type', 'application/json')); s.end_headers(); s.wfile.write(b)
            except Exception as e: s.send_response(502); s.end_headers()
            return
        p0 = s.path.split('?')[0]
        if re.fullmatch(r'/track/[A-Za-z0-9]{3,8}', p0): s.path = '/track.html'
        elif '.' not in p0.rsplit('/', 1)[-1] and p0 != '/' and __import__('os').path.isfile(ROOT + p0 + '.html'): s.path = p0 + '.html'
        super().do_GET()
    def log_message(*a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', 8656), H).serve_forever()
