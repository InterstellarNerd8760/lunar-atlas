"""Build the search index from the Gazetteer's Moon center-point shapefile.

Download MOON_nomenclature_center_pts.zip from
https://planetarynames.wr.usgs.gov/Page/MOON/target, then pass it as the argument.
"""
import argparse
import json
import math
from pathlib import Path
import zipfile


def read_rows(data):
    header_size = int.from_bytes(data[8:10], "little")
    row_size = int.from_bytes(data[10:12], "little")
    fields = {}
    offset = 1
    for index in range(32, header_size - 1, 32):
        name = data[index:index + 11].split(bytes(1), 1)[0].decode("ascii")
        width = data[index + 16]
        fields[name] = slice(offset, offset + width)
        offset += width
    count = int.from_bytes(data[4:8], "little")
    for index in range(count):
        start = header_size + index * row_size
        row = data[start:start + row_size]
        if row[:1] != b"*":
            yield {name: row[field].strip().decode("utf-8") for name, field in fields.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    with zipfile.ZipFile(args.archive) as archive:
        data = archive.read("MOON_nomenclature_center_pts.dbf")
    features = []
    types = []
    for row in read_rows(data):
        if row["approval"] != "Adopted by IAU" or not row["name"]:
            continue
        lat = float(row["center_lat"])
        lon = float(row["center_lon"])
        if not -90 <= lat <= 90 or not math.isfinite(lon):
            continue
        feature_type = row["type"].split(",")[0]
        if feature_type not in types:
            types.append(feature_type)
        features.append([
            row["name"], round(lat, 4), round((lon + 180) % 360 - 180, 4),
            round(float(row["diameter"] or 0), 3),
            types.index(feature_type), int(row["link"].rsplit("/", 1)[-1]),
        ])
    features.sort(key=lambda feature: (feature[0].casefold(), feature[-1]))
    output = Path(__file__).resolve().parents[1] / "public/data/lunar-names.json"
    with output.open("w", encoding="utf-8") as file:
        file.write('{"types":' + json.dumps(types, ensure_ascii=False) + ',"features":[\n')
        file.write(",\n".join(json.dumps(feature, ensure_ascii=False, separators=(",", ":")) for feature in features))
        file.write("\n]}\n")
    print(f"Indexed {len(features)} features")


if __name__ == "__main__":
    main()
