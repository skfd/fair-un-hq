#!/bin/sh
# ISIMIP gridded population, 30 arcmin: HYDE-based history 1850-2021 and SSP1/3/5 to 2100.
set -e
dest="$(dirname "$0")/../data/raw/isimip"
mkdir -p "$dest"
b="https://files.isimip.org"
for p in \
  ISIMIP3a/InputData/socioeconomic/pop/histsoc/population_histsoc_30arcmin_annual_1850_1900.nc \
  ISIMIP3a/InputData/socioeconomic/pop/histsoc/population_histsoc_30arcmin_annual_1901_2021.nc \
  ISIMIP3b/InputData/socioeconomic/pop/ssp126soc-noadapt/population_ssp1_30arcmin_annual_2015_2100.nc \
  ISIMIP3b/InputData/socioeconomic/pop/ssp370soc-noadapt/population_ssp3_30arcmin_annual_2015_2100.nc \
  ISIMIP3b/InputData/socioeconomic/pop/ssp585soc-noadapt/population_ssp5_30arcmin_annual_2015_2100.nc
do
  f="$dest/$(basename "$p")"
  [ -f "$f.done" ] && continue
  curl -sS -L -C - --retry 5 -o "$f" "$b/$p"
  touch "$f.done"
  echo "got $(basename "$p")"
done
