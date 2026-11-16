# Centauri Lunar Atlas — NASA Space Apps 2026 Submission Snapshot

**Project:** Centauri Lunar Atlas  
**Creator:** Weston Rosch (solo)  
**Challenge:** Lunar Landing Site Navigator  
**Event:** NASA Space Apps Mountain View, November 14–15, 2026  
**Submission type:** Seven-slide demo (the optional video must be **30 seconds or shorter**).

## Official links

- **Live interactive application:** https://moon.westonrosch.com/
- **Public seven-slide presentation:** https://westonrosch.com/projects/lunar-atlas/slides/
- **Project description:** https://westonrosch.com/projects/lunar-atlas/
- **Open-source repository:** https://github.com/InterstellarNerd8760/lunar-atlas

## High-level summary

Centauri Lunar Atlas is a browser-based 3D Moon explorer that compares candidate and historic lunar landing sites by how the local terrain affects sunlight and direct line-of-sight visibility to Earth. Using NASA elevation data, lunar imagery, and time-dependent JPL Horizons positions, visitors can inspect the terrain horizon, evaluate a fixed 30-day window, compare up to three locations, and explore the surface in free-flight or Walk mode.

## Detailed project description

Lunar site selection is a terrain problem. At the Moon's poles, even nearby ridges and crater floors can experience very different illumination and direct-to-Earth visibility. Centauri Lunar Atlas renders the Moon with NASA's Lunar Orbiter Laser Altimeter (LOLA) elevation data and Lunar Reconnaissance Orbiter Camera (LROC) imagery, including selected higher-resolution Apollo-site NAC terrain and Goddard PGDA south-polar DEMs.

The application uses precomputed JPL Horizons Sun and Earth positions sampled every six hours from November 14 through December 14, 2026 UTC. It evaluates body centers against modeled terrain horizons and summarizes the sunlight fraction, longest continuous sampled darkness, and Earth visibility for a selected site. A three-site comparison uses the same time window. Visitors can rotate the Moon, navigate to mission sites, adjust terrain relief, inspect source notes and photography, fly over the surface, and enter Walk mode to view the local horizon.

The searchable catalog includes Apollo, Luna, Chang'e, Surveyor and CLPS mission locations, selected south-pole terrain regions, Artemis-associated potential landing-region proxies, and planned CLPS destinations. Future-mission pins use USGS/IAU named-feature centers as **illustrative regional references only**, never as exact NASA-confirmed landing coordinates. Distinct code-generated markers distinguish landed spacecraft, failed attempts, approximate historical coordinates, proposed regions, and terrain landmarks.

The project uses plain JavaScript, three.js, local processed NASA terrain assets, and web-native controls without a build step. It was designed and directed as a solo project over the NASA Space Apps hackathon weekend.

## NASA datasets and sources

- **LRO LOLA:** global LDEM_16, south-polar elevation grids and local PGDA products — https://pds-geosciences.wustl.edu/missions/lro/lola.htm
- **LROC:** WAC imagery and selected NAC digital terrain models — https://lroc.im-ldi.com/ and https://data.lroc.im-ldi.com/
- **NASA Goddard PGDA:** local south-polar 5 m LOLA DEMs — https://pgda.gsfc.nasa.gov/products/78
- **JPL Horizons:** sampled Sun/Earth ephemerides — https://ssd.jpl.nasa.gov/horizons/
- **USGS/IAU Gazetteer:** published feature reference centers — https://planetarynames.wr.usgs.gov/
- Further per-site photography, terrain, licensing and source notes: [docs/data-sources.md](data-sources.md) and [docs/CREDITS.md](CREDITS.md).

## Limitations (required context)

This is an exploratory visualization, **not flight-qualified landing, power-storage or communications analysis**. Global and local terrain resolution varies. The model evaluates approximate body-center visibility using six-hour ephemeris sampling, without partial solar discs, sub-grid obstacles, full energy-balance modeling or validated engineering design. The solar verdict categories are qualitative. Synthetic micro-relief in some regions is visual detail, not measured fine-scale terrain. A future mission's illustrative map pin does not identify an official touchdown point. Shackleton floor is a representative crater-center reference, not a surveyed floor-lowest point.

## AI / super-intelligence disclosure

Weston Rosch led the product concept, feature and visual direction, dataset selection and processing workflow, scientific review, integration decisions, and iterative testing. AI coding assistants, including ChatGPT/Codex and Grok Bot, were used to accelerate code authoring, debugging, technical research, and editorial review. AI assistance was applied to implementation and documentation; NASA and other original datasets remain attributed to their sources. The final application pin sprites are **procedural geometry and CSS**, not generated image assets. Review separately any image added to the demonstration for compliance with NASA Space Apps AI-asset labeling and minor-likeness restrictions.

## Submission checks

- Complete every required English field in **My Team → Project** on the NASA Space Apps portal.
- Provide an externally reachable public demo link (seven slides or **up to 30-second** video), plus public project code/site.
- Explicitly disclose use of NASA data and AI tools.
- Confirm all assets and external links in a logged-out/private browser; do not include images, voice, video or likeness of anyone under 18.
- Accept Terms and Original Work declarations; explicitly click **Submit for Judging** before November 15 at 11:59 PM PST.
- The event emails contain **no mandatory Git tag instruction**. An optional release tag may be created as a reproducible archive after the final commit.

**Submission code snapshot:** see the repository history at the final `main` commit after cache refresh.
