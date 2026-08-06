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
  - `japa-mode.ts` — five namavalis; mantra picker, two views, script toggle
  - `garland-mode.ts` — garlands you carry and hang; rendered flowers on a rope
  - `garland-rope.ts` — the Verlet strand a garland hangs on
  - `teachings-mode.ts` — Amma quotes
  - `sound-mode.ts` — ambient beds (tanpura, ocean); Web Audio, mixable
  - `tab-mantra.ts` — random Lalita name in browser tab title on blur
- `tools/altar-assets.py` — Blender script generating the brass altar furniture
- `tools/garland-flowers.py` — Blender script rendering the garland flowers
- `tools/blender_common.py` — camera, world and output shared by both (imported,
  hence the underscore)
- `tools/lotus-knob.py` — cuts the nav's centre flower out of `docs/lotus.jpg`
- `tools/audio_loop.py` — shared seamless-loop + web-encode helper (imported,
  hence the underscore)
- `tools/render-tanpura.py`, `tools/render-ocean.py` — build the sound beds
- `tools/build-japa.py` — normalises `docs/japa/` into the japa mode's texts

The lotus nav's centre is that cut-out, not a drawn shape, so it is styled
with filters — `fill`/`stroke` do nothing to an `<image>`. Re-run the script
and its printed aspect ratio goes into `KNOB_W`/`KNOB_H` in `lotus-nav.ts`;
get it wrong and the flower squashes. Closed petals are `opacity: 0` and
`pointer-events: none` — they collapse onto the centre, where they would
otherwise sit as stubs on the flower and eat clicks meant for the toggle.

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

## Japa

Five mantras, chosen from the picker left of the script buttons: Lalita
trishati (the default), ashtottara, sahasranamavali, the sahasranama stotram,
and Amma's ashtottara. Each is offered in all three scripts, and the picker
labels itself in the current one.

Two views over whichever is chosen, both with play/pause and step
forward/back. `crawl` (the default) climbs the whole list up the screen;
`single` holds one at a time. The slider is a **speed**, 1–10, mapped per view
— right is faster in both. Don't put a duration back in it.

**Every mantra opens with its dhyana verses and nothing plays until asked.**
The four Lalita texts share `lalita-dhyanam`; Amma's carries its own. The
crawl therefore sits at rest with the opening verse parked at the bottom of
the stage — `REST_ROWS` — rather than at an offset of zero, which would show a
blank screen. Keep `REST_ROWS` inside the first verse: it is also where
`single` opens.

### Units and rows

A **unit** is one thing you step through: a dhyana verse, a name, or (in the
stotram) a couplet. A **row** is one line of the crawl, including the blank
one that follows a verse. Units span one row or several; rows are all exactly
`--japa-line` tall, and that is the whole trick — the crawl divides its scroll
offset by a single constant to find the row, then `rows[i].unit` to find where
it is. `--japa-line` must stay fixed for the same reason it always did: a
font-determined height drifts the counter against the column. `--japa-tilt`
and `--japa-perspective` are free to change.

The counter names the dhyanam rather than numbering it, so `1 / 300` means the
japa proper has begun.

Nothing in the crawl can be measured while the overlay is `display: none` —
every height reads 0. That is why `activateJapa()` exists and why
`handleModeChange` calls it *after* setting `.active`.

### Regenerating the texts

    python3 tools/build-japa.py

Sources are `docs/japa/*.md` (plus `static/data/*.txt` for the trishati, which
the browser-tab mantra also reads); output is `static/data/japa/`, one
`index.json` catalogue plus `{mantra}-{script}.json` per text, fetched on first
use because the sahasranama alone is a hundred times the trishati.

`docs/japa/` is tracked, unlike the ocean masters: it is a few hundred kB of
scraped text that has since been hand-corrected, and without it a clone cannot
re-run the build.

The sources are scraped and were not uniform — wrapped names, variant readings
in brackets, a count marker every tenth line, per-script disagreement about
which om to use. The tool normalises all of it and then **asserts each name
count**. That assert is the safety net: an edit that merges or drops a line
fails the build instead of quietly shortening the japa.

## Garlands

You take a garland from the panel, carry it across the altar and hang it on
her frame. Spawn as many as you like; **Clear is the only thing that takes
them down** — leaving the mode does not, exactly like the sound panel.

Hanging it on the frame rather than round her neck is not a workaround for a
flat photo. It is what is actually done with a framed photo at a shrine, so
the one thing a 2D image cannot support was never needed.

### Why the flowers are rendered one at a time

`tools/garland-flowers.py` renders thirteen single flowers, not three garland
images, because a garland's whole character is that its shape depends on how
many points you hold it by: one hand and it hangs in a long narrow U, two
frame corners and it spreads into a wide drape. `garland-rope.ts` is a Verlet
strand whose two ends are the pins, so that transition costs nothing — the
strand's rest length does not change when the pins move apart. It also ships
fewer bytes, since forty flowers on a strand are a dozen images reused.

    blender -b -P tools/garland-flowers.py
    blender -b -P tools/garland-flowers.py -- --only marigold-a

**Three invariants let the web side hardcode nothing**, unlike the brass: one
resolution for every sprite, one shared world-space window (so relative flower
sizes are already right in pixels — no scale table), and every flower centred
on the origin (so threading one on is drawing it centred on a rope node).
Break one and the garlands come apart with no error. The flower recipes —
which sprites, how often, how densely strung — live in `KINDS` in
`garland-mode.ts`, because they are art direction, not geometry.

Two things drove the modelling and will bite anyone retuning it. Petals must
stay narrow and deeply troughed or they tile smoothly and a marigold comes out
a dahlia. And the variant tilts are large because a flower threaded on a
garland shows its side far more than its front — which also disposes of the
artefact where petals near the pole, being surfaces seen edge-on, draw as
spokes across the flower's middle.

### Tuning the drape

`length` in `KINDS` is the number to be careful with: it is the strand length
as a multiple of the frame's width, and a strand L across a span W drapes to
about `sqrt((L/2)² - (W/2)²)` below the pins. At 1.95 the loop crosses her
face; the shipped values put it near mid-frame, around the neck, clear of the
face the whole room is built to lead the eye to. `BOX` sets flower size,
`spacing` how densely the strand is strung.

The animation loop stops once every garland has settled and restarts on the
next touch, so a still altar costs nothing. `Rope.step()` measures motion
*after* its constraint passes, not from `(x - px)` at the top: the latter
reads the previous frame's displacement, so a strand starting from rest
reports itself settled on its first call and freezes in its spawn pose.

## Sound

Two ambient beds, tanpura and ocean, toggled independently — they mix, because
a drone over the sea is what Amritapuri actually sounds like. **Playback does
not follow the overlay**: the panel is a light switch, not the lamp, so leaving
sound mode for japa or the altar leaves the bed running. Buffers are fetched on
first play, never at init.

Two things make the loops seamless and **both have to hold**:

1. Playback goes through `decodeAudioData` + `AudioBufferSourceNode`, not
   `<audio loop>`. Opus and AAC both carry encoder padding that `<audio loop>`
   replays as a gap at the seam; decoding to a buffer strips it.
2. The renders are cut so their seam is inaudible — see below.

Regenerate with `python3 tools/render-tanpura.py` / `render-ocean.py`. Both
write `.opus` and `.m4a` to `static/audio/`; `tools/audio_loop.py` owns the
crossfade and the encode, so fixes belong there rather than in either script.

### Why the loop lengths are what they are

A loop is made by folding a segment's tail back over its head with an
equal-power crossfade — so the material at the seam is overlaid with the
material one loop later, and the two have to match.

- **Tanpura**: `LOOP_S` must be an exact multiple of the pluck cycle
  (`1 / pluck_rate`). 100 s is 9 cycles at 0.09. Miss the multiple and the
  plucks land at a different phase across the seam — an audible hitch once a
  loop. **Change `pluck_rate` and you must re-pick the multiple.**
- **Ocean**: no fixed period, so `best_loop()` searches start *and* length,
  scoring candidates by band-envelope mismatch. Length is searched, not fixed,
  because a periodic swell wants whole periods just like the tanpura: ocean2
  scores 2.4 dB at 110 s and 7.3 dB at 115 s. Under ~2 dB is inaudible.

Sources: the tanpura is justifier's string model, unchanged, via
`justifier/native/experiments/temple_tanpura.dsp` — that file only adds reverb
(`component()`, not a copy), and the languid character is entirely in the
parameters `render-tanpura.py` passes. The ocean masters are `docs/ocean*.wav`
/`.flac`, gitignored like `docs/*.jpg`; only the loops ship.

No bhajans. The recordings belong to the Math and the CC tags on archive.org
copies are uploader-applied, so there is nothing freely shippable. Amma's arati
is a separate question and may end up an embedded player.

## Fonts

`static/fonts/` carries Noto Sans Devanagari and Noto Sans Malayalam as woff2
subsets (OFL, 74 kB together), declared in `Base.astro` with a `unicode-range`
so they claim only their own scripts and Latin/IAST still resolves to
`system-ui`. **Don't widen those ranges** — the subsets have almost no Latin,
so a range that catches ASCII would put the whole interface in tofu.

Nearly every word on this site is Devanagari or Malayalam, and leaving that to
the visitor's system does not work: fontconfig here ranked FreeSans first for
both, and FreeSans carries the glyphs without the lookups. It applies the reph
(ra *before* a consonant) and nothing at all for the rakar (ra *after* one) —
`ब्र` shaped to three glyphs from three codepoints. Noto has `rkrf` and `pref`,
which are the substitutions that were missing.

Pango shapes from the same fontconfig the browser uses, so glyph counts are
measurable without a screenshot:

```python
layout.set_font_description(Pango.FontDescription('Noto Sans Devanagari 32'))
layout.set_text('ब्र', -1)      # 3 codepoints -> 1 glyph shaped, 3 unshaped
```

## Key conventions

- All mode overlays use class `mode-overlay` and id `mode-{name}`. The lotus nav toggles `.active` on them.
- Photos live in `static/images/photos/`, brass renders in `static/images/altar/` (`@2x`/`@3x`). Mantra sources in `docs/japa/`, built texts in `static/data/japa/`; `static/data/*.txt` is the trishati, one name per line, read directly by `tab-mantra`.
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
