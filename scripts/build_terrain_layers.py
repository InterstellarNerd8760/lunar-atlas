#!/usr/bin/env python3
"""Build the hi-res global grid and the SLDEM2015 regional crops.

Outputs (int16 little-endian, height_m = DN * scale + offset, NaN never used):
  public/data/global-height/global-height-hi.i16 + .json   (LOLA LDEM_16, 5760x2880)
  public/data/site-regions/<id>/<id>-region.i16 + .json    (SLDEM2015 256 ppd -> 160 km aeqd)
  public/data/site-regions/index.json

Only numpy is needed. SLDEM2015 is read with HTTP range requests (one per row),
so nothing larger than a few MB is downloaded per site.
Usage: python3 scripts/build_terrain_layers.py [--ldem path/to/LDEM_16.IMG]
"""
import argparse, datetime, http.client, json, math, os, sys
from concurrent.futures import ThreadPoolExecutor
import threading
import numpy as np

R = 1737400.0
ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
LDEM_URL = 'https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_16.IMG'
SL_HOST = 'imbrium.mit.edu'
SL_PATH = '/DATA/SLDEM2015/GLOBAL/FLOAT_IMG/SLDEM2015_256_60S_60N_000_360_FLOAT.IMG'
SL_PPD, SL_LINES, SL_SAMPLES = 256, 30720, 92160
REGION_SPAN_M = 160_000.0
REGION_PX = 1280                      # 125 m posts
SITES = ['apollo-11', 'apollo-12', 'apollo-14', 'apollo-15', 'apollo-16', 'apollo-17']
CRS_GEO = json.load(open(os.path.join(ROOT, 'global-height', 'global-height.json')))['crsWkt']
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()


def global_hi(ldem):
    raw = np.fromfile(ldem, '<i2').reshape(2880, 5760)
    # LDEM_16 column 0 is centred on 0.03125 E; roll so column 0 starts at 180 W.
    dn = np.roll(raw, 2880, axis=1)
    out = os.path.join(ROOT, 'global-height')
    dn.astype('<i2').tofile(os.path.join(out, 'global-height-hi.i16'))
    h = dn * 0.5
    meta = {
        'source': 'https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_16.IMG',
        'productLabel': 'https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_16.LBL',
        'credit': 'NASA/GSFC LOLA team (LRO LOLA GDR, 16 px/deg)',
        'width': 5760, 'height': 2880,
        'encoding': 'int16-le', 'scale': 0.5, 'offset': 0.0,
        'units': 'm', 'order': 'row-major', 'rowOrder': 'north to south',
        'nodataEncoding': 'none', 'referenceRadiusM': R,
        'globalExtentDegrees': [-180, -90, 180, 90], 'crsWkt': CRS_GEO,
        'affine': [0.0625, 0.0, -180.0, 0.0, -0.0625, 90.0],
        'resampling': 'none (native LDEM_16 posts, longitudes rolled to start at 180 W)',
        'minElevationM': float(h.min()), 'maxElevationM': float(h.max()),
        'processedUtc': now(),
    }
    json.dump(meta, open(os.path.join(out, 'global-height-hi.json'), 'w'), indent=2)
    print('global-hi', dn.shape, meta['minElevationM'], meta['maxElevationM'])


_local = threading.local()

def get_range(start, length):
    for attempt in range(5):
        try:
            conn = getattr(_local, 'conn', None)
            if conn is None:
                conn = _local.conn = http.client.HTTPSConnection(SL_HOST, timeout=60)
            conn.request('GET', SL_PATH, headers={'Range': f'bytes={start}-{start + length - 1}'})
            resp = conn.getresponse()
            body = resp.read()
            if resp.status == 206 and len(body) == length:
                return body
            raise IOError(f'status {resp.status} len {len(body)}')
        except Exception as error:  # reconnect and retry
            _local.conn = None
            if attempt == 4:
                raise
    return None


def aeqd_inverse(lat0, lon0, x, y):
    """Spherical azimuthal equidistant inverse; x east, y north, meters -> deg."""
    p0, l0 = math.radians(lat0), math.radians(lon0)
    rho = np.hypot(x, y)
    c = rho / R
    with np.errstate(invalid='ignore', divide='ignore'):
        lat = np.arcsin(np.cos(c) * math.sin(p0) + np.where(rho > 0, y * np.sin(c) * math.cos(p0) / rho, 0))
        lon = l0 + np.arctan2(x * np.sin(c), rho * math.cos(p0) * np.cos(c) - y * math.sin(p0) * np.sin(c))
    return np.degrees(lat), np.degrees(lon)


def region(site):
    sid, (lat0, lon0) = site['id'], site['centerLatLon']
    done = os.path.join(ROOT, 'site-regions', sid, f'{sid}-region.json')
    if os.path.exists(done) and os.environ.get('REBUILD') != '1':
        meta = json.load(open(done))
        return {k: meta[k] for k in ('siteId', 'siteName', 'width', 'height', 'centerLatLon',
                                       'resolutionM', 'minElevationM', 'maxElevationM')} | {
            'id': sid, 'file': f'{sid}/{sid}-region.i16'}
    half = REGION_SPAN_M / 2
    post = REGION_SPAN_M / REGION_PX
    coords = (np.arange(REGION_PX) + 0.5) * post - half
    xx, yy = np.meshgrid(coords, -coords)          # north row first
    lat, lon = aeqd_inverse(lat0, lon0, xx, yy)
    lon_e = np.mod(lon, 360.0)
    # source pixel coordinates (centre convention)
    fl = (60.0 - lat) * SL_PPD - 0.5
    lon_rel = np.mod(lon_e - lon_e[REGION_PX // 2, REGION_PX // 2] + 180, 360) - 180
    l0, l1 = int(math.floor(fl.min())) - 1, int(math.ceil(fl.max())) + 2
    s_ref = lon_e[REGION_PX // 2, REGION_PX // 2] * SL_PPD - 0.5
    fs_rel = lon_rel * SL_PPD
    s0 = int(math.floor(s_ref + fs_rel.min())) - 1
    s1 = int(math.ceil(s_ref + fs_rel.max())) + 2
    ncols = s1 - s0
    rows = list(range(l0, l1))
    print(sid, 'rows', len(rows), 'cols', ncols, flush=True)

    def fetch_row(line):
        out = np.empty(ncols, '<f4')
        # handle the 0/360 seam by splitting into at most two ranges
        start = s0 % SL_SAMPLES
        first = min(ncols, SL_SAMPLES - start)
        base = line * SL_SAMPLES * 4
        out[:first] = np.frombuffer(get_range(base + start * 4, first * 4), '<f4')
        if first < ncols:
            out[first:] = np.frombuffer(get_range(base, (ncols - first) * 4), '<f4')
        return out

    with ThreadPoolExecutor(16) as pool:
        block = np.stack(list(pool.map(fetch_row, rows))).astype(np.float64) * 1000.0  # km -> m
    fx = s_ref + fs_rel - s0
    fy = fl - l0
    x0 = np.floor(fx).astype(int); y0 = np.floor(fy).astype(int)
    tx = fx - x0; ty = fy - y0
    v = lambda yy_, xx_: block[yy_, xx_]
    h = (v(y0, x0) * (1 - tx) * (1 - ty) + v(y0, x0 + 1) * tx * (1 - ty)
         + v(y0 + 1, x0) * (1 - tx) * ty + v(y0 + 1, x0 + 1) * tx * ty)
    dn = np.clip(np.round(h * 2), -32767, 32767).astype('<i2')
    d = os.path.join(ROOT, 'site-regions', sid)
    os.makedirs(d, exist_ok=True)
    dn.tofile(os.path.join(d, f'{sid}-region.i16'))
    hm = dn * 0.5
    crs = ('PROJCS["unknown",GEOGCS["unknown",DATUM["unknown",SPHEROID["unknown",1737400,0]],'
           'PRIMEM["Reference meridian",0],UNIT["degree",0.0174532925199433]],'
           f'PROJECTION["Azimuthal_Equidistant"],PARAMETER["latitude_of_center",{lat0}],'
           f'PARAMETER["longitude_of_center",{lon0}],PARAMETER["false_easting",0],'
           'PARAMETER["false_northing",0],UNIT["metre",1]]')
    meta = {
        'source': f'https://{SL_HOST}{SL_PATH}',
        'productLabel': f'https://{SL_HOST}{SL_PATH[:-4]}.LBL',
        'credit': 'SLDEM2015, LOLA + SELENE Terrain Camera (Barker et al. 2016), 256 px/deg',
        'siteId': sid, 'siteName': site.get('name', sid),
        'width': REGION_PX, 'height': REGION_PX,
        'encoding': 'int16-le', 'scale': 0.5, 'offset': 0.0,
        'units': 'm', 'order': 'row-major', 'rowOrder': 'north to south',
        'nodataEncoding': 'none', 'referenceRadiusM': R,
        'projection': 'azimuthal equidistant centered on the landing site; x east, y north, meters',
        'crsWkt': crs,
        'affine': [post, 0.0, -half, 0.0, -post, half],
        'extentM': [-half, -half, half, half],
        'centerLatLon': [lat0, lon0], 'resolutionM': post,
        'sourceResolutionM': round(math.pi * R / 180 / SL_PPD, 1),
        'resampling': 'bilinear from 256 ppd simple cylindrical',
        'readMethod': 'http-range per row',
        'minElevationM': float(hm.min()), 'maxElevationM': float(hm.max()),
        'processedUtc': now(),
    }
    json.dump(meta, open(os.path.join(d, f'{sid}-region.json'), 'w'), indent=2)
    print(sid, 'done', meta['minElevationM'], meta['maxElevationM'], flush=True)
    return {k: meta[k] for k in ('siteId', 'siteName', 'width', 'height', 'centerLatLon',
                                   'resolutionM', 'minElevationM', 'maxElevationM')} | {
        'id': sid, 'file': f'{sid}/{sid}-region.i16'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ldem')
    ap.add_argument('--skip-regions', action='store_true')
    a = ap.parse_args()
    if a.ldem:
        global_hi(a.ldem)
    if a.skip_regions:
        return
    catalog = json.load(open(os.path.join(ROOT, 'site-dems', 'index.json')))['sites']
    entries = [region(s) for s in catalog if s['id'] in SITES]
    index = {
        'description': 'SLDEM2015 regional terrain, 160 km azimuthal-equidistant crops around the '
                       'Apollo NAC DTM sites. Blends between the fine site DEM and the global grid.',
        'encoding': 'int16-le', 'scale': 0.5, 'offset': 0.0, 'units': 'm',
        'order': 'row-major', 'rowOrder': 'north to south', 'referenceRadiusM': R,
        'processedUtc': now(), 'regions': entries,
    }
    json.dump(index, open(os.path.join(ROOT, 'site-regions', 'index.json'), 'w'), indent=2)


if __name__ == '__main__':
    main()
