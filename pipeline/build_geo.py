import json, math

SCALE = 22.0
LON0, LAT0 = -176.0, 14.0   # esquina superior izquierda del sistema

def merc_y(lat):
    lat = max(min(lat, 84.0), -84.0)
    return math.degrees(math.log(math.tan(math.pi/4 + math.radians(lat)/2)))

Y0 = merc_y(LAT0)

def proj(lon, lat):
    x = (lon - LON0) * SCALE
    y = (Y0 - merc_y(lat)) * SCALE
    return (x, y)

def dp(pts, eps):
    if len(pts) < 3:
        return pts
    def d(p, a, b):
        (x, y), (x1, y1), (x2, y2) = p, a, b
        dx, dy = x2-x1, y2-y1
        if dx == 0 and dy == 0:
            return math.hypot(x-x1, y-y1)
        t = max(0, min(1, ((x-x1)*dx + (y-y1)*dy)/(dx*dx+dy*dy)))
        return math.hypot(x-(x1+t*dx), y-(y1+t*dy))
    dmax, idx = 0.0, 0
    for i in range(1, len(pts)-1):
        dd = d(pts[i], pts[0], pts[-1])
        if dd > dmax:
            dmax, idx = dd, i
    if dmax > eps:
        return dp(pts[:idx+1], eps)[:-1] + dp(pts[idx:], eps)
    return [pts[0], pts[-1]]

def ring_to_path(ring, eps):
    pts = [proj(c[0], c[1]) for c in ring]
    pts = dp(pts, eps)
    if len(pts) < 4:
        return None, 0.0
    a = 0.0
    for i in range(len(pts)-1):
        a += pts[i][0]*pts[i+1][1] - pts[i+1][0]*pts[i][1]
    area = abs(a)/2
    seg = ["M%.1f %.1f" % pts[0]]
    for p in pts[1:-1]:
        seg.append("L%.1f %.1f" % p)
    seg.append("Z")
    return "".join(seg), area

def centroid(ring):
    pts = [proj(c[0], c[1]) for c in ring]
    a = cx = cy = 0.0
    for i in range(len(pts)-1):
        x1, y1 = pts[i]; x2, y2 = pts[i+1]
        f = x1*y2 - x2*y1
        a += f; cx += (x1+x2)*f; cy += (y1+y2)*f
    if a == 0:
        return pts[0]
    a *= 0.5
    return (cx/(6*a), cy/(6*a))

EPS = 0.32  # unidades SVG

src = json.load(open('peru_dep.geojson'))
out = []
for f in src['features']:
    name = f['properties']['NOMBDEP'].title()
    geom = f['geometry']
    polys = geom['coordinates'] if geom['type'] == 'Polygon' else [p[0] for p in geom['coordinates']]
    if geom['type'] == 'Polygon':
        rings = geom['coordinates']
    else:
        rings = [p[0] for p in geom['coordinates']]
    parts, best_area, best_ring = [], 0.0, None
    for r in rings:
        pth, area = ring_to_path(r, EPS)
        if pth and area > 4:
            parts.append(pth)
            if area > best_area:
                best_area, best_ring = area, r
    if not parts:
        continue
    cx, cy = centroid(best_ring)
    out.append({"n": name, "d": "".join(parts), "c": [round(cx, 1), round(cy, 1)]})

out.sort(key=lambda x: x['n'])

# extents
xs, ys = [], []
for lon, lat in [(-81.4, 0.1), (-68.6, -18.4)]:
    x, y = proj(lon, lat); xs.append(x); ys.append(y)
peru_box = [round(min(xs)-25, 1), round(min(ys)-25, 1), round(max(xs)-min(xs)+50, 1), round(max(ys)-min(ys)+50, 1)]

xs, ys = [], []
for lon, lat in [(-174, 8), (-66, -20)]:
    x, y = proj(lon, lat); xs.append(x); ys.append(y)
pac_box = [round(min(xs), 1), round(min(ys), 1), round(max(xs)-min(xs), 1), round(max(ys)-min(ys), 1)]

def rect(lo1, lo2, la1, la2):
    x1, y1 = proj(lo1, la1); x2, y2 = proj(lo2, la2)
    return [round(min(x1, x2), 1), round(min(y1, y2), 1), round(abs(x2-x1), 1), round(abs(y2-y1), 1)]

data = {
    "deps": out,
    "viewPeru": peru_box,
    "viewPac": pac_box,
    "nino12": rect(-90, -80, 0, -10),
    "nino34": rect(-170, -120, 5, -5),
    "nino3":  rect(-150, -90, 5, -5),
    "nino4":  rect(-160, -150, 5, -5),
}

js = json.dumps(data, separators=(',', ':'))
open('../data/geo/departamentos.json', 'w').write(js)
print("deps:", len(out), "bytes:", len(js))
print("viewPeru", peru_box)
print("viewPac", pac_box)
print("nino12", data['nino12'])
