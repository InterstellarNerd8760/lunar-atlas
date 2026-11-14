# Lunar Atlas

A browser-based Moon explorer for comparing sunlight and Earth visibility at lunar sites.

## Local development

Run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000`.

- `src/` contains the browser entry point, Moon scene module, and styles.
- `notebooks/` is for offline terrain processing in Colab or Kaggle.
- `data/raw/` and `data/work/` are local folders for downloads and intermediate files.
- `public/data/` holds processed assets the browser can load.
- `docs/data-sources.md` records planned inputs and asset provenance.


## Show the global LOLA terrain

Unzip `global-height.zip` into `public/data/`. The folder should contain `global-height.f32` and `global-height.json`. Then start the local server from the repository root. The viewer builds a reduced mesh from the elevation grid and applies a labeled ×6 visual relief exaggeration.

The WAC texture notebook is [`notebooks/prepare-wac-texture.ipynb`](notebooks/prepare-wac-texture.ipynb). Run it in Colab, download `wac-texture.jpg`, and place it beside the LOLA files in `public/data/`. The Three.js viewer uses the texture when that file is present and otherwise keeps the grayscale terrain view.
