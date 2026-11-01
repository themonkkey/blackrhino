// node scripts/test-bcbp.mjs  -- checks the boarding pass and ticket text parsers in public/bcbp.js
import assert from 'node:assert/strict';
import {parseBCBP, parseTicketText, normFlight, todayIST} from '../public/bcbp.js';

const T = '2026-11-01';
const pick = l => l.map(({flight, date, from, to, icao}) => ({flight, date, from, to, icao}));
// IATA Res 792 sample (single leg, no conditional block): AC 834 YUL-FRA, day 226 = 14 Aug, nearest to 1 Nov 2026 is 2026
assert.deepEqual(pick(parseBCBP('M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 226F001A0025 100', T)),
  [{flight: 'AC834', date: '2026-08-14', from: 'YUL', to: 'FRA', icao: 'ACA834'}]);
// two legs with conditional blocks and security data
const two = 'M2DESMARAIS/LUC       EABC123 YULFRAAC 0834 226F001A0025 14D>6181WW6225BAC 00141234560032A0141234567890 1AC AC 1234567890123    20KYLX58ZDEF456 FRAGVALH 3664 227C012C0002 12E2A0140987654321 1AC AC 1234567890123    2PCNWQ^164GIWVC5EH7JNT684FVNJ91W2QA4DVN5J8K4F0L0GEQ3DF5TGBN8709HKT5D3DW3GBHFCVHMY7J5T6HFR41W2QA4DVN5J8K4F0L0GE';
assert.deepEqual(pick(parseBCBP(two, T)).map(l => [l.flight, l.from, l.to, l.date]), [['AC834', 'YUL', 'FRA', '2026-08-14'], ['LH3664', 'FRA', 'GVA', '2026-08-15']]);
// BA sample with a 5-digit zero-padded flight field
assert.deepEqual(pick(parseBCBP('M1LEOPOLD/EMR         EZQ7O92 GVALHRBA 00723319C002F00009100', T)).map(l => [l.flight, l.date]), [['BA723', '2026-11-15']]);
// Indian pass, day 305 = 1 Nov 2026; a January pass read in late December resolves to next year
assert.deepEqual(pick(parseBCBP('M1TEST/PASSENGER      EXYZ123 DELBOM6E 2024 305Y012A0001 100', T)), [{flight: '6E2024', date: '2026-11-01', from: 'DEL', to: 'BOM', icao: 'IGO2024'}]);
assert.equal(parseBCBP('M1TEST/PASSENGER      EXYZ123 DELBOM6E 0512 004Y012A0001 100', '2026-12-30')[0].date, '2027-01-04');
// output never carries the name or booking reference
assert.ok(!JSON.stringify(parseBCBP(two, T)).match(/DESMARAIS|ABC123|DEF456/));
// garbage fails closed
for (const bad of ['', 'hello', 'M9XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 'M1' + 'x'.repeat(70)]) assert.deepEqual(parseBCBP(bad, T), []);

// flight number input
assert.deepEqual([normFlight('6e 2024'), normFlight('IGO542Y'), normFlight('AI-0101'), normFlight('12345'), normFlight('ABCD')].map(f => f && [f.flight, f.icao]),
  [['6E2024', 'IGO2024'], ['6E542Y', 'IGO542Y'], ['AI101', 'AIC101'], null, null]);

// ticket and email text
const mail = `Booking confirmed. PNR: 6EK2PQ  Passenger: MR TEST
Flight 6E 2024  Bhubaneswar (BBI) to Delhi (DEL)  Departure: 05 Nov 2026, 06:10   Fare: SG4K saver
Return: AI-0868  DEL - BBI  Sun, Nov 15, 2026 19:40`;
assert.deepEqual(parseTicketText(mail, T).map(f => [f.flight, f.date]), [['6E2024', '2026-11-05'], ['AI868', '2026-11-15']]);
assert.deepEqual(parseTicketText('QP 1127 BLR-PNQ 12/11/2026 dep 07:05', T).map(f => [f.flight, f.date]), [['QP1127', '2026-11-12']]);
assert.deepEqual(parseTicketText('Your flight IX 1543 on 3rd Dec departs at 14:20', T).map(f => [f.flight, f.date]), [['IX1543', '2026-12-03']]);
assert.deepEqual(parseTicketText('nothing here, PNR AB1234, seat 12A', T), []);
assert.match(todayIST(new Date('2026-10-31T20:00:00Z')), /^2026-11-01$/);
// review cases: booking references and IDs are not flights; foreign codes need flight context
assert.deepEqual(parseTicketText('Booking reference (PNR): AI2345\nFlight 6E 2024 BBI-DEL 05 Nov 2026', T).map(f => f.flight), ['6E2024']);
assert.deepEqual(parseTicketText('Customer ID 4521, order no. SG 1234', T), []);
assert.deepEqual(parseTicketText('Batik Air ID 7181 KUL-DEL departs 10:05 on 20 Nov', T).map(f => [f.flight, f.date]), [['ID7181', '2026-11-20']]);
// dates printed before flights: each flight takes its own nearest date, never one past the next flight
assert.deepEqual(parseTicketText('Onward 05 Nov 2026\n6E 2024 BBI-DEL 06:10\nReturn 15 Nov 2026\nAI 868 DEL-BBI 19:40', T).map(f => [f.flight, f.date]),
  [['6E2024', '2026-11-05'], ['AI868', '2026-11-15']]);
// airline/GDS compact dates
assert.deepEqual(parseTicketText('6E2024 Y 15NOV BBIDEL HK1 0610 0820', T).map(f => [f.flight, f.date]), [['6E2024', '2026-11-15']]);
assert.deepEqual(parseTicketText('QP 1127 05NOV26 BLR PNQ', T).map(f => [f.flight, f.date]), [['QP1127', '2026-11-05']]);
// no date anywhere: the person picks one, we do not guess
assert.deepEqual(parseTicketText('Your flight is 6E 512', T).map(f => [f.flight, f.date]), [['6E512', null]]);
// ICAO input with a leading zero, boarding pass year windows
assert.equal(normFlight('AIC0101').icao, 'AIC101');
assert.equal(parseBCBP('M1TEST/PASSENGER      EXYZ123 DELBOM6E 2024 200Y012A0001 100', T)[0].date, '2026-07-19');
assert.equal(parseBCBP('M1TEST/PASSENGER      EXYZ123 DELBOM6E 2024 320Y012A0001 100', T)[0].date, '2026-11-16');
console.log('bcbp tests passed');
