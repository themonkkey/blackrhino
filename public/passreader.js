// Read boarding-pass barcodes from the camera, a photo/screenshot or a PDF, entirely in this browser tab.
// Loaded only when someone taps Scan or Upload. Uses the browser's own barcode detector when it reads all
// boarding-pass formats (Android Chrome, Chrome on Mac); otherwise a self-hosted zxing WebAssembly decoder (iPhone,
// Firefox, Windows). PDFs are drawn with a self-hosted pdf.js. Nothing is uploaded; files never leave the device.
const FORMATS = ['pdf417', 'aztec', 'qr_code', 'data_matrix'];
let nativeP, zxingP, pdfP;

function native() {
  return nativeP ||= (async () => {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const have = await window.BarcodeDetector.getSupportedFormats();
      return FORMATS.every(f => have.includes(f)) ? new window.BarcodeDetector({formats: FORMATS}) : null;
    } catch (e) { return null; }
  })();
}
function zxing() {
  return zxingP ||= import('/vendor/zxing/barcode-detector.js').then(m => {
    m.prepareZXingModule({overrides: {locateFile: (p, prefix) => p.endsWith('.wasm') ? '/vendor/zxing/zxing_reader.wasm' : prefix + p}});
    return new m.BarcodeDetector({formats: FORMATS});
  });
}
function pdfjs() {
  // pdf.js reads text with `for await` over a ReadableStream, which Safari lacks before 26: add the standard shim
  if (window.ReadableStream && !ReadableStream.prototype[Symbol.asyncIterator]) {
    ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
      const r = this.getReader();
      try { for (;;) { const {done, value} = await r.read(); if (done) return; yield value; } } finally { r.releaseLock(); }
    };
  }
  return pdfP ||= import('/vendor/pdfjs/pdf.min.js').then(m => { m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; return m; });
}

async function detect(src, still = true) {
  const n = await native();
  if (n) {
    try { const r = await n.detect(src); if (r.length || !still) return r.map(c => c.rawValue); } catch (e) {}
  }
  const z = await zxing();   // also the second try when the native detector sees nothing in a still image
  try { return (await z.detect(src)).map(c => c.rawValue); } catch (e) { return []; }
}

// image file -> canvas, at most ~3000 px on the long side (dense PDF417 needs the detail, more just costs time)
async function toCanvas(file) {
  let img;
  try { img = await createImageBitmap(file); } catch (e) {
    const url = URL.createObjectURL(file);
    try { img = new Image(); img.src = url; await img.decode(); } finally { URL.revokeObjectURL(url); }
  }
  const w = img.width, h = img.height, k = Math.min(1, 3000 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  img.close && img.close();
  return c;
}

// file (image or PDF) -> {codes: [barcode text], text: 'PDF text for ticket parsing'}
export async function readFile(file) {
  if (file.size > 25e6) throw new Error('That file is too large (max 25 MB).');
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return readPdf(file);
  const c = await toCanvas(file);
  try { return {codes: await detect(c), text: ''}; } finally { c.width = c.height = 0; }
}

async function readPdf(file) {
  const lib = await pdfjs();
  const task = lib.getDocument({data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false}), pdf = await task.promise;
  const codes = [], text = [];
  try {
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      const page = await pdf.getPage(i);
      if (!codes.length) {   // the barcode first: text is only the fallback, and must not be able to block it
        const vp = page.getViewport({scale: 2.5}), c = document.createElement('canvas');
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        await page.render({canvas: c, viewport: vp}).promise;
        codes.push(...await detect(c));
        c.width = c.height = 0;
      }
      try { text.push((await page.getTextContent()).items.map(t => t.str).join(' ')); } catch (e) {}
      page.cleanup();
    }
  } finally { await task.destroy(); }
  return {codes, text: text.join('\n')};
}

// live camera: calls onCode(text) once a barcode is read; returns stop()
export async function startCamera(video, onCode) {
  const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}, audio: false});
  try {
    video.srcObject = stream;
    video.setAttribute('playsinline', ''); video.muted = true;
    await video.play();
  } catch (e) { stream.getTracks().forEach(t => t.stop()); video.srcObject = null; throw e; }
  let on = true, busy = false;
  const stop = () => { on = false; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
  const tick = async () => {
    if (!on) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      const codes = await detect(video, false);
      busy = false;
      if (on && codes.length) { stop(); onCode(codes[0]); return; }
    }
    setTimeout(tick, 220);
  };
  tick();
  return stop;
}
