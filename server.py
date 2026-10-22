#!/usr/bin/env python3
"""Live flight tracker: static server + data proxy + enrichment.

Live positions (merged by ICAO hex):
  - OpenSky Network: wide bbox, good India coverage. Anonymous quota ~400 credits/day,
    big bbox = 4 credits, so poll slowly (OPENSKY_EVERY seconds) and only when a client is active.
  - adsb.lol: point + 250nm radius, no quota but rate-limited; fresher and much richer
    (IAS/TAS/Mach, wind, temperature, selected altitude, autopilot modes, ...).
Enrichment (cached on disk in cache/):
  - adsbdb.com: callsign -> airline + origin/destination airports; hex -> registration, type, owner, photo.
Every request is answered from memory; upstream calls only happen in background threads.
Optional: OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET env for a free account (10x quota).
"""
import gzip, json, math, os, threading, time, urllib.request, urllib.parse, urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = int(os.environ.get("PORT", 8650))
OPENSKY_EVERY = int(os.environ.get("OPENSKY_EVERY", 60))
ADSB_EVERY = 15            # adsb.lol rate-limits aggressively
ENRICH_RATE = 2.0          # adsbdb requests per second
ROUTE_TTL, MISS_TTL = 3 * 86400, 86400
BBOX = dict(lamin=5, lomin=66, lamax=37, lomax=99)  # India + neighbours
UA = {"User-Agent": "blackrhino-dev/1.0 (local server)"}
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
PUBLIC = os.path.join(HERE, "public")

state = {"opensky": {}, "opensky_t": 0, "opensky_status": "idle", "quota": None,
         "last_client": 0, "token": None, "token_exp": 0}
adsb = {"data": {}, "status": "idle", "center": (22.5, 79.0), "backoff": 0, "hex": {}}
lock = threading.Lock()


def load(name):
    try:
        return json.load(open(os.path.join(CACHE, name)))
    except Exception:
        return {}


routes, aircraft, apts = load("routes.json"), load("aircraft.json"), load("airports_seen.json")
priority = []   # hex/callsign pairs the user is looking at right now
enrich = {"status": "idle", "done": 0, "backoff": 0}


def get_json(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r), r.headers


# ---------------- OpenSky ----------------
def opensky_token():
    cid, sec = os.environ.get("OPENSKY_CLIENT_ID"), os.environ.get("OPENSKY_CLIENT_SECRET")
    if not (cid and sec):
        return None
    if state["token"] and time.time() < state["token_exp"] - 60:
        return state["token"]
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": cid,
                                   "client_secret": sec}).encode()
    req = urllib.request.Request(
        "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
        data=body, headers={**UA, "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=20) as r:
        t = json.load(r)
    state["token"], state["token_exp"] = t["access_token"], time.time() + t.get("expires_in", 1800)
    return state["token"]


POS_SRC = ["ADS-B", "ASTERIX", "MLAT", "FLARM"]


def opensky_loop():
    while True:
        if time.time() - state["last_client"] < 120:  # someone is watching
            try:
                tok = opensky_token()
                hdr = {"Authorization": f"Bearer {tok}"} if tok else {}
                d, h = get_json("https://opensky-network.org/api/states/all?extended=1&" + urllib.parse.urlencode(BBOX), hdr)
                ac = {}
                for s in d.get("states") or []:
                    if s[5] is None or s[6] is None:
                        continue
                    ac[s[0]] = {
                        "hex": s[0], "flight": (s[1] or "").strip(), "country": s[2],
                        "lon": s[5], "lat": s[6],
                        "alt": None if s[8] else round((s[7] or s[13] or 0) * 3.28084),
                        "ground": s[8], "gs": round((s[9] or 0) * 1.94384, 1), "track": s[10] or 0,
                        "vr": round((s[11] or 0) * 196.85), "squawk": s[14],
                        "ts": s[3] or d["time"], "src": "opensky",
                        "x": {"alt_geom": round(s[13] * 3.28084) if s[13] is not None else None,
                              "spi": s[15], "pos_src": POS_SRC[s[16]] if s[16] in (0, 1, 2, 3) else None,
                              "cat": s[17] if len(s) > 17 else None, "last_contact": s[4]}}
                with lock:
                    state["opensky"], state["opensky_t"] = ac, time.time()
                    state["opensky_status"] = "ok"
                    state["quota"] = h.get("x-rate-limit-remaining")
            except urllib.error.HTTPError as e:
                state["opensky_status"] = "quota exhausted" if e.code == 429 else f"http {e.code}"
                if e.code == 429:
                    time.sleep(600)
            except Exception as e:
                state["opensky_status"] = f"error: {type(e).__name__}"
        time.sleep(OPENSKY_EVERY)


# ---------------- adsb.lol ----------------
# raw adsb.lol fields passed through to the client as "x" (everything the receivers decode)
X_FIELDS = ("alt_geom", "ias", "tas", "mach", "wd", "ws", "oat", "tat", "track_rate", "roll", "mag_heading",
            "true_heading", "baro_rate", "geom_rate", "nav_qnh", "nav_altitude_mcp", "nav_altitude_fms",
            "nav_heading", "nav_modes", "category", "version", "nic", "rc", "nac_p", "nac_v", "sil",
            "sil_type", "gva", "sda", "nic_baro", "messages", "seen", "rssi", "type", "mlat", "tisb",
            "emergency", "alert", "spi", "desc", "ownOp", "year", "dbFlags")


def adsb_convert(a, now):
    ground = a.get("alt_baro") == "ground"
    return {
        "hex": a["hex"], "flight": (a.get("flight") or "").strip(), "reg": a.get("r"), "type": a.get("t"),
        "lat": a["lat"], "lon": a["lon"], "alt": None if ground else a.get("alt_baro"),
        "ground": ground, "gs": a.get("gs") or 0, "track": a.get("track") or a.get("true_heading") or 0,
        "vr": a.get("baro_rate") or a.get("geom_rate") or 0, "squawk": a.get("squawk"),
        "emergency": a.get("emergency") not in (None, "none"),
        "ts": now - (a.get("seen_pos") or 0), "src": "adsb.lol",
        "x": {k: a[k] for k in X_FIELDS if k in a}}


def adsblol_loop():
    """Poll adsb.lol in the background around the last-requested centre; requests never wait on it."""
    while True:
        if time.time() - state["last_client"] < 120 and time.time() > adsb["backoff"]:
            try:
                lat, lon = adsb["center"]
                d, _ = get_json(f"https://api.adsb.lol/v2/lat/{lat:.3f}/lon/{lon:.3f}/dist/250", timeout=10)
                now = d.get("now", time.time() * 1000) / 1000
                adsb["data"] = {a["hex"]: adsb_convert(a, now) for a in d.get("ac", []) if "lat" in a}
                adsb["status"] = "ok"
            except urllib.error.HTTPError as e:
                adsb["status"] = f"http {e.code}"
                if e.code == 429:
                    adsb["status"] += " (backing off 60s)"
                    adsb["backoff"] = time.time() + 60
            except Exception as e:
                adsb["status"] = f"error: {type(e).__name__}"
        time.sleep(ADSB_EVERY)


def adsb_hex(hexid):
    """Full live record for one aircraft (used for the detail panel). Cached 10s, respects backoff."""
    c = adsb["hex"].get(hexid)
    if c and time.time() - c[0] < 10:
        return c[1]
    if time.time() < adsb["backoff"]:
        return c[1] if c else None
    try:
        d, _ = get_json(f"https://api.adsb.lol/v2/hex/{hexid}", timeout=8)
        now = d.get("now", time.time() * 1000) / 1000
        ac = [a for a in d.get("ac", []) if "lat" in a]
        rec = adsb_convert(ac[0], now) if ac else None
    except urllib.error.HTTPError as e:
        if e.code == 429:
            adsb["backoff"] = time.time() + 60
        rec = c[1] if c else None
    except Exception:
        rec = c[1] if c else None
    adsb["hex"][hexid] = (time.time(), rec)
    return rec


# ---------------- adsbdb enrichment ----------------
def apt_compact(a):
    return {"icao": a.get("icao_code"), "iata": a.get("iata_code"), "name": a.get("name"),
            "city": a.get("municipality"), "country": a.get("country_name"), "cc": a.get("country_iso_name"),
            "lat": a.get("latitude"), "lon": a.get("longitude"), "elev": a.get("elevation")}


def fetch_route(cs):
    try:
        d, _ = get_json(f"https://api.adsbdb.com/v0/callsign/{urllib.parse.quote(cs)}", timeout=10)
        fr = d["response"]["flightroute"]
        o, de = apt_compact(fr["origin"]), apt_compact(fr["destination"])
        with lock:
            apts[o["icao"]], apts[de["icao"]] = o, de
        al = fr.get("airline") or {}
        routes[cs] = {"t": time.time(), "o": o["icao"], "d": de["icao"], "fi": fr.get("callsign_iata"),
                      "al": al.get("name"), "ali": al.get("iata"), "alc": al.get("country"), "alcs": al.get("callsign")}
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise
        routes[cs] = {"t": time.time(), "miss": True}
    except (KeyError, TypeError):
        routes[cs] = {"t": time.time(), "miss": True}


def fetch_aircraft(hexid):
    try:
        d, _ = get_json(f"https://api.adsbdb.com/v0/aircraft/{hexid}", timeout=10)
        a = d["response"]["aircraft"]
        aircraft[hexid] = {"t": time.time(), "reg": a.get("registration"), "model": a.get("type"),
                           "icao_type": a.get("icao_type"), "mfr": a.get("manufacturer"),
                           "owner": a.get("registered_owner"), "owner_cc": a.get("registered_owner_country_name"),
                           "op_flag": a.get("registered_owner_operator_flag_code"),
                           "photo": a.get("url_photo"), "thumb": a.get("url_photo_thumbnail")}
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise
        aircraft[hexid] = {"t": time.time(), "miss": True}
    except (KeyError, TypeError):
        aircraft[hexid] = {"t": time.time(), "miss": True}


def stale(rec, ttl=ROUTE_TTL):
    return rec is None or time.time() - rec["t"] > (MISS_TTL if rec.get("miss") else ttl)


def enrich_loop():
    last_save = time.time()
    while True:
        if time.time() - state["last_client"] > 120 or time.time() < enrich["backoff"]:
            time.sleep(2)
            continue
        with lock:
            live = list(state["opensky"].values()) + list(adsb["data"].values())
        # what the user is looking at first, then airborne flights, routes before airframes
        todo = []
        for h, cs in list(priority):
            if cs and stale(routes.get(cs)):
                todo.append(("r", cs))
            if stale(aircraft.get(h), 30 * 86400):
                todo.append(("a", h))
        todo += [("r", f["flight"]) for f in live if f["flight"] and stale(routes.get(f["flight"]))]
        todo += [("a", f["hex"]) for f in live if stale(aircraft.get(f["hex"]), 30 * 86400)]
        seen = set()
        todo = [t for t in todo if not (t in seen or seen.add(t))]
        enrich["status"] = f"{len(todo)} queued" if todo else "up to date"
        for kind, key in todo[:6]:
            try:
                fetch_route(key) if kind == "r" else fetch_aircraft(key)
                enrich["done"] += 1
            except urllib.error.HTTPError:
                enrich["status"] = "rate limited (backing off 60s)"
                enrich["backoff"] = time.time() + 60
                break
            except Exception:
                pass
            time.sleep(1 / ENRICH_RATE)
        if time.time() - last_save > 60:
            save_caches()
            last_save = time.time()
        if not todo:
            time.sleep(5)


def save_caches():
    os.makedirs(CACHE, exist_ok=True)
    for name, obj in (("routes.json", routes), ("aircraft.json", aircraft), ("airports_seen.json", apts)):
        tmp = os.path.join(CACHE, name + ".tmp")
        with lock:
            json.dump(obj, open(tmp, "w"), separators=(",", ":"))
        os.replace(tmp, os.path.join(CACHE, name))


# ---------------- airport weather ----------------
metar_cache = {}   # icao -> (fetched_at, record)


def metar(icao):
    c = metar_cache.get(icao)
    if c and time.time() - c[0] < 600:
        return c[1]
    try:
        d, _ = get_json(f"https://aviationweather.gov/api/data/metar?ids={urllib.parse.quote(icao)}&format=json", timeout=10)
        rec = d[0] if d else None
    except Exception:
        rec = c[1] if c else None
    metar_cache[icao] = (time.time(), rec)
    return rec


# ---------------- merge ----------------
def gc_km(lat1, lon1, lat2, lon2):
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
    return 6371 * math.acos(max(-1, min(1, c)))


def attach(f):
    """Add route + airframe data; flag routes the aircraft's position does not fit (stale callsign data)."""
    r = routes.get(f["flight"]) if f["flight"] else None
    if r and not r.get("miss"):
        o, d = apts.get(r["o"]), apts.get(r["d"])
        f.update(o=r["o"], d=r["d"], fi=r.get("fi"), al=r.get("al"))
        if o and d and o["lat"] is not None and d["lat"] is not None:
            od = gc_km(o["lat"], o["lon"], d["lat"], d["lon"])
            via = gc_km(o["lat"], o["lon"], f["lat"], f["lon"]) + gc_km(f["lat"], f["lon"], d["lat"], d["lon"])
            f["rv"] = via < od * 1.25 + 150   # plausible: aircraft roughly between origin and destination
    a = aircraft.get(f["hex"])
    if a and not a.get("miss"):
        f["reg"] = f.get("reg") or a.get("reg")
        f["type"] = f.get("type") or a.get("icao_type")
        f["model"] = a.get("model")
        f["own"] = a.get("owner")
    return f


class H(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        if not self.path.startswith("/api/"):
            # models never change; pages revalidate (cheap 304 via Last-Modified)
            cc = "public, max-age=604800, immutable" if self.path.startswith("/models/") else "no-cache"
            self.send_header("Cache-Control", cc)
        super().end_headers()

    def send_json(self, obj):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        if "gzip" in self.headers.get("Accept-Encoding", ""):
            body = gzip.compress(body, 5)
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/api/flights":
            return self.flights(q)
        if u.path == "/api/detail":
            return self.detail(q)
        if u.path == "/api/metar":
            return self.send_json(metar(q.get("icao", [""])[0].upper()[:4]))
        if "." not in os.path.basename(u.path) and u.path != "/" and os.path.exists(os.path.join(PUBLIC, u.path.lstrip("/") + ".html")):
            self.path = u.path + ".html" + (("?" + u.query) if u.query else "")   # clean URLs, same as Cloudflare
        return super().do_GET()

    def flights(self, q):
        center = self.headers.get("X-Center") or f'{q.get("lat", [22.5])[0]},{q.get("lon", [79])[0]}'
        try:
            lat, lon = (float(v) for v in center.split(",")[:2])
        except ValueError:
            lat, lon = 22.5, 79.0
        state["last_client"] = time.time()
        adsb["center"] = (lat, lon)
        with lock:
            merged = {k: dict(v) for k, v in state["opensky"].items()}
            meta = {"opensky": state["opensky_status"], "quota": state["quota"],
                    "opensky_age": round(time.time() - state["opensky_t"]) if state["opensky_t"] else None}
        meta["adsblol"] = adsb["status"]
        for k, v in adsb["data"].items():   # adsb.lol is fresher: prefer it, keep opensky country
            v = dict(v)
            if k in merged:
                v["country"] = merged[k].get("country")
            merged[k] = v
        ac = [attach(f) for f in merged.values()]
        known = sum(1 for f in ac if f.get("o"))
        meta["routes"] = f"{known}/{len(ac)} with route · {enrich['status']}"
        used = {f[k] for f in ac for k in ("o", "d") if f.get(k)}
        self.send_json({"now": time.time(), "meta": meta, "ac": ac,
                        "apts": {k: apts[k] for k in used if k in apts}})

    def detail(self, q):
        hexid, cs = q.get("hex", [""])[0].lower(), q.get("cs", [""])[0].strip()
        state["last_client"] = time.time()
        if (hexid, cs) not in priority:
            priority.insert(0, (hexid, cs))
            del priority[8:]
        live = adsb_hex(hexid)
        r = routes.get(cs)
        route = None
        if r and not r.get("miss"):
            route = {**r, "origin": apts.get(r["o"]), "destination": apts.get(r["d"])}
        a = aircraft.get(hexid)
        self.send_json({"hex": hexid, "live": live, "route": route,
                        "route_pending": r is None and bool(cs),
                        "aircraft": a if a and not a.get("miss") else None,
                        "aircraft_pending": a is None})


if __name__ == "__main__":
    os.chdir(PUBLIC)
    state["last_client"] = time.time()
    for fn in (opensky_loop, adsblol_loop, enrich_loop):
        threading.Thread(target=fn, daemon=True).start()
    print(f"Flight tracker on http://localhost:{PORT}")
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
    finally:
        save_caches()
