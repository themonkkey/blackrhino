"""Generate a detailed A320-style airliner glTF with painted parts (public/models/airliner_hq.glb).
Built nose +X, left +Y, up +Z (metres, ~37.6 m long, 35.8 m span); written glTF y-up, +z forward.
Colours are per-vertex (COLOR_0): white fuselage, navy tail/engines/belly stripe (IndiGo-like),
grey wings, dark cockpit + cabin windows. Cesium can still tint it via colorBlendMode."""
import json, math, os, struct
import numpy as np

WHITE, NAVY, GREY, DARK, METAL, BLUE = (0.95, 0.95, 0.96), (0.02, 0.09, 0.42), (0.72, 0.74, 0.78), (0.05, 0.06, 0.08), (0.55, 0.57, 0.6), (0.10, 0.22, 0.72)
P, C = [], []          # triangle vertices, per-vertex colours


def tri(a, b, c, col):
    P.extend([a, b, c]); C.extend([col(a), col(b), col(c)] if callable(col) else [col] * 3)


def quad(a, b, c, d, col):
    tri(a, b, c, col); tri(a, c, d, col)


def solid(col):
    return col


# ---------- fuselage: lofted superellipse rings ----------
L_NOSE, L_TAIL = 18.8, -18.8
def fus_profile(x):
    """(half-width, half-height, centre z) at station x."""
    if x > 13.5:                       # nose: rounded taper, droops slightly
        t = (x - 13.5) / (L_NOSE - 13.5)
        k = math.sqrt(max(0.0, 1 - t ** 2.2))
        return 1.98 * k, 2.05 * k, -0.35 * t ** 1.5
    if x > -9:
        return 1.98, 2.05, 0.0
    t = (-9 - x) / (-9 - L_TAIL)       # tail cone: tapers and sweeps up
    return 1.98 * (1 - t) ** 1.15 + 0.06, 2.05 * (1 - 0.82 * t) + 0.05 - 0.6 * t * t, 1.15 * t ** 1.4


def fus_color(p):
    x, y, z = p
    w, h, zc = fus_profile(x)
    rel = (z - zc) / max(h, 0.1)
    # cockpit windows: band on upper nose
    if 15.2 < x < 16.9 and 0.18 < rel < 0.55 and abs(y) > 0.25: return DARK
    # cabin window line
    if -11.5 < x < 13.6 and 0.22 < rel < 0.36: return DARK
    # navy belly sweep (IndiGo-like)
    if rel < -0.55 and x < 10: return NAVY
    if x < -12.5 and rel > -0.2: return NAVY   # tail cone blends into fin colour
    return WHITE


stations = np.concatenate([np.linspace(L_NOSE, 13.5, 14), np.linspace(13.0, -9, 12), np.linspace(-9.6, L_TAIL, 14)])
SEG = 32
rings = []
for x in stations:
    w, h, zc = fus_profile(x)
    ring = []
    for k in range(SEG):
        a = 2 * math.pi * k / SEG
        c, s = math.cos(a), math.sin(a)
        e = 2.4  # superellipse exponent: a bit boxier than a circle, like real fuselages
        y = w * math.copysign(abs(c) ** (2 / e), c)
        z = zc + h * math.copysign(abs(s) ** (2 / e), s)
        ring.append((x, y, z))
    rings.append(ring)
for r1, r2 in zip(rings, rings[1:]):
    for k in range(SEG):
        m = (k + 1) % SEG
        quad(r1[k], r2[k], r2[m], r1[m], fus_color)
for ring, flip in ((rings[0], False), (rings[-1], True)):
    c = tuple(np.mean(np.array(ring), axis=0))
    for k in range(SEG):
        a, b = ring[k], ring[(k + 1) % SEG]
        tri(c, b, a, fus_color) if not flip else tri(c, a, b, fus_color)


# ---------- lifting surfaces (airfoil-ish slabs) ----------
def surface(root_le, root_te, tip_le, tip_te, root_t, tip_t, col, vertical=False, n=6):
    """Thin tapered surface between root and tip chords; thickness tapers; lens-shaped section."""
    secs = []
    for i in range(n + 1):
        f = i / n
        le = np.array(root_le) * (1 - f) + np.array(tip_le) * f
        te = np.array(root_te) * (1 - f) + np.array(tip_te) * f
        t = root_t * (1 - f) + tip_t * f
        pts = []
        for j, u in enumerate((0, 0.12, 0.35, 0.65, 1.0)):
            base = le * (1 - u) + te * u
            thick = t * (1.0 if u == 0.12 else 0.85 if u == 0.35 else 0.5 if u == 0.65 else 0.12 if u == 1.0 else 0.35)
            off = np.array([0, thick, 0]) if vertical else np.array([0, 0, thick])
            pts.append((tuple(base + off), tuple(base - off)))
        secs.append(pts)
    for a, b in zip(secs, secs[1:]):
        for j in range(len(a) - 1):
            quad(a[j][0], a[j + 1][0], b[j + 1][0], b[j][0], col)   # upper
            quad(a[j][1], b[j][1], b[j + 1][1], a[j + 1][1], col)   # lower
        quad(a[-1][0], b[-1][0], b[-1][1], a[-1][1], col)           # trailing edge
    for sec in (secs[0], secs[-1]):                                  # end caps
        for j in range(len(sec) - 1):
            quad(sec[j][0], sec[j][1], sec[j + 1][1], sec[j + 1][0], col)


for s in (1, -1):
    # main wing: 25° sweep, dihedral, root chord ~6 m
    surface((3.6, s * 1.6, -1.25), (-3.4, s * 1.6, -1.35), (-5.6, s * 17.2, 0.25), (-7.2, s * 17.2, 0.2), 0.42, 0.11, GREY)
    # sharklet
    surface((-5.6, s * 17.2, 0.25), (-7.2, s * 17.2, 0.2), (-7.4, s * 17.55, 2.6), (-8.0, s * 17.55, 2.6), 0.10, 0.04, NAVY, vertical=True, n=3)
    # horizontal stabiliser
    surface((-13.6, s * 0.6, 1.0), (-17.0, s * 0.6, 1.0), (-17.9, s * 6.2, 1.35), (-19.2, s * 6.2, 1.35), 0.22, 0.07, GREY)
# vertical fin (navy)
surface((-12.4, 0, 1.6), (-17.6, 0, 1.6), (-17.9, 0, 7.6), (-19.6, 0, 7.6), 0.28, 0.09, NAVY, vertical=True)


# ---------- engines (CFM/LEAP-like nacelles under the wing) ----------
def nacelle(cx, cy, cz):
    prof = [(2.9, 0.78), (2.75, 0.98), (2.2, 1.06), (0.4, 1.02), (-1.1, 0.72), (-1.9, 0.38)]
    seg = 24
    rs = []
    for x, r in prof:
        rs.append([(cx + x, cy + r * math.cos(2 * math.pi * k / seg), cz + r * math.sin(2 * math.pi * k / seg)) for k in range(seg)])
    for r1, r2 in zip(rs, rs[1:]):
        for k in range(seg):
            m = (k + 1) % seg
            quad(r1[k], r1[m], r2[m], r2[k], NAVY)
    # intake fan face (dark) and exhaust cone (metal)
    fc = (cx + 2.75, cy, cz)
    for k in range(seg):
        tri(fc, rs[0][(k + 1) % seg], rs[0][k], DARK)
    ec = (cx - 2.6, cy, cz)
    for k in range(seg):
        tri(ec, rs[-1][k], rs[-1][(k + 1) % seg], METAL)
    # pylon
    surface((cx + 1.8, cy, cz + 0.9), (cx - 1.2, cy, cz + 0.6), (cx + 0.6, cy, cz + 1.75), (cx - 1.8, cy, cz + 1.55), 0.18, 0.15, GREY, vertical=True, n=2)


for s in (1, -1):
    nacelle(2.2, s * 5.75, -2.35)

T = np.array(P, dtype=np.float32).reshape(-1, 3, 3)
n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
pos = T.reshape(-1, 3)
nor = np.repeat(n, 3, axis=0).astype(np.float32)
col = np.array(C, dtype=np.float32)
col = np.concatenate([col, np.ones((len(col), 1), np.float32)], 1)
conv = lambda a: np.stack([a[:, 1], a[:, 2], a[:, 0]], 1).astype(np.float32)   # (nose,left,up) -> glTF (left,up,nose)
pos, nor = conv(pos), conv(nor)

bp, bn, bc = pos.tobytes(), nor.tobytes(), col.tobytes()
binb = bp + bn + bc
views, off = [], 0
for b in (bp, bn, bc):
    views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b), "target": 34962}); off += len(b)
gltf = {"asset": {"version": "2.0", "generator": "flight-tracker make_airliner_hq"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.25, "roughnessFactor": 0.35},
                       "doubleSided": True}],
        "buffers": [{"byteLength": len(binb)}], "bufferViews": views,
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
                      {"bufferView": 1, "componentType": 5126, "count": len(nor), "type": "VEC3"},
                      {"bufferView": 2, "componentType": 5126, "count": len(col), "type": "VEC4"}]}
js = json.dumps(gltf).encode(); js += b" " * (-len(js) % 4); binb += b"\0" * (-len(binb) % 4)
out = struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(binb)) + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binb), 0x004E4942) + binb
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models", "airliner_hq.glb")
open(dst, "wb").write(out)
print("triangles", len(P) // 3, "bytes", len(out))
