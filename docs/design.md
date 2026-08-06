# ജയ്മാ.com — digital temple

A devotional site dedicated to Amma (Mata Amritanandamayi Devi).
Not a personal site, not a blog — a digital temple you enter and dwell in.

## Architecture

Two states: **threshold** and **room**. Single page, no routing.

### Threshold

The entry experience. Dark background. Three lines fade in sequentially, slow:

```
ഓം അമൃതേശ്വര്യൈ നമഃ       ← Malayalam
oṃ amṛteśvaryai namaḥ      ← IAST
ॐ अमृतेश्वर्यै नमः        ← Devanagari
```

Tap/click or wait a few seconds — text dissolves, room fades in behind it.

### Room

The sanctum. One space that transforms based on the active mode.

**Base state** (no mode selected): the darshan photo on an altar, with ambient
particle effects. No text, no UI except the lotus nav bud. Pure darshan.

#### The altar

The photo is matted inside a gilt frame standing on a ledge, flanked by two
tall nilavilakku whose wicks burn, under a mango-leaf thoranam, with kalasha,
diyas, a burning incense stick and flower offerings across the front. The
whole viewport is filled.

Density is not a contradiction of "the room is always dominant". Look at a real
altar: it is crowded with lamps, garlands, vessels and cloth, and your eye still
goes straight to the face — because everything else is dark and low contrast,
not because the space is empty. So the rule is **dense in detail, quiet in
contrast**. Two passes over the finished composition enforce it: a warm wash
that puts every object under the same lamp light, and a vignette that drops the
corners away. Without them the layers read as cut-outs on a background.

A fixed frame means photos of different aspect ratios (the padapuja shots are
landscape, the Devi bhava portraits are not) letterbox onto the deep red mat.
That is deliberate, and it is what a real framer does — the alternative is
either stretching the ornament or cropping every photo to portrait.

**Brass furniture** is modelled and rendered in Blender rather than sourced as
stock art, by `tools/altar-assets.py`. Each piece is a surface of revolution
built from a profile curve, which is how the real objects are lathe-turned.
Two reasons for rendering rather than downloading: licensing, and — the one
that actually matters — a shared light rig. Three PNGs from three sources carry
three different studio lightings and will never sit together on a dark altar.

**Flames are live, never baked.** A baked loop reads as a loop. Each wick is two
CSS layers running on deliberately unrelated periods, so it never settles.

**Flowers are seeded procedural SVG.** A marigold is literally concentric rings
of ruffled petals, which vectors describe well, and generated colour keeps them
in the room's palette instead of importing a stock photo's white-studio light.

**Atmosphere** runs at all times in the room:

- **Color & light**: Dark base (deep aubergine / temple-stone), warm radial
  glows behind the photo. Saffron, crimson, gold palette.
- **Time-awareness**: Tone shifts with local time of day. Dawn = softer gold.
  Midday = brighter. Evening = deeper warmth. Night = intimate, lamp-like.
  Driven by `new Date().getHours()` → CSS custom properties.
- **Motion**: Slow particle field — flower petals, incense smoke, embers. The
  constraint is slowness: nothing moves faster than incense smoke. A petal
  takes 26–46 seconds to cross the viewport; anything quicker pulls attention
  outward. Three.js canvas overlay.

  Petals are rose, marigold and jasmine, tumbling with a falling-leaf swing
  coupled to their tilt, so they catch the light face-on at the extremes of the
  arc and fall slower there. The smoke and embers are **sourced**: smoke rises
  from the measured position of the incense tip and embers from the lamp
  flames, re-measured on resize. Ambient smoke is fog; sourced smoke reads.

### Lotus nav

Bottom-right corner. Closed lotus bud at rest. Tap/click → blooms open,
petals fan out, each petal = a mode. Selecting a petal activates that mode
and the lotus closes back, glowing subtly to indicate active mode.

Petals / modes:

| Petal | Mode | Description |
|-------|------|-------------|
| 1 | **Photo** | Cycle through Amma photos |
| 2 | **Garland** | Offer a flower garland on the photo |
| 3 | **Japa** | Stream Lalita Trishati namavali |
| 4 | **Teachings** | Amma quotes |
| 5 | **Sound** | Ambient audio (off by default) |
| 6 | **Arati** | Wave a flame (v2) |

### Mode details

#### Photo

Changes the central darshan photo. Sub-controls: subtle arrows at screen
edges, or tap to advance. Photos crossfade slowly.

Available photos (from `~/w/wallpaper/`):
- `amma-devi1.png` — Devi bhava, ornate red/gold sari, crown (default)
- `amma.jpg` — White sari, smiling, close-up
- `amma1.jpg` — White sari with pink/white garlands
- `amma2.jpg`, `amma3.jpg`, `amma4.jpg` — additional portraits
- `her-feet.jpg`, `her-feet2.jpg` — padapuja, feet with flowers on saffron cloth
- More to be added

#### Garland

**Shipped**: a panel bottom-left spawns a garland into your hand; you carry it
across the altar and click to hang it. Any number of them, three kinds
(marigold, rose, mullapoo), and Clear is the only thing that takes them down —
leaving the mode does not.

The flowers are individually rendered in Blender and threaded onto a Verlet
rope, rather than composited as finished garland images. That is what makes
the offering read as one: held at a single point the strand hangs in a long
narrow U, and released over the frame's two top corners it spreads into a wide
drape, because the strand's length does not change when the pins move apart.

Hanging it on the frame rather than round her neck is what is actually done
with a framed photo at a shrine, so the one thing a flat photo cannot support
was never needed.

**Still open**: per-flower collision so stacked garlands rest on each other
rather than interpenetrating; a swing impulse when the room is entered.

#### Japa

Streams Lalita Trishati (300 names) in the selected script. Sub-controls:

- **Script toggle**: Malayalam / IAST / Devanagari (small tabs)
- **Mode**: Streaming (names scroll bottom-to-top at adjustable speed) or
  manual (tap to advance)
- **Speed control**: For streaming mode

Names appear large and centered, overlaid on the room. The photo and
atmosphere remain visible behind the text.

Data: existing files — `iast.txt`, `devanagari.txt`, `malayalam.txt`
(300 lines each, one name per line). Lalita Sahasranama (1000 names) to be
added later.

#### Teachings

One Amma quote at a time, overlaid on the room. Tap for next.
Quote data to be curated separately.

#### Sound

Off by default. Sub-menu with audio options:

- Bhajans (pending copyright clearance)
- Tanpura drone
- Other ambient recordings (pending copyright clearance)

Scaffolding built now, actual audio assets added later.

#### Arati (v2)

A flame that can be waved — interactive arati experience.
Three.js flame simulation. Paired with an arati recording if
copyright permits. Not in v1.

## Mantra tab title

Carried over from the current site. When the browser tab loses focus,
the page title changes to a random Lalita name (cycling through
IAST/Devanagari/Malayalam). Runs on both threshold and room.

## Design principles

1. **The room is always dominant.** Controls are peripheral. Nothing competes
   with the central image / experience.
2. **Slowness is the constraint.** Every animation passes the test: does this
   draw inward or pull attention outward?
3. **No temple-breaking chrome.** No nav bar, no footer, no social links,
   no "about me." Nothing that breaks the spell.
4. **Reverence over spectacle.** The technology is invisible — just warmth
   and space around the photos and mantras.

## Technology

- **Astro**: Static build, zero JS by default, component islands for
  interactivity. The room is a JS application within an Astro shell.
- **Three.js**: Particle field (petals, smoke, embers),
  arati flame (v2). Loaded only in the room. Deliberately *not* used for the
  altar furniture: those objects never move, so paying a live 3D budget — env
  maps for the brass, a perspective camera fighting the flat page layout — buys
  nothing. The altar is a still life, rendered once and shipped as pixels.
- **Blender**: Brass altar furniture, headless via `tools/altar-assets.py`.
- **CSS**: Atmosphere engine — gradients, blend modes, transitions,
  time-of-day color shifting via custom properties.
- **Vanilla JS**: Mode state management, lotus nav interaction, japa logic,
  mantra tab-title feature.

### Component breakdown

```
Threshold         — entry animation, fires "enter" event
Room              — main container, mode state machine
  Altar           — frame, mat, ledge, lamps, offerings, light passes
  DarshanPhoto    — central image inside the frame aperture, crossfades
  ParticleField   — Three.js ambient effects, sourced from the altar
  LotusNav        — blooming nav, mode switching
  JapaStream      — mantra data, streaming/manual display
  GarlandOverlay  — rendered flower sprites on a Verlet rope
  TeachingsOverlay — quote display
  SoundController — audio scaffolding, mute/unmute, track selection
  AtmosphereEngine — time-of-day CSS updates, ambient color
```

## Hosting

Currently on Gitlab Pages.
Domain: `ജയ്മാ.com` / `xn--iwc0bc5dwd.com`.

## Scope

**v1** (this build):
- Threshold → Room transition
- Devi bhava base state with particle atmosphere
- Lotus nav (bloom/close interaction)
- Photo mode (cycle through available photos)
- Garland (rendered flowers on a simulated rope, carried and hung)
- Japa mode (streaming + manual, script toggle)
- Teachings mode (scaffolded, needs quote data)
- Sound mode (scaffolded, no audio assets yet)
- Arati petal visible but disabled ("coming soon")
- Mantra tab-title feature
- Time-of-day atmosphere

**v2** (future):
- Arati flame + audio
- Lalita Sahasranama (1000 names)
- Sound assets (bhajans, recordings)
- Additional photos
