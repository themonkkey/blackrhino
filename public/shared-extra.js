// Extra tools shared by the 2D map and the 3D globe: bookmarks, recently viewed flights, filters,
// list view, fleet view, map layers (satellite clouds, ATC boundaries) and history.
// Extends window.FT (shared.js). Pages may provide hooks: layer(name, on), refilter(), showTrack(points|null).
(() => {
const FT = window.FT;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fmt = n => n == null || isNaN(n) ? '-' : Math.round(n).toLocaleString('en-IN');
const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch (e) { return def; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const IST = {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false};
FT.HISTORY_API = (window.BR_CONFIG || {}).historyApi || '';
FT.HISTORY_READ = (window.BR_CONFIG || {}).historyRead || FT.HISTORY_API;

// ---------- airlines (ICAO callsign prefix) ----------
const AIRLINES = {IGO: 'IndiGo', AIC: 'Air India', AXB: 'Air India Express', AKJ: 'Akasa Air', SEJ: 'SpiceJet', LLR: 'Alliance Air',
  SDG: 'Star Air', FRR: 'Fly91', IAD: 'AirAsia India', VTI: 'Vistara', BDA: 'Blue Dart', QTR: 'Qatar Airways', UAE: 'Emirates',
  ETD: 'Etihad', SIA: 'Singapore Airlines', THA: 'Thai Airways', AXM: 'AirAsia', MAS: 'Malaysia Airlines', CPA: 'Cathay Pacific',
  BAW: 'British Airways', DLH: 'Lufthansa', AFR: 'Air France', KLM: 'KLM', THY: 'Turkish Airlines', SVA: 'Saudia', GFA: 'Gulf Air',
  OMA: 'Oman Air', KAC: 'Kuwait Airways', FDB: 'flydubai', ABY: 'Air Arabia', ALK: 'SriLankan', BBC: 'Biman', RNA: 'Nepal Airlines',
  CSC: 'Sichuan Airlines', CES: 'China Eastern', CCA: 'Air China', CSN: 'China Southern', VIR: 'Virgin Atlantic', UAL: 'United',
  AAL: 'American', DAL: 'Delta', ACA: 'Air Canada', QFA: 'Qantas', ANA: 'ANA', JAL: 'Japan Airlines', KAL: 'Korean Air',
  CEB: 'Cebu Pacific', FDX: 'FedEx', UPS: 'UPS', ETH: 'Ethiopian', KQA: 'Kenya Airways', MSR: 'EgyptAir', PIA: 'PIA', IRA: 'Iran Air',
  AFG: 'Ariana', UZB: 'Uzbekistan Airways', AZG: 'Silk Way West', CLX: 'Cargolux', GEC: 'Lufthansa Cargo', THT: 'Air Tahiti'};
FT.airlineOf = d => {
  const pre = (d.flight || '').slice(0, 3);
  return /^[A-Z]{3}$/.test(pre) && /\d/.test((d.flight || '').slice(3)) ? (AIRLINES[pre] || d.al || pre) : (d.al || null);   // one name per airline
};

// ---------- bookmarks + recent ----------
let bookmarks = load('ft-bookmarks', []);     // [{key, label, t}]  key = callsign or registration
let recent = load('ft-recent', []);           // [{hex, cs, reg, o, d, t}]
FT.isBookmarked = d => bookmarks.some(b => b.key === d.flight || (d.reg && b.key === d.reg));
FT.toggleBookmark = d => {
  if (FT.isBookmarked(d)) bookmarks = bookmarks.filter(b => b.key !== d.flight && b.key !== d.reg);
  else bookmarks.unshift({key: d.flight || d.reg || d.hex.toUpperCase(), reg: d.reg, label: [FT.airlineOf(d), d.o && d.d ? `${FT.code(d.o)}→${FT.code(d.d)}` : ''].filter(Boolean).join(' · '), t: Date.now()});
  save('ft-bookmarks', bookmarks);
  FT.hooks.refreshInfo?.(); FT.renderList();
};
const baseSelect = FT.selectFlight;
FT.selectFlight = (hex, p) => {
  baseSelect(hex, p);
  if (hex && p) {
    const d = p.d;
    recent = [{hex, cs: d.flight, reg: d.reg, o: d.o, d: d.d, t: Date.now()}, ...recent.filter(r => r.hex !== hex)].slice(0, 25);
    save('ft-recent', recent);
  }
};
// star + history shortcuts at the top of the flight panel
const baseHTML = FT.flightHTML;
FT.flightHTML = (p, nowS) => {
  const on = FT.isBookmarked(p.d);
  const ob = onboard && onboard.hex === p.d.hex;
  const acts = `<div class="fx-acts">
      <button data-bm="${p.d.hex}" class="${on ? 'on' : ''}" title="Keep this flight in your bookmarks">${on ? '★ Saved' : '☆ Save'}</button>
      ${p.d.flight ? `<button data-hist="${esc(p.d.flight)}" title="Earlier flights with this callsign">History</button>` : ''}
      <button data-onboard="${p.d.hex}" class="${ob ? 'on' : ''}" title="Track this flight with your phone's GPS">${ob ? 'GPS live' : "I'm on board"}</button><!--acts-end-->
    </div>`;
  return baseHTML(p, nowS).replace('<!--acts-->', acts) + (histHTML[p.d.flight] || '');
};

// ---------- on-board GPS: your own phone tracks your own flight (works in airplane mode) ----------
// GPS needs no network, so taxi, takeoff, landing and the whole route are covered even where no
// receiver hears the aircraft. Positions stay on this device (localStorage), nothing is uploaded.
let onboard = null;   // {hex, cs, watch, pts, lock}
FT.onboard = () => onboard;
async function startOnboard(p) {
  if (!navigator.geolocation) { alert('This device has no GPS / location access.'); return; }
  stopOnboard();
  const d = p.d, key = 'ft-onboard-' + (d.flight || d.hex);
  onboard = {hex: d.hex, cs: d.flight, pts: load(key, []), key};
  try { onboard.lock = await navigator.wakeLock?.request('screen'); } catch (e) {}
  onboard.watch = navigator.geolocation.watchPosition(pos => {
    const c = pos.coords, cur = FT.hooks.planes().get(onboard.hex), base = cur ? cur.d : d;
    const last = onboard.pts[onboard.pts.length - 1];
    let track = c.heading, gs = c.speed != null ? c.speed / 0.514444 : null;
    if ((track == null || isNaN(track)) && last) {
      const r = Math.PI / 180, dl = (c.longitude - last[2]) * r;
      track = (Math.atan2(Math.sin(dl) * Math.cos(c.latitude * r), Math.cos(last[1] * r) * Math.sin(c.latitude * r) - Math.sin(last[1] * r) * Math.cos(c.latitude * r) * Math.cos(dl)) / r + 360) % 360;
    }
    if (gs == null && last) gs = FT.km(last[1], last[2], c.latitude, c.longitude) / ((pos.timestamp / 1000 - last[0]) / 3600) / 1.852;
    const altFt = c.altitude != null ? Math.round(c.altitude * 3.28084) : base.alt;
    const ground = (gs || 0) < 50 && (altFt == null || altFt < 3000);
    const rec = {...base, lat: c.latitude, lon: c.longitude, alt: ground ? null : altFt, ground, gs: gs || 0, track: track ?? base.track,
      vr: last && altFt != null && last[3] != null ? Math.round((altFt - last[3]) / Math.max((pos.timestamp / 1000 - last[0]) / 60, 0.05)) : 0,
      ts: pos.timestamp / 1000, src: 'my phone GPS (on board)', x: {...(base.x || {}), gps_accuracy_m: Math.round(c.accuracy)}};
    delete rec._plan;
    onboard.pts.push([rec.ts, rec.lat, rec.lon, altFt]);
    if (onboard.pts.length % 10 === 0) save(onboard.key, onboard.pts.slice(-5000));
    FT.hooks.addFlights?.([rec]);
  }, err => { alert('Location error: ' + err.message); stopOnboard(); }, {enableHighAccuracy: true, maximumAge: 1000, timeout: 30000});
  FT.hooks.refreshInfo?.();
}
function stopOnboard() {
  if (!onboard) return;
  navigator.geolocation.clearWatch(onboard.watch);
  try { onboard.lock && onboard.lock.release(); } catch (e) {}
  save(onboard.key, onboard.pts.slice(-5000));
  onboard = null;
  FT.hooks.refreshInfo?.();
}

// ---------- filters ----------
const DEF = {airline: '', alt: 'any', type: '', apt: '', onlyMap: false, bm: false};
let F = {...DEF, ...load('ft-filters', {})};
FT.filters = () => F;
FT.filterActive = () => !!(F.airline || F.alt !== 'any' || F.type || F.apt || F.bm);
FT.passes = d => {
  if (F.airline && FT.airlineOf(d) !== F.airline) return false;
  if (F.alt === 'ground' && !d.ground) return false;
  if (F.alt === 'low' && (d.ground || (d.alt || 0) >= 10000)) return false;
  if (F.alt === 'mid' && (d.ground || (d.alt || 0) < 10000 || d.alt >= 25000)) return false;
  if (F.alt === 'high' && (d.ground || (d.alt || 0) < 25000)) return false;
  if (F.type && !`${d.type || ''} ${d.model || ''} ${d.x?.desc || ''}`.toUpperCase().includes(F.type.toUpperCase())) return false;
  if (F.apt) { const a = FT.search(F.apt); const ic = a && a.icao; if (ic && d.o !== ic && d.d !== ic) return false; }
  if (F.bm && !FT.isBookmarked(d)) return false;
  return true;
};
FT.onMap = d => !F.onlyMap || FT.passes(d);   // pages ask this when drawing
const setF = patch => { F = {...F, ...patch}; save('ft-filters', F); FT.hooks.refilter?.(); FT.renderList(); };

// ---------- layers ----------
let L = {clouds: false, fir: false, ...load('ft-layers', {})};
FT.layers = () => L;
const setL = (k, on) => { L[k] = on; save('ft-layers', L); FT.hooks.layer?.(k, on); };
FT.firData = () => FT._fir || (FT._fir = fetch('fir.json').then(r => r.json()));
// EUMETSAT Meteosat (Indian Ocean) 10.8 µm infrared: cold cloud tops bright, refreshed every 15 min
FT.CLOUD_WMS = {url: 'https://view.eumetsat.int/geoserver/wms', layers: 'msg_iodc:ir108'};

// ---------- panel ----------
let tab = 'all', sortKey = 'flight', sortDir = 1, airlineSel = '';
function panel() {
  let el = document.getElementById('flist');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'flist'; el.className = 'hud';
  el.innerHTML = '<span id="flClose">×</span><div id="flBody"></div>';
  document.body.appendChild(el);
  el.querySelector('#flClose').onclick = () => { el.style.display = 'none'; };
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-tab],[data-sort],[data-hex],[data-air],[data-recent],[data-bmkey]');
    if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; FT.renderList(); }
    else if (t.dataset.sort) { sortDir = sortKey === t.dataset.sort ? -sortDir : 1; sortKey = t.dataset.sort; FT.renderList(); }
    else if (t.dataset.air != null) { airlineSel = t.dataset.air; FT.renderList(); }
    else if (t.dataset.hex) FT.hooks.selectFlight(t.dataset.hex);
    else if (t.dataset.bmkey) { bookmarks = bookmarks.filter(b => b.key !== t.dataset.bmkey); save('ft-bookmarks', bookmarks); FT.renderList(); }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.f) setF({[t.dataset.f]: t.type === 'checkbox' ? t.checked : t.value});
    if (t.dataset.l) setL(t.dataset.l, t.checked);
  });
  el.addEventListener('input', e => { const t = e.target; if (t.dataset.f && t.type === 'text') { clearTimeout(t._d); t._d = setTimeout(() => setF({[t.dataset.f]: t.value}), 300); } });
  return el;
}
FT.openList = (t) => {
  if (t) tab = t;
  panel().style.display = 'block';
  document.getElementById('apt') && (document.getElementById('apt').style.display = 'none');
  FT.renderList();
};

const statusOf = p => FT.status(p);
const rowsFor = list => list.map(p => {
  const d = p.d, s = statusOf(p);
  return `<tr class="row" data-hex="${esc(d.hex)}"><td><b>${esc(d.flight || d.hex.toUpperCase())}</b>${FT.isBookmarked(d) ? ' ★' : ''}<br><span class="stat">${esc(FT.airlineOf(d) || '')}</span></td>
    <td>${d.o && d.d && d.rv !== false ? `${esc(FT.code(d.o))}→${esc(FT.code(d.d))}` : '<span class="stat">-</span>'}<br><span class="stat">${esc(d.type || '')} ${esc(d.reg || '')}</span></td>
    <td class="num">${d.ground ? 'GND' : fmt(d.alt)}<br><span class="stat">${fmt(d.gs)} kt</span></td>
    <td class="${s.cls}" style="font-size:11px">${esc(s.label)}</td></tr>`;
}).join('');
const sortVal = (p, k) => {
  const d = p.d;
  return k === 'alt' ? (d.ground ? -1 : d.alt || 0) : k === 'gs' ? d.gs || 0 : k === 'route' ? `${d.o || 'ZZZZ'}${d.d || ''}` : (d.flight || 'ZZZ');
};

FT.renderList = () => {
  const el = document.getElementById('flist');
  if (!el || el.style.display !== 'block') return;
  const body = el.querySelector('#flBody'), sc = el.scrollTop;
  const all = [...FT.hooks.planes().values()];
  const airlines = {};
  for (const p of all) { const a = FT.airlineOf(p.d); if (a) airlines[a] = (airlines[a] || 0) + 1; }
  const airOpts = Object.entries(airlines).sort((a, b) => b[1] - a[1]);
  const tabs = [['all', 'All'], ['fleet', 'Fleet'], ['bm', `Bookmarks ${bookmarks.length || ''}`], ['recent', 'Recent'], ['layers', 'Layers']]
    .map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('');
  let html = `<h2>Flights</h2><div class="tabs">${tabs}</div>`;

  if (tab === 'all') {
    const list = all.filter(p => FT.passes(p.d)).sort((a, b) => { const x = sortVal(a, sortKey), y = sortVal(b, sortKey); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
    html += `<div class="filters">
        <select data-f="airline"><option value="">All airlines</option>${airOpts.map(([a, n]) => `<option ${F.airline === a ? 'selected' : ''} value="${esc(a)}">${esc(a)} (${n})</option>`).join('')}</select>
        <select data-f="alt">${[['any', 'Any altitude'], ['ground', 'On ground'], ['low', 'Below 10,000 ft'], ['mid', '10,000–25,000 ft'], ['high', 'Above 25,000 ft']].map(([v, l]) => `<option ${F.alt === v ? 'selected' : ''} value="${v}">${l}</option>`).join('')}</select>
        <input type="text" data-f="type" placeholder="Aircraft type (A20N, B738…)" value="${esc(F.type)}">
        <input type="text" data-f="apt" placeholder="To/from airport (DEL, Mumbai…)" value="${esc(F.apt)}">
        <label class="stat"><input type="checkbox" data-f="bm" ${F.bm ? 'checked' : ''}> bookmarked only</label>
        <label class="stat"><input type="checkbox" data-f="onlyMap" ${F.onlyMap ? 'checked' : ''}> hide others on the map</label>
      </div>
      <div class="stat" style="margin:6px 0">${list.length} of ${all.length} aircraft${FT.filterActive() ? ' match' : ''}</div>
      <table><tr><th data-sort="flight" style="cursor:pointer">Flight</th><th data-sort="route" style="cursor:pointer">Route · type</th><th class="num" data-sort="alt" style="cursor:pointer">Alt · speed</th><th>Status</th></tr>${rowsFor(list.slice(0, 400))}</table>`;
  } else if (tab === 'fleet') {
    const sel = airlineSel || (airOpts[0] && airOpts[0][0]) || '';
    const list = all.filter(p => FT.airlineOf(p.d) === sel);
    const byType = {};
    for (const p of list) { const t = p.d.type || '?'; byType[t] = (byType[t] || 0) + 1; }
    const air = list.filter(p => !p.d.ground).length;
    html += `<div class="filters"><select onchange="this.closest('#flist').querySelector('[data-air]')" data-airsel>${airOpts.map(([a, n]) => `<option ${a === sel ? 'selected' : ''} value="${esc(a)}">${esc(a)} (${n})</option>`).join('')}</select></div>
      <div class="stat" style="margin:6px 0">${list.length} aircraft transmitting now · ${air} airborne · ${list.length - air} on ground</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="badge">${esc(t)} × ${n}</span>`).join('')}</div>
      <table><tr><th>Flight</th><th>Route · type</th><th class="num">Alt · speed</th><th>Status</th></tr>${rowsFor(list.sort((a, b) => (a.d.reg || '').localeCompare(b.d.reg || '')))}</table>
      <div class="note">Fleet = aircraft of this airline broadcasting right now (parked aircraft with transponders off are not visible).</div>`;
  } else if (tab === 'bm') {
    const live = all.filter(p => FT.isBookmarked(p.d));
    html += bookmarks.length ? `<table><tr><th>Bookmark</th><th></th><th class="num">Now</th><th></th></tr>${bookmarks.map(b => {
        const p = live.find(p => p.d.flight === b.key || p.d.reg === b.key);
        return `<tr class="${p ? 'row' : ''}" ${p ? `data-hex="${esc(p.d.hex)}"` : ''}><td><b>★ ${esc(b.key)}</b><br><span class="stat">${esc(b.label)}</span></td><td></td>
          <td class="num">${p ? (p.d.ground ? 'on ground' : fmt(p.d.alt) + ' ft') : '<span class="stat">not flying</span>'}</td>
          <td><span data-bmkey="${esc(b.key)}" style="cursor:pointer;color:var(--mute)">remove</span></td></tr>`;
      }).join('')}</table>` : '<div class="empty">No bookmarks yet. Open a flight and tap ☆ Bookmark.</div>';
  } else if (tab === 'recent') {
    html += recent.length ? `<table><tr><th>Flight</th><th>Route</th><th class="num">Viewed</th></tr>${recent.map(r => {
        const live = FT.hooks.planes().has(r.hex);
        return `<tr class="${live ? 'row' : ''}" ${live ? `data-hex="${esc(r.hex)}"` : ''}><td><b>${esc(r.cs || r.hex.toUpperCase())}</b><br><span class="stat">${esc(r.reg || '')}</span></td>
          <td>${r.o ? `${esc(FT.code(r.o))}→${esc(FT.code(r.d))}` : '-'}</td>
          <td class="num">${new Date(r.t).toLocaleTimeString('en-IN', IST)}<br><span class="stat">${live ? 'flying now' : 'not live'}</span></td></tr>`;
      }).join('')}</table>` : '<div class="empty">Flights you open will appear here.</div>';
  } else if (tab === 'layers') {
    html += `<div class="filters" style="flex-direction:column;align-items:flex-start">
        <label><input type="checkbox" data-l="clouds" ${L.clouds ? 'checked' : ''}> <b>Satellite clouds</b> <span class="stat">· Meteosat infrared, live (15 min), EUMETSAT</span></label>
        <label><input type="checkbox" data-l="fir" ${L.fir ? 'checked' : ''}> <b>ATC boundaries</b> <span class="stat">· Delhi, Mumbai, Kolkata, Chennai FIRs (approximate, VATSIM data)</span></label>
      </div>`;
  }
  body.innerHTML = html;
  const as = body.querySelector('[data-airsel]');
  if (as) as.onchange = () => { airlineSel = as.value; FT.renderList(); };
  el.scrollTop = sc;
};
setInterval(() => { if (!document.hidden) FT.renderList(); }, 3000);

// ---------- history (recorded by the flight-history worker every 10 min) ----------
FT.history = {
  flight: (cs, days = 7) => fetch(`${FT.HISTORY_READ}/flight?cs=${encodeURIComponent(cs)}&days=${days}`).then(r => r.json()),
  airport: (icao, day) => fetch(`${FT.HISTORY_READ}/airport?icao=${icao}&day=${day}`).then(r => r.json()),
};
const histHTML = {}, histData = {};
async function showFlightHistory(cs) {
  histHTML[cs] = '<h3>History</h3><div class="pend">loading…</div>'; FT.hooks.refreshInfo?.();
  try {
    const j = await FT.history.flight(cs);
    histData[cs] = j.flights || [];
    histHTML[cs] = !histData[cs].length
      ? `<h3>History</h3><div class="stat">No recorded flights for ${esc(cs)} yet (recording since ${esc(j.since || 'recently')}).</div>`
      : `<h3>History · last 7 days</h3><table>${histData[cs].map((f, i) => `<tr><td>${esc(f.day)}</td>
          <td>${new Date(f.first * 1000).toLocaleTimeString('en-IN', IST)}–${new Date(f.last * 1000).toLocaleTimeString('en-IN', IST)}</td>
          <td>${esc(f.reg || '')}</td><td><span data-track="${esc(cs)}|${i}" style="cursor:pointer;color:var(--acc)">show path</span></td></tr>`).join('')}</table>
          <div class="stat" style="font-size:11px">Recorded every 10 min from this app's live feed; times IST.</div>`;
  } catch (e) { histHTML[cs] = '<h3>History</h3><div class="stat">History service unavailable.</div>'; }
  FT.hooks.refreshInfo?.();
}

// ---------- airport history tab ----------
const aptHist = {};
FT.airportHistory = icao => {   // cached HTML for the airport panel's "Earlier today" tab
  const c = aptHist[icao];
  if (!c || Date.now() - c.t > 120e3) {
    aptHist[icao] = {t: Date.now(), html: c ? c.html : '<div class="pend">loading recorded flights…</div>'};
    FT.airportHistoryHTML(icao).then(h => { aptHist[icao] = {t: Date.now(), html: h}; FT.renderAirport(); })
      .catch(() => { aptHist[icao] = {t: Date.now(), html: '<div class="empty">History service unavailable.</div>'}; FT.renderAirport(); });
  }
  return aptHist[icao].html;
};
FT.airportHistoryHTML = async (icao) => {
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const j = await FT.history.airport(icao, day);
  const fl = j.flights || [];
  const arr = fl.filter(f => f.d === icao), dep = fl.filter(f => f.o === icao);
  const tbl = (list, other, label) => list.length ? `<h3>${label} today (${list.length})</h3><table><tr><th>Flight</th><th>${other === 'o' ? 'From' : 'To'}</th><th class="num">Seen (IST)</th></tr>${list.map(f =>
      `<tr><td><b>${esc(f.cs)}</b><br><span class="stat">${esc(f.reg || '')} ${esc(f.type || '')}</span></td><td>${esc(FT.code(f[other]) || '-')}</td>
       <td class="num">${new Date(f.first * 1000).toLocaleTimeString('en-IN', IST)}–${new Date(f.last * 1000).toLocaleTimeString('en-IN', IST)}</td></tr>`).join('')}</table>` : '';
  return (tbl(arr, 'o', 'Arrivals') + tbl(dep, 'd', 'Departures')) ||
    `<div class="empty">No recorded flights for today yet (recording since ${esc(j.since || 'today')}).</div>`;
};

// ---------- wiring ----------
const baseInit = FT.init;
FT.init = hooks => {
  const r = baseInit(hooks);
  const b = document.createElement('button');
  b.id = 'bList'; b.className = 'tb'; b.title = 'Flights list, filters, bookmarks and map layers';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span>Flights</span>';
  document.getElementById('bApt').insertAdjacentElement('afterend', b);
  b.onclick = () => { const el = panel(); el.style.display === 'block' ? el.style.display = 'none' : FT.openList(); };
  document.getElementById('info').addEventListener('click', e => {
    const bm = e.target.closest('[data-bm]'), h = e.target.closest('[data-hist]');
    if (bm) { const p = FT.hooks.planes().get(bm.dataset.bm); if (p) FT.toggleBookmark(p.d); }
    if (h) showFlightHistory(h.dataset.hist);
    const ob = e.target.closest('[data-onboard]');
    if (ob) { if (onboard && onboard.hex === ob.dataset.onboard) stopOnboard(); else { const p = FT.hooks.planes().get(ob.dataset.onboard); if (p) startOnboard(p); } }
    const tr = e.target.closest('[data-track]');
    if (tr) { const [cs, i] = tr.dataset.track.split('|'); const f = (histData[cs] || [])[+i]; if (f) FT.hooks.showTrack?.(f.track); }
  });
  // visible "filters on" chip so a saved filter never silently hides aircraft
  const chip = document.createElement('button');
  chip.id = 'fChip'; chip.style.display = 'none';
  document.getElementById('q').insertAdjacentElement('afterend', chip);
  chip.onclick = () => { F = {...DEF}; save('ft-filters', F); FT.hooks.refilter?.(); FT.renderList(); };
  setInterval(() => {
    const on = FT.filterActive() && F.onlyMap;
    chip.style.display = on ? '' : 'none';
    if (on) { const all = [...FT.hooks.planes().values()], n = all.filter(p => FT.passes(p.d)).length; chip.textContent = `Filter: ${n}/${all.length} shown · clear ✕`; }
  }, 1000);
  // re-apply saved layers once the page is ready
  setTimeout(() => { for (const k of Object.keys(L)) if (L[k]) FT.hooks.layer?.(k, true); }, 800);
  return r;
};
})();
