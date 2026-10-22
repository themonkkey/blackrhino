// Learned landing-time correction (eta/train.py -> eta-model.json).
// The physics plan in shared.js gives a duration T; the model predicts (actual - T) in seconds from where the aircraft
// was when radar went silent. Features here must match eta/train.py features() exactly.
(function () {
  const FT = window.FT || (window.FT = {});
  const R = Math.PI / 180;
  const km = (la1, lo1, la2, lo2) => { const a = Math.sin((la2 - la1) * R / 2) ** 2 + Math.cos(la1 * R) * Math.cos(la2 * R) * Math.sin((lo2 - lo1) * R / 2) ** 2; return 12742 * Math.asin(Math.sqrt(Math.min(1, a))); };
  const brg = (a, b) => { const dl = (b[1] - a[1]) * R; return (Math.atan2(Math.sin(dl) * Math.cos(b[0] * R), Math.cos(a[0] * R) * Math.sin(b[0] * R) - Math.sin(a[0] * R) * Math.cos(b[0] * R) * Math.cos(dl)) / R + 360) % 360; };
  const adiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const TURBO = ['AT4', 'AT7', 'ATR', 'DH8', 'Q40', 'DHC', 'B190', 'C208', 'D228', 'SF34', 'J41', 'E120'];
  const HEAVY = ['B77', 'B78', 'B74', 'A33', 'A34', 'A35', 'A38', 'B76', 'MD1', 'IL7'];
  let M = null;
  fetch('/eta-model.json').then(r => r.ok ? r.json() : null).then(j => { if (j && j.v === 2) { M = j; FT.metarGen = (FT.metarGen || 0) + 1; } }).catch(() => {});
  FT.etaModel = () => M;

  function predict(m, x) {
    let s = m.base;
    for (const t of m.trees) {
      let i = 0;
      for (;;) {
        const n = t[i];
        if (n[4]) { s += n[5]; break; }
        const v = x[n[0]];
        i = (v !== v ? n[6] : v <= n[1]) ? n[2] : n[3];   // NaN follows the learned missing branch
      }
    }
    return s;
  }

  // d: live flight record, t: destination airport, rw: chosen runway from FT.landingRunway, T/L: physics plan seconds/km
  FT.etaAdjust = (d, t, rw, T, Lkm) => {   // -> {T, lo, hi} seconds from the last fix, or null (no model / out of range)
    if (!M || !t) return null;
    const elev = t.elev || 0, lat = d.lat, lon = d.lon, alt = d.alt || 0, trk = d.track || 0;
    const thr = rw ? rw.thr : [t.lat, t.lon], course = rw ? rw.course : trk;
    const dThr = km(lat, lon, thr[0], thr[1]);
    const off = adiff(brg(thr, [lat, lon]), (course + 180) % 360);
    const agl = alt - elev, glide = dThr * 1000 * Math.tan(3 * R) / 0.3048;
    const hour = ((d.ts + 5.5 * 3600) % 86400) / 3600;
    const typ = (d.type || '').toUpperCase(), cat = d.x && d.x.category;
    const heavy = cat === 'A5' || HEAVY.includes(typ.slice(0, 3)) ? 1 : 0;
    const turbo = TURBO.some(p => typ.startsWith(p)) || (cat === 'A2' && /^(AT|DH)/.test(typ)) ? 1 : 0;
    const rws = t.runways || [];
    const x = [T, Lkm, agl, d.gs || 0, Math.max(-6000, Math.min(3000, d.vr || 0)), km(lat, lon, t.lat, t.lon), dThr, off,
      adiff(trk, course), adiff(trk, brg([lat, lon], [t.lat, t.lon])), agl - glide, rw && rw.byWind ? 1 : 0, rws.length,
      Math.max(0, ...rws.map(r => r.len || 0)) / 1000, heavy, turbo, Math.sin(hour / 24 * 2 * Math.PI), Math.cos(hour / 24 * 2 * Math.PI), agl < 9000 ? 1 : 0];
    if (agl < 1500 || agl > 24000) return null;                          // outside the range the model was trained on
    const clamp = c => Math.max(-T * 0.5, Math.min(T * 1.5, c));
    const c50 = clamp(predict(M.q50, x)), c10 = clamp(predict(M.q10, x)) - M.cqr, c90 = clamp(predict(M.q90, x)) + M.cqr;
    // 80% range: both ends calibrated on held-out airports (eta/train.py); the median always sits inside it
    return {T: T + c50, lo: Math.max(30, T + Math.min(c10, c90, c50)), hi: T + Math.max(c10, c90, c50), corr: c50};
  };
})();
