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
  - `arati-mode.ts` — the arati: the hand that waves either lamp, and the wiring
  - `arati-player.ts` — the embedded recording, and the channel to it
  - `arati-lyrics.ts` — the words, climbing in step with that recording
  - `puja-bell.ts` — the Nandi bell on the ledge; swing it, or leave it ringing
  - `audio.ts` — the one AudioContext, codec choice and buffer cache
  - `bell-voice.ts` — the ghanta's strike, synthesised from measured modes
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
- `tools/bell-modes.py` — measures the ghanta recording's modes for `bell-voice.ts`
- `tools/arati-timing.py` — measures the arati's stanza clock for `arati-lyrics.ts`
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
a low ledge carrying kalasha, diyas, three incense sticks, the puja bell and
flower offerings. Two bracket shelves between the lamps and the frame carry the
arati lamps.

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

    blender -b -P tools/altar-assets.py            # all six objects
    blender -b -P tools/altar-assets.py -- --only nilavilakku

Most objects are a surface of revolution built from a profile curve, which is
how the real pieces are lathe-turned. The arati lamp is the exception: a turned
body with five arms brazed on, so it also uses `sweep()` (a flattened tube
along a planar path — bent sheet, not pipe) and `join_all()`. The bell is the
other: a turned bell and handle, with a cast Nandi on top built from a dozen
placed ellipsoids (`blob()`, `spike()`), joined the same way. Everything is
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
| `grip` | `transform-origin` + `GRIP`, on `.arati-lamp` and on `.puja-bell` |
| `content box` | `bottom` on `.arati-lamp` / `.puja-bell` — the clear margin it must sink by |
| the `WxH` line | `aspect-ratio` on `.altar-lamp`, `.arati-lamp` and `.puja-bell` |

A builder returns `(object, flames, landmarks)`, and the landmarks are how a
piece asks for a number the web side cannot compute. Only the two things that
get picked up report a `grip`, and each says where its own is — the lamp is
held under its dish, at the origin; the bell most of the way up its handle.

Also derived, and not printed: `.altar-diya .altar-flame { left: 89.3%; top:
43.7% }`. The reporter was checked against the nilavilakku's existing hand-
derived `WICKS` and reproduces them to four places, so trust the log over
arithmetic. "Make the lamp a bit wider" is still not a one-line change.

### The arati lamps

Two pancharati stand on the bracket shelves, modelled from
`docs/arati-lamp-*.jpg`. They are built by `arati-lamp.ts` rather than
`altar.ts` because arati mode drives them, and `initAltar` hands their setters
out as `Altar.aratiLamps` — by value, not by selector, since a querySelector
would only find the div. The interface is three setters and nothing else:

- `setLift(x, y)` carries it off its shelf, in px. The lamp is **never
  reparented** while carried; reparenting restarts every flame's CSS flicker
  mid-wave. `--lift-x`/`--lift-y` come first in the transform list so the tilt
  still pivots about the grip wherever it has been carried to.
- `setTilt(deg)` turns it about the **grip** — the dish underside, where a hand
  holds it — not about the element's centre.
- `setDrag(deg)` leans the flames back against the direction of travel.

`--arati-h` sizes it, `--shelf-x`/`--shelf-y` place the shelf it stands on.

Two flame angles that must not be confused. Each flame counter-rotates by
`--flame-plumb` so it stays upright however far the lamp leans — a flame
leaning *with* the lamp is the single thing that gives a waved sprite away.
`--flame-drag` is the opposite idea, added on top: it leans the flame *away*
from the direction the lamp is travelling, which is what fire dragged through
air does. Plumb cancels the lamp's rotation, drag adds the air. Both default to
`0deg`, so nothing static is affected.

The lamp is modelled with **no handle**, on purpose: a handle would give it a
front, which is wrong for something swung through an arc.

Embers currently source from `.altar-lamp .altar-flame` only — the two big
lamps. The arati flames are deliberately excluded so five embers do not get
spread across fifteen wicks. Widening that selector is the one-line change if
a waved lamp should throw them, and the reason it has not been made is that it
would change the *static* altar too.

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

## Teachings

Amma's words, in the same two views japa offers: `single` holds one and you
click for the next, `stream` sends the whole list climbing up the screen.
**Single is the default and has no autoplay** — a name is a syllable you
repeat, a teaching is a sentence, and only the reader knows when they have
finished it. The play button and the speed slider are hidden in single for
that reason; the two views otherwise share the japa control bar's CSS, which
is why those rules carry both class families.

`docs/teachings.md` is the source, imported with `?raw` at build time and
split on blank lines. No build step and no copy in the TS: words attributed to
Amma are exactly the thing that gets paraphrased into something she never
said, so there is one file to check against. Duplicates are dropped — the file
repeats one today.

The stream is **not** tilted like the japa crawl. That perspective is readable
for a three-word name and punishing for a four-line sentence. It also cannot
reuse the crawl's row arithmetic, because a teaching wraps to a different
number of lines than its neighbour: `measure()` reads each one's `offsetTop`
instead, which is why the quotes are spaced with padding rather than margins
(collapsing margins would move the first one off zero).

`READ_LINE` is one constant doing two jobs and they have to agree — `seekIndex`
puts a teaching on that line and `indexAt` reads one back off the offset. Move
one without the other and the counter disagrees with the screen.

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

Dropping anywhere over the frame — not just near its top edge — hangs the
garland on it; `SNAP` is that margin, as a fraction of the frame's width.
While one is in hand and inside that region a warm line shows where it will
land, because otherwise the snap is invisible until after you have let go and
the two outcomes look nothing alike.

`drop` in `KINDS` is how far down the frame a garland reaches, as a fraction
of the frame's *height*, measured to the bottom of the flowers. The shipped
values put it near the bottom of the frame — well clear of her face, which a
shorter drape crosses in some photos. The strand length that produces it is
derived (`strandFor`): a strand L across a span W bottoms out about
`sqrt((L/2)² - (W/2)²)` below the pins, and these hang close enough to that
limit that inverting it lands within a percent. Keep the direction of that
dependency — a hardcoded length goes stale against the frame's proportions and
`PIN_INSET`, and it fails by creeping up over her face. `BOX` sets flower
size, `spacing` how densely the strand is strung.

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
is the exception and it went the other way — an embedded player, below.

## Arati

The arati plays in the upper left corner and either lamp can be taken off its
shelf and waved for as long as you like. Those two are deliberately **not wired
to each other**: nothing waits for the video, nothing counts bars, the wave
neither starts nor stops with playback. The rite is the visitor's to perform;
the recording is what the room sounds like while they perform it.

The words are the third thing here, and they are the one part that *is* wired to
the recording. That is not a contradiction: the wave is the visitor's offering
and has no right answer, whereas the words are what is being sung this second
and there is exactly one of those.

The lamps waved are the two already on the wall, not a third the mode conjures.
The shelf standing visibly empty while you hold one is half of what makes it
read as arati rather than as a widget.

### The player

`arati-player.ts`. An `<iframe>`, no YouTube API script, built on first entry
and never at init — a visitor who does not open arati mode never talks to
YouTube at all. `youtube-nocookie.com`, no autoplay parameter anywhere, and the
video id is one constant at its top (`docs/arati-youtube.md` is the source).

**Leaving the mode pauses it, and this is the one place sound mode's rule is
deliberately inverted.** The beds outlive their panel because ambience should;
the arati is a rite with a beginning and an end. The mechanism matters: the
overlay goes `display: none` around the iframe and *a hidden YouTube frame keeps
playing* — the audio would follow you into japa with nothing on screen to
explain it or turn it off. So the frame stays mounted, keeping its position for
when you come back, and is told to pause over the postMessage channel that
`enablejsapi=1` opens. Verified against the real player: it pauses, stays
paused, and returns holding its position rather than restarting.

**Both directions of that channel are used**, and the inbound one is what the
lyrics run on. Send `{event: 'listening'}` and the player answers with
`initialDelivery`, `onReady` and then a stream of `infoDelivery` carrying
`currentTime` and `playerState` — the same handshake `youtube.com/iframe_api`
performs internally, done here so every byte of arati mode stays on
youtube-nocookie.com. Two things about it are easy to get wrong and silent when
you do:

- The player opens with `readyToListen`, which is **not** an answer — it carries
  no state and means "ask me now". Treating it as one stops the handshake a
  message short of every report you wanted.
- Nothing here throws, logs or shows a failure. If the player stops answering,
  `time()` falls back to a clock started when we asked it to play and the panel
  scrolls on regardless; the only symptom is drift.

The player's width has a floor (`clamp(360px, ...)`) rather than being pure vw
because YouTube's terms put a floor of 200 x 200 px on an embedded player, and
360 px at 16:9 is 202 px tall whatever the window does.

### The words

`arati-lyrics.ts`, and **hidden until the Lyrics button is pressed** — the rite
is the lamp and the bell, and the text is for whoever wants to sing along. The
whole bhajan is on screen at once and climbing, like japa's crawl and the
teachings' stream, not one line at a time: a line you are about to sing is more
use than one you have finished. Sources are `docs/arati-{deva,iast,mal}.md`,
imported `?raw` at build time exactly as the teachings are, and offered in japa's
three scripts under japa's own labels.

The column runs off `player.time()` every frame rather than a clock of its own,
so pausing pauses it, seeking moves it and it cannot drift. Play here is play
there and play there lights the button here. Scrolling the column by hand
detaches it — someone reading ahead should not be dragged back four times a
second — and a Follow button appears to put it back; pressing play does the
same. Nothing is lit while detached or before the singing starts, because a lit
line is a claim about this second and in neither state is there one to make.

The panel is top **right**, opposite the player, and that side is not a
preference: a column under the player would run down the left edge, and the
left shelf and its arati lamp are at `--shelf-y` (44vh from the bottom, lamp
8vh above). A panel with `pointer-events` there would sit on the one thing the
mode exists to let you pick up. `--lyrics-h` is capped for the same reason —
raise `--shelf-y` and it has room to grow, lower it and this must shrink first.

#### The two timing numbers

`LEAD_S` and `STANZA_S`, measured by `tools/arati-timing.py` from
`docs/arati-master.webm` (gitignored like the ocean masters — the recording is
the Math's, only the numbers ship). **Read the tool's output rather than
hand-tuning them.**

Two numbers are the whole cue sheet because the bhajan is strictly strophic,
and the tool demonstrates that rather than assuming it: the chroma
self-similarity has one peak, at 36.46 s, with its 2x and 3x harmonics and
nothing else near; a checkerboard novelty curve picks the phase that puts every
boundary on a change; ten cycles then fill the recording, and the text parses to
exactly ten stanzas. Inside a stanza the lines are spread evenly — exact at
every stanza boundary, a second or so out in between. Better than that needs an
ear, and it needs `LEAD_S` retuned first: a constant offset is what is noticed,
a stanza's inner drift is not.

### The wave

`setLift` + `setTilt` + `setDrag` and one rAF loop. No canvas, no physics.

`FOLLOW` is below 1 on purpose: the lamp lags the pointer, and that lag is both
the whole illusion of weight *and* where the velocity the two angles are read
off comes from. At `FOLLOW: 1` the lamp is nailed to the cursor and never leans
at all. Tilt and drag are read from horizontal speed only — a lamp raised
straight up does not lean, and a flame lifted vertically is compressed rather
than swept aside. Their **signs are opposite**, and that is most of why the
wave reads as motion rather than as a rotating picture: the lamp leads with its
top the way a wrist-led sweep carries one, the flames trail the air.

Releasing does not snap it back — the same loop runs with the target set to
(0, 0), so it settles onto its shelf, and then stops. A still altar costs
nothing, exactly like the garlands.

Two things are load-bearing and invisible:

- The lamps are **live in every mode**, like the bell — `setAratiActive` only
  mounts and pauses the recording. A stray grab cannot eat a click meant for a
  garland because the garland canvas (z 7) sits above the shelves (z 5) and
  takes the pointer inside its own mode; that z-order is what makes the
  ungated lamps safe, so don't reorder it.
- `.altar-shelf:has(.arati-lamp.lifted)` raises the *shelf*, not the lamp. The
  shelf is a positioned element with a `z-index`, hence a stacking context, so
  raising the lamp inside it does nothing at all. `8` ties with `.altar-light`
  and `.altar-shade`, and a tie breaks on document order — the stage comes
  first, so a carried lamp clears the offerings and still passes under the two
  light passes, where everything on this altar belongs.

## The bell

A brass puja bell with Nandi couchant on the handle stands on the ledge, off to
the left of centre. **Drag it and it rings; click it without dragging and it
keeps ringing on its own until you click it again.** The second gesture is the
whole reason it exists: one pointer cannot hold the bell and a lamp at once, so
without it the bell and the arati could never happen together, which is the one
way a bell is actually used.

It is **live in every mode**, like the arati lamps, and it keeps ringing and
keeps its place across a mode change, like the sound beds. Only the line
explaining it belongs to arati — the hint is in that overlay, so it is not on
screen anywhere else. Where a mode legitimately owns that patch of screen the
bell is simply behind it: reachable from the bare altar and from photo, sound
and arati; covered by the garland canvas (which is the whole altar, by design)
and by the japa and teachings control bars. That is also why the bell steals no
clicks — everything that wants the altar's pointer sits above the offerings.

The bell does not go home by itself. Drop it back near its place and it settles
into it exactly (`HOME_SNAP`); that is the only way home, and it is why there is
no Clear button of the kind the garlands have.

### The swing

One damped pendulum, integrated in `puja-bell.ts`, driven by the **acceleration**
of the carried position and not its speed — the hand pulls the pivot out from
under the body and the body is left behind, so walking the bell steadily across
the altar does not ring it and shaking it does. The clapper lands at each turn
of the swing, which is why a small shake gives a small ring for free.

`AUTO_PUSH` is an escapement: a nudge, in whichever direction it is already
going, on every step inside `AUTO_AMP`. So it is the same integrator either way
and clicking a swinging bell keeps the swing it had. `STOP_D` is the opposite —
the free damping is right for a bell let go of and far too slow for one told to
stop, which would go on striking for four seconds after the click.

**The integrator runs on a fixed `STEP_MS`, not on the frame**, and must keep
doing so. Every constant is per step, so on a frame-driven loop the bell would
ring at twice the rate on a 120 Hz display. The arati wave gets away with
reading the frame directly because a lamp that follows a little more tightly is
not noticeable; a bell's *rate* is the first thing an ear hears.

### The sound

Synthesised, in `bell-voice.ts` — no recording ships. A struck bell is a set
of decaying modes, so its whole voice is the `MODES` table: frequency, level,
decay and beat per mode, **measured from a real ghanta** by
`tools/bell-modes.py` (source `docs/ganta-bell.mp3`, gitignored like the
ocean masters). Regenerate the table with the tool rather than hand-editing
frequencies; levels and beats are fair game for taste. The tool also renders
`docs/bell-preview.wav` from the same model — audition changes there, against
the reference, before trusting them in the browser.

The synth buys three things a sample cannot do, and they are the point:
force drives a lowpass cutoff, so a soft swing is a dark ting and a hard
shake a bright clang; each strike wobbles every mode's level a couple of dB
(the sample path faked variety by shifting playbackRate, i.e. the bell's
pitch — the one thing a real bell never varies); and clicking a ringing bell
chokes the sounding tails along with the swing — `chokeBell` and `STOP_D`
are one gesture heard and seen.

It shares the one AudioContext in `audio.ts` with the beds. Nothing is built
at init: `warmBell` runs on the first pointerdown — a user gesture, so the
context may be created inside it — and each strike is a dozen short-lived
oscillator nodes that stop a few time-constants in.

Every strike leaves through a tanh saturation bus (`bellBus`), because the
auto-ring stacks a dozen full-force tails and the sum clips digitally
without it. It is unity gain at ordinary levels — a lone strike passes
untouched — and deliberately not a `DynamicsCompressorNode`, whose implicit
makeup gain would reboost everything.

`MAX_RINGING` caps how many strikes sound at once: past it the oldest tail
is faded out under the strike that just landed. Unbounded, the auto-ring
accumulates two-hundred-odd live oscillators and the audio thread misses
deadlines — heard as intermittent stutter, nothing logged anywhere.

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

GitHub Pages via `.github/workflows/deploy.yml`. Push to `master` → builds and
deploys to `ജയ്മാ.com`. Remote: `jaima-github` (github.com:ninthhousestudios/jaima).

The custom domain lives in the repo's Settings › Pages as `xn--iwc0bc5dwd.com`
— Punycode, since the field rejects the Malayalam. A custom Actions workflow
means GitHub ignores any `CNAME` file, so don't add one. `static/.nojekyll` is
empty and stays: the whole site is one chunk under `public/_astro/`, and Jekyll
strips underscore-prefixed paths.

## Design doc

`docs/design.md` — full design spec including v2 plans (garland physics, arati flame, sahasranama).
