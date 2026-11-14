# Lunar data sources

This file tracks source provenance for the layers used or planned in Lunar Atlas. Keep the matching source details in the Notion [Data sources & provenance](https://app.notion.com/p/) page and record product-level metadata alongside every processed export.

| Layer | Source | Use | Status and limits |
| --- | --- | --- | --- |
| Global lunar elevation | [LOLA LDEM_16, PDS Geosciences Node](https://pds-geosciences.wustl.edu/missions/lro/lola.htm) | Base elevation for whole-Moon globe | Current global DEM. Record exact product version, grid, units, scale/offset, and no-data behavior. |
| Mid-latitude elevation | [SLDEM2015, NASA Goddard PGDA](https://pgda.gsfc.nasa.gov/products/54) | Optional higher-detail layer combining LOLA with JAXA/SELENE Kaguya Terrain Camera stereo | Coverage is 60°S–60°N; it does not cover Shackleton or the south pole. About 512 px/degree (60 m/px at equator). Citation: Barker et al., *Icarus* 273 (2016), 346–355, [doi:10.1016/j.icarus.2015.07.039](https://doi.org/10.1016/j.icarus.2015.07.039). |
| South-polar elevation | [LOLA products, PDS Geosciences Node](https://pds-geosciences.wustl.edu/missions/lro/lola.htm) | Site-scale terrain and local horizon around candidate regions | Use named LOLA regional products/tiles; log exact footprint and product. Shackleton is a practice tile, not the only candidate. |
| Lunar color | [LROC WAC global products](https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_GLOBAL/) | Whole-Moon texture | Record mosaic version, projection, resolution, and credits. |
| Sun/Earth ephemerides | [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Time-dependent positions and illumination context | [Current generation script](../scripts/prepare-ephemeris.py) uses a 0°N, 0°E lunar observer. Regenerate with site coordinates for local Sun/Earth visibility. Preserve query parameters and UTC coverage. |
| Earth texture | [NASA Blue Marble](https://science.nasa.gov/resource/blue-marble/) | Earth appearance, illuminated by the scene Sun | The linked page describes a 2002 global composite. Preserve the asset's credit and source metadata. |
| Star map | [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851/) | Realistic all-sky background | Derived from Gaia DR2, Hipparcos-2, Tycho-2, and other catalogs. Use the celestial-coordinate version for 3D; document map resolution, epoch, and orientation. |

## Landing-region context

NASA's [October 28, 2024 Artemis III update](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/) lists nine candidate regions: Peak near Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2, and Slater Plain. Each region contains multiple possible landing sites; NASA has not announced a permanent lunar-base site. Shackleton was discussed among earlier candidates but is not in this updated nine-region list.

## Export provenance checklist

For every processed raster or ephemeris export, capture the source product and URL, download date/version, original filename, coordinate reference/projection, spatial bounds, dimensions, resolution and units, no-data handling, scale/offset, resampling/compositing method, processing notebook/script and commit, output filename, checksum, and required credit/citation. Label inferred or visually exaggerated values.