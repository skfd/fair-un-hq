# fair-un-hq

*Fun category.*

## The goal

Work out where the UN headquarters *should* be if it were placed fairly for all of humanity,
and show how that fair spot drifts through history: a live, draggable globe with a year
slider, computing the answer in the browser as you play with it.

The real UN never appears: not New York, not Geneva, Vienna or Nairobi. This is a pure
"where would fair be" page, not a critique of where things are.

This is a playful map, not a policy paper.

## Decided

Settled in a brainstorm (2026-10-24); change on purpose, not by drift.

- **Artifact: a static web page with a globe, run locally for now** (open `index.html`; no
  hosting decided). Python preprocesses population into small binary grids per epoch; plain
  JS plus a globe library does the maths live, so every toy below is interactive rather than
  precomputed. A 0.5° grid is roughly 60k populated cells per epoch, and Weiszfeld's
  algorithm on that runs in milliseconds.
- **Notions of fair, all shown:**
  - **Fairness dial.** Minimise Σ wᵢ·dᵢᵖ (great-circle distance) and let the reader drag p:
    p=1 is the geometric median (least total travel), p≈2 is about the centroid, and p→∞ is
    minimax (the worst-off person as close as possible). The point slides as you drag.
  - **Country vs person.** One country, one vote: the median of the member states (where
    to put each state is still open: capital or its population centroid). Compare it with
    one person, one vote.
  - **k HQs.** The optimal 2, 3 or 4 offices (spherical k-medians), with the world coloured
    by which office each person is closest to. No comparison with real UN offices.
  - **Anti-HQ.** The point farthest on average from all of humanity, framed as the place to
    hold a meeting nobody should attend.
  - **Depth of humanity.** The 3D centre of mass of all people lies inside the Earth; its
    depth below the surface measures how lopsided humanity is, epoch by epoch.
- **Time span: antiquity to 2100.** HYDE for the deep past, GHSL GHS-POP for 1975–2030,
  and something for 2030–2100 (e.g. GHSL 2030 rescaled by UN WPP country projections).
- **Data honesty: fade by confidence.** The trail is solid for observed GHSL epochs, dashed
  for projections and ghostly/dotted for the HYDE past, with the source named on hover.
- **Silly landings: show the raw point and name the nearest town.** A "welcome to your new
  capital" card gives the nearest settlement and a short blurb. A point at sea gets a
  floating HQ barge.
- **Extra toys:**
  - **Weight by…** Urban only or rural only, using GHSL's degree-of-urbanisation layer
    (GHS-SMOD).
  - **Drift speed.** Headline numbers per epoch, like "the HQ would have to crawl N metres
    a day".
  - **Relocation postcard.** A shareable card with the new capital's nearest town, the
    moving date and the drift speed.

## Still open

- **Grid resolution.** Pick the coarsest that does not change the answer. Verify 0.5°
  against 30 arcsec offline, per epoch.
- **Seams between datasets.** HYDE and GHSL overlap in about 1975–2020. Does the fair point
  jump at the handover? If it does, that is a calibration problem to solve or show, not to
  hide.
- **The country-vote point per state.** Use the capital, the population centroid or the
  country's own median? Each gives a different General Assembly point.
- **Minimax at p→∞.** Taken literally it is decided by the remotest few cells (Tristan da
  Cunha, Pitcairn). Clip to, say, 99.9% of people, or keep it and enjoy it?
- **Nearest-town source.** GeoNames cities dump? Wikipedia blurbs need a fetch or a small
  bundled extract, since the page is offline-first.
- **How anyone would know it worked.** The p=1 point should land roughly in South / Central
  Asia or the Middle East and move as Asia and Africa grow. A sudden jump between epochs is
  a bug until proven otherwise.

## Leads (unverified, evaluate before using)

- GHSL data: the JRC GHSL site (ghsl.jrc.ec.europa.eu), GHS-POP (population) and GHS-SMOD
  (degree of urbanisation), epochs 1975–2030 in 5-year steps.
- HYDE (History Database of the Global Environment, PBL / Utrecht University): gridded
  historical population going back to 10,000 BC.
- UN World Population Prospects: country-level projections to 2100.
- "Centre of world population" / "world population centre of gravity" is a known idea with
  earlier estimates. Look into it for prior art and as a comparison.
- Weiszfeld's algorithm (geometric median), adapted to the sphere; iteratively reweighted
  versions handle general p.

## Status

Brainstormed. Nothing built yet.
