// Articulated A320-class airliner for the 3D view: landing gear (struts, doors, oleo, spinning tyres),
// flaps, spoilers, thrust reversers, spinning fans and aircraft lighting. Built in metres:
// nose +Z, up +Y, left wing +X, main wheels touch the ground at y = -4 when the gear is down.
// makeAirliner(THREE, {tail}) -> {root, update(state, dt, t)}
//   state: {gear: 0|1, flaps: 0..1, spoilers: 0..1, reverse: 0..1, ground: bool, speed: m/s, n1: 0..1,
//           lights: {nav, beacon, strobe, landing, taxi}}

// Airline liveries, keyed by ICAO callsign prefix. body / belly / band (window-line stripe or null) / tail / accent / engine.
export const LIVERIES = {
  IGO: {name: 'IndiGo', title: 'IndiGo', titleCol: 0x1a2a8c, body: 0xf6f7f9, belly: 0x1a2a8c, band: 0x3aa6e8, tail: 0x1a2a8c, accent: 0x3aa6e8, engine: 0x1a2a8c, art: 'indigo',
    line: [[19.5, -3], [14.5, -1.75], [11, -.8], [6, -.5], [-4, -.38], [-9, -.12], [-12.5, .45], [-15.5, 1.25], [-19, 2.2]]},
  AIC: {name: 'Air India', title: 'AIR INDIA', titleCol: 0xa3123a, body: 0xf6f6f4, belly: 0x8a1538, band: null, tail: 0xa3123a, accent: 0xc9a24a, engine: 0xa3123a, art: 'window'},
  AXB: {name: 'Air India Express', title: 'air india express', titleCol: 0xe2531f, body: 0xf6f6f4, belly: 0xd8dbdf, band: null, tail: 0xe2531f, accent: 0x0b2a5c, engine: 0xe2531f, art: 'pattern'},
  AKJ: {name: 'Akasa Air', title: 'akasa air', titleCol: 0xff6a13, body: 0xf7f7f5, belly: 0xdfe1e3, band: null, tail: 0xff6a13, accent: 0x5b2a86, engine: 0xff6a13, art: 'swoosh'},
  SEJ: {name: 'SpiceJet', title: 'SpiceJet', titleCol: 0xc8102e, line: [[19.5, -3], [14, -1.6], [8, -.7], [-6, -.6], [-12, 0], [-19, 1.8]], body: 0xf6f6f4, belly: 0xc8102e, band: null, tail: 0xc8102e, accent: 0xffd200, engine: 0xc8102e, art: 'swirl'},
  LLR: {name: 'Alliance Air', title: 'Alliance Air', titleCol: 0xc8102e, body: 0xf6f6f4, belly: 0xd8dbdf, band: 0xc8102e, tail: 0xc8102e, accent: 0xffffff, engine: 0xf6f6f4, art: 'plain'},
  IAD: {name: 'AirAsia India', body: 0xf6f6f4, belly: 0xd8dbdf, band: null, tail: 0xe31837, accent: 0xffffff, engine: 0xe31837, art: 'plain'},
  VTI: {name: 'Vistara', body: 0xf3f1ee, belly: 0x5b2a86, band: null, tail: 0x5b2a86, accent: 0xc9a24a, engine: 0x5b2a86, art: 'window'},
  FRR: {name: 'Fly91', body: 0xf6f6f4, belly: 0xd8dbdf, band: null, tail: 0x00a19a, accent: 0xffc107, engine: 0x00a19a, art: 'swoosh'},
  SDG: {name: 'Star Air', body: 0xf6f6f4, belly: 0x0b2a5c, band: null, tail: 0x0b2a5c, accent: 0xf2b705, engine: 0x0b2a5c, art: 'plain'},
  UAE: {name: 'Emirates', title: 'Emirates', titleCol: 0xb8860b, body: 0xf6f6f4, belly: 0xd8dbdf, band: null, tail: 0xd71921, accent: 0x00843d, engine: 0xd8dbdf, art: 'flag'},
  QTR: {name: 'Qatar Airways', title: 'QATAR', titleCol: 0x5c0632, body: 0xeceeef, belly: 0xb8bdc2, band: null, tail: 0x5c0632, accent: 0xffffff, engine: 0x5c0632, art: 'plain'},
  ETD: {name: 'Etihad', body: 0xf0ebe3, belly: 0xc9b99a, band: null, tail: 0xb08d57, accent: 0x5a4a3a, engine: 0xb08d57, art: 'pattern'},
  SIA: {name: 'Singapore Airlines', body: 0xf6f6f4, belly: 0xd8dbdf, band: null, tail: 0x0b2a5c, accent: 0xf2b705, engine: 0xf6f6f4, art: 'bird'},
  THY: {name: 'Turkish Airlines', body: 0xf6f6f4, belly: 0xd8dbdf, band: null, tail: 0xc8102e, accent: 0xffffff, engine: 0xf6f6f4, art: 'plain'},
  BAW: {name: 'British Airways', body: 0xf6f6f4, belly: 0x0b2a5c, band: null, tail: 0x0b2a5c, accent: 0xc8102e, engine: 0xd8dbdf, art: 'flag'},
  DLH: {name: 'Lufthansa', body: 0xf6f6f4, belly: 0xd8dbdf, band: null, tail: 0x05164d, accent: 0xffffff, engine: 0x05164d, art: 'plain'},
  FDB: {name: 'flydubai', body: 0xf6f6f4, belly: 0x0d4c92, band: null, tail: 0xf26522, accent: 0x0d4c92, engine: 0x0d4c92, art: 'plain'},
  ABY: {name: 'Air Arabia', body: 0xf6f6f4, belly: 0xd8dbdf, band: null, tail: 0xc8102e, accent: 0x6d6e70, engine: 0xf6f6f4, art: 'swirl'},
  SVA: {name: 'Saudia', body: 0xe8e3d8, belly: 0x0a6b4b, band: null, tail: 0x0a3e75, accent: 0x0a6b4b, engine: 0xd8dbdf, art: 'plain'},
  RHN: {name: 'blackrhino', title: 'blackrhino', titleCol: 0x0b0d0f, body: 0xf4f6f8, belly: 0x0b0d0f, band: 0x7cc8ff, tail: 0x0b0d0f, accent: 0x7cc8ff, engine: 0x0b0d0f, art: 'indigo',
    line: [[19.5, -3], [14.5, -1.8], [10, -.9], [-6, -.75], [-11, -.2], [-15, .9], [-19, 2]]},
};
const DEFAULT_LIVERY = {name: '', body: 0xf4f6f8, belly: 0xc9d0d6, band: null, tail: 0x34404c, accent: 0xc9d0d6, engine: 0xd8dbdf, art: 'plain'};
export const liveryFor = callsign => LIVERIES[String(callsign || '').slice(0, 3).toUpperCase()] || DEFAULT_LIVERY;

export function makeAirliner(THREE, opt = {}) {
  const root = new THREE.Group();
  const M = (c, r = 0.45, m = 0.15, extra = {}) => new THREE.MeshStandardMaterial({color: c, roughness: r, metalness: m, ...extra});
  const paint = M(0xffffff, 0.32, 0.12, {vertexColors: true, side: THREE.DoubleSide}), solidPaint = M(0xf4f6f8, 0.32, 0.12), belly = M(0xc9d0d6, 0.4, 0.2), wingM = M(0xbcc4cb, 0.42, 0.35, {side: THREE.DoubleSide});
  const tail = M(0xffffff, 0.35, 0.15, {side: THREE.DoubleSide}), sharkM = M(0x1f3a93, 0.35, 0.15, {side: THREE.DoubleSide}), engM = M(0x1f3a93, .3, .3, {side: THREE.DoubleSide}), dark = M(0x15191d, 0.6, 0.3), metal = M(0x8c949b, 0.3, 0.8);
  const tyre = M(0x111214, 0.9, 0), hub = M(0xaab2b9, 0.35, 0.7), glass = M(0x0b1a26, 0.08, 0.6);
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const deg = Math.PI / 180;

  // ---------- fuselage: lathe profile (radius by station), axis along Z ----------
  const L = [[18.9, 0], [18.6, .55], [18.0, 1.05], [17.0, 1.5], [15.8, 1.82], [14.2, 1.97], [-7, 1.97], [-10, 1.85], [-13, 1.55], [-15.5, 1.05], [-17.6, .55], [-18.7, .22]];
  const prof = L.map(([z, r]) => new THREE.Vector2(r, z)).reverse();
  const fus = new THREE.LatheGeometry(prof, 64);
  fus.rotateX(Math.PI / 2); fus.rotateZ(Math.PI / 2);   // lathe axis Y -> Z
  // A320 shape: the nose tip sits low with a flatter chin; the tail cone sweeps up. One function for skin and decals.
  const rAt = z => { for (let i = 0; i < L.length - 1; i++) { const [z0, r0] = L[i], [z1, r1] = L[i + 1]; if (z <= z0 && z >= z1) return r0 + (r1 - r0) * (z - z0) / (z1 - z0); } return 0; };
  const noseK = z => Math.min(1, Math.max(0, (z - 13) / 5.9));
  const drop = z => .38 * noseK(z) ** 2 - (z < -9 ? ((-9 - z) / 9.7) ** 1.6 * 1.05 : 0);   // + = lowered
  const deformY = (y, z) => (y < 0 ? y * (1 - .28 * noseK(z)) : y) - drop(z);
  { const p = fus.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, deformY(p.getY(i), p.getZ(i)));
    fus.computeVertexNormals(); }
  // conforming skin patch (decals: windows, doors, titles) between stations z0..z1 and heights y0..y1 on one side
  function skin(side, z0, z1, y0, y1, nz = 24, ny = 8) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= nz; i++) for (let j = 0; j <= ny; j++) {
      const z = z0 + (z1 - z0) * i / nz, r = rAt(z) + .012, yy = y0 + (y1 - y0) * j / ny, th = Math.asin(Math.max(-.99, Math.min(.99, yy / r)));
      pos.push(side * r * Math.cos(th), deformY(r * Math.sin(th), z), z);
      uv.push(side > 0 ? i / nz : 1 - i / nz, j / ny);   // text reads nose-to-tail on both sides
    }
    for (let i = 0; i < nz; i++) for (let j = 0; j < ny; j++) { const a = i * (ny + 1) + j, b = a + 1, c = a + ny + 1, d = c + 1; side > 0 ? idx.push(a, b, c, b, d, c) : idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const decal = (canvas) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return new THREE.MeshStandardMaterial({map: t, transparent: true, alphaTest: .02, roughness: .35, metalness: .1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2}); };
  const cnv = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; };
  fus.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(fus.attributes.position.count * 3), 3));
  add(root, fus, paint);
  // cockpit: the fuselage opens where the windscreen is; a glass shell of the same shape fills the opening
  const inScreen = '(vLoc.z > 16.3 && vLoc.z < 18.0 && (vLoc.y + .38 * pow(clamp((vLoc.z - 13.) / 5.9, 0., 1.), 2.)) > 0.5 + (vLoc.z - 16.3) * 0.05 && (vLoc.y + .38 * pow(clamp((vLoc.z - 13.) / 5.9, 0., 1.), 2.)) < 1.28 - (vLoc.z - 16.3) * 0.1 && abs(vLoc.x) > 0.05 && abs(vLoc.x) < 1.6)';
  const cut = (mat, keepInside) => { mat.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vLoc;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;');
    sh.fragmentShader = 'varying vec3 vLoc;\n' + sh.fragmentShader.replace('void main() {', `void main() {
  bool scr = ${inScreen};
  if (${keepInside ? '!scr' : 'scr'}) discard;`);
  }; return mat; };
  cut(paint, false);
  add(root, fus, cut(new THREE.MeshPhysicalMaterial({color: 0x8fb0c4, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false}), true)).renderOrder = 2;
  { // window frame posts
    const post = M(0x20262c, .5, .3);
    for (const [x, z, ry] of [[0, 17.75, 0], [.62, 17.45, .5], [-.62, 17.45, -.5], [1.12, 16.9, 1.0], [-1.12, 16.9, -1.0]]) {
      const g = new THREE.BoxGeometry(.06, .55, .05); const m = add(root, g, post, x * .96, .86 - drop(z), z - .05);
      m.rotation.set(-0.45 + Math.abs(x) * .3, ry, 0);
    }
  }
  // cockpit interior: bulkhead, floor, instrument panel with displays, glareshield, two seats and two pilots
  const cock = new THREE.Group(); root.add(cock);
  { const cab = M(0x3a4148, .8, 0), panelM = M(0x16191c, .7, .2), seatM = M(0x2b2f35, .8, 0);
    const scr = new THREE.MeshBasicMaterial({color: 0x2a7fb8, toneMapped: false}), scr2 = new THREE.MeshBasicMaterial({color: 0x1f8a5a, toneMapped: false});
    const bh = add(cock, new THREE.CircleGeometry(1.78, 32), cab, 0, 0, 15.6);
    add(cock, new THREE.BoxGeometry(2.9, .06, 2.4), cab, 0, -.2, 16.6);
    const pnl = add(cock, new THREE.BoxGeometry(2.3, .5, .3), panelM, 0, .22, 17.25); pnl.rotation.x = .25;
    const gl = add(cock, new THREE.BoxGeometry(2.2, .07, .45), panelM, 0, .5, 17.12);
    [-.85, -.42, .42, .85].forEach((x, i) => { const d = add(cock, new THREE.PlaneGeometry(.3, .24), i % 2 ? scr2 : scr, x, .25, 17.08); d.rotation.set(-.25, Math.PI, 0); });
    const skin = M(0xc08a66, .6, 0, {emissive: 0x2a1a10}), shirt = M(0xffffff, .6, 0, {emissive: 0x3a3e44}), hair = M(0x1b1714, .9, 0), cup = M(0x0d0f11, .5, .2);
    for (const x of [.48, -.48]) {
      add(cock, new THREE.BoxGeometry(.55, .75, .12), seatM, x, .2, 16.0);            // seat back
      add(cock, new THREE.BoxGeometry(.55, .12, .55), seatM, x, -.12, 16.3);          // seat pan
      const torso = add(cock, new THREE.CapsuleGeometry(.17, .32, 4, 10), shirt, x, .33, 16.22); torso.rotation.x = -.12;
      for (const e of [.12, -.12]) add(cock, new THREE.BoxGeometry(.09, .02, .1), M(0xc9a24a, .4, .6), x + e, .56, 16.2);   // epaulettes
      add(cock, new THREE.SphereGeometry(.12, 16, 12), skin, x, .76, 16.27);          // head
      const h = add(cock, new THREE.SphereGeometry(.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair, x, .79, 16.25); h.rotation.x = -.35;
      const band = add(cock, new THREE.TorusGeometry(.125, .012, 6, 16, Math.PI), cup, x, .8, 16.27); band.rotation.y = Math.PI / 2;
      for (const e of [.125, -.125]) add(cock, new THREE.CylinderGeometry(.045, .045, .04, 12).rotateZ(Math.PI / 2), cup, x + e, .74, 16.27);
      for (const e of [.17, -.17]) { const a = add(cock, new THREE.CapsuleGeometry(.05, .3, 4, 8), shirt, x + e, .38, 16.42); a.rotation.x = 1.15; }
    }
  }
  // belly fairing (wing box) + windows + windscreen
  const fair = new THREE.SphereGeometry(1, 24, 12); fair.scale(1.9, .75, 6.2);
  add(cock, fair, belly, 0, -1.55, 0.4);
  // windows + doors painted onto the skin (they follow its curve; nothing sticks out)
  const winCanvas = cnv(2048, 64, (x, w, h) => {   // 13.2 m .. -13.2 m, 0.76 m pitch, gaps at the over-wing exits
    x.fillStyle = '#0d1820';
    for (let i = 0; i < 35; i++) { const z = 12.8 - i * .76; if (Math.abs(z - 1.2) < .3) continue; const u = (13.2 - z) / 26.4 * w;
      x.beginPath(); x.roundRect(u - 8, 14, 16, 34, 7); x.fill(); }
  });
  const winMat = decal(winCanvas);
  for (const sd of [1, -1]) add(root, skin(sd, 13.2, -13.2, .22, .64, 60, 4), winMat).renderOrder = 1;
  const doorMat = decal(cnv(128, 256, (x, w, h) => {
    x.strokeStyle = 'rgba(40,48,56,.75)'; x.lineWidth = 4; x.beginPath(); x.roundRect(10, 8, w - 20, h - 16, 22); x.stroke();
    x.fillStyle = '#0d1820'; x.beginPath(); x.roundRect(w / 2 - 14, 52, 28, 40, 10); x.fill();
  }));
  for (const sd of [1, -1]) for (const [z0, z1] of [[15.85, 15.0], [-13.85, -14.7], [1.95, 1.4], [.6, .05]]) {
    const em = z1 > 1 || (z0 < 1 && z0 > 0);   // over-wing emergency exits are smaller
    add(root, skin(sd, z0, z1, em ? -.05 : -.75, em ? .95 : 1.2, 6, 10), doorMat).renderOrder = 1;
  }
  const titleCanvas = document.createElement('canvas'); titleCanvas.width = 1024; titleCanvas.height = 180;
  const titleMat = decal(titleCanvas);
  for (const sd of [1, -1]) add(root, skin(sd, 12.9, 3.6, .7, 1.62, 20, 4), titleMat).renderOrder = 1;
  for (const s of [1, -1]) {   // cockpit windscreen panels
    const w = add(cock, new THREE.PlaneGeometry(.7, .42), glass, s * .62, .72, 17.15);
    w.rotation.set(-0.55, s * 0.62, 0);
    const w2 = add(cock, new THREE.PlaneGeometry(.55, .36), glass, s * 1.18, .6, 16.55); w2.rotation.set(-0.3, s * 1.15, 0);
  }
  cock.children.forEach(c => c.position.y -= drop(c.position.z));

  // ---------- wings: swept, tapered, cambered shell with dihedral ----------
  const ROOT_X = 1.8, TIP_X = 17.1, LE0 = 4.2, SWEEP = Math.tan(25 * deg), C0 = 6.4, C1 = 1.55, Y0 = -1.15, DIH = Math.tan(5.5 * deg);
  const leZ = x => LE0 - (x - ROOT_X) * SWEEP, chord = x => C0 + (C1 - C0) * (x - ROOT_X) / (TIP_X - ROOT_X), teZ = x => leZ(x) - chord(x);
  const wingY = x => Y0 + (x - ROOT_X) * DIH;
  function wingGeo(side) {
    const NS = 10, NC = 14, pos = [], idx = [];
    for (const top of [1, 0]) for (let i = 0; i <= NS; i++) for (let j = 0; j <= NC; j++) {
      const x = ROOT_X + (TIP_X - ROOT_X) * i / NS, c = j / NC, th = (0.55 - 0.38 * i / NS) * chord(x) / 5;
      const af = Math.sqrt(c) * (1 - c) * 2.6;   // thickness distribution, max near 30% chord
      const y = wingY(x) + (top ? af * th * 0.62 : -af * th * 0.38);
      pos.push(side * x, y, leZ(x) - c * chord(x));
    }
    const W = NC + 1, off = (NS + 1) * W;
    for (let i = 0; i < NS; i++) for (let j = 0; j < NC; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);                       // top
      idx.push(off + a, off + b, off + c, off + b, off + d, off + c);   // bottom
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    if (side < 0) g.index.array.reverse();
    g.computeVertexNormals(); return g;
  }
  const flaps = [], spoilers = [], lights = {};
  for (const s of [1, -1]) {
    add(root, wingGeo(s), wingM);
    // sharklet
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(1.5, 0); sh.lineTo(1.25, 2.4); sh.lineTo(.75, 2.4); sh.closePath();
    const sk = add(root, new THREE.ShapeGeometry(sh), sharkM, s * (TIP_X + .02), wingY(TIP_X), teZ(TIP_X) + .05);
    sk.rotation.set(0, -s * Math.PI / 2, 0); sk.rotation.z = -s * 0.12;
    // flaps: inner + outer panels hinged along the trailing edge; deploy = slide aft + rotate down
    for (const [xa, xb] of [[ROOT_X + .3, 8.6], [8.9, 13.6]]) {
      const pts = [[xa, teZ(xa) + 1.25], [xb, teZ(xb) + 1.0], [xb, teZ(xb)], [xa, teZ(xa)]];
      const hx = (xa + xb) / 2, hz = (pts[0][1] + pts[1][1]) / 2, hy = wingY(hx) - .05;
      const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(s * (x - hx), -(z - hz))));
      const g = new THREE.ShapeGeometry(shape); g.rotateX(Math.PI / 2);
      const pivot = new THREE.Group(); pivot.position.set(s * hx, hy, hz); root.add(pivot);
      const m = add(pivot, g, wingM); m.position.y = -.02;
      const axis = new THREE.Vector3(s * (xb - xa), 0, teZ(xb) - teZ(xa)).normalize();
      flaps.push({pivot, axis, base: pivot.position.clone(), aft: new THREE.Vector3(0, -.15, -1)});
    }
    // spoilers: 4 panels on the upper surface ahead of the flaps
    for (let k = 0; k < 4; k++) {
      const xa = 3.4 + k * 2.3, xb = xa + 2.1, z1 = teZ(xa) + 2.6, z2 = teZ(xa) + 1.35;
      const g = new THREE.PlaneGeometry(xb - xa, z1 - z2); g.rotateX(-Math.PI / 2);
      const pivot = new THREE.Group(); pivot.position.set(s * (xa + xb) / 2, wingY((xa + xb) / 2) + .2, z1); root.add(pivot);
      const m = add(pivot, g, wingM, 0, 0, -(z1 - z2) / 2);
      pivot.rotation.y = s * 25 * deg * 0.4;
      spoilers.push(pivot);
    }
  }

  // ---------- tailplane + fin ----------
  for (const s of [1, -1]) {
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(6.2, -2.6); sh.lineTo(6.2, -3.6); sh.lineTo(0, -4.4); sh.closePath();
    const g = new THREE.ShapeGeometry(sh); g.rotateX(Math.PI / 2); g.scale(s, 1, -1);
    if (s > 0) { g.index.array.reverse(); } g.computeVertexNormals();   // mirrored side: keep faces pointing up
    const h = add(root, g, wingM, s * .5, 1.05, -13.6); h.rotation.z = s * 6 * deg;
  }
  { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(-5.6, 6.3); sh.lineTo(-8.0, 6.3); sh.lineTo(-6.4, 0); sh.closePath();
    const fin = new THREE.ExtrudeGeometry(sh, {depth: .28, bevelEnabled: false}); fin.translate(0, 0, -.14); fin.rotateY(-Math.PI / 2);
    { const uv = fin.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 8 + 1, uv.getY(i) / 6.3); }   // shape coords -> 0..1
    add(root, fin, tail, 0, 1.25, -10.9); }

  // ---------- engines: nacelle, pylon, fan with blades, spinner, translating reverser cowl ----------
  const fans = [], cowls = [];
  for (const s of [1, -1]) {
    const ex = s * 5.75, ey = wingY(5.75) - 1.55, ez = leZ(5.75) + 1.6, eng = new THREE.Group(); eng.position.set(ex, ey, ez); root.add(eng);
    const np = [[1.0, 1.95], [1.12, 1.5], [1.12, 0], [1.02, -1.4], [.72, -2.5]].map(([r, z]) => new THREE.Vector2(r, z)).reverse();
    const nac = new THREE.LatheGeometry(np, 32); nac.rotateX(Math.PI / 2);
    const nacM = add(eng, nac, engM);
    const lip = new THREE.TorusGeometry(1.0, .07, 8, 32); add(eng, lip, metal, 0, 0, 1.95);
    const cowl = new THREE.Group(); eng.add(cowl);
    const cg = new THREE.CylinderGeometry(1.03, .95, 1.1, 32, 1, true); cg.rotateX(Math.PI / 2);
    add(cowl, cg, M(0x2a3138, .5, .4, {side: THREE.DoubleSide}), 0, 0, -.9).visible = false;   // cascade band, shown when cowl slides aft
    cowls.push({cowl, band: cowl.children[0], nac: nacM});
    const fan = new THREE.Group(); fan.position.z = 1.55; eng.add(fan);
    add(fan, new THREE.CircleGeometry(.98, 32), dark, 0, 0, -.02);
    const blade = new THREE.BoxGeometry(.13, .86, .03); blade.translate(0, .52, 0);
    for (let b = 0; b < 18; b++) { const m = add(fan, blade, metal); m.rotation.z = b / 18 * Math.PI * 2; m.rotation.y = .45; }
    const spin = new THREE.ConeGeometry(.3, .7, 20); spin.rotateX(Math.PI / 2); add(fan, spin, metal, 0, 0, .3);
    fans.push(fan);
    add(eng, new THREE.CylinderGeometry(.55, .4, 1.2, 16).rotateX(Math.PI / 2), dark, 0, -.05, -2.9);   // exhaust cone
    const pyl = new THREE.BoxGeometry(.32, 1.25, 4.2); add(root, pyl, wingM, ex, ey + 1.05, ez - 1.0);
  }

  // ---------- landing gear ----------
  const strut = M(0xdde2e6, .35, .5), gears = [], doors = [];
  function wheelSet(n, r, w, gap) {   // axle group with n wheels side by side; returns {group, wheels}
    const g = new THREE.Group(), wheels = [];
    const tg = new THREE.CylinderGeometry(r, r, w, 24); tg.rotateZ(Math.PI / 2);
    const hg = new THREE.CylinderGeometry(r * .55, r * .55, w * 1.02, 16); hg.rotateZ(Math.PI / 2);
    const tread = new THREE.TorusGeometry(r * .97, w * .12, 6, 24); tread.rotateY(Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * gap, wh = new THREE.Group(); wh.position.x = x; g.add(wh);
      add(wh, tg, tyre); add(wh, hg, hub);
      for (const dx of [-w * .3, w * .3]) add(wh, tread, tyre, dx, 0, 0);
      const spoke = new THREE.BoxGeometry(w * 1.04, r * .9, .05);   // hub marks make the rotation readable
      add(wh, spoke, dark); add(wh, spoke, dark).rotation.x = Math.PI / 2;
      wheels.push(wh);
    }
    return {group: g, wheels};
  }
  function leg(x, y, z, len, axis, retractAngle, wheels) {
    const pivot = new THREE.Group(); pivot.position.set(x, y, z); root.add(pivot);
    const upper = new THREE.CylinderGeometry(.17, .17, len * .62, 12); upper.translate(0, -len * .31, 0); add(pivot, upper, strut);
    const lower = new THREE.Group(); pivot.add(lower);
    const lg = new THREE.CylinderGeometry(.12, .12, len * .5, 12); lg.translate(0, -len * .62, 0); add(lower, lg, metal);
    const brace = new THREE.CylinderGeometry(.06, .06, len * .7, 8); brace.translate(0, -len * .35, 0);
    const br = add(pivot, brace, strut); br.rotation[axis === 'z' ? 'x' : 'z'] = .35;
    const ws = wheels; ws.group.position.y = -len; lower.add(ws.group);
    // leg door fixed to the strut
    const ld = new THREE.PlaneGeometry(axis === 'z' ? .05 : .9, len * .7); ld.translate(0, -len * .4, 0);
    const door = add(pivot, new THREE.BoxGeometry(axis === 'z' ? .04 : .9, len * .65, axis === 'z' ? 1.05 : .04), solidPaint, axis === 'z' ? Math.sign(x) * .25 : 0, -len * .4, axis === 'z' ? 0 : .32);
    const taxi = axis === 'x' ? add(lower, new THREE.SphereGeometry(.09, 8, 6), new THREE.MeshBasicMaterial({color: 0xfff6dd, toneMapped: false}), 0, -len * .45, .2) : null;
    const g = {pivot, lower, axis, retractAngle, wheels: ws.wheels, r: ws.wheels.length && ws.wheels[0].children[0].geometry.parameters.radiusTop, taxi};
    gears.push(g); return g;
  }
  const mainLen = 2.85, noseLen = 2.15;
  // wheel bottom at y = -4: pivot y + (-len) - r = -4
  leg(3.85, -4 + mainLen + .58, -.6, mainLen, 'z', -86 * deg, wheelSet(2, .58, .4, .98));
  leg(-3.85, -4 + mainLen + .58, -.6, mainLen, 'z', 86 * deg, wheelSet(2, .58, .4, .98));
  leg(0, -4 + noseLen + .38, 14.2, noseLen, 'x', -98 * deg, wheelSet(2, .38, .26, .5));
  // bay doors: two belly doors per main bay (open only while the gear moves), two nose doors
  for (const s of [1, -1]) {
    // hinges on the outer edge; closed = flush with the belly, open = swung down
    const piv = new THREE.Group(); piv.position.set(s * 1.65, -2.27, -.6); root.add(piv);
    add(piv, new THREE.BoxGeometry(1.5, .04, 1.6), belly, -s * .75, 0, 0); doors.push({piv, s, kind: 'main'});
    const np = new THREE.Group(); np.position.set(s * .5, -1.93, 13.6); root.add(np);
    add(np, new THREE.BoxGeometry(.48, .04, 1.8), solidPaint, -s * .24, 0, 0); doors.push({piv: np, s, kind: 'nose'});
  }

  // ---------- lights: emissive bulbs + additive glow sprites ----------
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  function light(name, color, x, y, z, size) {
    const bulb = add(root, new THREE.SphereGeometry(.12, 8, 6), new THREE.MeshBasicMaterial({color, toneMapped: false}), x, y, z);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false}));
    spr.scale.setScalar(size); spr.position.set(x, y, z); root.add(spr);
    (lights[name] = lights[name] || []).push({bulb, spr, size});
  }
  const tipY = wingY(TIP_X) + .1, tipZ = leZ(TIP_X) - .5;
  light('navL', 0xff2a1a, TIP_X + .05, tipY, tipZ, 2.2); light('navR', 0x19ff6a, -TIP_X - .05, tipY, tipZ, 2.2);
  light('tail', 0xffffff, 0, .55, -18.75, 1.6);
  light('strobe', 0xffffff, TIP_X + .1, tipY, tipZ - .5, 7); light('strobe', 0xffffff, -TIP_X - .1, tipY, tipZ - .5, 7); light('strobe', 0xffffff, 0, .6, -18.8, 5);
  light('beacon', 0xff1f10, 0, 2.02, 2.5, 3.2); light('beacon', 0xff1f10, 0, -2.25, 1.0, 3.2);
  light('landing', 0xfff3d6, 2.6, wingY(2.6) - .1, leZ(2.6) + .1, 3.2); light('landing', 0xfff3d6, -2.6, wingY(2.6) - .1, leZ(2.6) + .1, 3.2);
  for (const m of root.children) if (m.isMesh) m.castShadow = false;

  // ---------- animation state ----------
  const S = {gear: 1, flaps: 0, spoilers: 0, reverse: 0, comp: 0, fan: 0, spin: [0, 0, 0]};
  const Q = new THREE.Quaternion();
  const approach = (v, target, rate, dt) => v + Math.sign(target - v) * Math.min(Math.abs(target - v), rate * dt);
  const smooth = k => k * k * (3 - 2 * k);
  function setLight(name, on, bright = 1) {
    for (const l of lights[name] || []) { l.bulb.visible = on; l.spr.visible = on; l.spr.material.opacity = bright; l.spr.scale.setScalar(l.size * (0.35 + 0.65 * bright)); }
  }

  function update(st, dt, t) {
    dt = Math.min(dt, 0.1);
    // gear: ~9 s full cycle; doors open first, close again once the leg is fully up (stay closed when down)
    S.gear = approach(S.gear, st.gear ? 1 : 0, 1 / 9, dt);
    const g = smooth(Math.min(1, Math.max(0, (S.gear - .12) / .76)));        // leg travel inside the door window
    const moving = S.gear > .02 && S.gear < .98, doorK = moving ? Math.min(1, Math.min(S.gear, 1 - S.gear) * 10) : 0;
    for (const G of gears) {
      const a = (1 - g) * G.retractAngle;
      G.pivot.rotation.set(G.axis === 'x' ? a : 0, 0, G.axis === 'z' ? a : 0);
    }
    for (const D of doors) {
      if (D.kind === 'main') D.piv.rotation.z = -D.s * doorK * 85 * deg;
      else D.piv.rotation.z = -D.s * (moving ? doorK : S.gear > .5 ? .9 : 0) * 85 * deg;
    }
    // oleo: compressed on the ground, extended in the air
    S.comp = approach(S.comp, st.ground ? 1 : 0, 2.5, dt);
    for (const G of gears) G.lower.position.y = S.comp * .22;
    // wheels spin with ground speed; brakes stop them after lift-off
    const w = st.ground ? st.speed : 0;
    gears.forEach((G, i) => {
      const target = w / (G.r || .5);
      S.spin[i] = st.ground ? target : Math.max(0, S.spin[i] - 4 * dt);
      for (const wh of G.wheels) wh.rotation.x += S.spin[i] * dt;
      if (G.taxi) G.taxi.visible = !!(st.lights && st.lights.taxi) && S.gear > .95;
    });
    // flaps: slide aft and rotate down about the trailing-edge hinge (~40 s for full travel in reality; quicker here)
    S.flaps = approach(S.flaps, st.flaps, 1 / 12, dt);
    for (const F of flaps) {
      F.pivot.position.copy(F.base).addScaledVector(F.aft, S.flaps * 1.1);
      F.pivot.quaternion.setFromAxisAngle(F.axis, S.flaps * 32 * deg * (F.axis.x > 0 ? 1 : 1));
    }
    S.spoilers = approach(S.spoilers, st.spoilers, 1.6, dt);
    for (const P of spoilers) P.rotation.x = -S.spoilers * 48 * deg;
    // reversers: translating cowl slides aft, exposing the cascade band
    S.reverse = approach(S.reverse, st.reverse, .9, dt);
    for (const C of cowls) { C.cowl.position.z = -S.reverse * .75; C.band.visible = S.reverse > .05; }
    // fans: idle ~25% N1, take-off ~95%
    S.fan = approach(S.fan, st.n1 ?? .3, .25, dt);
    for (const f of fans) f.rotation.z -= (4 + S.fan * 55) * dt;
    // lights
    const L = st.lights || {};
    setLight('navL', L.nav !== false); setLight('navR', L.nav !== false); setLight('tail', L.nav !== false);
    const ph = t % 1.0, strobeOn = L.strobe && (ph < .05 || (ph > .12 && ph < .17));
    setLight('strobe', !!strobeOn);
    setLight('beacon', L.beacon !== false && (t % 1.2) < .14);
    setLight('landing', !!L.landing, st.glow ?? .7);
    return S;
  }
  update({gear: 1, flaps: 0, spoilers: 0, reverse: 0, ground: true, speed: 0, n1: .25, lights: {}}, 0, 0);
  // ---------- livery ----------
  const finCanvas = document.createElement('canvas'); finCanvas.width = finCanvas.height = 512;
  const finTex = new THREE.CanvasTexture(finCanvas); finTex.colorSpace = THREE.SRGBColorSpace; finTex.anisotropy = 4;
  tail.map = finTex;
  const hex = c => '#' + c.toString(16).padStart(6, '0');
  function paintFin(lv) {
    const x = finCanvas.getContext('2d'), W = 512, T = hex(lv.tail), A = hex(lv.accent);
    x.fillStyle = T; x.fillRect(0, 0, W, W);
    x.save(); x.translate(0, W); x.scale(1, -1);   // v = 0 at the fin root
    if (lv.art === 'indigo') {      // white fin, navy aft section, light-blue diagonal between them
      x.fillStyle = '#f6f7f9'; x.fillRect(0, 0, W, W);
      x.fillStyle = T; x.beginPath(); x.moveTo(0, 0); x.lineTo(W * .62, 0); x.lineTo(W * .08, W); x.lineTo(0, W); x.fill();
      x.strokeStyle = A; x.lineWidth = 30; x.beginPath(); x.moveTo(W * .7, 0); x.lineTo(W * .14, W); x.stroke();
    } else if (lv.art === 'dots') {         // IndiGo-style dot field, densest toward the leading edge
      x.fillStyle = A; for (let i = 0; i < 26; i++) for (let j = 0; j < 22; j++) { const u = i / 25, v = j / 21, r = 3 + 7 * u * (1 - Math.abs(v - .5));
        if (Math.sin(i * 1.7 + j * .9) > -.2) { x.globalAlpha = .25 + .75 * u; x.beginPath(); x.arc(u * W, v * W, r, 0, 7); x.fill(); } } x.globalAlpha = 1;
    } else if (lv.art === 'window') { // gold window-frame arc
      x.strokeStyle = A; x.lineWidth = 26; x.beginPath(); x.moveTo(W * .25, W * .05); x.lineTo(W * .25, W * .55); x.arc(W * .55, W * .55, W * .3, Math.PI, 0, false); x.lineTo(W * .85, W * .05); x.stroke();
    } else if (lv.art === 'swoosh' || lv.art === 'swirl') {
      x.fillStyle = A; x.beginPath(); x.moveTo(W * .1, W * .15); x.bezierCurveTo(W * .5, W * .1, W * .7, W * .45, W * .98, W * .9); x.lineTo(W * .98, W * .7); x.bezierCurveTo(W * .7, W * .3, W * .45, W * .02, W * .1, W * .15); x.fill();
      if (lv.art === 'swirl') { x.lineWidth = 14; x.strokeStyle = A; x.beginPath(); x.arc(W * .62, W * .45, W * .17, .3, 5.2); x.stroke(); }
    } else if (lv.art === 'pattern') {
      x.strokeStyle = A; x.globalAlpha = .5; x.lineWidth = 6; for (let i = -8; i < 16; i++) { x.beginPath(); x.moveTo(i * 40, 0); x.lineTo(i * 40 + 300, W); x.stroke(); } x.globalAlpha = 1;
    } else if (lv.art === 'flag') {
      const cols = [A, '#ffffff', '#000000']; cols.forEach((c, i) => { x.fillStyle = c; x.fillRect(0, W * (.06 + i * .07), W, W * .07); });
    } else if (lv.art === 'bird') {
      x.fillStyle = A; x.beginPath(); x.moveTo(W * .3, W * .3); x.quadraticCurveTo(W * .6, W * .7, W * .9, W * .62); x.quadraticCurveTo(W * .62, W * .5, W * .3, W * .3); x.fill();
    }
    x.restore(); finTex.needsUpdate = true;
  }
  const lineAt = (lv, z) => { const k = lv.line; if (!k) return -0.9 - drop(z);
    for (let i = 0; i < k.length - 1; i++) if (z <= k[i][0] && z >= k[i + 1][0]) { const t = (z - k[i][0]) / (k[i + 1][0] - k[i][0]), e = t * t * (3 - 2 * t); return k[i][1] + (k[i + 1][1] - k[i][1]) * e - drop(z); }
    return -3; };
  function paintTitle(lv) {
    const x = titleCanvas.getContext('2d'), W = titleCanvas.width, H = titleCanvas.height; x.clearRect(0, 0, W, H);
    if (!lv.title) { titleMat.map.needsUpdate = true; return; }
    x.fillStyle = hex(lv.titleCol ?? lv.tail); x.textBaseline = 'middle';
    let fs = 168; x.font = `700 ${fs}px Montserrat, Arial, sans-serif`;
    while (x.measureText(lv.title).width > W * .94 && fs > 40) { fs -= 6; x.font = `700 ${fs}px Montserrat, Arial, sans-serif`; }
    x.fillText(lv.title, W * .03, H * .55); titleMat.map.needsUpdate = true;
  }
  function paintBody(lv) {
    const p = fus.attributes.position, c = fus.attributes.color, B = new THREE.Color(lv.body), Y = new THREE.Color(lv.belly), N = lv.band != null ? new THREE.Color(lv.band) : null, tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i), up = z < -9 ? ((-9 - z) / 9.7) ** 1.6 * 1.05 : 0, yy = y - up;   // undo the tail upsweep for the paint line
      const line = lineAt(lv, z);
      tmp.copy(y < line ? Y : B);
      if (N && (lv.line ? y >= line && y < line + .16 : yy > -0.25 && yy < 0.05 && z < 15.4)) tmp.copy(N);
      c.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    c.needsUpdate = true;
  }
  function setLivery(lv) {
    lv = lv || DEFAULT_LIVERY;
    paintBody(lv); paintFin(lv); paintTitle(lv);
    sharkM.color.setHex(lv.tail); engM.color.setHex(lv.engine); belly.color.setHex(lv.belly); solidPaint.color.setHex(lv.body);
  }
  setLivery(opt.livery || DEFAULT_LIVERY);
  return {root, update, state: S, setLivery};
}
