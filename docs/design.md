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

**Base state** (no mode selected): Devi bhava photo, nearly full-viewport,
with ambient particle effects (flower petals, light motes drifting slowly).
No text, no UI except the lotus nav bud. Pure darshan.

**Atmosphere** runs at all times in the room:

- **Color & light**: Dark base (deep aubergine / temple-stone), warm radial
  glows behind the photo. Saffron, crimson, gold palette.
- **Time-awareness**: Tone shifts with local time of day. Dawn = softer gold.
  Midday = brighter. Evening = deeper warmth. Night = intimate, lamp-like.
  Driven by `new Date().getHours()` → CSS custom properties.
- **Motion**: Slow particle field — flower petals, light motes, incense smoke. The constraint
  is slowness: nothing moves faster than incense smoke. Three.js canvas
  overlay or CSS animations.

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

**v1**: Select garland mode → a garland image/SVG composites over the photo
with a gentle draping animation. A few garland styles (jasmine, rose, mixed)
selectable via a small radial sub-menu near the lotus. Simple, shippable.

**v2**: Drag-to-place or physics-based rope/cloth drape simulation.
As realistic as possible. Three.js.

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
- **Three.js**: Particle field (petals, light motes), garland physics (v2),
  arati flame (v2). Loaded only in the room.
- **CSS**: Atmosphere engine — gradients, blend modes, transitions,
  time-of-day color shifting via custom properties.
- **Vanilla JS**: Mode state management, lotus nav interaction, japa logic,
  mantra tab-title feature.

### Component breakdown

```
Threshold         — entry animation, fires "enter" event
Room              — main container, mode state machine
  DarshanPhoto    — central image, crossfade transitions
  ParticleField   — Three.js/Canvas 2D ambient effects
  LotusNav        — blooming nav, mode switching
  JapaStream      — mantra data, streaming/manual display
  GarlandOverlay  — SVG/image composite (v1), physics (v2)
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
- Garland v1 (simple SVG/image overlay with animation)
- Japa mode (streaming + manual, script toggle)
- Teachings mode (scaffolded, needs quote data)
- Sound mode (scaffolded, no audio assets yet)
- Arati petal visible but disabled ("coming soon")
- Mantra tab-title feature
- Time-of-day atmosphere

**v2** (future):
- Garland physics simulation
- Arati flame + audio
- Lalita Sahasranama (1000 names)
- Sound assets (bhajans, recordings)
- Additional photos
