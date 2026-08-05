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
  - `altar.ts` — the shrine the photo sits in: frame, mat, ledge, lamps, shelves, offerings
  - `arati-lamp.ts` — the pancharati hand lamp; built to be picked up and waved
  - `dom.ts` — `el()` and `flame()`, shared by anything that builds brass
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
Two bracket shelves between the lamps and the frame carry the arati lamps.

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

### Regenerating the brass — read this before touching a lamp

    blender -b -P tools/altar-assets.py            # all five objects
    blender -b -P tools/altar-assets.py -- --only nilavilakku

Most objects are a surface of revolution built from a profile curve, which is
how the real pieces are lathe-turned. The arati lamp is the exception: a turned
body with five arms brazed on, so it also uses `sweep()` (a flattened tube
along a planar path — bent sheet, not pipe) and `join_all()`. Everything is
rendered under one shared light rig so the objects composite as a single altar;
the convention (each piece lit as if the altar's centre is to its right, hence
the left lamp is CSS-mirrored for the right) is in the script's module
docstring. Five-fold pieces share `ARM_PHASE` so they read as a set.

**The web side hardcodes numbers derived from these renders. Re-render and they
go stale silently — the flames just drift off the wicks, no error.** Every
render now *prints* the correct values, so read the log instead of re-deriving:

| Printed as | Goes to |
| --- | --- |
| `wick0..4` | `WICKS` in `altar.ts`, `WICKS` in `arati-lamp.ts` |
| `grip` | `transform-origin` on `.arati-lamp`, `GRIP` in `arati-lamp.ts` |
| `content box` | `bottom` on `.arati-lamp` — the clear margin it must sink by |
| the `WxH` line | `aspect-ratio` on `.altar-lamp` and `.arati-lamp` |

Also derived, and not printed: `.altar-diya .altar-flame { left: 89.3%; top:
43.7% }`. The reporter was checked against the nilavilakku's existing hand-
derived `WICKS` and reproduces them to four places, so trust the log over
arithmetic. "Make the lamp a bit wider" is still not a one-line change.

### The arati lamps (and what v2 has to work with)

Two pancharati stand on the bracket shelves, modelled from
`docs/arati-lamp-*.jpg`. They are built by `arati-lamp.ts`, not `altar.ts`,
because arati mode will build one too. The whole interface for waving one is
already there and is deliberately small:

- `--arati-h` sizes it, `--shelf-x`/`--shelf-y` place the shelf it stands on.
- `setTilt(deg)` turns it about the **grip** — the dish underside, where a hand
  holds it — not about the element's centre.
- Each flame counter-rotates by `--flame-plumb` so it stays upright however far
  the lamp leans. A flame leaning with the lamp is the single thing that gives
  a waved sprite away. It defaults to `0deg`, so nothing static is affected.

The lamp is modelled with **no handle**, on purpose: a handle would give it a
front, which is wrong for something swung through an arc.

Embers currently source from `.altar-lamp .altar-flame` only — the two big
lamps. The arati flames are deliberately excluded so five embers do not get
spread across fifteen wicks. Widening that selector is the one-line change if
v2 wants them.

## The lotus

Two whorls of petals around a seed pod, all drawn in `lotus-nav.ts`. The outer
six are the modes; the inner six are decoration, offset half a step to fill the
outer ring's gaps. Shape knobs are the `OUTER`/`INNER` constants (`base` = where
the petal springs from, `tip` = how far it reaches, `half` = half-width) and the
curve in `petalPath`. Colour is three gradients in `<defs>`.

It blooms by transforming a `<g>` per petal, not by morphing `d`. Closed, each
petal is `scale(0.9, 0.4)` — a lotus closes by standing its petals upright, so
from above they foreshorten along their axis and keep their width. The pod is
hidden inside the bud (`.lotus-heart` opacity) and revealed by the bloom.

Two things will break it silently:

- **The viewBox must stay centred on the origin.** Petals pivot via
  `transform-box: view-box` + `transform-origin: 50% 50%`, which is user-space
  (0,0) only because the viewBox is `-90 -90 180 180`.
- **`.lotus-hit` must stay clear of the petals.** It is the toggle target, and
  it is painted on top. Closed it covers the whole bud (`HIT_CLOSED`); open it
  shrinks inside the petal bases (`HIT_OPEN`) or it swallows their clicks.
  Closed petals are also `pointer-events: none` for the same reason — a petal
  that eats a click on the toggle is an intermittent dead button, not a
  visible bug.

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
