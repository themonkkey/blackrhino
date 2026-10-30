/* Near me core, shared by the 2D map and the 3D view.
   The device position (browser GPS) is used only inside the page and is never sent anywhere.
   rows(planes)   aircraft within 30 km of you with bearing, elevation angle and closest-approach prediction
   choose(rows)   the headline aircraft: right above you / next over you / nearest
   bannerHTML, listHTML, alert(), start()/stop() (GPS watch + keep-screen-awake) */
window.NEAR = (() => {
  const RAD = Math.PI / 180, COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const st = {me: null, watch: null, wake: null, alertOn: false, alerted: new Set(), audio: null};
  try { st.alertOn = localStorage.getItem('br-near-alert') === '1'; } catch (e) {}
  const arrow = vr => (vr || 0) > 300 ? '&uarr;' : (vr || 0) < -300 ? '&darr;' : '';
  const dir = az => COMPASS[Math.round(az / 22.5) % 16];

  function rows(planes) {
    const me = st.me;
    if (!me) return [];
    if (me.g == null) {   // ground level under you: the nearest airport's elevation (barometric altitude is above sea level)
      let best = 0, bd = 60; for (const a of FT.airports) { const k = FT.km(me.lat, me.lon, a.lat, a.lon); if (k < bd) { bd = k; best = a.elev || 0; } } me.g = best;
    }
    const out = [];
    for (const [hex, p] of planes) {
      const d = p.dv || p.d;
      if (d.ground || p.lat == null || d.alt == null) continue;
      const dk = FT.km(me.lat, me.lon, p.lat, p.lon);
      if (dk > 30) continue;
      const h = Math.max(0, (d.alt - me.g) * 0.3048), el = Math.atan2(h, dk * 1000) / RAD;
      const az = (Math.atan2((p.lon - me.lon) * Math.cos(me.lat * RAD), p.lat - me.lat) / RAD + 360) % 360;
      // closest approach: where the aircraft is nearest to you if it keeps its track and speed
      const gs = (d.gs || 0) * 0.514444, tr = (d.track || 0) * RAD, vE = gs * Math.sin(tr), vN = gs * Math.cos(tr);
      const rE = (p.lon - me.lon) * 111195 * Math.cos(me.lat * RAD), rN = (p.lat - me.lat) * 111195, v2 = vE * vE + vN * vN;
      const tc = v2 > 1 ? Math.max(0, -(rE * vE + rN * vN) / v2) : 0, cE = rE + vE * tc, cN = rN + vN * tc;
      const cpa = Math.hypot(cE, cN, Math.max(0, h + (d.vr || 0) * 0.3048 / 60 * Math.min(tc, 120))) / 1000;
      const sweep = (vE * rN - vN * rE) / Math.max(rE * rE + rN * rN, 1);   // rad/s of bearing change: > 0 = it moves left to right as you face it
      out.push({hex, p, d, dk, h, el, az, tc, cpa, sweep, slant: Math.hypot(dk * 1000, h) / 1000});
    }
    return out.sort((a, b) => a.slant - b.slant);
  }
  function choose(rs) {
    const ok = r => r.slant < 2.5 || (r.cpa < 3.5 && r.tc > 2 && r.tc < 600);
    const top = rs.filter(r => r.cpa < 3.5 && r.tc > 2 && r.tc < 600).sort((a, b) => a.tc - b.tc)[0], over = rs.find(r => r.slant < 2.5);
    let pick = over || top || rs[0] || null, tail = false;
    // Like a person watching the sky: keep following the plane you were looking at, even after it has passed, until another one
    // is right above you (or about to be within ~25 s) or it is lost in the distance.
    const prev = st.last && rs.find(r => r.hex === st.last);
    if (prev && prev.dk < 18 && !(over && over.hex !== prev.hex) && !(top && top.hex !== prev.hex && top.tc < (prev.tc > 2 ? Math.min(25, prev.tc - 12) : 25))) { pick = prev; tail = !ok(prev); }
    st.last = pick && pick.hex;
    return {pick, over: !!over && pick === over, top: !!pick && !tail && pick.slant >= 2.5 && ok(pick), tail};
  }
  function look(r) {
    return `Look ${dir(r.az)}, ${Math.round(r.el)}° above the horizon${Math.abs(r.sweep) > 0.002 ? `, moving ${r.sweep > 0 ? 'left to right' : 'right to left'}` : ''}`;
  }
  function bannerHTML(c) {
    const r = c.pick;
    if (!r) return '';
    const d = r.d, mm = Math.floor(r.tc / 60), ss = String(Math.round(r.tc % 60)).padStart(2, '0');
    const when = c.over ? 'overhead now' : r.cpa < 3.5 && r.tc > 2 && r.tc < 600 ? `passes closest in ${mm}:${ss}, ${r.cpa.toFixed(1)} km from you` : c.tail ? `${r.dk.toFixed(1)} km away, flying off ${dir(r.az)}` : `${r.dk.toFixed(1)} km away, not heading your way`;
    return `<div class="ntop" data-hex="${esc(r.hex)}"><small>${c.over ? 'Right above you' : c.top ? 'Next over you' : c.tail ? 'Watching it go' : 'Nearest aircraft'}</small><b>${esc(d.flight || r.hex)}</b> <span>${esc(d.al || '')} ${esc(d.type || '')}</span><em>${Math.round(d.alt / 100) * 100} ft ${arrow(d.vr)} &middot; ${Math.round(d.gs || 0)} kt${d.o || d.d ? ` &middot; ${esc(d.o || '?')} &rarr; ${esc(d.d || '?')}` : ''}</em><u>${when}</u><i>${look(r)}</i></div>`;
  }
  function listHTML(rs, selected) {
    return rs.length ? rs.slice(0, 8).map(r => {
      const d = r.d, over = r.slant < 2.5 || r.el > 60;
      return `<div class="nrow${r.hex === selected ? ' on' : ''}" data-hex="${esc(r.hex)}"><b>${esc(d.flight || r.hex)}</b><span>${esc(d.type || '')}</span>${over ? '<i>overhead</i>' : ''}<small>${Math.round(d.alt / 100) * 100} ft ${arrow(d.vr) || '&rarr;'} &middot; ${r.dk.toFixed(1)} km ${dir(r.az)} &middot; ${Math.round(r.el)}&deg; up</small></div>`;
    }).join('') : '<div class="nrow none">No aircraft within 30 km right now</div>';
  }

  // optional alert: soft double beep + vibration + toast when an aircraft is about to pass over you (once per flight)
  function beep() {
    try { navigator.vibrate && navigator.vibrate([120, 80, 120]); } catch (e) {}
    try {
      const a = st.audio = st.audio || new (window.AudioContext || window.webkitAudioContext)();
      for (const t of [0, 0.22]) { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, a.currentTime + t); g.gain.exponentialRampToValueAtTime(0.18, a.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t + 0.18); o.connect(g); g.connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.2); }
    } catch (e) {}
  }
  function alert(c) {
    const r = c.pick;
    if (!st.alertOn || !r || st.alerted.has(r.hex) || !(c.over || (r.tc > 2 && r.tc < 40 && r.cpa < 2))) return;
    st.alerted.add(r.hex); beep();
    const t = document.getElementById('nearToast');
    if (t) { t.textContent = `${r.d.flight || r.hex} is ${c.over ? 'right above you' : 'about to pass over you'}`; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 6000); }
  }
  function setAlert(on) {
    st.alertOn = on; try { localStorage.setItem('br-near-alert', on ? '1' : '0'); } catch (e) {}
    if (on) try { st.audio = st.audio || new (window.AudioContext || window.webkitAudioContext)(); st.audio.resume(); } catch (e) {}
  }
  async function keepAwake(on) { try { if (on && navigator.wakeLock) st.wake = await navigator.wakeLock.request('screen'); else if (st.wake) { await st.wake.release(); st.wake = null; } } catch (e) {} }
  document.addEventListener('visibilitychange', () => { if (st.me && !document.hidden && !st.wake) keepAwake(true); });

  /* Phone compass + gyro (the way Google Maps turns the blue cone): az = where the back camera points (0 = north), el = how far above the horizon.
     Android gives an absolute orientation; iOS gives webkitCompassHeading and asks permission, which must come from a tap. Desktop has no sensor: az stays null. */
  const comp = {az: null, el: null, on: false, listeners: []};
  const circ = (a, b, k) => (a + (((b - a + 540) % 360) - 180) * k + 360) % 360;
  function feed(az, el) {   // smoothed; also the entry point for tests
    comp.az = comp.az == null ? az : circ(comp.az, az, 0.3);
    comp.el = comp.el == null ? el : comp.el + (el - comp.el) * 0.3;
  }
  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    const R = RAD, b = e.beta * R, g = e.gamma * R, up = -Math.cos(b) * Math.cos(g), el = Math.asin(Math.max(-1, Math.min(1, up))) / R;
    let az = null;
    if (e.webkitCompassHeading != null) az = e.webkitCompassHeading;                       // iOS: already tilt-compensated
    else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) {  // Android: direction of the back camera from the rotation matrix
      const a = e.alpha * R, E = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g)), N = -(Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g));
      if (Math.abs(el) < 80) az = (Math.atan2(E, N) / R + 360) % 360;                       // straight up or down has no heading: keep the last one
    }
    if (az == null && comp.az == null) return;
    feed(az == null ? comp.az : az, el); comp.listeners.forEach(f => f(comp));
  }
  async function compassStart() {
    if (comp.on || typeof DeviceOrientationEvent === 'undefined') return comp.on;
    try { if (DeviceOrientationEvent.requestPermission && (await DeviceOrientationEvent.requestPermission()) !== 'granted') return false; } catch (e) { return false; }
    addEventListener('deviceorientationabsolute', onOrient, true); addEventListener('deviceorientation', onOrient, true);
    return comp.on = true;
  }
  function compassStop() { removeEventListener('deviceorientationabsolute', onOrient, true); removeEventListener('deviceorientation', onOrient, true); comp.on = false; comp.az = comp.el = null; }

  /* GPS. onFix(me, isFirst) on every position, onError(message) once. */
  function start(onFix, onError) {
    if (!navigator.geolocation) { onError('This browser has no location access.'); return false; }
    keepAwake(true);
    let first = true;
    st.watch = navigator.geolocation.watchPosition(pos => {
      st.me = {lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, g: st.me && st.me.g};
      onFix(st.me, first); first = false;
    }, err => { onError(err.code === 1 ? 'Location is blocked. Allow it for this site in your browser settings, then press Near me again.' : 'Could not get a GPS fix. Try again.'); stop(); },
    {enableHighAccuracy: true, maximumAge: 10000, timeout: 30000});
    return true;
  }
  function stop() {
    if (st.watch != null) navigator.geolocation.clearWatch(st.watch);
    st.watch = null; st.me = null; st.alerted.clear(); st.last = null; keepAwake(false); compassStop();
  }
  return {compass: comp, compassStart, feed, rows, choose, look, bannerHTML, listHTML, alert, setAlert, start, stop, dir, esc, get me() { return st.me; }, get active() { return st.watch != null; }, get alertOn() { return st.alertOn; }};
})();
