"""Fetch HYDE total and urban population grids (popc, urbc; 5 arcmin) for 10000 BC to 1850 AD.

    .venv/Scripts/python scripts/fetch_hyde.py                    # HYDE 3.3, up to 1850
    .venv/Scripts/python scripts/fetch_hyde.py --upto 2023
    .venv/Scripts/python scripts/fetch_hyde.py --vars popc        # total population only
    .venv/Scripts/python scripts/fetch_hyde.py --release 3.2.1    # the DANS fallback

Utrecht's own copy (public.yoda.uu.nl, geo.public.data.uu.nl) sits behind an Anubis bot
wall, so both releases come from mirrors:

- 3.3 (default): a Kaggle re-upload of the Utrecht YODA vault, kaggle.com/datasets/
  ilyenkov/hyde-3-3. It is third-party, but it carries YODA's own metadata and readme, and its
  txt/popc_r.txt is byte-identical to the copy datahub.io republishes. The per-file download
  endpoint needs no Kaggle account.
- 3.2.1: the DANS Data Station Archaeology deposit, doi:10.17026/DANS-25G-GEZ3, file
  HYDE3_2_1-baseline.zip (5.3 GB). DANS serves it with HTTP range support, so this pulls only
  the wanted grids out of the zip. The zip uses Deflate64, which the stdlib zipfile can list but
  not inflate; the `inflate64` package does the inflating.

ISIMIP3a histsoc, which the build uses from 1850, cites HYDE 3.2. Its 1850 total is 1290 M,
against 1287 M for HYDE 3.3 and 1271 M for 3.2.1.

Each grid is written gzipped as data/raw/hyde/<release>/<var>_<year>.asc.gz (year negative for
BC). rasterio reads these via /vsigzip/, and numpy.loadtxt reads them directly.
"""
import argparse
import gzip
import io
import re
import struct
import sys
import time
import urllib.parse
import urllib.request
import zipfile
import zlib
from pathlib import Path

KAGGLE = "https://www.kaggle.com/api/v1/datasets/download/ilyenkov/hyde-3-3/"
DANS = "https://archaeology.datastations.nl/api/access/datafile/5490328"
RAW = Path(__file__).resolve().parent.parent / "data" / "raw" / "hyde"
GRID = re.compile(r"baseline/asc/\d+(AD|BC)_pop/([a-z]+)_(\d+)(AD|BC)\.asc$")


def hyde_years():
    """HYDE's time steps: millennia, then centuries, then decades, then (3.3) years."""
    return ([*range(-10000, 0, 1000)] + [*range(0, 1700, 100)] + [*range(1700, 1950, 10)]
            + [*range(1950, 2024)])


def tag(year):
    return f"{-year}BC" if year < 0 else f"{year}AD"


def get(url, start=None, end=None):
    headers = {"Range": f"bytes={start}-{end}"} if start is not None else {}
    for attempt in range(5):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=headers),
                                          timeout=300).read()
        except OSError:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def save(out, data):
    part = out.with_suffix(".part")
    with gzip.open(part, "wb", compresslevel=6) as f:
        f.write(data)
    part.replace(out)
    print(f"got {out.name}  ({len(data) / 1e6:.0f} MB raw)")


def fetch_kaggle(wanted, dest):
    for var, year in wanted:
        out = dest / f"{var}_{year}.asc.gz"
        if out.exists():
            continue
        path = f"hyde/base/{tag(year)}_pop/{var}_{tag(year)}.asc"
        data = get(KAGGLE + urllib.parse.quote(path, safe=""))
        if not data.startswith(b"ncols"):
            raise ValueError(f"{path}: not an ASCII grid")
        save(out, data)


class Ranged(io.RawIOBase):
    """Just enough of a file over HTTP ranges for zipfile to read the central directory."""

    def __init__(self, url, size):
        self.url, self.size, self.pos = url, size, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        d = get(self.url, self.pos, min(self.pos + len(b), self.size) - 1)
        b[: len(d)] = d
        self.pos += len(d)
        return len(d)


def resolve_dans():
    """The access URL redirects to a presigned S3 URL that expires after an hour."""
    r = urllib.request.urlopen(urllib.request.Request(DANS, headers={"Range": "bytes=0-0"}))
    return r.url, int(r.headers["Content-Range"].split("/")[1])


def extract(url, zi):
    import inflate64

    head = get(url, zi.header_offset, zi.header_offset + 29)
    name_len, extra_len = struct.unpack("<HH", head[26:30])
    start = zi.header_offset + 30 + name_len + extra_len
    raw = get(url, start, start + zi.compress_size - 1)
    if zi.compress_type == zipfile.ZIP_DEFLATED:
        data = zlib.decompress(raw, -15)
    elif zi.compress_type == 9:
        data = inflate64.Inflater().inflate(raw)
    else:
        raise ValueError(f"{zi.filename}: compression method {zi.compress_type}")
    if len(data) != zi.file_size or zlib.crc32(data) != zi.CRC:
        raise ValueError(f"{zi.filename}: size or CRC mismatch")
    return data


def fetch_dans(wanted, dest):
    url, size = resolve_dans()
    with zipfile.ZipFile(io.BufferedReader(Ranged(url, size), 1 << 20)) as z:
        members = {}
        for zi in z.infolist():
            m = GRID.search(zi.filename)
            if m:
                members[m.group(2), int(m.group(3)) * (-1 if m.group(4) == "BC" else 1)] = zi
    resolved_at = time.time()
    for key in wanted:
        out = dest / f"{key[0]}_{key[1]}.asc.gz"
        if out.exists() or key not in members:
            continue
        if time.time() - resolved_at > 45 * 60:
            url, _ = resolve_dans()
            resolved_at = time.time()
        save(out, extract(url, members[key]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", choices=["3.3", "3.2.1"], default="3.3")
    ap.add_argument("--upto", type=int, default=1850, help="last year to fetch (default 1850)")
    ap.add_argument("--vars", default="popc,urbc", help="HYDE grids to fetch (default popc,urbc)")
    args = ap.parse_args()
    dest = RAW / args.release
    dest.mkdir(parents=True, exist_ok=True)
    years = [y for y in hyde_years() if y <= args.upto]
    if args.release == "3.2.1":
        years = [y for y in years if y <= 2017]
    wanted = [(v, y) for v in args.vars.split(",") for y in years]
    print(f"HYDE {args.release}: {args.vars} for {len(years)} steps up to {args.upto}")
    (fetch_kaggle if args.release == "3.3" else fetch_dans)(wanted, dest)


if __name__ == "__main__":
    sys.exit(main())
