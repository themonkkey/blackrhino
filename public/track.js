// Track a flight: /track/6E2024?d=2026-11-05. The link carries only the flight number and date (plus a radio callsign
// if the person picked one), never a name or PNR, and the server keeps nothing. Status comes from public ADS-B radar
// (/api/hex, /api/flights), the route from adsbdb, past flights from the history recorder (/hist). Boarding passes are
// read in this tab by /passreader.js (loaded on demand). Family will act on what this page says, so when unsure it
// says so ("lost radar contact", "route not confirmed") rather than guessing "in the air" or "landed".
import {normFlight, parseBCBP, parseTicketText, todayIST} from '/bcbp.js';

const $ = id => document.getElementById(id);
const IST = {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false};
const hhmm = t => new Date(t * 1000).toLocaleTimeString('en-IN', IST);
const nice = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
const dayNo = s => Math.round(Date.parse(s + 'T00:00:00Z') / 864e5);
const addDay = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const istMidnight = s => Date.parse(s + 'T00:00:00+05:30') / 1000;   // unix s when that IST day starts
const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s)) && Math.abs(dayNo(s) - dayNo(todayIST())) <= 400 ? s : null;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const trackUrl = (f, d, cs) => `/track/${f}?d=${d}${cs ? '&cs=' + cs : ''}`;
const ago = s => s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`;
const now = () => Date.now() / 1000;

// ---------- map ----------
const mq = matchMedia('(max-width: 700px)');   // on phones the card covers the bottom of the map
const map = L.map('map', {zoomControl: false, attributionControl: false}).setView([22.5, 80], 5);
const attrib = L.control.attribution({position: mq.matches ? 'topright' : 'bottomright'}).addTo(map), zoom = L.control.zoom({position: 'bottomright'});
if (!mq.matches) zoom.addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom: 18, attribution: 'Imagery <a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a> · Esri, Maxar, Earthstar Geographics · radar: adsb.fi, adsb.lol, OpenSky · routes: adsbdb'}).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {maxZoom: 18, opacity: .8}).addTo(map);
const routeLine = L.polyline([], {color: '#c4e7ff', weight: 1.5, opacity: .7, dashArray: '6 8'}).addTo(map);
const pathLine = L.polyline([], {color: '#7cc8ff', weight: 3, opacity: .9}).addTo(map);
const PLANE = c => `<svg width="34" height="34" viewBox="0 0 24 24" style="transform:rotate(var(--r))"><path d="M12 2c.8 0 1.3.9 1.3 2v5.2l7.7 4.6v2l-7.7-2.4v4.8l2.3 1.7V21L12 20l-3.6 1v-1.1l2.3-1.7v-4.8L3 15.8v-2l7.7-4.6V4c0-1.1.5-2 1.3-2z" fill="${c}" stroke="#000" stroke-width=".7"/></svg>`;
const marker = L.marker([0, 0], {icon: L.divIcon({className: 'plane', html: PLANE('#7cc8ff'), iconSize: [34, 34], iconAnchor: [17, 17]}), opacity: 0, interactive: false}).addTo(map);
const dot = (lat, lon) => L.circleMarker([lat, lon], {radius: 4, color: '#c4e7ff', weight: 1, fillColor: '#05070d', fillOpacity: 1}).addTo(map);
let follow = true, fitted = false;
// keep things in the part of the map the card does not cover: above it on phones, right of it on desktop
const pad = () => { const r = $('card').getBoundingClientRect(); return mq.matches ? {paddingTopLeft: [30, 40], paddingBottomRight: [30, innerHeight - r.top + 20]} : {paddingTopLeft: [r.right + 30, 40], paddingBottomRight: [60, 40]}; };
function centre(ll) {
  const r = $('card').getBoundingClientRect(), off = mq.matches ? [0, (innerHeight - r.top) / 2] : [-r.right / 2, 0];
  map.panTo(map.unproject(map.project(ll).add(off)), {animate: true, duration: 0.8});
}
map.on('dragstart', () => { follow = false; });
mq.addEventListener('change', () => {
  attrib.setPosition(mq.matches ? 'topright' : 'bottomright');
  if (mq.matches) zoom.remove(); else zoom.addTo(map);
  fitted = false; routeLine.setLatLngs([]);
});

// airports for routes, runways and landing estimates (absolute path: this page also lives at /track/<flight>)
const apts = fetch('/airports.json').then(r => r.json()).then(list => { FT.airports = list; for (const a of list) FT.byIcao[a.icao] = a; }).catch(() => {});

// ---------- what to track ----------
const pm = location.pathname.match(/^\/track\/([A-Za-z0-9]{3,8})\/?$/), q = new URLSearchParams(location.search);
const F = normFlight(pm ? pm[1] : q.get('f'));
const D = okDate(q.get('d')) || todayIST();
const CS = /^[A-Z0-9]{3,8}$/.test((q.get('cs') || '').toUpperCase()) ? q.get('cs').toUpperCase() : null;   // radio callsign picked earlier
const relNow = () => dayNo(D) - dayNo(todayIST());   // 0 today, -1 yesterday (overnight flights), >0 coming up

// ---------- entry form, boarding pass and ticket reading ----------
$('fdate').value = D;
$('f').onsubmit = e => {
  e.preventDefault();
  const f = normFlight($('fno').value);
  if (!f) return say('That does not look like a flight number. Try something like 6E 2024 or AI 101.');
  location.assign(trackUrl(f.flight, okDate($('fdate').value) || todayIST()));
};
function say(t) { $('askmsg').textContent = t; $('askmsg').classList.toggle('hide', !t); }
function recent() {
  const today = dayNo(todayIST()), list = load('ft-track-recent', []).filter(r => r && normFlight(r.f) && okDate(r.d) && dayNo(r.d) >= today - 2);
  $('recent').innerHTML = list.map(r => `<a href="${esc(trackUrl(r.f, r.d))}">${esc(r.f)} · ${esc(nice(r.d))}</a>`).join('');
}
function remember(f, d) {
  const list = load('ft-track-recent', []).filter(r => r && !(r.f === f && r.d === d));
  save('ft-track-recent', [{f, d}, ...list].slice(0, 6));
}

// a pass or ticket gave us flights: show them and let the person choose (nothing is used until they tap Track)
function choose(legs) {
  if (!legs.length) return say('No flight number found. Try a clearer screenshot, the PDF from the airline, or type the flight number.');
  say('');
  $('found').innerHTML = legs.map((l, i) => `<div class="leg"><div><b>${esc(l.carrier)} ${esc(l.number)}</b>
    <span>${l.from && l.to ? `${esc(l.from)} → ${esc(l.to)} · ` : ''}${l.date ? esc(nice(l.date)) : 'date not found, pick it:'}</span>
    ${l.date ? '' : `<input type="date" data-i="${i}" value="${todayIST()}" aria-label="Date of the flight">`}</div>
    <button class="btn on" type="button" data-i="${i}">Track</button></div>`).join('');
  $('found').querySelectorAll('button').forEach(b => b.onclick = () => {
    const l = legs[+b.dataset.i], inp = $('found').querySelector(`input[data-i="${b.dataset.i}"]`);
    location.assign(trackUrl(l.flight, l.date || okDate(inp && inp.value) || todayIST()));
  });
  $('ask').classList.add('hide'); $('pick').classList.remove('hide');
  history.pushState({pick: 1}, '');   // the phone's Back button returns to the form instead of leaving
  $('pick').querySelector('h2').focus();
}
function unpick() { $('found').innerHTML = ''; $('pick').classList.add('hide'); $('ask').classList.remove('hide'); }
$('pickBack').onclick = () => history.back();
addEventListener('popstate', () => { if (!$('pick').classList.contains('hide')) unpick(); });
// a barcode is a boarding pass (BCBP); if it is not, it may still carry ticket text, e.g. some QR codes
const fromCodes = codes => codes.flatMap(c => { const b = parseBCBP(c); return b.length ? b : parseTicketText(c); });

$('upload').onclick = () => $('file').click();
$('file').onchange = async () => {
  const file = $('file').files[0];
  $('file').value = '';   // let go of the file at once; we keep only what we read from it
  if (!file) return;
  say('Reading on this device…');
  try {
    const {readFile} = await import('/passreader.js');
    const {codes, text} = await readFile(file);
    const legs = fromCodes(codes);
    choose(legs.length ? legs : parseTicketText(text));
  } catch (e) { say(e && e.message && /large/.test(e.message) ? e.message : 'Could not read that file. Try a screenshot of the boarding pass, or type the flight number.'); }
};
$('pasteGo').onclick = () => { const t = $('paste').value; $('paste').value = ''; choose(parseTicketText(t)); };
addEventListener('pagehide', () => { $('paste').value = ''; });

// camera: one stream at a time; a Cancel tapped while the permission prompt is still open must also stop it
let camStop = null, camGen = 0;
$('scan').onclick = async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return say('This browser cannot use the camera here. Upload a screenshot or the PDF instead.');
  const g = ++camGen;
  $('scan').disabled = true; $('cam').classList.remove('hide'); $('camMsg').textContent = 'Starting camera…'; $('camStop').focus();
  try {
    const {startCamera} = await import('/passreader.js');
    const stop = await startCamera($('vid'), code => { closeCam(); choose(fromCodes([code])); });
    if (g !== camGen) { stop(); return; }
    camStop = stop;
    $('camMsg').textContent = 'Point at the barcode on the pass';
  } catch (e) {
    if (g !== camGen) return;
    closeCam();
    say(e && e.name === 'NotAllowedError' ? 'Camera is blocked for this site. Allow it in the browser settings, or upload a screenshot instead.' : 'Could not start the camera. Upload a screenshot or the PDF instead.');
  }
};
function closeCam() { camGen++; if (camStop) camStop(); camStop = null; $('cam').classList.add('hide'); $('scan').disabled = false; }
$('camStop').onclick = closeCam;
document.addEventListener('visibilitychange', () => { if (document.hidden && !$('cam').classList.contains('hide')) closeCam(); });

// ---------- tracking state ----------
// cs: the callsign that matches the flight number; radio: the callsign we follow, which can differ (IGO487M for 6E 487,
// or a code like AIC7SL: airlines fly some flights under radio codes). Codes are only ever matched with the person's OK.
let R = {cs: F && F.icao, radio: null, locked: false, o: null, d: null, airline: F && F.airline};
let radar = null;          // latest accepted fix
let hist = null;           // {leg, overnightHex} or {none, overnightHex}
let landed = null;         // {t, hex}: once the plane is down at the destination this page says Landed and stays there
let otherLeg = false;      // the same flight number (or plane) is flying another leg after landing
let lastHist = 0, lastWide = 0, cands = new Map(), dismissed = new Set();

async function resolve() {
  try {
    const j = await fetch(`https://api.adsbdb.com/v0/callsign/${F.flight}`).then(r => r.ok ? r.json() : null);
    const fr = j && j.response && j.response.flightroute;
    if (fr) Object.assign(R, {cs: /^[A-Z0-9]{3,8}$/.test(fr.callsign_icao || '') ? fr.callsign_icao : F.icao, o: fr.origin, d: fr.destination,
      airline: (fr.airline && fr.airline.name) || F.airline});
  } catch (e) {}
  R.radio = CS && R.cs && CS.slice(0, 3) === R.cs.slice(0, 3) ? CS : R.cs;
  R.locked = !!R.radio && R.radio !== R.cs;
}
const aptOf = x => x && {icao: x.icao_code, iata: x.iata_code, city: x.municipality || x.name, lat: x.latitude, lon: x.longitude};
const O = () => (R.o && (FT.apt(R.o.icao_code) || aptOf(R.o))) || null;
const T = () => (R.d && (FT.apt(R.d.icao_code) || aptOf(R.d))) || null;
const near = (p, a, km) => !!(a && p && FT.km(p.lat, p.lon, a.lat, a.lon) < km);
function onRoute(p) {   // inside the ellipse around origin and destination (the site's own route plausibility test)
  const o = O(), t = T();
  if (!o || !t) return true;
  return FT.km(o.lat, o.lon, p.lat, p.lon) + FT.km(p.lat, p.lon, t.lat, t.lon) < FT.km(o.lat, o.lon, t.lat, t.lon) * 1.25 + 150;
}
function links() { if (R.radio) { $('l3d').href = `/3d?flight=${R.radio}`; $('lmap').href = `/map?flight=${R.radio}`; } }

// should a radar fix count as this flight on this date?
function accept(d) {
  const rel = relNow();
  if (landed) {   // after landing: the same plane parked at the gate is fine, anything else is a later leg
    if (d.hex === landed.hex && d.ground && near(d, T(), 12)) return true;
    otherLeg = true; return false;
  }
  if (rel > 0 || rel < -1) return false;
  if (rel === -1) {   // yesterday's flight: only its own continuation after midnight, never today's flight
    const leg = hist && hist.leg;
    if (leg) return d.hex === leg.hex && !leg.landed && now() - leg.last < 4 * 3600;
    return now() < istMidnight(addDay(D, 1)) + 6 * 3600;
  }
  // today: not yesterday's overnight flight still in the air under the same number after midnight
  if (hist && hist.overnightHex === d.hex && d.ts < istMidnight(D) + 6 * 3600 && !(d.ground && near(d, O(), 15))) return false;
  return true;
}
function onFix(d) {
  if (!d.o && R.o) { d.o = R.o.icao_code; d.d = R.d && R.d.icao_code; }
  FT.attach(d);
  if (R.o) { d.o = R.o.icao_code; d.d = R.d && R.d.icao_code; }   // the route of the flight number, not of a reused callsign
  if (!radar || radar.hex !== d.hex) pathLine.setLatLngs([]);
  radar = d;
  const pts = pathLine.getLatLngs();
  if (pts.length > 2000) pathLine.setLatLngs(pts.slice(-1500));
  pathLine.addLatLng([d.lat, d.lon]);
  if (!landed && d.ground && near(d, T(), 12)) landed = {t: d.ts, hex: d.hex};
}

const freshest = (j, cs) => (j && j.ac || []).filter(d => d && (!cs || d.flight === cs) && Number.isFinite(d.lat) && Number.isFinite(d.lon)).sort((a, b) => b.ts - a.ts)[0];
async function pollLive() {
  if (!R.radio || !/^[A-Z0-9]{2,8}$/.test(R.radio)) return;
  try {
    // one flight from adsb.lol / adsb.fi; when they have nothing fresh, the India-wide feed (shared CDN copy, also
    // has adsb.fi tile scans and OpenSky), at most every 30 s
    let d = freshest(await fetch('/api/hex?cs=' + R.radio).then(r => r.ok ? r.json() : null).catch(() => null));
    if ((!d || now() - d.ts > 60) && Date.now() - lastWide > 30000) {
      lastWide = Date.now();
      const wide = await fetch('/api/flights').then(r => r.ok ? r.json() : null).catch(() => null);
      let w = freshest(wide, R.radio);
      if (!w && !R.locked && !radar && relNow() === 0) {
        w = suffixMatch(wide);
        if (w && accept(w)) { R.radio = w.flight; links(); }
      }
      if (w && (!d || w.ts > d.ts)) d = w;
      if (!d && !R.locked && !radar && relNow() === 0) { routeCandidates(wide); setTimeout(() => { if (!radar) { routeCandidates(wide); render(); } }, 4000); }   // routes arrive a moment later
    }
    if (d && (!radar || d.ts >= radar.ts) && accept(d)) onFix(d);
  } catch (e) {}
}
// ATC often adds one letter to the flight number (IGO487M for 6E 487): same flight, safe to follow automatically
function suffixMatch(wide) {
  const re = new RegExp(`^${R.cs}[A-Z]$`), m = (wide && wide.ac || []).filter(a => re.test(a.flight || ''));
  return m.length === 1 ? m[0] : null;
}
// same airline, flying this flight's route right now, under a radio code: offer them, never pick one silently
// (an earlier flight on the same route must not look like yours)
function routeCandidates(wide) {
  const o = O(), t = T(), pre = R.cs.slice(0, 3);
  if (!o || !t || !wide) return;
  for (const a of wide.ac || []) {
    const f = a.flight || '';
    if (!f.startsWith(pre) || f === R.cs || dismissed.has(f) || !Number.isFinite(a.lat)) continue;
    if (!onRoute(a)) { cands.delete(f); continue; }
    FT.attach(a);   // learns the route of that callsign (adsbdb, cached on this device)
    if (a.o === R.o.icao_code && a.d === R.d.icao_code) cands.set(f, a); else cands.delete(f);
  }
}
function pickCand(cs) {
  const a = cands.get(cs);
  if (!a) return;
  R.radio = cs; R.locked = true; cands.clear();
  history.replaceState(null, '', trackUrl(F.flight, D, cs));
  links(); radar = null; pathLine.setLatLngs([]);
  if (accept(a)) onFix(a);
  render(); pollLive();
}

// history (recorded every 10 min, folded in hourly): what happened on the chosen day, split into legs so a flight
// number that flies more than once a day, or yesterday's overnight flight, is not mistaken for this one
async function pollHist() {
  if (!R.radio) return;
  lastHist = Date.now();
  const days = Math.min(30, Math.max(1, -relNow() + 1));
  try {
    const j = await fetch(`/hist/flight?cs=${encodeURIComponent(R.radio)}&days=${days}`).then(r => r.ok ? r.json() : null);
    if (!j) return;
    const all = (j.flights || []).filter(f => f.cs === R.radio), mid = istMidnight(D), mid2 = istMidnight(addDay(D, 1));
    const prev = all.filter(f => f.day === addDay(D, -1)), next = all.filter(f => f.day === addDay(D, 1));
    const over = prev.filter(p => p.last >= mid - 1800).sort((a, b) => b.last - a.last)[0];
    const overnightHex = over ? over.hex : null;
    // drop the after-midnight part of yesterday's flight (rows are split at IST midnight)
    const rows = all.filter(f => f.day === D && !(f.first < mid + 1800 && prev.some(p => p.hex === f.hex && f.first - p.last < 7200)));
    const segs = [];
    for (const r of rows) {
      const cont = next.find(n => n.hex === r.hex && n.first - r.last < 7200 && n.first < mid2 + 1800);
      const pts = [...(r.track || []), ...(cont && cont.track || [])].sort((a, b) => a[0] - b[0]);
      let cur = [];
      for (const p of pts) {   // a new leg starts after a long gap, or when the plane lifts off again after being on the ground
        const last = cur[cur.length - 1];
        if (last && (p[0] - last[0] > 2700 || (last[3] === 0 && p[3] > 0 && cur.some(x => x[3] > 0)))) { segs.push({hex: r.hex, pts: cur}); cur = []; }
        cur.push(p);
      }
      if (cur.length) segs.push({hex: r.hex, pts: cur});
    }
    if (!segs.length) { hist = {none: true, overnightHex}; return; }
    const o = O(), t = T(), P = p => ({lat: p[1], lon: p[2]});
    const fits = s => !o || !t || near(P(s.pts[0]), o, 30) || near(P(s.pts[s.pts.length - 1]), t, 15);
    const s = segs.filter(fits).sort((a, b) => b.pts[0][0] - a.pts[0][0])[0] || segs.sort((a, b) => b.pts[0][0] - a.pts[0][0])[0];
    const lp = s.pts[s.pts.length - 1], wasUp = s.pts.some(p => p[3] > 0);
    const atDest = near(P(lp), t, 15) || (lp[3] === 0 && wasUp && !near(P(lp), o, 30));
    const atOrigin = !atDest && lp[3] === 0 && near(P(lp), o, 30);
    hist = {overnightHex, leg: {hex: s.hex, first: s.pts[0][0], last: lp[0], pts: s.pts, landed: atDest, atOrigin, otherRoute: !fits(s)}};
  } catch (e) {}
}

function project(lat, lon, trk, kt, dt) {
  const r = Math.PI / 180, dd = kt * 0.514444 * dt / 6371000, b = trk * r, p1 = lat * r, l1 = lon * r;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dd) + Math.cos(p1) * Math.sin(dd) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(dd) * Math.cos(p1), Math.cos(dd) - Math.sin(p1) * Math.sin(p2));
  return [p2 / r, l2 / r];
}
const bearing = (a, b) => { const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r); return (Math.atan2(y, x) / r + 360) % 360; };
// best position now: fresh radar (dead-reckoned); a modelled approach only when the plane was clearly inbound on
// its route; else the last fix as it is
function current() {
  if (!radar) return null;
  const age = now() - radar.ts, t = T();
  if (age < 90) {
    const [la, lo] = radar.ground ? [radar.lat, radar.lon] : project(radar.lat, radar.lon, radar.track || 0, radar.gs || 0, Math.min(age, 60));
    return {src: 'radar', lat: la, lon: lo, alt: radar.ground ? 0 : radar.alt, kt: radar.gs, trk: radar.track, vr: radar.vr, ground: radar.ground, age};
  }
  const inbound = t && !radar.ground && onRoute(radar) && FT.km(radar.lat, radar.lon, t.lat, t.lon) < 400 &&
    Math.abs(((radar.track || 0) - bearing(radar, t) + 540) % 360 - 180) < 60;
  if (inbound && age < 3 * 3600 && FT.apt(radar.d)) {
    const v = FT.virtual(radar, now());
    if (v) return {src: 'est', lat: v.lat, lon: v.lon, alt: v.alt, kt: v.gs, trk: v.track, vr: v.vr, ground: v.ground, est: v.est, age};
  }
  return {src: 'old', lat: radar.lat, lon: radar.lon, alt: radar.alt, kt: radar.gs, trk: radar.track, ground: radar.ground, age};
}

// ---------- drawing ----------
function chip(text, cls) { $('state').textContent = text; $('state').className = 'chip ' + cls; }
function tiles(a, b, c) { [[a, 't1'], [b, 't2'], [c, 't3']].forEach(([[k, v], id]) => { $(id + 'k').textContent = k; $(id).textContent = v; }); }
function setBar(pct) { $('bar').parentNode.style.visibility = pct == null ? 'hidden' : ''; if (pct != null) { $('bar').style.width = pct + '%'; $('pl').style.left = pct + '%'; } }
function progress(lat, lon) {
  const o = O(), t = T();
  if (!o || !t) return null;
  const a = FT.km(o.lat, o.lon, lat, lon), b = FT.km(lat, lon, t.lat, t.lon);
  return {pct: Math.max(0, Math.min(100, a / (a + b) * 100)), toD: b, fromO: a};
}
function plane(lat, lon, trk, col) {
  marker.setLatLng([lat, lon]).setOpacity(1);
  marker.getElement() && (marker.getElement().innerHTML = PLANE(col).replace('var(--r)', `${trk || 0}deg`));
}
function drawRoute() {
  const o = O(), t = T();
  $('o').textContent = o ? (o.iata || o.icao) : '-'; $('oc').textContent = o ? o.city || '' : '';
  $('d').textContent = t ? (t.iata || t.icao) : '-'; $('dc').textContent = t ? t.city || '' : '';
  if (o && t && !routeLine.getLatLngs().length) {
    const pts = [];
    for (let i = 0; i <= 48; i++) { const k = i / 48; pts.push([o.lat + (t.lat - o.lat) * k, o.lon + (t.lon - o.lon) * k]); }
    routeLine.setLatLngs(pts); dot(o.lat, o.lon); dot(t.lat, t.lon);
  }
  if (!fitted && routeLine.getLatLngs().length) { map.fitBounds(routeLine.getBounds(), {...pad(), maxZoom: 9}); fitted = true; }
}
function renderCands() {
  const list = [...cands.values()].filter(a => !dismissed.has(a.flight));
  $('cands').classList.toggle('hide', !list.length || !!radar);
  if (!list.length || radar) return;
  const o = O(), t = T(), name = R.airline || F.airline || 'This airline';
  $('candsHead').textContent = `${name} sometimes flies under a radio code instead of the flight number. ${list.length === 1 ? 'This plane is' : 'These planes are'} flying ${o.iata || o.icao} → ${t.iata || t.icao} right now. ${list.length === 1 ? 'Is it yours?' : 'Is one of them yours?'}`;
  $('candsList').innerHTML = list.map(a => {
    const p = progress(a.lat, a.lon), st = a.ground ? 'on the ground' : `${Math.round(a.alt || 0).toLocaleString('en-IN')} ft`;
    return `<div class="leg"><div><b>${esc(a.flight)}</b><span>${esc(st)}${p ? ` · ${Math.round(p.pct)}% of the way` : ''} · seen ${esc(ago(now() - a.ts))}</span></div>
      <button class="btn on" type="button" data-cs="${esc(a.flight)}">That's mine</button></div>`;
  }).join('');
  $('candsList').querySelectorAll('button').forEach(b => b.onclick = () => pickCand(b.dataset.cs));
}

function render() {
  drawRoute();
  renderCands();
  const rel = relNow(), t = T(), o = O(), c = current(), leg = hist && hist.leg;
  const fo = n => n == null ? '-' : Math.round(n).toLocaleString('en-IN');
  const flightTile = ['FLIGHT', `${F.carrier} ${F.number}`];
  $('via').classList.toggle('hide', !R.locked);
  if (R.locked) $('via').innerHTML = `Following radio callsign <b>${esc(R.radio)}</b>, picked for this link. <a href="${esc(trackUrl(F.flight, D))}">Use the flight number instead</a>`;

  // 1. landed: stays landed, whatever comes later under the same number
  const histLanded = leg && leg.landed && (!radar || (c && c.src === 'old' && leg.last >= radar.ts - 600));
  if (landed || histLanded) {
    const at = landed ? landed.t : leg.last;
    if (radar && landed) plane(radar.lat, radar.lon, radar.track, '#7cc8ff');
    else if (leg) { pathLine.setLatLngs(leg.pts.map(p => [p[1], p[2]])); const lp = leg.pts[leg.pts.length - 1]; plane(lp[1], lp[2], 0, '#9ca3af'); }
    setBar(100); chip('Landed', 'st-land');
    tiles(['LANDED (IST)', (landed ? '' : '~') + hhmm(at)], flightTile, ['DATE', nice(D)]);
    $('note').textContent = `Landed at ${t ? (t.iata || t.icao) : 'the destination'} ${landed ? 'at' : 'around'} ${hhmm(at)} IST${landed ? ' (radar)' : ' (radar record)'}.${otherLeg ? ' This flight number or plane is now flying another leg, which is not shown.' : ''}`;
    return;
  }
  // 2. on radar now, or lost
  if (c) {
    const p = progress(c.lat, c.lon), routeOk = onRoute(c);
    let lab, cls, note;
    if (c.src === 'old') {
      plane(c.lat, c.lon, c.trk, '#9ca3af');
      lab = c.ground && near(c, o, 15) ? 'At the gate' : 'Lost radar contact'; cls = 'st-gate';
      note = `Last radar fix at ${hhmm(radar.ts)} IST (${ago(c.age)}). It may be over an area with no receivers. This page keeps checking.`;
      tiles(['LAST ALTITUDE', c.ground ? 'GND' : fo(c.alt) + ' ft'], ['LAST SEEN', hhmm(radar.ts)], ['LANDS (IST)', '-']);
      setBar(routeOk && p ? p.pct : null); chip(lab, cls); $('note').textContent = note;
      return;
    }
    plane(c.lat, c.lon, c.trk, c.src === 'est' ? '#fde68a' : '#7cc8ff');
    if (follow) centre([c.lat, c.lon]);
    const atDest = p && p.toD < 12, atOrig = p && p.fromO < 12;
    if (c.src === 'est') { const ph = c.est && c.est.phase; lab = ph === 'landed' || c.ground ? 'Probably landed (estimated)' : ph === 'final' ? 'Landing soon (estimated)' : 'In the air (estimated)'; cls = ph === 'enroute' ? 'st-enr' : 'st-app'; }
    else if (c.ground) { lab = atOrig ? 'At the gate / taxiing' : 'On the ground'; cls = 'st-gate'; }
    else if ((c.vr || 0) > 600 && (c.alt || 0) < 18000) { lab = 'Took off · climbing'; cls = 'st-dep'; }
    else if ((c.vr || 0) < -600 && p && p.toD < 250) { lab = 'Descending to land'; cls = 'st-app'; }
    else { lab = 'In the air'; cls = 'st-enr'; }
    let eta = null;
    if (routeOk && c.est && c.est.landT) eta = c.est.landT;
    else if (routeOk && !c.ground && p && (c.kt || 0) > 60) eta = now() + p.toD / (c.kt * 1.852) * 3600 + (p.toD > 40 ? 360 : 120);
    chip(lab, cls); setBar(routeOk && p ? p.pct : null);
    tiles(['ALTITUDE', c.ground ? 'GND' : c.alt == null ? '-' : fo(c.alt) + ' ft'], ['SPEED', c.kt == null ? '-' : fo(c.kt) + ' kt'], ['LANDS (IST)', eta ? '~' + hhmm(eta) : '-']);
    $('note').textContent = !routeOk ? `Not on its usual route (${o ? o.iata || o.icao : '?'} → ${t ? t.iata || t.icao : '?'}) right now: this flight number may be flying another leg first, so no landing time is shown.`
      : c.src === 'radar' ? `Live from radar · last fix ${ago(c.age)}${t && p ? ` · ${fo(p.toD)} km to ${t.iata || t.icao}` : ''}`
      : 'No radar fix for a while, so the position is modelled from the last one.';
    return;
  }
  marker.setOpacity(0);
  // 3. history for the day
  if (leg) {
    pathLine.setLatLngs(leg.pts.map(p => [p[1], p[2]]));
    if (!fitted && leg.pts.length > 1) { map.fitBounds(pathLine.getBounds(), {...pad(), maxZoom: 10}); fitted = true; }
    const lp = leg.pts[leg.pts.length - 1], gone = !leg.atOrigin && rel >= -1 && now() - leg.last < 4 * 3600, p = progress(lp[1], lp[2]);
    plane(lp[1], lp[2], 0, '#9ca3af');
    setBar(leg.otherRoute || !p ? null : p.pct);
    chip(leg.atOrigin ? 'At the gate' : gone ? 'Out of radar range' : 'Flew', 'st-gate');
    tiles(['FIRST SEEN', hhmm(leg.first)], ['LAST SEEN', hhmm(leg.last)], ['DATE', nice(D)]);
    $('note').textContent = leg.atOrigin ? `Last seen on the ground at ${o ? o.iata || o.icao : 'the origin'} at ${hhmm(leg.last)} IST.`
      : leg.otherRoute ? `Radar recorded this flight number on another route that day (until ${hhmm(leg.last)} IST).`
      : gone ? `Last recorded at ${hhmm(leg.last)} IST${p && t ? `, ${fo(p.toD)} km from ${t.iata || t.icao}` : ''}. Some areas have no radar receivers; this page keeps checking.`
      : `Recorded on radar until ${hhmm(leg.last)} IST (after that it was out of range).`;
    return;
  }
  setBar(0);
  if (rel > 0) {
    chip('Coming up', 'st-gate');
    tiles(['DATE', nice(D)], flightTile, ['LANDS (IST)', '-']);
    $('note').textContent = `Live tracking starts when the plane takes off on ${nice(D)}. Keep this link: open it on the day and it updates by itself.`;
  } else if (rel < -1 || (hist && hist.none && rel === -1)) {
    chip('No record', 'st-gate'); tiles(['DATE', nice(D)], flightTile, ['LANDS (IST)', '-']);
    $('note').textContent = 'We have no radar record of this flight on that date (we keep 30 days, and some flights fly out of range).';
  } else {
    chip('Not on radar yet', 'st-gate');
    tiles(['DATE', nice(D)], flightTile, ['LANDS (IST)', '-']);
    $('note').textContent = `It shows up here once the plane switches on its transponder, at the gate or on take-off. This page checks every minute${R.radio ? ` for ${R.radio}` : ''}. If it landed in the last hour, the record can take up to an hour to appear.`;
  }
}

async function shareLink() {
  const url = location.origin + trackUrl(F.flight, D, R.locked ? R.radio : null), o = O(), t = T();
  const text = `Follow ${F.carrier} ${F.number}${o && t ? ` (${o.iata || o.icao} → ${t.iata || t.icao})` : ''} live`;
  if (navigator.share) { try { await navigator.share({title: `${F.carrier} ${F.number} · blackrhino`, text, url}); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); $('share').textContent = 'Link copied'; setTimeout(() => { $('share').textContent = 'Share link'; }, 1800); }
  catch (e) { window.prompt('Copy this link', url); }
}

async function tick() {
  const rel = relNow();
  if (rel > 0) {   // coming up: reload when the day starts in India, so an open page begins tracking by itself
    setTimeout(() => location.reload(), Math.max(60000, (istMidnight(addDay(todayIST(), 1)) - now()) * 1000 + 5000));
    return;
  }
  if (!document.hidden && !landed && rel >= -1) {
    if (!hist && (rel === -1 || !radar)) await pollHist();
    await pollLive();
    if ((!radar || now() - radar.ts > 1800) && Date.now() - lastHist > 300000) await pollHist();
  }
  if (landed || relNow() < -1) return;   // nothing more to learn
  setTimeout(tick, radar && now() - radar.ts < 600 ? 15000 : 60000);
}

async function start() {
  $('ask').classList.add('hide'); $('live').classList.remove('hide'); $('another').classList.remove('hide');
  document.title = `${F.carrier} ${F.number} · ${nice(D)} | blackrhino`;
  $('title').textContent = `${F.carrier} ${F.number}`;
  $('who').textContent = `${F.airline || ''}${F.airline ? ' · ' : ''}${nice(D)}`;
  $('share').onclick = shareLink;
  $('candsNo').onclick = () => { for (const k of cands.keys()) dismissed.add(k); cands.clear(); render(); };
  remember(F.flight, D);
  render();
  await Promise.all([resolve(), apts]);
  $('who').textContent = `${R.airline || F.airline || ''}${R.airline || F.airline ? ' · ' : ''}${nice(D)}`;
  if (!R.radio) {
    chip('Unknown airline', 'st-gate');
    $('note').textContent = `We could not match the airline code ${F.carrier} to a radar callsign. Try the 3-letter ICAO form, like IGO2024 for 6E 2024.`;
    return;
  }
  links();
  if (relNow() <= 0) await pollHist();   // first: it decides which live fixes belong to this date
  render();
  setInterval(render, 1000);
  tick();
}

if (F) start();
else { recent(); if (q.get('f') || pm) say('That link has no valid flight number. Type one below.'); }
