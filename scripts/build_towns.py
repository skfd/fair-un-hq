"""Build web/data/towns.js and web/data/capitals.js from GeoNames, and (with --vendor) refresh
the vendored JS libraries and world topojson under web/vendor/.

    .venv/Scripts/python scripts/build_towns.py            # towns + capitals
    .venv/Scripts/python scripts/build_towns.py --vendor   # ...and web/vendor/
    .venv/Scripts/python scripts/build_towns.py --refresh  # re-download everything

Raw downloads go to data/raw/geonames/ and data/raw/npm/ (gitignored). They are read
as data only. See web/DATA.md, section "data/towns.js and data/capitals.js", for the contract.

Towns: the denser cities5000 dump (every place over 5000 people, plus capitals) is preferred, so
the nearest-town card still finds something in deserts and steppe; cities15000 is the fallback
if towns.js would exceed MAX_TOWNS_BYTES. Towns are sorted by population, largest first.

Capitals: exactly the 193 UN member states. The rule is GeoNames' own PPLC (the official /
constitutional capital), with an explicit override table for where GeoNames has none. Every
country with more than one claimant capital is commented in CAPITAL_NOTES below.
"""
import argparse
import base64
import io
import json
import math
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "geonames"
RAW_NPM = ROOT / "data" / "raw" / "npm"
OUT = ROOT / "web" / "data"
VENDOR = ROOT / "web" / "vendor"
GEONAMES = "https://download.geonames.org/export/dump/"
JSDELIVR = "https://cdn.jsdelivr.net/npm/"
MAX_TOWNS_BYTES = 3_000_000
PREFIX = "window.FAIR = window.FAIR || {};\n"

# The 193 UN member states, ISO 3166-1 alpha-2. Not included: observers (PS Palestine,
# VA Holy See) and non-members (TW Taiwan, XK Kosovo).
UN_MEMBERS = """
AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH
CM CA CF TD CL CN CO KM CG CR CI HR CU CY CZ KP CD DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ
FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI
KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA
NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA KR RO RU RW KN LC VC WS SM ST
SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV
UG UA AE GB US UY UZ VU VE VN YE ZM ZW
""".split()

# Capitals where GeoNames has no PPLC, as cc -> GeoNames geonameid (looked up in the dumps).
CAPITAL_OVERRIDES = {
    # Israel: GeoNames codes no PPLC for IL. Jerusalem's status is internationally disputed;
    # we follow where most embassies sit and use Tel Aviv (owner's call, 2026-10-24).
    "IL": 293397,  # Tel Aviv
}

# Countries with more than one claimant capital. All of these take GeoNames' PPLC (the official
# or constitutional capital), noted here with the alternative so the choice is on purpose.
CAPITAL_NOTES = {
    "NL": "Amsterdam (constitutional capital); The Hague is the seat of government.",
    "BO": "Sucre (constitutional capital); La Paz is the seat of government.",
    "ZA": "Pretoria (executive); Cape Town is legislative, Bloemfontein judicial.",
    "CI": "Yamoussoukro (official since 1983); Abidjan is the de facto seat of government.",
    "BJ": "Porto-Novo (official); Cotonou is the seat of government.",
    "SZ": "Mbabane (executive); Lobamba is the royal and legislative capital.",
    "MY": "Kuala Lumpur (official); Putrajaya is the administrative centre.",
    "LK": "Colombo (GeoNames' PPLC, executive and commercial); Sri Jayawardenepura Kotte is "
          "the legislative capital.",
    "TZ": "Dodoma (official); Dar es Salaam still hosts much of government.",
    "BI": "Gitega (political capital since 2019); Bujumbura is the economic capital.",
    "GQ": "Ciudad de la Paz (GeoNames' PPLC, the new capital decreed to replace Malabo; "
          "a few thousand people). Malabo is the old capital.",
    "CH": "Bern (federal city; Switzerland has no de jure capital).",
    "NR": "Yaren (Nauru has no official capital; Yaren district hosts parliament).",
    "PW": "Ngerulmud (capital since 2006; Koror is the largest town).",
    "FM": "Palikir (capital; Kolonia is the largest town nearby).",
    "KI": "Tarawa (South Tarawa / Bairiki).",
    "TV": "Funafuti (the atoll; Vaiaku is the administrative village).",
    "CL": "Santiago; the National Congress sits in Valparaiso.",
    "ME": "Podgorica; Cetinje is the old royal capital.",
    "YE": "Sanaa (constitutional); the recognised government has worked from Aden.",
    "SD": "Khartoum; the government moved to Port Sudan during the war.",
    "IL": "Tel Aviv (override, see CAPITAL_OVERRIDES).",
}


def log(*a):
    print(*a, flush=True)


def download(url, dest, refresh=False):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not refresh:
        return dest
    log(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "fair-un-hq build_towns.py"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    return dest


def read_country_info(path):
    countries = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        f = line.split("\t")
        countries[f[0]] = f[4]
    return countries


def read_cities(zpath):
    """GeoNames cities dump -> list of dicts (only the columns we use)."""
    name = zpath.stem + ".txt"
    with zipfile.ZipFile(zpath) as z:
        text = z.read(name).decode("utf-8")
    rows = []
    for line in text.splitlines():
        f = line.split("\t")
        rows.append({
            "id": int(f[0]), "name": f[1], "lat": float(f[4]), "lon": float(f[5]),
            "fcode": f[7], "cc": f[8], "pop": int(f[14] or 0),
        })
    return rows


def b64_f32(values):
    return base64.b64encode(np.asarray(values, dtype="<f4").tobytes()).decode("ascii")


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def towns_js(rows, countries):
    rows = sorted(rows, key=lambda r: (-r["pop"], r["id"]))
    towns = {
        "name": [r["name"] for r in rows],
        "cc": [r["cc"] for r in rows],
        "lat": b64_f32([r["lat"] for r in rows]),
        "lon": b64_f32([r["lon"] for r in rows]),
        "pop": [r["pop"] for r in rows],
    }
    used = sorted({r["cc"] for r in rows} | set(countries))
    ctry = {cc: countries.get(cc, cc) for cc in used}
    return (PREFIX
            + "// GeoNames (https://www.geonames.org/), CC BY 4.0. Built by scripts/build_towns.py.\n"
            + "FAIR.towns = " + dumps(towns) + ";\n"
            + "FAIR.countries = " + dumps(ctry) + ";\n")


def check_un_list(countries):
    s = set(UN_MEMBERS)
    assert len(UN_MEMBERS) == 193 and len(s) == 193, f"UN list has {len(UN_MEMBERS)} / {len(s)}"
    assert not s & {"TW", "XK", "PS", "VA"}, "observer or non-member in UN list"
    missing = s - set(countries)
    assert not missing, f"UN codes not in countryInfo: {sorted(missing)}"
    return sorted(set(countries) - s)


def pick_capitals(dumps_by_name, countries):
    by_id = {}
    pplc = {}
    for rows in dumps_by_name:  # densest last, so its rows win; they're the same records
        for r in rows:
            by_id[r["id"]] = r
            if r["fcode"] == "PPLC":
                pplc.setdefault(r["cc"], {})[r["id"]] = r
    out, problems = [], []
    for cc in sorted(UN_MEMBERS, key=lambda c: countries[c]):
        if cc in CAPITAL_OVERRIDES:
            r = by_id.get(CAPITAL_OVERRIDES[cc])
            if r is None:
                problems.append(f"{cc}: override geonameid {CAPITAL_OVERRIDES[cc]} not found")
                continue
        else:
            cands = list(pplc.get(cc, {}).values())
            if len(cands) != 1:
                problems.append(f"{cc} {countries[cc]}: {len(cands)} PPLC rows "
                                f"{[c['name'] for c in cands]}")
                continue
            r = cands[0]
        out.append({"cc": cc, "country": countries[cc], "city": r["name"],
                    "lat": round(r["lat"], 5), "lon": round(r["lon"], 5)})
    if problems:
        sys.exit("FAILED: capitals missing or ambiguous:\n  " + "\n  ".join(problems))
    assert len(out) == 193 and len({c["cc"] for c in out}) == 193
    return out


def capitals_js(caps):
    lines = [PREFIX,
             "// Capitals of the 193 UN member states. GeoNames (https://www.geonames.org/), "
             "CC BY 4.0.\n// Rule and per-country choices: see scripts/build_towns.py.\n",
             "FAIR.capitals = [\n"]
    lines += ["  " + dumps(c) + ",\n" for c in caps]
    lines.append("];\n")
    return "".join(lines)


# --- self-check, against the files as written -------------------------------------------------

def load_js_assign(text, name):
    m = re.search(r"^FAIR\." + name + r" = (.*);$", text, re.M)
    return json.loads(m.group(1)) if m else None


def haversine_km(lat1, lon1, lat2, lon2):
    la1, lo1, la2, lo2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def self_check():
    t = (OUT / "towns.js").read_text(encoding="utf-8")
    towns = load_js_assign(t, "towns")
    ctry = load_js_assign(t, "countries")
    lat = np.frombuffer(base64.b64decode(towns["lat"]), dtype="<f4").astype(float)
    lon = np.frombuffer(base64.b64decode(towns["lon"]), dtype="<f4").astype(float)
    n = len(towns["name"])
    assert len(towns["cc"]) == len(towns["pop"]) == len(lat) == len(lon) == n
    c = (OUT / "capitals.js").read_text(encoding="utf-8")
    caps = json.loads(c[c.index("[", c.index("FAIR.capitals")):c.rindex("]") + 1].replace(",\n]", "\n]"))
    assert len(caps) == 193 and len({x["cc"] for x in caps}) == 193
    log("\nself-check")
    log(f"  towns.js     {(OUT / 'towns.js').stat().st_size:>10,} bytes, {n:,} towns, "
        f"{len(ctry)} countries")
    log(f"  capitals.js  {(OUT / 'capitals.js').stat().st_size:>10,} bytes, {len(caps)} capitals")
    for qlat, qlon, expect in [(30.52, 76.50, "Punjab/Haryana, India"),
                               (25.9, 48.7, "Saudi Arabia")]:
        d = haversine_km(qlat, qlon, lat, lon)
        i = int(np.argmin(d))
        log(f"  nearest to {qlat}, {qlon} (expect {expect}): {towns['name'][i]}, "
            f"{ctry.get(towns['cc'][i], towns['cc'][i])} (pop {towns['pop'][i]:,}), "
            f"{d[i]:.1f} km")
    # A sparse probe, for a feel of how far the card may have to reach.
    d = haversine_km(23.0, 25.0, lat, lon)  # central Libyan desert
    i = int(np.argmin(d))
    log(f"  nearest to 23.0, 25.0 (Libyan desert): {towns['name'][i]}, "
        f"{ctry.get(towns['cc'][i])}, {d[i]:.0f} km")


# --- vendored libraries ----------------------------------------------------------------------

def npm_version(pkg, major, refresh):
    p = download(f"{JSDELIVR}{pkg}@{major}/package.json", RAW_NPM / f"{pkg}-package.json", refresh)
    return json.loads(p.read_text(encoding="utf-8"))["version"]


def vendor(refresh):
    VENDOR.mkdir(parents=True, exist_ok=True)
    v = {pkg: npm_version(pkg, major, refresh)
         for pkg, major in [("d3", 7), ("topojson-client", 3), ("world-atlas", 2)]}
    log(f"vendoring {v}")
    download(f"{JSDELIVR}d3@{v['d3']}/dist/d3.min.js", VENDOR / "d3.min.js", True)
    download(f"{JSDELIVR}topojson-client@{v['topojson-client']}/dist/topojson-client.min.js",
             VENDOR / "topojson-client.min.js", True)
    wa = f"{JSDELIVR}world-atlas@{v['world-atlas']}/"
    world = json.loads(download(wa + "countries-50m.json", RAW_NPM / "countries-50m.json",
                                refresh).read_text(encoding="utf-8"))
    land = json.loads(download(wa + "land-50m.json", RAW_NPM / "land-50m.json",
                               refresh).read_text(encoding="utf-8"))
    assert world.get("type") == "Topology" and land.get("type") == "Topology"
    (VENDOR / "world-50m.js").write_text(
        PREFIX + f"// world-atlas@{v['world-atlas']} (Natural Earth 1:50m, public domain).\n"
        + "FAIR.world = " + dumps(world) + ";\nFAIR.land = " + dumps(land) + ";\n",
        encoding="utf-8", newline="\n")
    lic = {}
    for pkg in v:
        lic[pkg] = download(f"{JSDELIVR}{pkg}@{v[pkg]}/LICENSE", RAW_NPM / f"{pkg}-LICENSE",
                            refresh).read_text(encoding="utf-8").strip()
    md = f"""# Third-party licences

Everything under `web/vendor/` and the generated `web/data/towns.js` and `web/data/capitals.js`
comes from the projects below. Refresh with `scripts/build_towns.py --vendor`.

## d3 {v['d3']} (`d3.min.js`)

From {JSDELIVR}d3@{v['d3']}/dist/d3.min.js. ISC licence:

```
{lic['d3']}
```

## topojson-client {v['topojson-client']} (`topojson-client.min.js`)

From {JSDELIVR}topojson-client@{v['topojson-client']}/dist/topojson-client.min.js. Licence:

```
{lic['topojson-client']}
```

## world-atlas {v['world-atlas']} (`world-50m.js`)

`countries-50m.json` and `land-50m.json` from {wa}, wrapped as JS so the page can load them
over file://. The world-atlas package licence:

```
{lic['world-atlas']}
```

The geometry is derived from [Natural Earth](https://www.naturalearthdata.com/) 1:50m data,
which is in the public domain ("Made with Natural Earth. Free vector and raster map data @
naturalearthdata.com.").

## GeoNames (`web/data/towns.js`, `web/data/capitals.js`)

Town names, coordinates, populations, capitals and country names come from the
[GeoNames](https://www.geonames.org/) geographical database dumps
(https://download.geonames.org/export/dump/), licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

Attribution: "Contains data from GeoNames (www.geonames.org), licensed under CC BY 4.0."
The data was filtered (UN member states, one capital each) and re-encoded.
"""
    (VENDOR / "LICENSES.md").write_text(md, encoding="utf-8", newline="\n")
    for f in ["d3.min.js", "topojson-client.min.js", "world-50m.js", "LICENSES.md"]:
        log(f"  web/vendor/{f:24} {(VENDOR / f).stat().st_size:>10,} bytes")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download raw files")
    ap.add_argument("--vendor", action="store_true", help="also refresh web/vendor/")
    args = ap.parse_args()

    log("downloading GeoNames dumps")
    files = {n: download(GEONAMES + n, RAW / n, args.refresh)
             for n in ["countryInfo.txt", "cities15000.zip", "cities5000.zip", "cities1000.zip"]}
    countries = read_country_info(files["countryInfo.txt"])
    not_un = check_un_list(countries)
    log(f"UN list: 193 codes; countryInfo has {len(countries)}; not UN members: {' '.join(not_un)}")

    dumps_rows = {n: read_cities(files[n + ".zip"]) for n in ["cities15000", "cities5000", "cities1000"]}
    chosen = None
    for n in ["cities5000", "cities15000"]:
        js = towns_js(dumps_rows[n], countries)
        size = len(js.encode("utf-8"))
        log(f"  towns.js from {n}: {len(dumps_rows[n]):,} towns, {size:,} bytes")
        if size <= MAX_TOWNS_BYTES:
            chosen = n
            break
    if chosen is None:
        sys.exit(f"FAILED: even cities15000 exceeds {MAX_TOWNS_BYTES:,} bytes")
    log(f"chose {chosen}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "towns.js").write_text(js, encoding="utf-8", newline="\n")

    caps = pick_capitals([dumps_rows["cities1000"], dumps_rows["cities5000"],
                          dumps_rows["cities15000"]], countries)
    (OUT / "capitals.js").write_text(capitals_js(caps), encoding="utf-8", newline="\n")
    log("capital notes (multi-capital countries and overrides):")
    by_cc = {c["cc"]: c for c in caps}
    for cc, note in CAPITAL_NOTES.items():
        log(f"  {cc} {by_cc[cc]['city']:18} {note}")

    if args.vendor:
        vendor(args.refresh)
    self_check()


if __name__ == "__main__":
    main()
