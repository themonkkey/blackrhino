// Real airport layouts in 3D from OpenStreetMap (public/apt3d/<ICAO>.json, built by data/build_airports3d.py):
// runways with ICAO markings, taxiways with centrelines, aprons, and buildings extruded to their mapped heights.
// buildAirport(THREE, data, xz) -> {group, bound, elevM, contains(lat, lon), distKm(lat, lon)}
// Geometry is in scene km (xz(lat, lon) -> [x, z]); the group sits at y = 0 and is lifted to the field elevation by the caller.
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const R = Math.PI / 180;

export function buildAirport(THREE, A, xz) {
  const group = new THREE.Group();
  const KM = 0.001, lift = {apron: .00025, twy: .0004, rwy: .00055, mark: .0007};
  const P = ll => { const [x, z] = xz(ll[0], ll[1]); return [x, z]; };

  // ---------- polygons (aprons) ----------
  function polyGeo(ring, y) {
    const pts = ring.map(P); if (pts.length < 3) return null;
    const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); return g;
  }
  // ---------- ribbons along a polyline (taxiways, runway surface), mitred joints ----------
  function ribbon(line, wKm, y, out) {
    const pts = line.map(P); if (pts.length < 2) return;
    const n = pts.length, base = out.pos.length / 3, half = wKm / 2;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx;
      out.pos.push(pts[i][0] + nx * half, y, pts[i][1] + nz * half, pts[i][0] - nx * half, y, pts[i][1] - nz * half);
    }
    for (let i = 0; i < n - 1; i++) { const a = base + i * 2; out.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const mk = (out) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3)); g.setIndex(out.idx); g.computeVertexNormals(); return g; };
  const mat = (c, r = .9, extra = {}) => new THREE.MeshStandardMaterial({color: c, roughness: r, metalness: 0, ...extra});

  // aprons
  const ap = (A.aprons || []).map(a => polyGeo(a.ring, lift.apron)).filter(Boolean);
  if (ap.length) group.add(new THREE.Mesh(mergeGeometries(ap), mat(0x8a8f94, .95)));

  // taxiways + yellow centrelines
  const tw = {pos: [], idx: []}, tcl = {pos: [], idx: []};
  for (const t of A.taxiways || []) { ribbon(t.line, (t.w || 23) * KM, lift.twy, tw); ribbon(t.line, .3 * KM, lift.twy + .00008, tcl); }
  if (tw.idx.length) group.add(new THREE.Mesh(mk(tw), mat(0x3b4046, .92)));
  if (tcl.idx.length) group.add(new THREE.Mesh(mk(tcl), mat(0xe8b923, .6, {emissive: 0x2a2005})));

  // runways: merge OSM segments that share a reference, then surface + markings
  const byRef = new Map(), loose = [];
  for (const r of A.runways || []) {
    const k = (r.ref || '').replace(/\s/g, '');
    if (!k) { loose.push(r); continue; }
    const e = byRef.get(k); if (e) { e.pts.push(...r.line); e.w = Math.max(e.w, r.w || 45); } else byRef.set(k, {ref: k, w: r.w || 45, pts: [...r.line]});
  }
  // unnamed OSM pieces (sections, stopways): merge into the named runway they line up with; keep only long ones otherwise
  const axis = e => { const a = P(e.pts[0]), b = P(e.pts[e.pts.length - 1]), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return {a, ux: (b[0] - a[0]) / l, uz: (b[1] - a[1]) / l, l}; };
  for (const r of loose) {
    const pa = P(r.line[0]), pb = P(r.line[r.line.length - 1]), l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1, ux = (pb[0] - pa[0]) / l, uz = (pb[1] - pa[1]) / l;
    let host = null;
    for (const e of byRef.values()) { const x = axis(e), par = Math.abs(ux * x.ux + uz * x.uz), off = Math.abs((pa[0] - x.a[0]) * -x.uz + (pa[1] - x.a[1]) * x.ux);
      if (par > .995 && off < .08) { host = e; break; } }
    if (host) host.pts.push(...r.line);
    else if (l > 1.8) byRef.set('~' + byRef.size, {ref: '', w: r.w || 45, pts: [...r.line]});
  }
  const rs = {pos: [], idx: []}, mk2 = {pos: [], idx: []}, numbers = [], runways = [];
  for (const r of byRef.values()) {
    // ends = the two points farthest apart
    let best = [r.pts[0], r.pts[r.pts.length - 1]], bd = 0;
    for (const a of r.pts) for (const b of r.pts) { const d = (a[0] - b[0]) ** 2 + ((a[1] - b[1]) * Math.cos(a[0] * R)) ** 2; if (d > bd) { bd = d; best = [a, b]; } }
    const [p0, p1] = best.map(P), dx = p1[0] - p0[0], dz = p1[1] - p0[1], len = Math.hypot(dx, dz);
    if (len < .3) continue;
    runways.push({ref: r.ref, a: best[0], b: best[1], w: r.w, lenKm: len});   // exact centreline ends, for the demo and ground logic
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux, w = r.w * KM;
    ribbon([best[0], best[1]], w, lift.rwy, rs);
    // white marking quad: along-runway s (km from p0), across t (km from centreline), size ls x lt
    const quad = (s, t, ls, lt) => {
      const cx = p0[0] + ux * s + nx * t, cz = p0[1] + uz * s + nz * t, b = mk2.pos.length / 3, hl = ls / 2, ht = lt / 2;
      for (const [a, c] of [[-hl, -ht], [hl, -ht], [-hl, ht], [hl, ht]]) mk2.pos.push(cx + ux * a + nx * c, lift.mark, cz + uz * a + nz * c);
      mk2.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    };
    // both ends: from p0 looking toward p1 (sgn 1), and from p1 back (sgn -1)
    const brg = (Math.atan2(ux, -uz) / R + 360) % 360;   // scene: +x east, -z north
    const refs = r.ref.split('/'), suffix = i => (refs[i] || '').replace(/[0-9]/g, '');
    for (const [sgn, s0, idx] of [[1, 0, 0], [-1, len, 1]]) {
      const at = d => s0 + sgn * d;
      // threshold piano keys (1.8 m stripes), number of stripes by width
      const nk = r.w >= 55 ? 16 : r.w >= 44 ? 12 : 8, gap = 1.8 * KM;
      for (let i = 0; i < nk / 2; i++) for (const sd of [1, -1]) quad(at(.021), sd * (gap * 1.5 + i * gap * 2), .03, gap);
      // aiming point (400 m) and touchdown zone pairs (150..900 m)
      for (const sd of [1, -1]) quad(at(.42), sd * w * .27, .045, w * .2);
      for (const [d, nb] of [[.15, 3], [.3, 3], [.6, 2], [.75, 2], [.9, 1]]) for (const sd of [1, -1]) for (let b = 0; b < nb; b++) quad(at(d + .011), sd * (w * .33 + b * .003), .0225, .0018);
      // designator: magnetic-ish heading / 10 from the true bearing seen by an aircraft landing in this direction
      // designator: OSM's own (e.g. 11R/29L), matched to this end by heading; computed from the true bearing if absent
      const hdg = sgn > 0 ? brg : (brg + 180) % 360, nums = refs.map(t => parseInt(t, 10));
      const pick = nums.length === 2 && nums.every(Number.isFinite) ? (Math.abs(((nums[0] * 10 - hdg + 540) % 360) - 180) < 60 ? 0 : 1) : -1;
      const num = pick >= 0 ? refs[pick].replace(/^(\d)([A-Z]?)$/, '0$1$2') : String(Math.round(hdg / 10) % 36 || 36).padStart(2, '0');
      numbers.push({s: at(.075), sgn, txt: num, p0, ux, uz, nx, nz, w});
    }
    // centreline dashes: 30 m dash, 20 m gap, between the designators
    for (let s = .14; s < len - .14; s += .05) quad(s + .015, 0, .03, .0009);
    // edge lines
    for (const sd of [1, -1]) quad(len / 2, sd * (w / 2 - .0015), len, .0009);
  }
  if (rs.idx.length) group.add(new THREE.Mesh(mk(rs), mat(0x24282c, .85)));
  if (mk2.idx.length) group.add(new THREE.Mesh(mk(mk2), mat(0xf2f4f5, .6, {emissive: 0x202224})));
  // designator numbers as textured quads, readable for the landing aircraft
  for (const n of numbers) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 384; const x = c.getContext('2d');
    x.fillStyle = '#f2f4f5'; x.font = '700 300px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const lines = n.txt.match(/^(\d+)([A-Z]?)$/) || [0, n.txt, ''];
    if (lines[2]) { x.font = '700 150px Arial'; x.fillText(lines[2], 128, 70); x.font = '700 230px Arial'; x.fillText(lines[1], 128, 260); }
    else x.fillText(lines[1], 128, 200);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8;
    const g = new THREE.PlaneGeometry(n.w * .5, .03); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({map: t, transparent: true, alphaTest: .3, roughness: .6}));
    m.position.set(n.p0[0] + n.ux * n.s, lift.mark + .00005, n.p0[1] + n.uz * n.s);
    // text "up" points away from the landing aircraft (along the landing direction)
    m.rotation.y = Math.atan2(-n.ux * n.sgn, -n.uz * n.sgn);
    group.add(m);
  }

  // ---------- buildings ----------
  const kinds = {terminal: [], hangar: [], tower: [], other: []};
  for (const b of A.buildings || []) {
    const pts = (b.ring || []).map(P); if (pts.length < 3) continue;
    const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const h = Math.max(3, Math.min(b.h || 8, 120)) * KM;
    const g = new THREE.ExtrudeGeometry(sh, {depth: h, bevelEnabled: false}); g.rotateX(-Math.PI / 2);
    g.deleteAttribute('uv');
    (kinds[b.kind] || kinds.other).push(g);
  }
  const shade = (g, wall, roof) => {   // roofs lighter than walls, via vertex colours from the normals
    const n = g.attributes.normal, col = new Float32Array(n.count * 3), W = new THREE.Color(wall), Rf = new THREE.Color(roof);
    for (let i = 0; i < n.count; i++) { const c = n.getY(i) > .5 ? Rf : W; col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
  };
  const bmat = (r, m) => new THREE.MeshStandardMaterial({vertexColors: true, roughness: r, metalness: m});
  const looks = {terminal: [0x7f98ad, 0xdfe5ea, .35, .35], hangar: [0xb9bfc5, 0xd3d8dc, .6, .3], tower: [0xc7ccd1, 0x5a6670, .5, .2], other: [0xc2bdb4, 0xd9d4ca, .8, .05]};
  for (const [k, list] of Object.entries(kinds)) if (list.length) {
    const [wall, roof, r, m] = looks[k];
    group.add(new THREE.Mesh(shade(mergeGeometries(list), wall, roof), bmat(r, m)));
  }

  // ---------- helpers for the terrain: inside test + distance to the boundary ----------
  const rings = (A.bound && A.bound.length ? A.bound : []).map(r => r.map(P)).filter(r => r.length > 2);
  const inside = (x, z) => { let c = false; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const edgeDist = (x, z) => { let best = 1e9; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j], [bx, bz] = r[i], vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t)); } return best; };
  let bb = [1e9, 1e9, -1e9, -1e9]; for (const r of rings) for (const [x, z] of r) bb = [Math.min(bb[0], x), Math.min(bb[1], z), Math.max(bb[2], x), Math.max(bb[3], z)];
  return {group, elevM: A.elev_m || 0, bb, inside, edgeDist, runways};
}
