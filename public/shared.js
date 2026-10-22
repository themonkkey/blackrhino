// Shared by the 2D map and the 3D globe: Indian airports, live arrival/departure boards,
// airport weather, and the full flight detail panel. Pages call FT.init({...hooks}).
// A "plane" is the page's record: {d: flight data from /api/flights, lat, lon} (lat/lon = drawn position).
(() => {
const IST = {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false};
const CAT = {A0: 'unspecified', A1: 'light (<7 t)', A2: 'small (7–34 t)', A3: 'large (34–136 t)', A4: 'high-vortex large (B757)',
  A5: 'heavy (>136 t)', A6: 'high performance', A7: 'rotorcraft', B1: 'glider', B2: 'balloon', B4: 'ultralight', B6: 'drone',
  C1: 'surface emergency vehicle', C2: 'surface service vehicle'};
const OS_CAT = {2: 'light', 3: 'small', 4: 'large', 5: 'high-vortex large', 6: 'heavy', 7: 'high performance', 8: 'rotorcraft'};
const SQUAWK = {'7500': 'hijack', '7600': 'radio failure', '7700': 'general emergency', '2000': 'no ATC code assigned'};
const SRC = {adsb_icao: 'ADS-B', adsb_icao_nt: 'ADS-B (non-transponder)', adsr_icao: 'ADS-R', tisb_icao: 'TIS-B', mlat: 'MLAT (multilateration)', mode_s: 'Mode S', adsc: 'ADS-C (satellite)', other: 'other'};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fmt = (n, d = 0) => n == null || isNaN(n) ? null : Number(n).toLocaleString('en-IN', {maximumFractionDigits: d, minimumFractionDigits: d});

const FT = window.FT = {
  touch: matchMedia('(pointer: coarse)').matches,
  airports: [], byIcao: {}, routeApts: {}, hooks: {},
  sel: null, detail: null, aptSel: null, aptTab: 'arr', metar: {},
};

FT.init = hooks => {
  FT.hooks = hooks;
  // panels
  const apt = document.createElement('div');
  apt.id = 'apt'; apt.className = 'hud';
  apt.innerHTML = '<span id="aptClose">×</span><div id="aptBody"></div>';
  document.body.appendChild(apt);
  const btn = document.createElement('button');
  btn.id = 'bApt'; btn.textContent = 'Airports';
  document.getElementById('q').insertAdjacentElement('beforebegin', btn);
  btn.onclick = () => FT.openAirport(null);
  document.getElementById('aptClose').onclick = () => FT.closeAirport();
  // "Install app" button (Android/desktop Chrome); iOS uses Share -> Add to Home Screen
  const inst = document.createElement('button');
  inst.id = 'bInstall'; inst.textContent = 'Install';
  btn.insertAdjacentElement('beforebegin', inst);
  let deferred = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; inst.style.display = 'inline-block'; });
  addEventListener('appinstalled', () => inst.style.display = 'none');
  inst.onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; inst.style.display = 'none'; };
  apt.addEventListener('click', e => {
    const t = e.target.closest('[data-hex],[data-icao],[data-tab]');
    if (!t) return;
    if (t.dataset.tab) { FT.aptTab = t.dataset.tab; FT.renderAirport(); }
    else if (t.dataset.hex) FT.hooks.selectFlight(t.dataset.hex);
    else if ('icao' in t.dataset) FT.openAirport(t.dataset.icao);
  });
  document.getElementById('info').addEventListener('click', e => {
    const t = e.target.closest('[data-icao]');
    if (t) FT.openAirport(t.dataset.icao);
  });
  setInterval(() => { if (!document.hidden && document.getElementById('apt').style.display === 'block') FT.renderAirport(); }, 2000);
  return fetch('airports.json').then(r => r.json()).then(list => {
    FT.airports = list;
    for (const a of list) FT.byIcao[a.icao] = a;
    const q = new URLSearchParams(location.search);   // app shortcut / deep links: ?airports=1, ?airport=BLR
    if (q.get('airport')) { const r = FT.search(q.get('airport')); if (r && r.icao) setTimeout(() => FT.openAirport(r.icao), 300); }
    else if (q.get('airports')) FT.openAirport(null);
    if (q.get('flight')) { const l = q.get('flight').toUpperCase().split(',').map(x => x.trim()).filter(x => /^[A-Z0-9-]{2,10}$/.test(x)).slice(0, 10); if (l.length) watchFlights(l); }   // whitelist: no markup reaches the HUD
  });
};

FT.ingest = j => { if (j.apts) Object.assign(FT.routeApts, j.apts); };
FT.apt = icao => icao && (FT.byIcao[icao] || FT.routeApts[icao] || EN.apts[icao]);

// ---------- route + airframe lookups on this device ----------
// adsbdb.com allows browser calls, so each phone looks up what it shows and remembers it (localStorage).
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } };
const EN = FT.en = {routes: lsGet('ft-routes'), aircraft: lsGet('ft-aircraft'), apts: lsGet('ft-apts')};
const ROUTE_TTL = 3 * 864e5, MISS_TTL = 864e5, AC_TTL = 30 * 864e5;
const isStale = (r, ttl) => !r || Date.now() - r.t > (r.miss ? MISS_TTL : ttl);
const queue = new Map();
let lookBackoff = 0, lsDirty = false;
FT.want = (kind, key, pri = 0) => {
  if (!key) return;
  const rec = kind === 'r' ? EN.routes[key] : EN.aircraft[key];
  if (!isStale(rec, kind === 'r' ? ROUTE_TTL : AC_TTL)) return;
  const q = queue.get(kind + key);
  if (!q || q.pri < pri) queue.set(kind + key, {kind, key, pri});
};
const aptC = a => ({icao: a.icao_code, iata: a.iata_code, name: a.name, city: a.municipality, country: a.country_name,
  cc: a.country_iso_name, lat: a.latitude, lon: a.longitude, elev: a.elevation});
async function adsbdb(path) {
  const r = await fetch('https://api.adsbdb.com/v0/' + path);
  if (r.status === 429) { const e = new Error('rate'); e.code = 429; throw e; }
  return r.ok ? r.json() : null;
}
async function lookRoute(cs) {
  const d = await adsbdb('callsign/' + encodeURIComponent(cs)), fr = d && d.response && d.response.flightroute;
  if (!fr) { EN.routes[cs] = {t: Date.now(), miss: true}; return; }
  const o = aptC(fr.origin), t = aptC(fr.destination), al = fr.airline || {};
  EN.apts[o.icao] = o; EN.apts[t.icao] = t;
  EN.routes[cs] = {t: Date.now(), o: o.icao, d: t.icao, fi: fr.callsign_iata, al: al.name, ali: al.iata, alc: al.country, alcs: al.callsign};
}
async function lookAircraft(hex) {
  const d = await adsbdb('aircraft/' + hex), a = d && d.response && d.response.aircraft;
  EN.aircraft[hex] = a ? {t: Date.now(), reg: a.registration, model: a.type, icao_type: a.icao_type, mfr: a.manufacturer,
    owner: a.registered_owner, owner_cc: a.registered_owner_country_name, photo: a.url_photo, thumb: a.url_photo_thumbnail}
    : {t: Date.now(), miss: true};
}
let inFlight = 0;
setInterval(async () => {   // up to 3 lookups in flight, most important first
  if (inFlight >= 3 || document.hidden || Date.now() < lookBackoff || !queue.size) return;
  let best = null;
  for (const q of queue.values()) if (!best || q.pri > best.pri) best = q;
  queue.delete(best.kind + best.key);
  inFlight++;
  try { await (best.kind === 'r' ? lookRoute(best.key) : lookAircraft(best.key)); lsDirty = true; }
  catch (e) { if (e.code === 429) lookBackoff = Date.now() + 60e3; }
  inFlight--;
}, 120);
setInterval(() => {
  if (!lsDirty) return;
  lsDirty = false;
  for (const [k, ttl] of [['routes', ROUTE_TTL], ['aircraft', AC_TTL]])
    for (const key in EN[k]) if (isStale(EN[k][key], ttl)) delete EN[k][key];
  try {
    localStorage.setItem('ft-routes', JSON.stringify(EN.routes));
    localStorage.setItem('ft-aircraft', JSON.stringify(EN.aircraft));
    localStorage.setItem('ft-apts', JSON.stringify(EN.apts));
  } catch (e) {}
}, 10000);
FT.lookupStatus = () => queue.size ? `${queue.size} lookups queued` : 'up to date';

// Fill route + airframe into a flight record (server may already have done it); queue what is missing.
FT.attach = d => {
  // a "first sighting" only means something if the page was already watching when the aircraft appeared
  if (d.hex && !FT.firstSeen[d.hex]) FT.firstSeen[d.hex] = {ts: d.ts, lat: d.lat, lon: d.lon, alt: d.ground ? 0 : d.alt, gs: d.gs,
    fresh: performance.now() > 120000};
  if (!d.o && d.flight) {
    const r = EN.routes[d.flight];
    if (r && !r.miss) {
      d.o = r.o; d.d = r.d; d.fi = r.fi; d.al = r.al;
      const o = FT.apt(r.o), t = FT.apt(r.d);
      if (o && t && o.lat != null && t.lat != null) {
        const od = FT.km(o.lat, o.lon, t.lat, t.lon);
        d.rv = FT.km(o.lat, o.lon, d.lat, d.lon) + FT.km(d.lat, d.lon, t.lat, t.lon) < od * 1.25 + 150;
      }
    }
    FT.want('r', d.flight, 1);
  }
  const a = EN.aircraft[d.hex];
  if (a && !a.miss) { d.reg = d.reg || a.reg; d.type = d.type || a.icao_type; d.model = d.model || a.model; d.own = d.own || a.owner; }
  else FT.want('a', d.hex, 0);
  return d;
};
FT.code = icao => { const a = FT.apt(icao); return a ? (a.iata || a.icao) : icao; };

FT.km = (lat1, lon1, lat2, lon2) => {
  const r = Math.PI / 180, p1 = lat1 * r, p2 = lat2 * r;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos((lon2 - lon1) * r);
  return 6371 * Math.acos(Math.max(-1, Math.min(1, c)));
};
FT.nearest = (lat, lon) => {
  let best = null, bd = 1e9;
  for (const a of FT.airports) { const d = FT.km(lat, lon, a.lat, a.lon); if (d < bd) { bd = d; best = a; } }
  return best && {a: best, km: bd};
};

// Where is this flight in its journey? Uses route (origin/destination) + live position.
FT.status = p => {
  if (p.est && p.dv && p.dv.est) {
    const e = p.dv.est, st = FT.status({...p, est: false, d: p.dv});
    const tf = ts => new Date(ts * 1000).toLocaleTimeString('en-IN', IST), ist = tf(e.landT);
    const rw = e.rwy ? ` RWY ${e.rwy}` : '';
    const rng = e.landLo ? `${tf(e.landLo).slice(0, 5)}-${tf(e.landHi).slice(0, 5)}` : null;
    return {...st, label: e.ground ? `Landed${rw} ~${ist} (estimated)` : e.phase === 'final' ? `Estimated · final approach${rw}` : `Estimated · no signal ${Math.round(e.silentFor / 60)} min`,
      cls: 'st-app', eta: e.ground ? null : new Date(e.landT * 1000), etaMin: e.ground ? null : (e.landT - Date.now() / 1000) / 60, estimated: true,
      range: rng, rwy: e.rwy, byWind: e.byWind, ml: e.ml, silentFor: e.silentFor, lastAlt: p.d.alt};
  }
  const d = p.d, o = FT.apt(d.o), t = FT.apt(d.d), lat = p.lat ?? d.lat, lon = p.lon ?? d.lon;
  const s = {};
  if (o && t && d.rv !== false) {
    s.total = FT.km(o.lat, o.lon, t.lat, t.lon);
    s.fromO = FT.km(o.lat, o.lon, lat, lon);
    s.toD = FT.km(lat, lon, t.lat, t.lon);
    s.progress = Math.max(0, Math.min(1, s.fromO / (s.fromO + s.toD)));
    if (!d.ground && d.gs > 60) {
      s.etaMin = s.toD / (d.gs * 1.852) * 60 + (s.toD > 40 ? 6 : 2);   // + approach/landing allowance
      s.eta = new Date(Date.now() + s.etaMin * 60000);
    }
  }
  if (d.ground) {
    s.label = s.fromO != null && s.fromO < 8 ? 'At gate / taxiing' : s.toD != null && s.toD < 8 ? 'Landed' : 'On ground';
    s.cls = s.label === 'Landed' ? 'st-land' : 'st-gate';
  } else if (s.toD != null && s.toD < 30 && d.alt != null && d.alt < 6000 && d.vr > 800 && s.fromO > 60) { s.label = 'Go-around / missed approach?'; s.cls = 'st-app'; }
  else if (s.toD != null && s.toD < 15 && d.alt != null && d.alt < 4000) { s.label = 'Landing'; s.cls = 'st-app'; }
  else if (s.fromO != null && s.fromO < 90 && d.vr > 250) { s.label = 'Departed · climbing'; s.cls = 'st-dep'; }
  else if (s.toD != null && s.toD < 150 && d.vr < -250) { s.label = 'On approach'; s.cls = 'st-app'; }
  else { s.label = d.vr > 500 ? 'Climbing' : d.vr < -500 ? 'Descending' : 'En route'; s.cls = 'st-enr'; }
  return s;
};

// ---------- estimated continuation (like Flightradar24 "estimated" positions) ----------
// When a tracked flight stops reporting near its destination (no receiver coverage at low level), keep it
// moving along a modelled approach: great circle to the runway, speed easing to ~135 kt, steady descent to
// the airport elevation, touchdown, then parked at the airport. Clearly labelled as estimated.
const gcInterp = (a, b, f) => {
  const r = Math.PI / 180, [la1, lo1, la2, lo2] = [a[0] * r, a[1] * r, b[0] * r, b[1] * r];
  const dd = FT.km(a[0], a[1], b[0], b[1]) / 6371;
  if (dd < 1e-9) return b;
  const A = Math.sin((1 - f) * dd) / Math.sin(dd), B = Math.sin(f * dd) / Math.sin(dd);
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
  const z = A * Math.sin(la1) + B * Math.sin(la2);
  return [Math.atan2(z, Math.hypot(x, y)) / r, Math.atan2(y, x) / r];
};
const bearing = (a, b) => {
  const r = Math.PI / 180, dl = (b[1] - a[1]) * r;
  return (Math.atan2(Math.sin(dl) * Math.cos(b[0] * r), Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos(dl)) * 180 / Math.PI + 360) % 360;
};
const destPoint = (p, brgDeg, km) => {
  const r = Math.PI / 180, dd = km / 6371, br = brgDeg * r, p1 = p[0] * r, l1 = p[1] * r;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dd) + Math.cos(p1) * Math.sin(dd) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(dd) * Math.cos(p1), Math.cos(dd) - Math.sin(p1) * Math.sin(p2));
  return [p2 / r, l2 / r];
};
FT.metarGen = 0;
// Runway in use: land into the wind (METAR, if >= 5 kt), else the runway direction closest to the inbound track.
FT.landingRunway = (t, inbound) => {
  const w = FT.metar[t.icao] && FT.metar[t.icao].w;
  const wdir = w && typeof w.wdir === 'number' && (w.wspd || 0) >= 5 ? w.wdir : null;
  let best = null;
  for (const rw of t.runways || []) {
    const A = [rw.pts[0], rw.pts[1]], B = [rw.pts[2], rw.pts[3]], ids = (rw.id || '/').split('/');
    for (const [thr, end, id] of [[A, B, ids[0]], [B, A, ids[1]]]) {
      const course = bearing(thr, end), ref = wdir ?? inbound ?? course;
      const score = Math.abs(((course - ref + 540) % 360) - 180) - (rw.len || 0) / 2000;   // prefer longer runways a little
      if (!best || score < best.score) best = {thr, course, id, score, byWind: wdir != null, len: rw.len};
    }
  }
  return best;
};
// Modelled arrival: fly to a final approach fix 15 km out on the runway centreline, then down a 3° glide path.
function makePlan(d) {
  const t = FT.apt(d.d || d._dest);
  if (!t || t.lat == null) return null;
  const rw = FT.landingRunway(t, d.track), elev = t.elev || 0, h0 = d.alt || 0, kt = 0.514444;
  const v0 = Math.max(d.gs || 0, 150) * kt, from = [d.lat, d.lon];
  const pts = [], spd = [], alt = [];
  if (rw) {
    const faf = destPoint(rw.thr, (rw.course + 180) % 360, 15), td = destPoint(rw.thr, rw.course, 0.35);
    if (FT.km(d.lat, d.lon, rw.thr[0], rw.thr[1]) > 16) { pts.push(from, faf, td); spd.push(v0, 180 * kt, 135 * kt); alt.push(h0, Math.min(h0, elev + 2600), elev); }
    else { pts.push(from, td); spd.push(v0, 135 * kt); alt.push(h0, elev); }
  } else { pts.push(from, [t.lat, t.lon]); spd.push(v0, 135 * kt); alt.push(h0, elev); }
  const segs = [];
  let T = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = Math.max(FT.km(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) * 1000, 1), va = spd[i], vb = spd[i + 1], b = (vb - va) / L;
    const dur = Math.abs(b) < 1e-9 ? L / va : Math.log(1 + b * L / va) / b;
    segs.push({a: pts[i], z: pts[i + 1], L, va, b, h0: alt[i], h1: alt[i + 1], T: dur, final: i === pts.length - 2 && !!rw});
    T += dur;
  }
  // learned correction (eta.js): shifts the arrival time and gives an 80% range; the path geometry stays the physics plan
  const ml = FT.etaAdjust && FT.etaAdjust(d, t, rw, T, segs.reduce((a, g) => a + g.L, 0) / 1000);
  return {segs, T, Tadj: ml ? ml.T : T, lo: ml ? ml.lo : null, hi: ml ? ml.hi : null, ml: !!ml, rwy: rw && rw.id, byWind: rw && rw.byWind, gen: FT.metarGen, td: pts[pts.length - 1]};
}
FT.estimate = (d, now) => {
  if (!d._plan || d._plan.gen !== FT.metarGen) d._plan = makePlan(d);
  const P = d._plan;
  if (!P) return null;
  const dt = Math.max(0, now - d.ts), landT = d.ts + P.Tadj, k = P.T / P.Tadj;   // k < 1: model says slower than physics, path is stretched in time
  const range = {landLo: P.lo != null ? d.ts + P.lo : null, landHi: P.hi != null ? d.ts + P.hi : null, ml: P.ml};
  if (dt >= P.Tadj) return {lat: P.td[0], lon: P.td[1], alt: null, ground: true, gs: 0, track: P.segs[P.segs.length - 1] ? bearing(P.segs.at(-1).a, P.segs.at(-1).z) : d.track,
    vr: 0, landT, silentFor: dt, phase: 'landed', rwy: P.rwy, byWind: P.byWind, ...range};
  let t = dt * k;
  for (const g of P.segs) {
    if (t > g.T) { t -= g.T; continue; }
    const s = Math.min(g.L, Math.abs(g.b) < 1e-9 ? g.va * t : (g.va / g.b) * (Math.exp(g.b * t) - 1)), f = s / g.L;
    const pos = gcInterp(g.a, g.z, f);
    return {lat: pos[0], lon: pos[1], alt: Math.round(g.h0 + (g.h1 - g.h0) * f), ground: false, gs: (g.va + g.b * s) / 0.514444 * k,
      track: bearing(pos, g.z), vr: Math.round((g.h1 - g.h0) / (g.T / 60) * k), landT, silentFor: dt, phase: g.final ? 'final' : 'enroute', rwy: P.rwy, byWind: P.byWind, ...range};
  }
  return null;
};
// Modelled departure: aircraft first seen already airborne near its origin (no low-level coverage there).
FT.firstSeen = {};
FT.depEstimate = d => {
  const f = FT.firstSeen[d.hex], o = FT.apt(d.o);
  if (!f || !f.fresh || !o || o.lat == null || f.alt == null || f.alt < 2500) return null;
  const km = FT.km(o.lat, o.lon, f.lat, f.lon);
  if (km > 400) return null;
  const avgKt = ((f.gs || 250) + 160) / 2;
  return {takeoff: f.ts - km / (avgKt * 1.852) * 3600 - 60, firstAlt: f.alt, firstKm: Math.round(km)};
};
// virtual flight record for drawing while estimating
FT.virtual = (d, now) => {
  const e = FT.estimate(d, now);
  return e && {...d, lat: e.lat, lon: e.lon, alt: e.alt, ground: e.ground, gs: e.gs, track: e.track, vr: e.vr, ts: now, est: e};
};
// switch a plane into estimate mode when it goes silent near its destination
FT.checkEstimate = (p, now, watched) => {
  const d = p.d;
  if (p.est || !watched || d.ground || d.rv === false) return;
  const t = FT.apt(d.d);
  if (!t || t.lat == null || now - d.ts < 45) return;
  if (FT.km(d.lat, d.lon, t.lat, t.lon) < 400) { p.est = true; if (t.icao) FT.loadMetar(t.icao); }
};

// Ghost planes: an inbound aircraft that goes silent near its destination keeps flying as a hollow, estimated plane
// until its predicted touchdown, instead of vanishing after 90 s. Works without a known route by inferring the airport it is heading to.
FT.inferDest = d => {
  let best = null, bd = 130;
  for (const a of FT.airports) {
    if (a.lat == null || !(a.runways && a.runways.length) || (a.type !== 'large' && a.type !== 'medium')) continue;
    const km = FT.km(d.lat, d.lon, a.lat, a.lon);
    if (km >= bd || Math.abs(((d.track - bearing([d.lat, d.lon], [a.lat, a.lon]) + 540) % 360) - 180) > 40) continue;
    best = a; bd = km;
  }
  return best;
};
FT.keepGhost = (p, now) => {                       // called for aircraft with no fix for > 90 s: true = keep drawing it as an estimate
  const d = p.d;
  if (p.est) {
    const e = p.dv && p.dv.est;
    if (!e) return now - d.ts < 200;               // estimate failed to start: don't leave a frozen plane behind
    return !(e.ground && now - e.landT > 150) && now - d.ts < 2400;
  }
  if (d.ground || d.alt == null || !(d.gs > 80) || d.rv === false) return false;
  const known = d.d && FT.apt(d.d), t = known && known.lat != null ? known : FT.inferDest(d);
  if (!t || FT.km(d.lat, d.lon, t.lat, t.lon) > 150) return false;
  const agl = d.alt - (t.elev || 0);
  if (agl > 22000 || agl < 300 || !(d.vr < -200 || agl < 12000)) return false;       // descending or already low: an arrival, not an overflight
  if (!known || known.icao !== t.icao) d._dest = t.icao;
  p.est = true; if (t.icao) FT.loadMetar(t.icao);
  return true;
};

// ---------- flight detail ----------
let detailTimer = null;
FT.secOpen = (() => { try { return JSON.parse(localStorage.getItem('ft-secs')) || {Flight: true, Aircraft: true}; } catch (e) { return {Flight: true, Aircraft: true}; } })();
document.addEventListener('toggle', e => {
  const el = e.target;
  if (el.tagName === 'DETAILS' && el.dataset.sec) {
    FT.secOpen[el.dataset.sec] = el.open;
    try { localStorage.setItem('ft-secs', JSON.stringify(FT.secOpen)); } catch (er) {}
  }
}, true);
FT.selectFlight = (hex, p) => {
  FT.sel = hex; FT.detail = null;
  document.body.classList.toggle('has-flight', !!hex);
  clearInterval(detailTimer);
  if (!hex) return;
  const cs = p.d.flight || '';
  FT.want('r', cs, 10); FT.want('a', hex, 10);
  let live = null;
  const build = () => {
    if (FT.sel !== hex) return;
    const r = EN.routes[cs], a = EN.aircraft[hex];
    FT.detail = {hex, live, aircraft: a && !a.miss ? a : null, aircraft_pending: !a,
      route: r && !r.miss ? {...r, origin: FT.apt(r.o), destination: FT.apt(r.d)} : null, route_pending: !r && !!cs};
    FT.hooks.refreshInfo?.();
  };
  // local server (server.py) also offers a per-aircraft live feed; the hosted version doesn't need it
  const loadLive = () => FT.detailApi !== false && fetch(`/api/detail?hex=${hex}&cs=${encodeURIComponent(cs)}`)
    .then(r => { if (!r.ok) { FT.detailApi = false; return null; } return r.json(); })
    .then(j => { if (j) { live = j.live; build(); } }).catch(() => {});
  build(); loadLive();
  detailTimer = setInterval(() => { if (!document.hidden) { build(); if (Date.now() % 5000 < 2000) loadLive(); } }, 2000);
};

FT.flightHTML = (p, nowS) => {
  const d = p.d, det = FT.detail && FT.detail.hex === d.hex ? FT.detail : null;
  const live = det && det.live, ac = det && det.aircraft, rt = det && det.route;
  const x = {...(d.x || {}), ...(live && live.x || {})};
  const s = FT.status(p);
  const row = (k, v, title) => v == null || v === '' || v === false ? '' : `<tr${title ? ` title="${esc(title)}"` : ''}><td class="stat">${k}</td><td>${v}</td></tr>`;
  const sec = (name, rows) => rows.trim() ? `<details data-sec="${name}" ${FT.secOpen[name] ? 'open' : ''}><summary>${name}</summary><table>${rows}</table></details>` : '';
  const o = FT.apt(d.o), t = FT.apt(d.d);
  const lat = p.lat ?? d.lat, lon = p.lon ?? d.lon;
  const near = FT.nearest(lat, lon);
  const alt = d.ground ? 'on ground' : d.alt != null ? fmt(d.alt) + ' ft' : null;

  const pct = s.progress != null ? Math.round(s.progress * 100) : 0;
  let route = '';
  if (o && t) {
    route = `<div class="fx-route">
      <div class="fx-ap" data-icao="${esc(o.icao)}"><b>${esc(o.iata || o.icao)}</b><span>${esc(o.city || '')}</span></div>
      <div><div class="fx-line"><i style="width:${pct}%"></i><em style="left:${pct}%">✈</em></div>
        <div class="fx-dist"><span>${s.fromO != null ? fmt(s.fromO) + ' km' : ''}</span><span>${s.toD != null ? fmt(s.toD) + ' km left' : ''}</span></div></div>
      <div class="fx-ap r" data-icao="${esc(t.icao)}"><b>${esc(t.iata || t.icao)}</b><span>${esc(t.city || '')}</span></div></div>
      ${d.rv === false ? '<div class="stat" style="color:var(--warn);font-size:11.5px">Route data does not match position (likely a stale callsign record)</div>' : ''}`;
  } else if (det && det.route_pending) route = '<div class="pend" style="margin:8px 0">Looking up route…</div>';
  const wind = x.wd != null && x.ws != null ? (() => {
    const hdg = x.true_heading ?? d.track, rel = (x.wd - hdg) * Math.PI / 180;
    const head = Math.round(x.ws * Math.cos(rel)), cross = Math.round(x.ws * Math.sin(rel));
    return `${Math.round(x.wd)}° at ${Math.round(x.ws)} kt <span class="stat">(${head >= 0 ? 'head' : 'tail'}wind ${Math.abs(head)} kt, cross ${Math.abs(cross)} kt)</span>`;
  })() : null;

  const airline = d.al || (rt && rt.al) || '';
  const AL_COL = {IGO: '#1f3a93', AIC: '#b3122e', AXB: '#c2410c', AKJ: '#ea580c', SEJ: '#dc2626', LLR: '#0f766e', QTR: '#5c0632', UAE: '#b91c1c'};
  const pre = (d.flight || '').slice(0, 3), logoCol = AL_COL[pre] || '#334155';
  const tile = (k, v, u) => `<div class="fx-tile"><small>${k}</small><b>${v}</b>${u ? `<span>${u}</span>` : ''}</div>`;
  const altTxt = d.ground ? 'GND' : d.alt != null ? fmt(d.alt) : '-';
  const html = `
    <div class="fx-hero"><div class="fx-logo" style="background:linear-gradient(135deg,${logoCol},#0b1220)">${esc(/^[A-Z]{3}$/.test(pre) ? pre : '✈')}</div>
      <div><div class="fx-cs">${esc(d.flight || d.hex.toUpperCase())}${d.fi && d.fi !== d.flight ? `<small>${esc(d.fi)}</small>` : ''}</div>
      <div class="fx-meta">${esc([airline, d.model || (ac && ac.model) || d.type, d.reg].filter(Boolean).join(' · ') || 'Unknown aircraft')}</div></div></div>
    <span class="chip ${s.cls}">${s.label}</span>
    ${s.estimated ? `<div class="fx-est"><b>ESTIMATED · NOT LIVE</b><span>Last radar contact${s.lastAlt != null ? ' at ' + fmt(s.lastAlt) + ' ft' : ''}, ${Math.max(1, Math.round(s.silentFor / 60))} min ago. Receivers can't see aircraft this low near this airport, so position and landing time are predicted from the last fix${s.ml ? ', live wind and past approaches' : ' and a standard approach path'}${s.rwy ? `. Runway ${esc(s.rwy)}${s.byWind ? ' (from wind)' : ' (a guess)'}` : ''}.</span></div>` : ''}
    ${route}
    <div class="fx-tiles">
      ${tile('Altitude', altTxt, d.ground ? '' : 'ft')}${tile('Speed', fmt(d.gs) ?? '-', 'kt')}${tile('Heading', String(Math.round(d.track || 0) % 360).padStart(3, '0') + '°', '')}
      ${tile('Vertical', d.vr ? (d.vr > 0 ? '+' : '') + fmt(Math.round(d.vr / 50) * 50) : '0', 'ft/min')}${tile(s.estimated ? 'Lands ~' : 'ETA', s.eta ? s.eta.toLocaleTimeString('en-IN', IST) : '-', s.estimated && s.range ? s.range + ' · 80% range' : s.etaMin ? Math.round(s.etaMin) + ' min · IST' : 'IST')}${tile('Squawk', esc(d.squawk || '-'), SQUAWK[d.squawk] ? esc(SQUAWK[d.squawk]) : '')}
    </div>
    ${d.emergency || SQUAWK[d.squawk] && d.squawk !== '2000' ? `<div class="fx-emg">Emergency: ${esc(SQUAWK[d.squawk] || x.emergency || 'declared')}</div>` : ''}
    ${sec('Flight', [
      row('Callsign', esc(d.flight)), row('Flight number', esc(d.fi)),
      row('Airline', esc([d.al || rt?.al, rt?.alc].filter(Boolean).join(', '))),
      row('Radio callsign', esc(rt?.alcs)),
      row('From', o && `${esc(o.name)}<br><span class="stat">${esc([o.city, o.country].filter(Boolean).join(', '))}</span>`),
      row('To', t && `${esc(t.name)}<br><span class="stat">${esc([t.city, t.country].filter(Boolean).join(', '))}</span>`),
      row('Took off', (() => { const e = FT.depEstimate(d); return e && `~${new Date(e.takeoff * 1000).toLocaleTimeString('en-IN', IST)} IST <span class="stat">(estimated: first seen at ${fmt(e.firstAlt)} ft, ${e.firstKm} km out)</span>`; })()),
      row('Route distance', s.total != null && fmt(s.total) + ' km'),
      row('Flown / remaining', s.fromO != null && `${fmt(s.fromO)} / ${fmt(s.toD)} km`),
    ].join(''))}
    ${sec('Aircraft', [
      row('Registration', esc(d.reg || ac?.reg)),
      row('Type', esc([ac?.model || d.model || x.desc, ac?.icao_type || d.type].filter(Boolean).join(' · '))),
      row('Manufacturer', esc(ac?.mfr)), row('Owner / operator', esc(ac?.owner || x.ownOp)),
      row('Registered in', esc(ac?.owner_cc || d.country)), row('Year built', esc(x.year)),
      row('Wake category', esc(CAT[x.category] || OS_CAT[x.cat])),
    ].join(''))}
    ${ac?.photo ? `<img class="ph" src="${esc(ac.photo)}" alt="aircraft photo" loading="lazy">` : ''}
    ${sec('Altitude', [
      row('Barometric', alt), row('Geometric (GNSS)', x.alt_geom != null && fmt(x.alt_geom) + ' ft'),
      row('Selected (autopilot)', x.nav_altitude_mcp != null && fmt(x.nav_altitude_mcp) + ' ft'),
      row('FMS target', x.nav_altitude_fms != null && fmt(x.nav_altitude_fms) + ' ft'),
      row('Altimeter setting', x.nav_qnh != null && fmt(x.nav_qnh, 1) + ' hPa'),
      row('Vertical rate', d.vr ? (d.vr > 0 ? '+' : '') + fmt(d.vr) + ' ft/min' : 'level'),
      row('Vertical rate (GNSS)', x.geom_rate != null && (x.geom_rate > 0 ? '+' : '') + fmt(x.geom_rate) + ' ft/min'),
    ].join(''))}
    ${sec('Speed', [
      row('Ground speed', `${fmt(d.gs)} kt <span class="stat">(${fmt(d.gs * 1.852)} km/h)</span>`),
      row('Indicated airspeed', x.ias != null && fmt(x.ias) + ' kt'),
      row('True airspeed', x.tas != null && fmt(x.tas) + ' kt'),
      row('Mach', x.mach != null && fmt(x.mach, 3)),
    ].join(''))}
    ${sec('Direction', [
      row('Track', fmt(d.track) + '°'), row('True heading', x.true_heading != null && fmt(x.true_heading, 1) + '°'),
      row('Magnetic heading', x.mag_heading != null && fmt(x.mag_heading, 1) + '°'),
      row('Selected heading', x.nav_heading != null && fmt(x.nav_heading, 1) + '°'),
      row('Turn rate', x.track_rate != null && fmt(x.track_rate, 2) + '°/s'),
      row('Bank angle', x.roll != null && fmt(x.roll, 1) + '°'),
      row('Autopilot modes', x.nav_modes && esc(x.nav_modes.join(', '))),
    ].join(''))}
    ${sec('Weather at aircraft', [
      row('Wind', wind), row('Outside air temp', x.oat != null && x.oat + ' °C'), row('Total air temp', x.tat != null && x.tat + ' °C'),
    ].join(''))}
    ${sec('Position', [
      row('Lat / Lon', `${lat.toFixed(4)}, ${lon.toFixed(4)}`),
      row('Nearest Indian airport', near && `<span data-icao="${esc(near.a.icao)}" style="cursor:pointer;color:var(--acc)">${esc(near.a.iata || near.a.icao)}</span> ${esc(near.a.city || '')} · ${fmt(near.km)} km`),
    ].join(''))}
    ${sec('Transponder & signal', [
      row('Squawk', d.squawk && `${esc(d.squawk)}${SQUAWK[d.squawk] ? ` <span class="stat">(${SQUAWK[d.squawk]})</span>` : ''}`),
      row('ICAO 24-bit address', d.hex.toUpperCase()),
      row('Position source', esc(SRC[x.type] || x.pos_src || x.type)),
      row('ADS-B version', x.version != null && 'v' + x.version),
      row('Integrity (NIC / NACp / SIL)', x.nic != null && `${x.nic} / ${x.nac_p ?? '-'} / ${x.sil ?? '-'}`,
        'NIC = position integrity, NACp = position accuracy, SIL = source integrity level'),
      row('Messages received', x.messages != null && fmt(x.messages)),
      row('Signal strength', x.rssi != null && fmt(x.rssi, 1) + ' dBFS'),
      row('Data feed', esc(d.src) + (live ? ' + live detail' : '')),
      row('Last position fix', Math.max(0, Math.round(nowS - d.ts)) + ' s ago'),
    ].join(''))}`;
  return html;
};

// ---------- airports ----------
FT.openAirport = icao => {
  FT.aptSel = icao || null;
  if (icao) { const a = FT.apt(icao); FT.hooks.focusAirport?.(a); loadMetar(icao); }
  document.getElementById('apt').style.display = 'block';
  FT.hooks.airportChanged?.();
  FT.renderAirport();
};
FT.closeAirport = () => {
  FT.aptSel = null;
  document.getElementById('apt').style.display = 'none';
  FT.hooks.airportChanged?.();
};
FT.loadMetar = icao => loadMetar(icao);
function loadMetar(icao) {
  const c = FT.metar[icao];
  if (c && Date.now() - c.t < 600000) return;
  FT.metar[icao] = {t: Date.now(), w: c && c.w};
  fetch('/api/metar?icao=' + icao).then(r => r.json()).then(w => { FT.metar[icao] = {t: Date.now(), w}; FT.metarGen++; FT.renderAirport(); }).catch(() => {});
}

// Build live boards for one airport from every tracked aircraft.
FT.board = icao => {
  const a = FT.apt(icao), planes = FT.hooks.planes();
  const arr = [], dep = [], gnd = [], near = [];
  for (const p of planes.values()) {
    const d = p.d, lat = p.lat ?? d.lat, lon = p.lon ?? d.lon;
    const dist = FT.km(lat, lon, a.lat, a.lon);
    const ok = d.rv !== false;
    if (!d.o && d.flight && dist < 600) FT.want('r', d.flight, 5);   // look up this airport's traffic first
    if (ok && d.d === icao && !(d.ground && dist > 8)) arr.push({p, s: FT.status(p), dist});
    else if (ok && d.o === icao) dep.push({p, s: FT.status(p), dist});
    if (d.ground && dist < 6) gnd.push({p, s: FT.status(p), dist});
    else if (!d.ground && dist < 60 && d.d !== icao && d.o !== icao) near.push({p, s: FT.status(p), dist});
  }
  arr.sort((u, v) => (u.s.etaMin ?? (u.p.d.ground ? -1 : 1e9)) - (v.s.etaMin ?? (v.p.d.ground ? -1 : 1e9)));
  dep.sort((u, v) => u.dist - v.dist);
  gnd.sort((u, v) => u.dist - v.dist);
  near.sort((u, v) => u.dist - v.dist);
  return {arr, dep, gnd, near};
};

FT.busiest = () => {
  const cnt = {};
  for (const p of FT.hooks.planes().values()) {
    const d = p.d; if (d.rv === false) continue;
    for (const k of [d.o, d.d]) if (k && FT.byIcao[k]) cnt[k] = (cnt[k] || 0) + 1;
  }
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]);
};

const flightCell = d => `<b>${esc(d.flight || d.hex.toUpperCase())}</b><br><span class="stat">${esc(d.al || d.type || '')}</span>`;
const apCell = icao => { const a = FT.apt(icao); return a ? `${esc(a.iata || a.icao)}<br><span class="stat">${esc(a.city || '')}</span>` : '<span class="stat">?</span>'; };

FT.renderAirport = () => {
  const body = document.getElementById('aptBody');
  if (!body) return;
  if (!FT.aptSel) {   // overview: busiest Indian airports right now
    const rows = FT.busiest().slice(0, 25).map(([icao, n]) => {
      const a = FT.byIcao[icao], b = FT.board(icao);
      return `<tr class="row" data-icao="${esc(icao)}"><td><b>${esc(a.iata || icao)}</b> <span class="stat">${esc(a.city || '')}</span></td>
        <td class="num">${b.arr.length}</td><td class="num">${b.dep.length}</td><td class="num">${b.gnd.length}</td></tr>`;
    }).join('');
    body.innerHTML = `<h2>Indian airports · live</h2><div class="sub">${FT.airports.length} airports · click one for its boards, or search IATA/city</div>
      <table><tr><th>Airport</th><th class="num">Arriving</th><th class="num">Departed</th><th class="num">On ground</th></tr>${rows ||
      '<tr><td colspan="4" class="empty">Waiting for route data…</td></tr>'}</table>
      <div class="note">Counts include only flights currently transmitting whose route is known.</div>`;
    return;
  }
  const a = FT.apt(FT.aptSel), b = FT.board(FT.aptSel), w = FT.metar[FT.aptSel]?.w;
  const tab = FT.aptTab, ist = dt => dt.toLocaleTimeString('en-IN', IST);
  let table;
  if (tab === 'arr') table = `<tr><th>Flight</th><th>From</th><th>Status</th><th class="num">ETA</th></tr>` + b.arr.map(({p, s}) =>
    `<tr class="row" data-hex="${esc(p.d.hex)}"><td>${flightCell(p.d)}</td><td>${apCell(p.d.o)}</td><td class="${s.cls}">${s.label}</td>
     <td class="num">${s.eta ? ist(s.eta) + `<br><span class="stat">${fmt(s.toD)} km</span>` : p.d.ground ? 'landed' : '-'}</td></tr>`).join('');
  else if (tab === 'dep') table = `<tr><th>Flight</th><th>To</th><th>Status</th><th class="num">Flown</th></tr>` + b.dep.map(({p, s}) =>
    `<tr class="row" data-hex="${esc(p.d.hex)}"><td>${flightCell(p.d)}</td><td>${apCell(p.d.d)}</td><td class="${s.cls}">${s.label}</td>
     <td class="num">${fmt(s.fromO)} km<br><span class="stat">${p.d.ground ? 'ground' : fmt(p.d.alt) + ' ft'}</span></td></tr>`).join('');
  else if (tab === 'gnd') table = `<tr><th>Flight</th><th>Route</th><th class="num">Speed</th></tr>` + b.gnd.map(({p}) =>
    `<tr class="row" data-hex="${esc(p.d.hex)}"><td>${flightCell(p.d)}</td><td>${p.d.o ? `${esc(FT.code(p.d.o))} → ${esc(FT.code(p.d.d))}` : '<span class="stat">unknown</span>'}</td>
     <td class="num">${fmt(p.d.gs)} kt<br><span class="stat">${p.d.gs > 5 ? 'taxiing' : 'parked'}</span></td></tr>`).join('');
  else table = `<tr><th>Flight</th><th>Route</th><th class="num">Alt / dist</th></tr>` + b.near.map(({p, dist}) =>
    `<tr class="row" data-hex="${esc(p.d.hex)}"><td>${flightCell(p.d)}</td><td>${p.d.o ? `${esc(FT.code(p.d.o))} → ${esc(FT.code(p.d.d))}` : '<span class="stat">unknown</span>'}</td>
     <td class="num">${fmt(p.d.alt)} ft<br><span class="stat">${fmt(dist)} km</span></td></tr>`).join('');
  const n = {arr: b.arr.length, dep: b.dep.length, gnd: b.gnd.length, near: b.near.length}[tab];

  const wx = w ? `<div class="wx"><span class="badge" style="background:${{VFR: '#166534', MVFR: '#1e40af', IFR: '#991b1b', LIFR: '#701a75'}[w.fltCat] || '#1b2436'}">${esc(w.fltCat || '?')}</span>
      Wind ${w.wdir === 'VRB' ? 'variable' : esc(w.wdir) + '°'} ${esc(w.wspd)} kt${w.wgst ? ` gust ${esc(w.wgst)}` : ''} ·
      Vis ${w.visib != null ? fmt(parseFloat(w.visib) * 1.609, 1) + ' km' : '-'} · ${esc(w.temp)}°C / dew ${esc(w.dewp)}°C · QNH ${esc(w.altim)} hPa
      ${w.wxString ? ` · ${esc(w.wxString)}` : ''}${w.clouds?.length ? ' · ' + w.clouds.map(c => esc(c.cover) + (c.base ? ' ' + c.base + ' ft' : '')).join(', ') : ''}
      <code>${esc(w.rawOb)}</code><span class="stat">observed ${new Date(w.obsTime * 1000).toLocaleTimeString('en-IN', IST)} IST</span></div>`
    : FT.metar[FT.aptSel] ? '<div class="wx stat">no current METAR for this airport</div>' : '';
  const rw = (a.runways || []).map(r => `${esc(r.id)} <span class="stat">${fmt(r.len)} ft${r.surf ? ' ' + esc(r.surf.toLowerCase()) : ''}${r.lit ? ', lit' : ''}</span>`).join(' · ');

  body.innerHTML = `
    <h2>${esc(a.iata || a.icao)} <span class="stat" style="font-size:13px">${esc(a.icao)}</span></h2>
    <div class="sub">${esc(a.name)}<br>${esc([a.city, a.state].filter(Boolean).join(', '))}${a.elev != null ? ` · elev ${fmt(a.elev)} ft` : ''}${a.type ? ` · ${esc(a.type)}` : ''}</div>
    ${rw ? `<div class="stat" style="font-size:12px">Runways: ${rw}</div>` : ''}
    ${wx}
    <div class="tabs">
      ${[['arr', 'Arrivals', b.arr.length], ['dep', 'Departures', b.dep.length], ['gnd', 'On ground', b.gnd.length], ['near', 'Nearby', b.near.length], ['hist', 'Earlier', '']]
        .map(([k, l, c]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l} ${c}</button>`).join('')}
    </div>
    ${tab === 'hist' && FT.airportHistory ? FT.airportHistory(FT.aptSel) : `<table>${n ? table : `<tr><td class="empty">Nothing ${{arr: 'inbound', dep: 'departed', gnd: 'on the ground', near: 'nearby'}[tab]} right now among tracked flights.</td></tr>`}</table>`}
    ${queue.size ? `<div class="note" style="color:var(--acc)">Looking up routes… ${queue.size} left (first visit only, remembered on this device)</div>` : ''}
    <div class="note">Built live from aircraft positions + route data (adsbdb). Aircraft at the gate with transponders off do not appear; flights whose route does not match their position are left out. <span data-icao="" style="cursor:pointer;color:var(--acc)">← all airports</span></div>`;
};

// ---------- ?flight=IGO542Y,IGO2244 : wait for these callsigns, then select + follow, in order ----------
function watchFlights(list) {
  const bar = document.createElement('div');
  bar.className = 'hud'; bar.id = 'watchBar';
  bar.style.cssText = 'top:auto;bottom:calc(14px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);padding:8px 14px;z-index:11;font-weight:600;white-space:nowrap';
  document.body.appendChild(bar);
  let current = null;
  const tick = () => {
    const planes = FT.hooks.planes();
    if (current && planes.has(current.hex) && FT.sel === current.hex) {
      bar.innerHTML = `<span class="dot"></span>Tracking ${esc(current.cs)} live`;
      return;
    }
    current = null;
    for (const cs of list) {
      for (const [hex, p] of planes) {
        const d = p.d;
        if ([d.flight, d.fi, d.reg].some(v => v && v.toUpperCase() === cs)) {
          current = {cs, hex};
          FT.hooks.selectFlight(hex);
          setTimeout(() => { const f = document.getElementById('follow'); if (f && !f.checked) f.click(); }, 400);
          bar.innerHTML = `<span class="dot"></span>Tracking ${esc(cs)} live`;
          return;
        }
      }
    }
    bar.textContent = `Waiting for ${list.join(' / ')} to start broadcasting…`;
    // silent for a while (no coverage near its destination)? continue it from its last recorded position
    if (FT.hooks.addFlights && FT.history && Date.now() - lastHist > 30000) {
      lastHist = Date.now();
      for (const cs of list) FT.history.flight(cs, 1).then(j => {
        const f = (j.flights || [])[0];
        if (!f || !f.track || !f.track.length || Date.now() / 1000 - f.last > 2400) return;
        if ([...FT.hooks.planes().values()].some(p => p.d.flight === cs)) return;
        const b = f.track[f.track.length - 1], a = f.track.length > 1 ? f.track[f.track.length - 2] : null;   // [ts, lat, lon, altft]
        const d = {hex: f.hex, flight: cs, reg: f.reg, type: f.type, lat: b[1], lon: b[2], alt: b[3], ground: b[3] < 100,
          ts: b[0], src: 'recorded (history)', o: f.o || undefined, d: f.d || undefined, x: {}};
        FT.attach(d);                                 // route from this device's lookup if the recorder has none
        if (!d.d) { FT.want('r', cs, 10); return; }   // try again once the route is known
        const t = FT.apt(d.d), r = Math.PI / 180;
        const brg = (p, q) => { const dl = (q[1] - p[1]) * r; return (Math.atan2(Math.sin(dl) * Math.cos(q[0] * r), Math.cos(p[0] * r) * Math.sin(q[0] * r) - Math.sin(p[0] * r) * Math.cos(q[0] * r) * Math.cos(dl)) / r + 360) % 360; };
        const gs = a ? FT.km(a[1], a[2], b[1], b[2]) / ((b[0] - a[0]) / 3600) / 1.852 : 0;
        d.gs = gs > 80 && gs < 600 ? gs : 280;
        d.track = a ? brg([a[1], a[2]], [b[1], b[2]]) : brg([b[1], b[2]], [t.lat, t.lon]);
        d.vr = a ? Math.round((b[3] - a[3]) / ((b[0] - a[0]) / 60)) : -1500;
        FT.hooks.addFlights([d]);
        const p = FT.hooks.planes().get(f.hex);
        if (p && !d.ground) p.est = true;
      }).catch(() => {});
    }
    // not in the countrywide feed (coverage gap)? ask for it directly by callsign
    if (FT.hooks.addFlights && Date.now() - lastDirect > 6000) {
      lastDirect = Date.now();
      for (const cs of list) fetch('/api/hex?cs=' + encodeURIComponent(cs)).then(r => r.ok ? r.json() : null)
        .then(j => { if (j && j.ac && j.ac.length) { j.ac.forEach(FT.attach); FT.hooks.addFlights(j.ac); } }).catch(() => {});
    }
  };
  let lastDirect = 0, lastHist = 0;
  tick(); setInterval(tick, 3000);
}
// ---------- search: flight (callsign, flight no, reg) or airport (IATA, ICAO, city, name) ----------
FT.search = s => {
  s = s.trim().toUpperCase(); if (!s) return null;
  for (const [hex, p] of FT.hooks.planes()) {
    const d = p.d;
    if ([d.flight, d.fi, d.reg].some(v => v && v.toUpperCase().replace('-', '') === s.replace('-', '')) || hex.toUpperCase() === s)
      return {hex};
  }
  const a = FT.airports.find(a => a.iata === s || a.icao === s) ||
    FT.airports.find(a => (a.city || '').toUpperCase().startsWith(s) || a.name.toUpperCase().includes(s));
  if (a) return {icao: a.icao};
  for (const [hex, p] of FT.hooks.planes())
    if ([p.d.flight, p.d.fi, p.d.reg].some(v => v && v.toUpperCase().includes(s))) return {hex};
  return null;
};
})();
