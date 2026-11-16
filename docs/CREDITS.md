# Credits

## Site photographs

Photographs in `public/data/site-photos/` appear in the site drawer. Captions, credit lines, licenses, and source URLs for every image are also recorded in `public/data/site-photos/index.json`.

### NASA/JSC Apollo surface photographs

Public domain (NASA media).

| File | Photograph | Credit |
| --- | --- | --- |
| `apollo-11.jpg` | Buzz Aldrin at Tranquility Base (AS11-40-5903) | NASA/JSC |
| `apollo-12.jpg` | An Apollo 12 astronaut beside the flag (AS12-47-6897) | NASA/JSC |
| `apollo-14.jpg` | Lunar Module Antares at Fra Mauro (AS14-66-9306) | NASA/JSC |
| `apollo-15.jpg` | James Irwin at the Lunar Roving Vehicle (AS15-86-11603) | NASA/JSC |
| `apollo-16.jpg` | John Young salutes the flag at Descartes (AS16-113-18339) | NASA/JSC |
| `apollo-17.jpg` | Harrison Schmitt beside the flag at Taurus-Littrow (AS17-134-20384) | NASA/JSC |
| `surveyor-3.jpg` | Alan Bean with Surveyor 3; Intrepid on the horizon (AS12-48-7136) | NASA/JSC |

Sources: [images.nasa.gov](https://images.nasa.gov/).

### LROC NAC lander views and Artemis region mosaics

Public domain (NASA/LROC). Credit requested as NASA/GSFC/Arizona State University.

These include LROC Narrow Angle Camera views of Surveyor 1, 5, 6, and 7; Luna 16, 17, 20, 21, 23, and 24; Chang'e 3, 4, 5, and 6; Chandrayaan-3; SLIM; IM-1 Odysseus; IM-2 Athena; and Blue Ghost Mission 1, plus low-Sun NAC mosaics or featured NAC views of the Artemis candidate regions Peak near Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, and de Gerlache Rim.

Featured-image pages are on [lroc.im-ldi.com](https://lroc.im-ldi.com/images). Region mosaics are LROC NAC ROI products from [data.lroc.im-ldi.com](https://data.lroc.im-ldi.com/). Luna 13 uses a crop of the bundled LROC WAC EMP mosaic around a historical (not LROC-confirmed) coordinate, because no clearly licensed surface photograph was available.

### Other NASA media

| File | Photograph | Credit | License |
| --- | --- | --- | --- |
| `luna-9.jpg` | First photograph from the lunar surface, 3 February 1966 | National Space Science Data Center / Luna 9 (USSR), hosted by NASA | NASA-hosted historical image; original USSR image rights not independently verified |
| `artemis3-slater-plain.jpg` | Official map of the nine Artemis III candidate landing regions, including Slater Plain, on an LRO WAC mosaic | NASA (background: LRO WAC mosaic, NASA/GSFC/Arizona State University) | Public domain (NASA media) |

Sources: [First Photo from the Surface of the Moon](https://science.nasa.gov/resource/first-photo-from-the-surface-of-the-moon/) and [NASA Provides Update on Artemis III Moon Landing Regions](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/).

## Named lunar features

Names and coordinates in `public/data/features.json` come from the IAU Working Group for Planetary System Nomenclature, as published in the [USGS Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/). The gazetteer is public domain. This copy was trimmed from the Moon center-point shapefile (LOLA 2011 control network) at [planetarynames.wr.usgs.gov/GIS_Downloads](https://planetarynames.wr.usgs.gov/GIS_Downloads).

Carroll is a proposed name from the Artemis II crew, not an official IAU name. Its location (18.633° N, 86.533° W) and 6 km diameter are from NASA SVS, [How to See the Proposed Carroll Crater](https://svs.gsfc.nasa.gov/5646). NASA also reported the proposal, still to be submitted to the IAU, in [NASA’s Artemis II Crew Eclipses Record for Farthest Human Spaceflight](https://www.nasa.gov/news-release/nasas-artemis-ii-crew-eclipses-record-for-farthest-human-spaceflight/).

## Externally hosted supplemental images (not bundled)

The 37 primary site photographs remain local; the `additionalImage` metadata adds third-party images as credited secondary references. **Hosting and citation are not guarantees of unrestricted reuse.** External embeds may fail independently of the application; the NASA/LROC primary photograph remains available.

- **Blue Ghost 1:** Firefly Aerospace flight/descent photo, [mission source](https://fireflyspace.com/news/blue-ghost-mission-1-live-updates/).
- **IM-1 / IM-2:** actual Intuitive Machines spacecraft photographs, from the [IM-1 mission](https://www.intuitivemachines.com/im-1) and [IM-2 mission](https://www.intuitivemachines.com/im-2) or original partner releases. Athena is pictured **before launch**, not after touchdown.
- **Chang'e 3, 4, 5 and 6:** original CNSA/CAS mission images, some displayed via news and [The Planetary Society](https://www.planetary.org/space-images/change-3-lander-in-the-distance). See each image's exact credit and source URL in `public/data/site-photos/index.json`.
- **2024 Artemis-associated candidate regions:** a [Blue Origin Blue Moon HLS artist concept](https://www.blueorigin.com/blue-moon). This is broad HLS **context**, not an image of a specific region or a selected lander; NASA's October 2026 Artemis program updates changed Artemis III to a 2027 LEO test.

Classify images precisely: LROC orbital observation, actual spacecraft/hardware photo, actual lunar surface image, or labeled *artist's concept*. None of the external images are AI-generated by this project. NASA and commercial logos/artwork must not be presented as project branding or endorsement.
