# Vendored libraries (loaded only when someone reads a boarding pass on /track)

| Path | Package | Version | Licence |
|---|---|---|---|
| zxing/barcode-detector.js, zxing/zxing-exported.js | barcode-detector (dist/es/ponyfill.js and the bundle it imports) | 3.2.3 | MIT |
| zxing/zxing_reader.wasm | zxing-wasm (dist/reader), contains zxing-cpp | 3.1.6 | MIT (zxing-wasm), Apache-2.0 (zxing-cpp) |
| pdfjs/pdf.min.js, pdfjs/pdf.worker.min.js | pdfjs-dist legacy/build (.mjs renamed .js) | 6.4.299 | Apache-2.0 (bundles core-js, MIT) |

zxing_reader.wasm SHA-256: 5003fb4b88c4fbd1fd518a2fd8c8ad365c519e183a08c03a322dddfea3cea84e (matches ZXING_WASM_SHA256 in zxing-exported.js).
Upgrade the wasm and barcode-detector.js together: each zxing-wasm version ships its own wasm.
