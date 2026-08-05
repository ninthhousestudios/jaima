# ജയ്മാ.com

Devotional site dedicated to Amma. Digital temple, not a blog or personal site.

## Commands

- `npm run dev` — dev server (localhost:4321)
- `npm run build` — production build to `public/`
- `npm run preview` — preview production build

## Architecture

Single-page app, two states: **threshold** (entry animation) → **room** (main experience). No routing.

- `src/pages/index.astro` — sole page; HTML structure, all CSS (scoped + global), script entry point
- `src/layouts/Base.astro` — html shell, global reset
- `src/components/` — vanilla TS modules, each owning one concern:
  - `altar.ts` — the shrine the photo sits in: frame, mat, ledge, lamps, offerings
  - `altar-flowers.ts` — seeded procedural SVG (marigold, rose, jasmine, thoranam)
  - `particles.ts` — Three.js canvas overlay (petals, incense smoke, embers)
  - `lotus-nav.ts` — SVG bloom nav, mode state machine; exports `Mode` type
  - `photo-mode.ts` — photo cycling with crossfade
  - `japa-mode.ts` — Lalita Trishati streaming/manual, script toggle
  - `garland-mode.ts` — SVG garland overlay (v1)
  - `teachings-mode.ts` — Amma quotes
  - `sound-mode.ts` — scaffold, no audio assets yet
  - `tab-mantra.ts` — random Lalita name in browser tab title on blur
- `tools/altar-assets.py` — Blender script generating the brass altar furniture

## The altar

The room's base state. The photo hangs matted inside a gilt frame on the wall,
flanked by two nilavilakku with live flames, under a mango-leaf thoranam, above
a low ledge carrying kalasha, diyas, three incense sticks and flower offerings.

The photo does not rest on the ledge and is not positioned from it — the ledge
is a platform for offerings, the frame is hung. `--ledge-y` and `--frame-y` are
independent, and nothing should reintroduce a dependency between them.

It is deliberately dense. That does not contradict "the room is always
dominant" — real altars are visually busy and the eye still goes to the face,
because everything around it is dark and low contrast, not because it is empty.
`.altar-light` and `.altar-shade` are the passes that enforce this: they sit
above every decoration and crush the value range of everything but the photo.
**If you add something to the altar, it goes below those two layers.**

### Tuning it

Layout is driven by custom properties at the top of `#altar` in `index.astro`
(`--ledge-y`, `--ledge-w`, `--frame-y`, `--frame-h`, `--frame-w`, `--toran-y`,
`--lamp-h`, `--lamp-x`, `--incense-x`). Flower placement is the `clusters`
array in `altar.ts`. Petal speed is `FALL_TIME_MIN`/`MAX` in `particles.ts`.
All of this is safe to change freely.

Three pieces are positioned independently and should stay that way: the ledge
(`--ledge-y`) is a platform for offerings, the photo (`--frame-y`) hangs on the
wall above it, and the garland (`--toran-y`) is strung higher still, near the
ceiling. Only `--frame-h`/`--frame-w` are coupled, by the frame's 4:5 — height
leads because vertical space is the scarce dimension.

`.altar-toran svg` must keep `height: auto`. A fixed height letterboxes the
garland inside its box, so `--toran-y` stops meaning where the garland is.

**Landscape only.** The composition assumes a wide window. The portrait media
query keeps it from falling apart, nothing more; don't spend effort there.

Smoke rises from every `.altar-incense-tip`, round-robin over `SMOKE_COUNT`.
Add a fourth stick and each column thins; raise `SMOKE_COUNT` in multiples of
the stick count to keep the columns even.

### Regenerating the brass — read this before touching the lamp

    blender -b -P tools/altar-assets.py            # all four objects
    blender -b -P tools/altar-assets.py -- --only nilavilakku

Each object is a surface of revolution built from a profile curve, which is how
the real pieces are lathe-turned. Everything is rendered under one shared light
rig so the objects composite as a single altar; the convention (each piece lit
as if the altar's centre is to its right, hence the left lamp is CSS-mirrored
for the right) is in the script's module docstring.

**These three sites hardcode numbers derived from the render camera and must be
updated together if the lamp geometry, `TILT_DEG` or `ORTHO_MARGIN` change:**

1. `WICKS` in `altar.ts` — the five flame positions on the lamp
2. `aspect-ratio: 440 / 1536` on `.altar-lamp` in `index.astro`
3. `.altar-diya .altar-flame { left: 89.3%; top: 43.7% }` in `index.astro`

Nothing enforces this. Change the lamp's proportions and re-render, and the
flames silently drift off the wicks — no error, it just looks wrong. "Make the
lamp a bit wider" is not a one-line change.

## Key conventions

- All mode overlays use class `mode-overlay` and id `mode-{name}`. The lotus nav toggles `.active` on them.
- Photos live in `static/images/photos/`, brass renders in `static/images/altar/` (`@2x`/`@3x`). Mantra data in `static/data/` (one name per line, 300 lines each).
- `#altar` carries a `z-index`, which is what contains the altar's blend modes to the altar. Removing it makes them bleed through the page.
- `photo-mode` builds fresh `<img>` elements per crossfade, so they carry no Astro scope attribute. Anything styling them (e.g. `#darshan > img`) must live in the `is:global` block.
- `static/` is Astro's publicDir (copied verbatim to build output). `public/` is outDir (build artifact, gitignored).
- CSS lives in `index.astro` — scoped styles for page structure, `is:global` block for component styles (lotus, modes).
- No framework (React/Vue/etc). Components are plain TS that create and manage their own DOM.

## Deploy

GitLab Pages via CI. Push to `master` → builds and deploys to `ജയ്മാ.com`.
Remote: `pages-gitlab` (gitlab.com:j0sh4rp3/pages.git).

## Design doc

`docs/design.md` — full design spec including v2 plans (garland physics, arati flame, sahasranama).
