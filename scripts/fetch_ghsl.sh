#!/bin/sh
# Download GHS-POP R2023A, 30 arcsec WGS84, every epoch 1975-2030. Resumable.
set -e
dest="$(dirname "$0")/../data/raw/ghsl"
mkdir -p "$dest"
base="https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A"
for y in 1975 1980 1985 1990 1995 2000 2005 2010 2015 2020 2025 2030; do
  name="GHS_POP_E${y}_GLOBE_R2023A_4326_30ss"
  zip="$dest/${name}_V1_0.zip"
  [ -f "$zip.done" ] && continue
  curl -sS -L -C - --retry 5 -o "$zip" "$base/$name/V1-0/${name}_V1_0.zip"
  touch "$zip.done"
  echo "got $y"
done
