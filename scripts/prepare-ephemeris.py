import csv
import datetime as dt
import json
from pathlib import Path
import urllib.parse
import urllib.request

def fetch(target):
    args = dict(COMMAND=target, CENTER='coord@301', COORD_TYPE='GEODETIC',
                SITE_COORD='0,0,0', EPHEM_TYPE='OBSERVER', TIME_TYPE='UT',
                START_TIME='2026-11-14', STOP_TIME='2026-12-14',
                STEP_SIZE='6 h', QUANTITIES='4,20', CSV_FORMAT='YES',
                EXTRA_PREC='YES', ANG_FORMAT='DEG', ELEV_CUT='-90')
    url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode(
        {'format':'text', **{k: f"'{v}'" for k,v in args.items()}})
    with urllib.request.urlopen(url, timeout=20) as response:
        result = response.read().decode()
    headers, rows = result.split('$$SOE', 1)
    print(headers.strip().splitlines()[-2:], rows.splitlines()[1])
    data = {}
    for row in csv.reader(rows.split('$$EOE')[0].strip().splitlines()):
        time = dt.datetime.strptime(row[0].strip(), '%Y-%b-%d %H:%M')
        data[time.isoformat(timespec='minutes')+'Z'] = [float(n) for n in row[3:6]]
    return data

sun = fetch('10')
earth = fetch('399')
assert sun.keys() == earth.keys() and len(sun) == 121
with open(Path(__file__).resolve().parents[1] / 'public/data/lunar-ephemeris.json', 'w') as output:
    json.dump(dict(source='NASA/JPL Horizons', observer=dict(longitude=0, latitude=0, altitudeKm=0),
        columns=['UTC','Sun azimuth deg','Sun elevation deg','Sun range au','Earth azimuth deg','Earth elevation deg','Earth range au'],
        samples=[[t,*s,*earth[t]] for t,s in sun.items()]), output, separators=(',', ':'))
