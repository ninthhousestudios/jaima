# ജയ്മാ.com

A digital temple for Amma (Mata Amritanandamayi Devi).

**[ജയ്മാ.com](https://xn--iwc0bc5dwd.com)**

Not a blog, not a personal site, not a fan page. A room you enter and stay in.
Her photo hangs matted in a gilt frame, flanked by two nilavilakku with live
flames, under a mango-leaf thoranam, above a ledge carrying kalasha, diyas,
incense and flowers. Petals fall, smoke rises, embers drift off the wicks. You
can hang a garland on the frame, take a lamp down and wave arati, read her
words, chant her names, or just sit there with the sound of the sea.

---

## The room

The site has exactly two states and no routing. The **threshold** is the entry
— three lines fade in on black, and touching anything dissolves them into the
**room**, which is the altar. Everything else is an overlay over that altar,
opened from a lotus that blooms in the corner.

| Mode | What it is |
| --- | --- |
| *(none)* | The altar itself — the base state, and always the dominant one |
| **photo** | Cycles her photographs through the frame with a slow crossfade |
| **japa** | Five namavalis in three scripts, in a climbing crawl or one name at a time |
| **garland** | Take a garland from the panel, carry it across the altar, hang it on her frame |
| **teachings** | Her words, one at a time or as a stream |
| **sound** | Tanpura and ocean, mixable — a drone over the sea is what Amritapuri sounds like |
| **arati** | The recording plays in the corner while you wave a real lamp off its shelf |

Two of these do not follow their overlay. Sound keeps playing when you leave —
the panel is a light switch, not the lamp. Garlands stay hung until you clear
them. The arati recording is the deliberate exception: it is a rite with a
beginning and an end, so it pauses when you go.

**Landscape only.** The composition assumes a wide window. There is a portrait
media query and it keeps things from falling apart, nothing more.

## Running it

```bash
npm install
npm run dev        # localhost:4321
npm run build      # static build into public/
npm run preview
```

Astro with no UI framework — every component is plain TypeScript that builds
and owns its own DOM. Three.js draws one canvas overlay for petals, smoke and
embers. The only other runtime dependency is the browser.

## Layout

```
src/pages/index.astro     the sole page: structure, and all of the CSS
src/layouts/Base.astro    html shell, font faces, reset
src/components/*.ts       one module per concern (altar, japa, garland, arati, …)
static/                   copied verbatim: images, audio, fonts, built texts
docs/                     design spec, source texts, reference photographs
tools/*.py                asset generation — Blender, Faust, text normalisation
```

`static/` is Astro's publicDir and `public/` is its outDir, which is the
opposite of the usual convention and worth knowing before you go looking for a
file. `public/` is a build artifact and is gitignored.

## The assets are generated, not drawn

Almost nothing here is a hand-authored image.

- **`tools/altar-assets.py`** — Blender. The brass: nilavilakku, kalasha, diya,
  bracket shelf, pancharati. Most are surfaces of revolution built from a
  profile curve, which is how the real pieces are lathe-turned. All five render
  under one shared light rig so they composite as a single altar.
- **`tools/garland-flowers.py`** — Blender. Thirteen single flowers, not three
  garland images, because a garland's shape depends on how many points you hold
  it by. `garland-rope.ts` is a Verlet strand whose ends are the pins, so
  spreading it from one hand to two frame corners costs nothing.
- **`tools/render-tanpura.py`** — the tanpura is a Faust string model borrowed
  from [justifier](https://github.com/ninthhousestudios/justifier), rendered
  and cut into a seamless loop.
- **`tools/render-ocean.py`** — the sea, loop point searched rather than fixed.
- **`tools/build-japa.py`** — normalises the scraped mantra sources in
  `docs/japa/` into the JSON the japa mode fetches, and asserts every name
  count so a bad edit fails the build instead of quietly shortening the japa.

The Blender renders print the numbers the web side needs — wick positions, grip
point, aspect ratios. Re-render without reading the log and the flames drift
off the wicks silently. `CLAUDE.md` has the table of what goes where.

## Fonts

Noto Sans Devanagari and Noto Sans Malayalam ship as woff2 subsets (74 kB
together) with a `unicode-range` that claims only their own scripts, so Latin
still resolves to `system-ui`. This is not a nicety. Left to the system,
fontconfig here picked FreeSans, which carries the Devanagari glyphs without
the lookups — it applies the reph and does nothing at all for the rakar, so
`ब्र` came out as three glyphs. Noto has `rkrf` and `pref`.

## Deploy

GitHub Pages, from `.github/workflows/deploy.yml`. Pushing `master` builds and
publishes `public/`; pull requests build without deploying.

The custom domain is set in the repository's **Settings › Pages**, not in a
file — with a custom Actions workflow GitHub ignores any `CNAME` in the tree.
It has to be entered as its Punycode form, `xn--iwc0bc5dwd.com`, because the
field will not take the Malayalam.

`static/.nojekyll` is empty and deliberate. Astro emits the whole site as one
chunk under `public/_astro/`, and Jekyll drops underscore-prefixed paths — so
on the off chance it ever runs, the failure is a blank page rather than a
missing stylesheet.

## On the contents

The photographs, and the arati recording embedded in arati mode, belong to the
Mata Amritanandamayi Math. They are used here in devotion and are not mine to
license. The same goes for the teachings in `docs/teachings.md` — they are
kept as one file, quoted verbatim, precisely because words attributed to Amma
are the thing that gets paraphrased into something she never said.

There are no bhajans on the site for this reason: the recordings belong to the
Math and the Creative Commons tags on archive.org copies are uploader-applied.

The code is mine. The room is hers.

<div align="center">

**ഓം അമൃതേശ്വര്യൈ നമഃ**

</div>
