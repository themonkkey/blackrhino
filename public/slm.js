/* Ask-in-words search, a small language model that runs in this page (nothing is sent anywhere).
   "indigo planes above 30k ft landing in delhi"  ->  airline=IGO;to=DEL;min_alt=30000  ->  filter on the map.
   The model only writes a filter; the filtering below is ordinary code, so a wrong answer is a wrong filter, never an invented flight.
   Two ONNX graphs (encoder, one decoder step), int8, 2.5 MB total, fetched on the first question only.
   Trained from scratch, see flight-slm. Low confidence or a malformed answer -> no filter and a plain "didn't understand". */
window.SLM = (() => {
  const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  const BOS = 1, EOS = 2, UNK = 3, GATE = 0.8, KEYS = ['airline', 'type', 'kind', 'from', 'to', 'near', 'state', 'min_alt', 'max_alt', 'min_gs', 'max_gs', 'squawk', 'sort', 'limit'];
  const HELI = /^(EC[0-9]|H1[2-7]|H160|AS[3-5]|AW1|A1[0-9]9|B0[6-7]|B4[0-3]|B2|R22|R44|R66|S76|S92|MI[0-9]|ALH|LCH|BK17|EH10|NH90)/;
  const PROP = /^(AT[4-7]|DH8|DHC|B190|BE[2-9]0|C208|C212|D228|DO2|PC1[2-2]|PC6|SF34|JS3|E120|L410|AN2|AN3|C130|C30J|P180|SW4|F27|F50|C1[5-9]|C172|C182|PA[0-9]|P28)/;
  const WIDE = /^(A30|A31[0-9]?$|A33|A34|A35|A38|B74|B76|B77|B78|MD11|IL76|C17|A400)/;
  const NEAR_KM = 100;
  let sess = null, loading = null, itos = null, stoi = null;

  function script(src, sri) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; if (sri) { s.integrity = sri; s.crossOrigin = 'anonymous'; } s.onload = ok; s.onerror = () => no(new Error('load ' + src)); document.head.appendChild(s); }); }
  function load() {
    return loading || (loading = (async () => {
      if (!window.ort) await script(ORT + 'ort.min.js', 'sha384-RPL/K8tc0JVaNWsunkEmCzLeieefvFX2UCRLKLmLVChCI6P+CTKhzqF7VIeCc3Zp');
      ort.env.wasm.wasmPaths = ORT; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
      const [tk, enc, dec] = await Promise.all([fetch('/slm/tokenizer.json').then(r => r.json()), ort.InferenceSession.create('/slm/enc.q.onnx'), ort.InferenceSession.create('/slm/dec.q.onnx')]);
      itos = tk.itos; stoi = Object.fromEntries(itos.map((c, i) => [c, i]));
      return sess = {enc, dec};
    })().catch(e => { loading = null; throw e; }));
  }

  const big = a => BigInt64Array.from(a, BigInt);
  /* greedy decode; confidence = the lowest probability the model gave to any character it wrote */
  async function translate(q) {
    const {enc, dec} = await load();
    const ids = [...q.toLowerCase().slice(0, 140)].map(c => stoi[c] ?? UNK).concat(EOS);
    const src = new ort.Tensor('int64', big(ids), [1, ids.length]);
    const mem = (await enc.run({src})).mem;
    const out = [BOS]; let conf = 1;
    for (let i = 0; i < 96; i++) {
      const lg = (await dec.run({tgt: new ort.Tensor('int64', big(out), [1, out.length]), mem, src})).logits.data;
      let mx = -Infinity, k = 0; for (let j = 0; j < lg.length; j++) if (lg[j] > mx) { mx = lg[j]; k = j; }
      let z = 0; for (let j = 0; j < lg.length; j++) z += Math.exp(lg[j] - mx);
      conf = Math.min(conf, 1 / z);
      out.push(k); if (k === EOS) break;
    }
    return {text: out.slice(1).filter(i => i > UNK).map(i => itos[i]).join('').trim(), conf};
  }

  /* "a=1;b=2" -> {a:'1',b:'2'}, 'all', 'none', or null if malformed (unknown key, bad value) */
  function parse(t) {
    if (t === 'all' || t === 'none') return t;
    const c = {};
    for (const kv of t.split(';')) {
      const m = /^([a-z_]+)=([A-Za-z0-9_]+)$/.exec(kv); if (!m || !KEYS.includes(m[1]) || m[1] in c) return null;
      c[m[1]] = m[2];
    }
    const ok = (k, re) => !(k in c) || re.test(c[k]);
    return Object.keys(c).length && ok('kind', /^(jet|heli|prop|wide)$/) && ok('state', /^(air|ground)$/) && ok('sort', /^(gs|alt)_(asc|desc)$/) && ok('squawk', /^(7500|7600|7700)$/) &&
      ['min_alt', 'max_alt', 'min_gs', 'max_gs', 'limit'].every(k => ok(k, /^\d{1,6}$/)) && ok('airline', /^[A-Z0-9]{3}$/) && ok('from', /^[A-Z]{3}$/) && ok('to', /^[A-Z]{3}$/) && ok('near', /^[A-Z]{3}$/) ? c : null;
  }

  const kindOf = d => { const t = (d.type || '').toUpperCase(); return d.category === 'A7' || HELI.test(t) ? 'heli' : PROP.test(t) ? 'prop' : d.category === 'A5' || WIDE.test(t) ? 'wide' : 'jet'; };
  const apt = iata => FT.airports.find(a => a.iata === iata);
  function km(a, b, c, d) { const p = Math.PI / 180, x = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); }

  /* the planes (list of d) that satisfy the constraints, sorted and limited like the model asked */
  function run(c, list) {
    const A = {}; for (const k of ['from', 'to', 'near']) if (c[k]) { A[k] = apt(c[k]); if (!A[k]) return []; }
    let out = list.filter(d => {
      if (c.airline && !(d.flight || '').toUpperCase().startsWith(c.airline)) return false;
      if (c.type) { const t = (d.type || '').toUpperCase(); if (!(t === c.type || (c.type === 'B737' && /^B73[0-9]$/.test(t)))) return false; }
      if (c.kind) { const k = kindOf(d); if (!(k === c.kind || (c.kind === 'jet' && k === 'wide'))) return false; }
      if (A.from && ![A.from.icao, A.from.iata].includes(d.o)) return false;
      if (A.to && ![A.to.icao, A.to.iata].includes(d.d)) return false;
      if (A.near && (d.lat == null || km(A.near.lat, A.near.lon, d.lat, d.lon) > NEAR_KM)) return false;
      if (c.state && !!d.ground !== (c.state === 'ground')) return false;
      if ('min_alt' in c && (d.ground || d.alt == null || d.alt < +c.min_alt)) return false;
      if ('max_alt' in c && (d.alt == null || d.alt > +c.max_alt)) return false;
      if ('min_gs' in c && (d.gs == null || d.gs < +c.min_gs)) return false;
      if ('max_gs' in c && (d.gs == null || d.gs > +c.max_gs)) return false;
      if (c.squawk && String(d.squawk) !== c.squawk) return false;
      return true;
    });
    if (c.sort) { const [f, dir] = c.sort.split('_'); out = out.filter(d => d[f] != null).sort((a, b) => dir === 'desc' ? b[f] - a[f] : a[f] - b[f]); }
    return c.limit ? out.slice(0, +c.limit) : out;
  }

  const SORTS = {gs_desc: 'fastest', gs_asc: 'slowest', alt_desc: 'highest', alt_asc: 'lowest'}, KINDS = {jet: 'jets', heli: 'helicopters', prop: 'turboprops', wide: 'widebodies'};
  function label(c) {
    const p = [];
    if (c.limit) p.push('top ' + c.limit); if (c.sort) p.push(SORTS[c.sort]);
    if (c.airline) p.push(c.airline); if (c.type) p.push(c.type); p.push(c.kind ? KINDS[c.kind] : 'aircraft');
    if (c.state) p.push(c.state === 'air' ? 'in the air' : 'on the ground');
    if (c.from) p.push('from ' + c.from); if (c.to) p.push('to ' + c.to); if (c.near) p.push('near ' + c.near);
    if (c.min_alt) p.push('above ' + (+c.min_alt).toLocaleString() + ' ft'); if (c.max_alt) p.push('below ' + (+c.max_alt).toLocaleString() + ' ft');
    if (c.min_gs) p.push('over ' + c.min_gs + ' kt'); if (c.max_gs) p.push('under ' + c.max_gs + ' kt');
    if (c.squawk) p.push('squawk ' + c.squawk);
    return p.join(' ');
  }

  /* Plain "hyd to blr", "from delhi to mumbai flights": no model needed, and it never gets it wrong. Both sides must be airports we know. */
  const ALIAS = {bangalore: 'BLR', bombay: 'BOM', calcutta: 'CCU', madras: 'MAA', baroda: 'BDQ', poona: 'PNQ', banaras: 'VNS', trivandrum: 'TRV', cochin: 'COK', gauhati: 'GAU', mangalore: 'IXE', vizag: 'VTZ', 'new delhi': 'DEL', delhi: 'DEL', goa: 'GOI'};
  /* spelling-tolerant place lookup: Damerau-Levenshtein against every city and alias; accepts a close, unambiguous match ("hydrabad", "bengluru", "dehli") */
  function dl(a, b) {
    const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  }
  let NAMES = null;
  function fuzzyPlace(t) {
    t = t.trim().toLowerCase(); if (t.length < 4) return null;
    if (!NAMES) {   // one entry per spoken name; a city with two airports means its largest
      const m = {...ALIAS}, big = {}; for (const a of FT.airports) { const n = (a.city || '').toLowerCase(); if (a.iata && n && (!(n in m) || (a.type === 'large' && !big[n]))) { m[n] = a.iata; if (a.type === 'large') big[n] = 1; } }
      NAMES = Object.entries(m);
    }
    const lim = Math.max(1, Math.floor(t.length / 4)); let best = null, bd = 99, tie = false;
    for (const [n, iata] of NAMES) {
      if (Math.abs(n.length - t.length) > lim) continue;
      const d = dl(t, n); if (d > lim) continue;
      if (d < bd) { bd = d; best = iata; tie = false; } else if (d === bd && iata !== best) tie = true;
    }
    return best && !tie ? best : null;
  }
  function place(t) {
    t = t.trim().toLowerCase(); if (!t || t.split(/\s+/).length > 3) return null;
    if (ALIAS[t]) return ALIAS[t];
    const a = FT.airports.find(a => (a.iata || '').toLowerCase() === t || (a.icao || '').toLowerCase() === t) || FT.airports.find(a => (a.city || '').toLowerCase() === t) || FT.airports.find(a => (a.city || '').toLowerCase().startsWith(t) && t.length >= 4);
    return a && a.iata || fuzzyPlace(t);
  }
  function route(q) {
    const m = /^\s*(?:(?:show|find|list|all|any|me)\s+)*(?:(?:flights?|planes?|aircraft)\s+)?(?:from\s+)?(.+?)\s*(?:\bto\b|->|\u2192|\u2013|\s-\s)\s*(.+?)(?:\s+(?:flights?|planes?|aircraft|now|live|today))*\s*$/i.exec(q);
    const f = m && place(m[1]), t = m && place(m[2]);
    return f && t && f !== t ? {from: f, to: t} : null;
  }

  /* ask(q): {c, label, conf} when understood, {none:true} for "not a flight question", {unsure:true} when the model was not confident */
  async function ask(q) {
    q = String(q).slice(0, 120);   // bound the work a pasted wall of text can cause
    const rc = route(q); if (rc) return {c: rc, label: label(rc), conf: 1};
    const r = await translate(q), c = parse(r.text);
    if (!c || r.conf < GATE) return {unsure: true, conf: r.conf, text: r.text};
    if (c === 'none') return {none: true, conf: r.conf};
    if (c && c !== 'all') for (const k of ['from', 'to', 'near']) if (c[k] === 'RAJ') c[k] = 'HSR';   // Rajkot's flights use the new Hirasar airport
    return c === 'all' ? {all: true, conf: r.conf} : {c, label: label(c), conf: r.conf};
  }
  return {ask, run, apt, fuzzyPlace, label, parse, translate, load, GATE};
})();
