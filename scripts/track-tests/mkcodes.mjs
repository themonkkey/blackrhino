import {writeBarcode, prepareZXingModule} from '/private/tmp/claude-501/-Users-thesinghaa/0856d80e-bd5a-4b13-90a2-7aeb99eabfef/scratchpad/libs/x/zxing-wasm/package/dist/es/full/index.js';
import {readFileSync, writeFileSync} from 'node:fs';
prepareZXingModule({overrides: {wasmBinary: readFileSync('/private/tmp/claude-501/-Users-thesinghaa/0856d80e-bd5a-4b13-90a2-7aeb99eabfef/scratchpad/libs/x/zxing-wasm/package/dist/full/zxing_full.wasm').buffer}});
// synthetic Indian pass for 5 Nov 2026 (day 309) and a 2-leg pass; names and PNRs are fake
const one = 'M1KUMAR/TESTPASSENGER EXYZ123 BBIDEL6E 2024 309Y012A0001 100';
const two = 'M2KUMAR/TESTPASSENGER EXYZ123 BBIDEL6E 2024 309Y012A0001 100ABC789 DELBOMAI 0868 310Y004C0002 100';
for (const [name, fmt, text] of [['pdf417', 'PDF417', one], ['aztec', 'Aztec', one], ['qr', 'QRCode', one], ['two-legs', 'PDF417', two]]) {
  const r = await writeBarcode(text, {format: fmt, scale: 4});
  if (r.error) throw new Error(name + ': ' + r.error);
  writeFileSync('/private/tmp/claude-501/-Users-thesinghaa/0856d80e-bd5a-4b13-90a2-7aeb99eabfef/scratchpad/track/fx/' + name + '.png', Buffer.from(await r.image.arrayBuffer()));
  console.log(name, r.image.size, 'bytes');
}
