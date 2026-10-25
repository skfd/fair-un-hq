# fair-un-hq

*Fun category.*

## The goal

Using the Global Human Settlement Layer (GHSL, from the EU Joint Research Centre), work out
where the UN headquarters *should* be if it were placed fairly for all of humanity — and
show how that fair spot drifts through the years, next to the real HQ in New York.

"Fair" starts as: the point on the globe that minimises the total (or average) great-circle
distance to every person — the geometric median on the sphere, weighted by the GHSL
population grid. Other notions of fair (centroid, minimax "nobody is too far", travel time
rather than distance) may sit alongside it.

GHSL's population grids (GHS-POP) come in epochs from 1975 to 2030 in 5-year steps, which is
what makes "through the years" possible: one fair point per epoch, a trail across the map.

This is a playful map, not a policy paper.

## Open questions

Decided on purpose by whoever builds it, not drifted into:

- **What "fair" means here.** Geometric median (sum of distances), something squared
  (pulled harder by far-away people), minimax (worst-off person), or several shown side by
  side? Distance on the sphere, or something people actually feel — flight time, hops?
- **Land only?** The optimum may land in the sea or somewhere implausible. Snap to the
  nearest land / city, or show the raw point and enjoy it?
- **Which GHSL product and resolution.** GHS-POP at a coarse grid (e.g. 30 arcsec or 1 km,
  or coarser) is probably plenty for a global optimum — pick the coarsest that does not
  change the answer.
- **Projected epochs.** 2025 and 2030 are model projections, not observations — show them
  differently, or stop at the last observed epoch?
- **What the artifact is.** A static map with a trail, an animated GIF, a small web page
  with a year slider, a single striking image for sharing?
- **How anyone would know it worked.** A sanity check worth having: the result should land
  somewhere roughly in South / Central Asia or the Middle East, and move as Asia and Africa
  grow; a sudden jump between epochs is a bug until proven otherwise.

## Leads — unverified, evaluate before using

- GHSL data download: the JRC GHSL site (ghsl.jrc.ec.europa.eu), GHS-POP dataset.
- "Centre of world population" / "world population centre of gravity" is a known idea with
  earlier estimates; worth a look for prior art and to compare against.

## Status

Empty — nothing built yet.
