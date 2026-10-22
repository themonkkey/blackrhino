"""Generate a low-poly airliner glTF (airliner.glb). Built nose +X, left +Y, up +Z; written glTF y-up, +z forward."""
import json, struct, math
import numpy as np

tris = []  # list of (3,3) arrays in Cesium frame

def quad(a, b, c, d):
    tris.extend([np.array([a, b, c]), np.array([a, c, d])])

def hexa(v):  # v: 8 points, bottom 0-3, top 4-7, both counter-clockwise from below
    v = [np.array(p, float) for p in v]
    quad(v[0], v[3], v[2], v[1]); quad(v[4], v[5], v[6], v[7])
    for i in range(4):
        j = (i + 1) % 4
        quad(v[i], v[j], v[j + 4], v[i + 4])

def loft(stations, seg=14, zoff=lambda x: 0, cap=True):  # stations: [(x, r)]
    rings = []
    for x, r in stations:
        rings.append([(x, r * math.cos(2 * math.pi * k / seg), zoff(x) + r * math.sin(2 * math.pi * k / seg)) for k in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            m = (k + 1) % seg
            quad(np.array(a[k]), np.array(a[m]), np.array(b[m]), np.array(b[k]))
    if cap:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            c = np.mean(np.array(ring), axis=0)
            for k in range(seg):
                p, q = np.array(ring[k]), np.array(ring[(k + 1) % seg])
                tris.append(np.array([c, q, p]) if rev else np.array([c, p, q]))

# fuselage (length ~40m), tail sweeps up
loft([(20, 0.05), (19.3, 0.9), (18, 1.6), (16, 1.95), (12, 2.0), (-8, 2.0), (-13, 1.6), (-17, 0.9), (-19.5, 0.25)],
     zoff=lambda x: 0 if x > -8 else (-8 - x) * 0.11)

def wing(side, xr0, xr1, xt0, xt1, span, z, zt, th=0.35, tth=0.12, y0=1.8):
    s = 1 if side > 0 else -1
    pts = [(xr0, s * y0, z), (xt0, s * span, zt), (xt1, s * span, zt), (xr1, s * y0, z)]
    bot = [(x, y, zz - th if abs(y) == y0 else zz - tth) for x, y, zz in pts]
    top = [(x, y, zz + th if abs(y) == y0 else zz + tth) for x, y, zz in pts]
    if s < 0:
        bot, top = bot[::-1], top[::-1]
    hexa(bot + top)

for s in (1, -1):
    wing(s, 5, -4, -6, -8.5, 17.5, -0.9, 0.6)                      # main wing, swept + dihedral
    wing(s, -13.5, -17.5, -17.2, -19, 6.5, 0.6, 0.9, 0.2, 0.08, 0.6)  # stabiliser
    # engine nacelle under wing
    eng_y = s * 6.0
    stations = [(4.2, 0.9), (3.9, 1.15), (1.0, 1.15), (-0.5, 0.8)]
    before = len(tris)
    loft(stations, seg=10)
    for i in range(before, len(tris)):
        tris[i] = tris[i] + np.array([0, eng_y, -1.9])

# vertical fin (XZ plane, thin)
fin = [(-12.5, 0, 1.4), (-18.8, 0, 1.4), (-20.2, 0, 8.0), (-17.3, 0, 8.0)]
hexa([(x, -0.25 if z < 2 else -0.1, z) for x, y, z in fin][::-1][:0] + [
    (-12.5, -0.25, 1.4), (-18.8, -0.25, 1.4), (-20.2, -0.1, 8.0), (-17.3, -0.1, 8.0),
    (-12.5, 0.25, 1.4), (-18.8, 0.25, 1.4), (-20.2, 0.1, 8.0), (-17.3, 0.1, 8.0)])

T = np.array(tris, dtype=np.float32)                   # (n,3,3)
n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
pos = T.reshape(-1, 3)
nor = np.repeat(n, 3, axis=0).astype(np.float32)
# Cesium assumes glTF is y-up, +z forward: (nose, left, up) -> (left, up, nose)
conv = lambda a: np.stack([a[:, 1], a[:, 2], a[:, 0]], 1).astype(np.float32)
pos, nor = conv(pos), conv(nor)

bp, bn = pos.tobytes(), nor.tobytes()
bin_ = bp + bn
gltf = {
    "asset": {"version": "2.0", "generator": "flight-tracker"},
    "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
    "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "material": 0}]}],
    "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.95, 0.95, 0.97, 1], "metallicFactor": 0.1, "roughnessFactor": 0.5}, "doubleSided": True}],
    "buffers": [{"byteLength": len(bin_)}],
    "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(bp), "target": 34962},
                    {"buffer": 0, "byteOffset": len(bp), "byteLength": len(bn), "target": 34962}],
    "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3",
                   "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
                  {"bufferView": 1, "componentType": 5126, "count": len(nor), "type": "VEC3"}],
}
js = json.dumps(gltf).encode(); js += b" " * (-len(js) % 4)
bin_ += b"\0" * (-len(bin_) % 4)
out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
out += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(bin_), 0x004E4942) + bin_
import os
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models", "airliner.glb"), "wb").write(out)
print("triangles", len(tris), "bytes", len(out))
