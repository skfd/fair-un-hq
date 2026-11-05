"""Build web/data/blurbs.js: Wikipedia for the new-capital card. Per town, a real sentence and the
article and section links; per country, its article.

    node scripts/build_landings.js                          # which towns the card can name
    .venv/Scripts/python scripts/build_blurbs.py            # fetch what is missing, then write
    .venv/Scripts/python scripts/build_blurbs.py --refresh  # re-fetch everything

Only the towns in landings.json get a sentence: the card follows the solved HQ, so it can only
ever name those, a few percent of towns.js. Towns are matched by GeoNames id through Wikidata (P1566), never by
title, so "Hyderabad" cannot land on the wrong Hyderabad. A town with no English article has no
entry and the card keeps just the joke. One whose first sentence will not fit keeps its links.

Raw answers are cached in data/raw/wikipedia/ (gitignored), so a rerun fetches only what is
missing. The text is CC BY-SA 4.0, unlike the rest of web/data/: see LICENSE-DATA.md. It stays in
its own file for that reason.
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "wikipedia"
GEONAMES = ROOT / "data" / "raw" / "geonames"
OUT = ROOT / "web" / "data"
SPARQL = "https://query.wikidata.org/sparql"
API = "https://en.wikipedia.org/w/api.php"
AGENT = "fair-un-hq/1.0 (https://skfd.github.io/fair-un-hq/) build_blurbs.py"
PREFIX = "window.FAIR = window.FAIR || {};\n"
IDS_PER_QUERY = 400
TITLES_PER_QUERY = 20  # the API's cap for prop=extracts
MAX_CHARS = 200
SECTIONS = [r"history\b", r"geography\b", r"transport"]  # the card's links, in the order of `sec`


def log(*a):
    print(*a, flush=True)


def fetch(url, data=None, headers=None):
    """GET or POST with backoff. Honours Retry-After, which both services send when throttling."""
    for attempt in range(8):
        req = urllib.request.Request(url, data=data, headers={"User-Agent": AGENT, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise
            wait = int(e.headers.get("Retry-After") or 2 ** attempt)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            wait = 2 ** attempt
        log(f"  retrying in {wait}s")
        time.sleep(wait)
    sys.exit(f"FAILED: gave up on {url[:100]}")


def load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def read_towns():
    """The towns in towns.js order, with the GeoNames ids towns.js does not keep."""
    t = (OUT / "towns.js").read_text(encoding="utf-8")
    names = json.loads(re.search(r"^FAIR\.towns = (.*);$", t, re.M).group(1))["name"]
    for dump in ["cities5000", "cities15000"]:
        with zipfile.ZipFile(GEONAMES / f"{dump}.zip") as z:
            rows = [line.split("\t") for line in z.read(dump + ".txt").decode("utf-8").splitlines()]
        rows.sort(key=lambda f: (-int(f[14] or 0), int(f[0])))
        if [f[1] for f in rows] == names:
            log(f"{len(rows):,} towns, matched to GeoNames {dump}")
            return [(f[0], f[1]) for f in rows]
    sys.exit("FAILED: towns.js does not match the raw GeoNames dumps. Run build_towns.py first.")


def read_landings(towns):
    """Indices into towns.js of the towns the card can name."""
    got = load(RAW / "landings.json")
    if got.get("n") != len(towns):
        sys.exit("FAILED: landings.json is missing or out of date. Run scripts/build_landings.js.")
    log(f"{len(got['towns']):,} of them can be landed on")
    return got["towns"]


def fetch_titles(ids, path):
    """GeoNames id -> English Wikipedia title, or None."""
    titles = load(path)
    todo = [i for i in ids if i not in titles]
    log(f"Wikidata: {len(todo):,} ids to look up")
    for n in range(0, len(todo), IDS_PER_QUERY):
        part = todo[n:n + IDS_PER_QUERY]
        values = " ".join(f'"{i}"' for i in part)
        query = (f"SELECT ?gid ?article WHERE {{ VALUES ?gid {{ {values} }} ?i wdt:P1566 ?gid. "
                 "?article schema:about ?i; schema:isPartOf <https://en.wikipedia.org/>. }")
        got = fetch(SPARQL, urllib.parse.urlencode({"query": query}).encode(),
                    {"Accept": "application/sparql-results+json"})
        found = {}
        for b in got["results"]["bindings"]:
            title = urllib.parse.unquote(b["article"]["value"].rsplit("/wiki/", 1)[1]).replace("_", " ")
            gid = b["gid"]["value"]
            found[gid] = min(found.get(gid, title), title)  # an id on two items: pick one, stably
        for i in part:
            titles[i] = found.get(i)
        save(path, titles)
        log(f"  {n + len(part):,}/{len(todo):,}")
        time.sleep(1)
    return titles


def fetch_extracts(titles, path):
    """Title -> the plain text of the article's opening, or None if there is no such page."""
    extracts = load(path)
    todo = sorted({t for t in titles if t not in extracts})
    log(f"Wikipedia: {len(todo):,} articles to read")
    for n in range(0, len(todo), TITLES_PER_QUERY):
        part = todo[n:n + TITLES_PER_QUERY]
        q = dict(action="query", format="json", formatversion="2", prop="extracts", exintro="1",
                 explaintext="1", exsentences="2", exlimit=str(TITLES_PER_QUERY), redirects="1",
                 maxlag="5", titles="|".join(part))
        got = fetch(API, urllib.parse.urlencode(q).encode())
        if "query" not in got:  # a maxlag answer: the servers asked us to wait
            log("  servers busy, waiting")
            time.sleep(10)
            got = fetch(API, urllib.parse.urlencode(q).encode())
        query = got.get("query", {})
        back = {}  # title as finally resolved -> title as asked
        for step in query.get("normalized", []) + query.get("redirects", []):
            back[step["to"]] = back.get(step["from"], step["from"])
        for t in part:
            extracts.setdefault(t, None)
        for page in query.get("pages", []):
            extracts[back.get(page["title"], page["title"])] = page.get("extract")
        if n % (TITLES_PER_QUERY * 50) == 0:
            save(path, extracts)
            log(f"  {n + len(part):,}/{len(todo):,}")
        time.sleep(0.5)
    save(path, extracts)
    return extracts


def fetch_sections(titles, path):
    """Title -> the anchors of SECTIONS in that article, "" where it has none. One request each:
    the API will not batch these."""
    sections = load(path)
    todo = sorted({t for t in titles if t not in sections})
    log(f"Wikipedia: {len(todo):,} tables of contents to read")
    for n, t in enumerate(todo):
        q = dict(action="parse", format="json", formatversion="2", prop="sections", redirects="1",
                 maxlag="5", page=t)
        got = fetch(API + "?" + urllib.parse.urlencode(q))
        if got.get("error", {}).get("code") == "maxlag":
            time.sleep(10)
            got = fetch(API + "?" + urllib.parse.urlencode(q))
        top = [s for s in got.get("parse", {}).get("sections", []) if s["toclevel"] == 1]
        sections[t] = [next((s["anchor"] for s in top if re.match(want, s["line"], re.I)), "")
                       for want in SECTIONS]
        if n % 200 == 0:
            save(path, sections)
            log(f"  {n + 1:,}/{len(todo):,}")
        time.sleep(0.1)
    save(path, sections)
    return sections


def read_countries():
    """ISO code -> GeoNames id, from countryInfo.txt."""
    rows = (GEONAMES / "countryInfo.txt").read_text(encoding="utf-8").splitlines()
    return {f[0]: f[16] for f in (r.split("\t") for r in rows if r and not r.startswith("#"))
            if f[16]}


def strip_brackets(s):
    """Drop (bracketed asides): pronunciations and native spellings, mostly. They nest."""
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"\s*[(\[][^()\[\]]*[)\]]", "", s)
    return s


def first_sentence(extract):
    """The article's opening sentence, tidied, or None if it will not read well on the card."""
    if not extract:
        return None
    s = strip_brackets(extract.split("\n")[0])
    s = re.sub(r"\s+", " ", s).replace(" ,", ",").strip()
    # A full stop ends the sentence unless it follows an initial or a short abbreviation (St., Mt.).
    m = re.search(r"^.*?(?<![A-Z])(?<!\b[A-Z][a-z])(?<!\bNo)[.!?](?=\s+[A-Z\"“]|$)", s)
    s = m.group(0) if m else s
    if len(s) > MAX_CHARS and ", located" in s:  # Russian towns, mostly: drop the directions
        s = s[:s.index(", located")] + "."
    if not s.endswith((".", "!", "?")) or len(s) > MAX_CHARS or len(s) < 20:
        return None
    if " may refer to" in s or " can refer to" in s or "(" in s or ")" in s:
        return None
    return s


def blurbs_js(towns, landings, ids_to_title, extracts, sections, countries):
    index, text, title, sec = [], [], [], []
    for i in landings:
        gid, name = towns[i]
        t = ids_to_title.get(gid)
        if t:
            index.append(i)
            text.append(first_sentence(extracts.get(t)) or "")
            title.append("" if t == name else t)
            sec.append(sections[t])
    body = {"n": len(towns), "i": index, "text": text, "title": title, "sec": sec,
            "countries": countries}
    js = (PREFIX
          + "// From English Wikipedia (https://en.wikipedia.org/), CC BY-SA 4.0: the first sentence "
          + "of each town's article,\n// shortened (see LICENSE-DATA.md). "
          + "Built by scripts/build_blurbs.py. See web/DATA.md.\n"
          + "FAIR.blurbs = " + json.dumps(body, ensure_ascii=False, separators=(",", ":")) + ";\n")
    return js, len(index), sum(1 for s in text if s)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-fetch everything")
    args = ap.parse_args()
    titles_path, extracts_path = RAW / "titles.json", RAW / "extracts.json"
    sections_path = RAW / "sections.json"
    if args.refresh:
        for p in (titles_path, extracts_path, sections_path):
            p.unlink(missing_ok=True)

    towns = read_towns()
    landings = read_landings(towns)
    ids = [towns[i][0] for i in landings]
    country_ids = read_countries()
    ids_to_title = fetch_titles(ids + list(country_ids.values()), titles_path)
    articles = [ids_to_title[i] for i in ids if ids_to_title[i]]
    extracts = fetch_extracts(articles, extracts_path)
    sections = fetch_sections(articles, sections_path)
    countries = {cc: ids_to_title[g] for cc, g in country_ids.items() if ids_to_title[g]}
    js, n, sentences = blurbs_js(towns, landings, ids_to_title, extracts, sections, countries)
    (OUT / "blurbs.js").write_text(js, encoding="utf-8", newline="\n")
    log(f"{n:,} of those have an article, {sentences:,} a usable sentence, "
        f"{len(countries)} countries, "
        f"{len(js.encode('utf-8')):,} bytes")


if __name__ == "__main__":
    main()
