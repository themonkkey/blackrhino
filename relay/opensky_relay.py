#!/usr/bin/env python3
"""OpenSky relay for flight-tracker-india.

OpenSky has the best receiver coverage over India (~50% more aircraft than adsb.fi, many at low level
near airports) but refuses connections from cloud hosts (Vercel, Cloudflare). This relay runs on a
normal internet connection (this Mac, a Raspberry Pi, an old Android phone in Termux...), fetches the
India box from OpenSky and pushes it to the flight-history worker, where the hosted app picks it up.

Quota: anonymous = 400 credits/day; the India box costs 4 credits per call, so ~100 calls/day.
A free OpenSky account (API client) gives 4000/day -> a call every ~90 s around the clock; feeders 8000.
Credentials (optional) from macOS Keychain: opensky-client-id / opensky-client-secret, or env vars.
"""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request

BBOX = "lamin=5&lomin=66&lamax=37&lomax=99"
# worker origin: BR_HISTORY_API env var, else historyApi from public/config.js (one place to change for forks)
_cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "config.js")
API = os.environ.get("BR_HISTORY_API") or (re.search(r"historyApi:\s*'([^']*)'", open(_cfg).read()) or [None, ""])[1]
PUSH = API.rstrip("/") + "/ingest/opensky"   # key goes in the X-Key header, never the URL
UA = {"User-Agent": "blackrhino opensky-relay (" + os.environ.get("BR_CONTACT", "https://github.com/themonkkey/blackrhino") + ")"}
POS_SRC = ["ADS-B", "ASTERIX", "MLAT", "FLARM"]


def secret(name, env):
    if os.environ.get(env):
        return os.environ[env]
    try:
        return subprocess.run(["security", "find-generic-password", "-s", name, "-w"], capture_output=True, text=True, timeout=5).stdout.strip() or None
    except Exception:
        return None


# worker checks INGEST_KEY (Keychain item flight-history-ingest-key, or env RELAY_KEY)
KEY = secret("flight-history-ingest-key", "RELAY_KEY")
CID, CSEC = secret("opensky-client-id", "OPENSKY_CLIENT_ID"), secret("opensky-client-secret", "OPENSKY_CLIENT_SECRET")
token, token_exp = None, 0


def get_token():
    global token, token_exp
    if not (CID and CSEC):
        return None
    if token and time.time() < token_exp - 60:
        return token
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": CID, "client_secret": CSEC}).encode()
    req = urllib.request.Request("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
                                 data=body, headers={**UA, "Content-Type": "application/x-www-form-urlencoded"})
    t = json.load(urllib.request.urlopen(req, timeout=20))
    token, token_exp = t["access_token"], time.time() + t.get("expires_in", 1800)
    return token


def once():
    tok = get_token()
    req = urllib.request.Request("https://opensky-network.org/api/states/all?extended=1&" + BBOX,
                                 headers={**UA, **({"Authorization": "Bearer " + tok} if tok else {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        d, remaining = json.load(r), r.headers.get("x-rate-limit-remaining")
    ac = []
    for s in d.get("states") or []:
        if s[5] is None or s[6] is None:
            continue
        ac.append({"hex": s[0], "flight": (s[1] or "").strip(), "country": s[2], "lon": round(s[5], 4), "lat": round(s[6], 4),
                   "alt": None if s[8] else round((s[7] or s[13] or 0) * 3.28084), "ground": s[8],
                   "gs": round((s[9] or 0) * 1.94384, 1), "track": round(s[10] or 0, 1), "vr": round((s[11] or 0) * 196.85),
                   "squawk": s[14], "ts": s[3] or d["time"], "src": "opensky",
                   "x": {"alt_geom": round(s[13] * 3.28084) if s[13] is not None else None,
                         "pos_src": POS_SRC[s[16]] if s[16] in (0, 1, 2, 3) else None, "cat": s[17] if len(s) > 17 else None}})
    payload = json.dumps({"t": d["time"], "quota": remaining, "ac": ac}, separators=(",", ":")).encode()
    urllib.request.urlopen(urllib.request.Request(PUSH, data=payload, method="POST",
                                                  headers={**UA, "Content-Type": "application/json", "X-Key": KEY}), timeout=30).read()
    return len(ac), int(remaining) if remaining and remaining.isdigit() else None


def next_wait(remaining):
    """Spread the remaining daily credits evenly until OpenSky's daily reset (UTC midnight); 90 s minimum."""
    if remaining is None:
        return 300
    left = 86400 - (time.time() % 86400)
    calls = max(remaining // 4, 1)
    return max(90, min(1800, left / calls))


if __name__ == "__main__":
    if not KEY:
        sys.exit("no relay key (Keychain flight-history-ingest-key / flight-history-run-key, or RELAY_KEY)")
    print(f"opensky relay starting ({'account' if CID else 'anonymous'})", flush=True)
    while True:
        try:
            n, rem = once()
            wait = next_wait(rem)
            print(time.strftime("%H:%M:%S"), f"pushed {n} aircraft, quota left {rem}, next in {int(wait)}s", flush=True)
        except urllib.error.HTTPError as e:
            wait = 1800 if e.code == 429 else 300
            print(time.strftime("%H:%M:%S"), f"http {e.code}, retry in {wait}s", flush=True)
        except Exception as e:
            wait = 120
            print(time.strftime("%H:%M:%S"), f"error {type(e).__name__}: {e}, retry in {wait}s", flush=True)
        time.sleep(wait)
