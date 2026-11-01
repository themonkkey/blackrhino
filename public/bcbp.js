// Read a flight number and date from a boarding pass barcode (IATA BCBP, Resolution 792) or ticket text.
// Runs only in the browser. Returns flight, date and airports, never the passenger name, booking reference,
// seat, ticket or frequent-flyer number, so none of that can reach a URL, a log or storage.

// IATA airline code -> [ICAO callsign prefix, name]. Fallback only: the track page asks adsbdb first.
export const AIRLINES = {
  '6E': ['IGO', 'IndiGo'], AI: ['AIC', 'Air India'], IX: ['AXB', 'Air India Express'], QP: ['AKJ', 'Akasa Air'],
  SG: ['SEJ', 'SpiceJet'], '9I': ['LLR', 'Alliance Air'], S5: ['SDG', 'Star Air'], IC: ['FRR', 'Fly91'],
  EK: ['UAE', 'Emirates'], QR: ['QTR', 'Qatar Airways'], EY: ['ETD', 'Etihad'], FZ: ['FDB', 'flydubai'], G9: ['ABY', 'Air Arabia'],
  '3L': ['ADY', 'Air Arabia Abu Dhabi'], WY: ['OMA', 'Oman Air'], OV: ['OMS', 'SalamAir'], GF: ['GFA', 'Gulf Air'],
  KU: ['KAC', 'Kuwait Airways'], SV: ['SVA', 'Saudia'], XY: ['KNE', 'flynas'], J9: ['JZR', 'Jazeera Airways'],
  SQ: ['SIA', 'Singapore Airlines'], TR: ['TGW', 'Scoot'], MH: ['MAS', 'Malaysia Airlines'], AK: ['AXM', 'AirAsia'],
  OD: ['MXD', 'Batik Air Malaysia'], FD: ['AIQ', 'Thai AirAsia'], D7: ['XAX', 'AirAsia X'], TG: ['THA', 'Thai Airways'],
  VZ: ['TVJ', 'Thai Vietjet'], DD: ['NOK', 'Nok Air'], SL: ['TLM', 'Thai Lion Air'], CX: ['CPA', 'Cathay Pacific'],
  VN: ['HVN', 'Vietnam Airlines'], VJ: ['VJC', 'VietJet'], ID: ['BTK', 'Batik Air'], GA: ['GIA', 'Garuda Indonesia'],
  PR: ['PAL', 'Philippine Airlines'], Z2: ['APG', 'AirAsia Philippines'], '5J': ['CEB', 'Cebu Pacific'],
  UL: ['ALK', 'SriLankan'], BG: ['BBC', 'Biman'], BS: ['UBG', 'US-Bangla'], RA: ['RNA', 'Nepal Airlines'],
  H9: ['HIM', 'Himalaya Airlines'], U4: ['BHA', 'Buddha Air'], KB: ['DRK', 'Drukair'], B3: ['BTN', 'Bhutan Airlines'],
  '8M': ['MMA', 'Myanmar Airways'], LH: ['DLH', 'Lufthansa'], LX: ['SWR', 'Swiss'], OS: ['AUA', 'Austrian'],
  BA: ['BAW', 'British Airways'], VS: ['VIR', 'Virgin Atlantic'], AF: ['AFR', 'Air France'], KL: ['KLM', 'KLM'],
  TK: ['THY', 'Turkish Airlines'], SU: ['AFL', 'Aeroflot'], ET: ['ETH', 'Ethiopian'], KQ: ['KQA', 'Kenya Airways'],
  MS: ['MSR', 'EgyptAir'], UA: ['UAL', 'United'], AA: ['AAL', 'American'], DL: ['DAL', 'Delta'], AC: ['ACA', 'Air Canada'],
  QF: ['QFA', 'Qantas'], NH: ['ANA', 'ANA'], JL: ['JAL', 'Japan Airlines'], KE: ['KAL', 'Korean Air'], OZ: ['AAR', 'Asiana'],
  CA: ['CCA', 'Air China'], MU: ['CES', 'China Eastern'], CZ: ['CSN', 'China Southern'], CI: ['CAL', 'China Airlines'],
  BR: ['EVA', 'EVA Air'], HX: ['CRK', 'Hong Kong Airlines'], HY: ['UZB', 'Uzbekistan Airways'], KC: ['KZR', 'Air Astana'],
  LO: ['LOT', 'LOT'], AY: ['FIN', 'Finnair'], SK: ['SAS', 'SAS'], IB: ['IBE', 'Iberia'], AZ: ['ITY', 'ITA Airways'],
  EI: ['EIN', 'Aer Lingus'], SA: ['SAA', 'South African'],
};
const BY_ICAO = Object.fromEntries(Object.entries(AIRLINES).map(([iata, [icao]]) => [icao, iata]));

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
// today's date in India as YYYY-MM-DD (the date printed on Indian passes and tickets)
export const todayIST = (now = new Date()) => ymd(new Date(now.getTime() + 5.5 * 3600e3));
const dayNo = s => Math.round(Date.parse(s + 'T00:00:00Z') / 864e5);

// "6E 2024", "6e-512", "IGO542Y", "ai101" -> {carrier: '6E', number: '2024', flight: '6E2024', icao: 'IGO2024'} or null
export function normFlight(raw) {
  const s = String(raw || '').toUpperCase().replace(/[\s\-–.]/g, '');
  let m = s.match(/^([A-Z]{3})(\d{1,4})([A-Z]{0,2})$/);
  if (m && BY_ICAO[m[1]]) return mk(BY_ICAO[m[1]], m[2] + m[3], m[1] + m[2].replace(/^0+(?=\d)/, '') + m[3]);
  m = s.match(/^([A-Z0-9]{2})(\d{1,4})([A-Z]?)$/);
  if (m && /[A-Z]/.test(m[1])) return mk(m[1], m[2] + m[3]);
  if (m) return null;
  m = s.match(/^([A-Z]{3})(\d{1,4})([A-Z]{0,2})$/);   // unknown ICAO airline: keep it as typed
  return m ? {carrier: m[1], number: m[2] + m[3], flight: s, icao: s} : null;
}
function mk(carrier, number, icao) {
  number = number.replace(/^0+(?=\d)/, '');
  const a = AIRLINES[carrier];
  return {carrier, number, flight: carrier + number, icao: icao || (a ? a[0] + number : null), airline: a ? a[1] : null};
}

// a day of the year with no year (BCBP) or a date with no year (tickets) -> the matching date nearest to today.
// A boarding pass is issued at most a few days before the flight, so its date lies within [-330, +30] days of today.
function nearestYear(month0, day, today, julian) {
  const y = +today.slice(0, 4), t = dayNo(today);
  let best = null;
  for (const yy of [y - 1, y, y + 1]) {
    const d = julian ? new Date(Date.UTC(yy, 0, julian)) : new Date(Date.UTC(yy, month0, day));
    if (julian ? d.getUTCFullYear() !== yy : d.getUTCMonth() !== month0) continue;   // day 366 in a short year, 31 Apr
    const s = ymd(d), gap = dayNo(s) - t;
    const score = julian ? (gap >= -330 && gap <= 30 ? 0 : 1000) + Math.abs(gap) : gap < -2 ? -gap * 3 : gap;   // tickets: usually a coming flight
    if (!best || score < best.score) best = {s, score};
  }
  return best && best.s;
}

// IATA BCBP format "M". Tolerant of real-world quirks (zero-padded flight numbers, stray line breaks), fails closed on garbage.
export function parseBCBP(raw, today = todayIST()) {
  const s = String(raw || '').replace(/[\r\n]/g, '');
  if (s.length < 60 || s[0] !== 'M' || !/^[1-4]$/.test(s[1])) return [];
  const n = +s[1], legs = [];
  let at = 23;   // first leg starts after format code, leg count, 20-char name and e-ticket flag
  for (let i = 0; i < n; i++) {
    const L = s.slice(at, at + 37);
    if (L.length < 37) break;
    const from = L.slice(7, 10), to = L.slice(10, 13), car = L.slice(13, 16).trim(), num = L.slice(16, 21).trim(), jul = L.slice(21, 24), size = L.slice(35, 37);
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !/^[A-Z0-9]{2,3}$/.test(car) || !/^\d{1,5}[A-Z]?$/.test(num) || !/^\d{3}$/.test(jul)) break;
    const j = +jul;
    if (j < 1 || j > 366) break;
    const f = normFlight(car + num.replace(/^0+(?=\d)/, ''));
    if (f) legs.push({...f, date: nearestYear(0, 0, today, j), from, to});
    if (!/^[0-9A-F]{2}$/i.test(size)) break;
    at += 37 + parseInt(size, 16);
  }
  return legs;
}

const MON = {jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11};
const MONRE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
function datesIn(text, today) {
  const out = [], add = (i, y, m0, d) => {
    if (!(m0 >= 0 && m0 < 12 && d >= 1 && d <= 31)) return;
    let s;
    if (y == null) s = nearestYear(m0, d, today);
    else {
      y = +y < 100 ? 2000 + +y : +y;
      const dt = new Date(Date.UTC(y, m0, d));
      if (dt.getUTCMonth() !== m0) return;
      s = ymd(dt);
    }
    if (s && Math.abs(dayNo(s) - dayNo(today)) <= 400) out.push({i, s});
  };
  let m;
  const a = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-/.,]*(${MONRE})\\b[\\s\\-/.,']*(\\d{4}|\\d{2}(?!\\d|:))?`, 'gi');
  while ((m = a.exec(text))) add(m.index, m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]);
  const b = new RegExp(`\\b(${MONRE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`, 'gi');
  while ((m = b.exec(text))) add(m.index, m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
  const c = /\b(20\d\d)-(\d\d)-(\d\d)\b/g;
  while ((m = c.exec(text))) add(m.index, m[1], +m[2] - 1, +m[3]);
  const d = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d\d|\d\d)\b/g;   // Indian order: day/month/year
  while ((m = d.exec(text))) add(m.index, m[3], +m[2] - 1, +m[1]);
  const e = /(?<![A-Za-z0-9])(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})?(?![A-Za-z0-9])/gi;   // airline/GDS style: 15NOV, 05NOV26
  while ((m = e.exec(text))) add(m.index, m[3], MON[m[2].toLowerCase()], +m[1]);
  return out.sort((x, y) => x.i - y.i);
}

const INDIAN = new Set(['6E', 'AI', 'IX', 'QP', 'SG', '9I', 'S5', 'IC']);
// a value right after one of these labels is a booking reference or an ID, not a flight
const LABEL = /(PNR|booking(?:\s+ref(?:erence)?)?|ref(?:erence)?|record\s+locator|locator|confirmation(?:\s+(?:no|number|code))?|transaction|order|member(?:ship)?|ffn|frequent\s+fl[yi]er|customer|ID)\s*(?:no\.?|number|#|id)?\s*\)?\s*[:#.\-]?\s*$/i;
// a line that reads like a flight: a time, the word flight, or an airport pair such as DEL-BOM
const FLIGHTY = /\b\d{1,2}:\d{2}\b|\bflight\b|\b[A-Z]{3}\s*(?:-|–|→|to|>)\s*[A-Z]{3}\b/i;

// e-ticket, itinerary or email text -> flights with the nearest date. Only known airline codes count, so a booking
// reference such as "6EK2PQ" or a fare code is not mistaken for a flight; foreign airline codes that double as
// ordinary words (ID, CA, MS...) also need the line to read like a flight.
export function parseTicketText(text, today = todayIST()) {
  text = String(text || '').slice(0, 200000);
  const codes = Object.keys(AIRLINES).join('|');
  // 2-4 digits and no suffix letter: fare and class codes such as "SG4K" look like flights otherwise
  const re = new RegExp(`(?<![A-Za-z0-9])(${codes})\\s?[-–]?\\s?(\\d{2,4})(?![A-Za-z0-9])`, 'g');
  const dates = datesIn(text, today), hits = [];
  let m;
  while ((m = re.exec(text))) {
    const ls = text.lastIndexOf('\n', m.index) + 1, le = (text.indexOf('\n', m.index) + 1 || text.length + 1) - 1, line = text.slice(ls, le);
    if (LABEL.test(text.slice(Math.max(ls, m.index - 32), m.index))) continue;
    if (!INDIAN.has(m[1]) && !FLIGHTY.test(line)) continue;
    const f = normFlight(m[1] + m[2]);
    if (f) hits.push({f, i: m.index, ls, le});
  }
  const seen = new Set(), out = [];
  hits.forEach((h, k) => {
    // the nearest date, preferring one on the same line, and never one that sits beyond the next flight
    const lo = k ? hits[k - 1].i : -1, hi = k + 1 < hits.length ? hits[k + 1].i : Infinity;
    const pool = dates.filter(d => d.i > lo && d.i < hi && Math.abs(d.i - h.i) < 260);
    const best = pool.sort((a, b) => ((a.i >= h.ls && a.i < h.le) ? 0 : 1000) + Math.abs(a.i - h.i) - (((b.i >= h.ls && b.i < h.le) ? 0 : 1000) + Math.abs(b.i - h.i)))[0];
    const date = best ? best.s : null, key = h.f.flight + date;
    if (seen.has(key) || out.length >= 6) return;
    seen.add(key); out.push({...h.f, date, from: null, to: null});
  });
  return out;
}
