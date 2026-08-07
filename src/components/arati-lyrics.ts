import deva from '../../docs/arati-deva.md?raw';
import iast from '../../docs/arati-iast.md?raw';
import mal from '../../docs/arati-mal.md?raw';
import type { AratiPlayer } from './arati-player';

/**
 * The words of the ārati, in step with the recording.
 *
 * Hidden until asked for. The rite is the lamp and the bell; the text is for
 * whoever wants to sing along, so it costs a button and nothing else until
 * they press it.
 *
 * The whole bhajan is on screen at once, climbing, the way japa's crawl and
 * the teachings' stream both work — not one line at a time. A line you are
 * about to sing is more use than a line you have finished, and a stanza whose
 * three lines are visible together is how the thing is actually printed.
 *
 * ## How it follows the recording
 *
 * The column does not run on a timer of its own. Every frame it asks
 * `player.time()` where the recording has got to and puts the text there, so
 * pausing pauses it, seeking moves it, and it cannot drift. The visitor's play
 * button is the recording's play button: press it here and YouTube starts,
 * press it in YouTube and this one lights. That is the whole of the coupling —
 * see arati-player.ts for the channel it rides on.
 *
 * Scroll the column by hand and it detaches, because someone reading ahead
 * should not be dragged back four times a second. A Follow button appears to
 * put it back on the recording, and pressing play does the same.
 *
 * ## Where the timing comes from
 *
 * `CUES` — one measured start per stanza — and nothing else. Measured off the
 * recording by `tools/arati-timing.py`, which prints the whole table; do not
 * hand-tune a row without reading its output first.
 *
 * **This used to be two numbers, a lead-in and one stanza length, and that was
 * wrong.** The bhajan is strophic in its melody but not in its tempo. It runs
 * at 36.46 s a stanza for five stanzas, then accelerates hard at
 * `patitoddhāra` to about 17.5 s, comes back to something near the original
 * pace for the `om jaya jaya` reprise, and closes on `jai bolo` and a
 * different chant altogether. A constant put the last third of the recording
 * out by more than a whole stanza — 40 s at `jai bolo` — which reads as the
 * words having simply stopped following the voice.
 *
 * The first entry still carries the weight the old lead-in did, and for the
 * same reason: the arati opens with one full instrumental cycle of the same
 * melody, so the singing begins a whole stanza in. Nothing that reads harmony
 * can tell that cycle from a sung one, which is why the tool reads the phase
 * off the voice band.
 *
 * Inside a stanza the lines are still spread evenly across its own span, which
 * is exact at every boundary and can be a second or so out in between. The
 * stanzas are sung for 85–99% of their span and the rest is the interlude, so
 * the last line of a slow stanza lights a little early. Bettering that needs
 * a per-line cue sheet and an ear, and the boundaries are what an ear notices.
 */

/**
 * Where each stanza starts being sung, in seconds. Measured by
 * tools/arati-timing.py — read its table rather than editing a row by feel.
 *
 * **One entry per stanza of the sources, in their order.** The three scripts
 * hold the same stanzas, so one table serves all of them; if the sources gain
 * or lose a stanza this must gain or lose a row, and the tool asserts the
 * count for exactly that reason.
 *
 * Confidence is not even down the table, and the tool says so per row. The
 * first five are the recording's own period, to the centisecond. The three
 * fast ones come from a fit that agrees with the voice to a quarter second.
 * The reprise and the two closing sections are single estimates, and each is
 * taken from the voice rather than from the music — see below.
 *
 * **A cue is where the singing starts, not where the melody does.** Twice on
 * this recording those are far apart, because the band plays the turn before
 * the voices come in: once at the top, which is the whole reason the opening
 * cue is not at 0, and again at the reprise, where the melody returns at
 * 278.0 and nobody sings until 286.0. Eight seconds is most of a line. Any
 * measurement that reads harmony will find the first of those and be early.
 */
const CUES = [
  36.72, // oṃ jaya jaya — the singing, one instrumental cycle in
  73.18,
  109.63,
  146.09,
  182.55,
  218.5, // patitoddhāra — and from here a stanza is half as long
  236.11,
  253.73, // this one eases back out of the accelerando, so it runs long
  286.0, // oṃ jaya jaya again — 8 s after the melody returns, not with it
  324.61, // jai bolo
  339.27, // asato mā sadgamaya, a different chant to close on
];

/**
 * Where the singing stops, closing the last stanza's span. Not the end of the
 * recording: there is applause and then silence after this.
 */
const END_S = 378.1;

/**
 * Where the line being sung sits, as a fraction of the column's height. Above
 * the middle, so most of what is on screen is what comes next.
 *
 * One constant doing two jobs, as in the teachings' stream: `offsetFor` puts a
 * line here and `indexAt` reads one back off the offset. Move one without the
 * other and the lit line is not the line at the reading position.
 */
const READ_LINE = 0.38;

/**
 * The same three scripts japa offers, in the same order, under the same
 * labels — the visitor should not have to learn a second script picker. The
 * type and the lang map are restated here rather than shared with japa-mode:
 * they are four lines of vocabulary, and a shared module between the two would
 * couple the mantras to the bhajan for no other reason.
 */
type Script = 'iast' | 'devanagari' | 'malayalam';

const LANG: Record<Script, string> = {
  iast: '',
  devanagari: 'hi',
  malayalam: 'ml',
};

/**
 * The verse marker that closes a stanza — `/8` in IAST, `/൮` in Malayalam,
 * `/८` in Devanagari. It is a scribe's mark and is not sung, so it is stripped
 * from what is shown; what it is kept for is that it is the only thing in the
 * sources that says where one stanza ends.
 */
const STANZA_END = /\s*\/\s*[0-9०-९൦-൯]+\s*$/;

/**
 * Blank-line separated lines, gathered into stanzas at the verse markers.
 *
 * The closing `jai bolo` and `jai` carry no marker, and neither does the
 * `asato mā` mantra that follows them: they are not verses of the bhajan. A
 * `---` rule in the source divides them, because they are sung over separate
 * spans and the cue sheet has a row for each — run them together and the
 * mantra would be dragged forward onto the `jai`.
 */
function parse(source: string): string[][] {
  const stanzas: string[][] = [];
  let current: string[] = [];
  const close = () => {
    if (current.length > 0) stanzas.push(current);
    current = [];
  };
  for (const block of source.split(/\n\s*\n/)) {
    const line = block.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (/^-{3,}$/.test(line)) {
      close();
      continue;
    }
    current.push(line.replace(STANZA_END, ''));
    if (STANZA_END.test(line)) close();
  }
  close();
  return stanzas;
}

const TEXTS: Record<Script, readonly (readonly string[])[]> = {
  devanagari: parse(deva),
  iast: parse(iast),
  malayalam: parse(mal),
};

interface Lyrics {
  /** Re-measures and re-seats the column. The panel cannot be measured while
   *  the overlay is display:none — every height reads 0. */
  activate(): void;
}

export function initAratiLyrics(overlay: HTMLElement, player: AratiPlayer): Lyrics {
  let script: Script = 'malayalam';
  let open = false;
  let following = true;
  let frame: number | null = null;

  /** Scroll position, px down the track. */
  let offset = 0;

  /** Where each line sits down the track, plus the track's own height as a
   *  final entry — so interpolating into the last line has somewhere to go. */
  let tops: number[] = [];
  let read = 0;

  const toggle = document.createElement('button');
  toggle.className = 'arati-lyrics-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'Lyrics';
  overlay.appendChild(toggle);

  const panel = document.createElement('section');
  panel.className = 'arati-lyrics';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="arati-lyrics-bar">
      <div class="arati-scripts">
        <button class="arati-script active" data-script="malayalam">മല</button>
        <button class="arati-script" data-script="iast">IAST</button>
        <button class="arati-script" data-script="devanagari">देव</button>
      </div>
      <button class="arati-lyrics-play" aria-label="Play the ārati">▶</button>
    </div>
    <div class="arati-lyrics-stage">
      <div class="arati-lyrics-track"></div>
    </div>
    <button class="arati-lyrics-follow" type="button">Follow the recording</button>
  `;
  overlay.appendChild(panel);

  const stage = panel.querySelector<HTMLElement>('.arati-lyrics-stage')!;
  const track = panel.querySelector<HTMLElement>('.arati-lyrics-track')!;
  const playBtn = panel.querySelector<HTMLElement>('.arati-lyrics-play')!;
  const followBtn = panel.querySelector<HTMLElement>('.arati-lyrics-follow')!;

  // ------------------------------------------------------------- rendering

  function build() {
    const frag = document.createDocumentFragment();
    for (const stanza of TEXTS[script]) {
      for (const line of stanza) {
        const p = document.createElement('p');
        p.className = 'arati-lyrics-line';
        // As text, not markup: these are Amma's ārati out of a file, and the
        // one place a stray < or & would land is the one place it must not.
        p.textContent = line;
        frag.appendChild(p);
      }
      // Marks the stanza break on the last line of the stanza rather than
      // adding an empty element, so the line index and the DOM stay 1:1.
      (frag.lastChild as HTMLElement).classList.add('stanza-end');
    }
    track.replaceChildren(frag);
    track.lang = LANG[script];
  }

  function measure() {
    // Nothing here can be measured while the overlay around it is display:none
    // — every height reads 0, and a zeroed measurement does not merely go
    // stale, it *freezes the column*: `apply` clamps the offset to a track of
    // no height, so the words stop moving and no drag, Follow or seek can
    // shift them again. The guard is the safety net; the call order (measure
    // only once the overlay is on screen) is the actual contract.
    if (stage.clientHeight === 0) return;

    const els = Array.from(track.children) as HTMLElement[];
    tops = els.map(el => el.offsetTop);
    tops.push(track.offsetHeight);
    read = stage.clientHeight * READ_LINE;
  }

  /** Which line is at the reading position. The inverse of `offsetFor`. */
  function indexAt(at: number): number {
    let i = 0;
    while (i + 1 < tops.length - 1 && tops[i + 1] <= at) i++;
    return i;
  }

  /**
   * Where the column has to sit for line `p` to be at the reading position.
   * `p` is fractional — the whole part names the line, the rest how far
   * through it the singing is — so the text glides rather than stepping.
   */
  function offsetFor(p: number): number {
    if (tops.length < 2) return 0;
    const i = Math.max(0, Math.min(Math.floor(p), tops.length - 2));
    return tops[i] + (tops[i + 1] - tops[i]) * (p - i);
  }

  /**
   * How far into the text, in fractional lines, the recording has sung.
   *
   * Walks the cue sheet rather than dividing by a stanza length, which is the
   * whole of the fix for a bhajan that changes tempo: each stanza is spread
   * across its own measured span, so an accelerando costs the following
   * stanzas nothing. A stanza with no cue of its own — the sources gaining a
   * verse the table has not been told about — is left off the end rather than
   * silently shifting every stanza before it.
   */
  function linePos(time: number): number {
    const stanzas = TEXTS[script];
    const n = Math.min(stanzas.length, CUES.length);
    if (n === 0 || time <= CUES[0]) return 0;

    let line = 0;
    for (let k = 0; k < n; k++) {
      const ends = k + 1 < n ? CUES[k + 1] : END_S;
      if (time < ends) return line + ((time - CUES[k]) / (ends - CUES[k])) * stanzas[k].length;
      line += stanzas[k].length;
    }
    return line;
  }

  function apply() {
    if (tops.length < 2) return;
    offset = Math.max(0, Math.min(offset, tops[tops.length - 1]));
    track.style.transform = `translateY(${read - offset}px)`;

    // Nothing is lit while the column is detached or the recording has not
    // reached the first stanza: a lit line is a claim about what is being sung
    // this second, and in either of those states there is no such claim to
    // make. Someone reading ahead by hand is reading, not being led.
    const lit = following && player.time() >= CUES[0] ? indexAt(offset) : -1;
    const els = track.children;
    for (let i = 0; i < els.length; i++) els[i].classList.toggle('current', i === lit);
  }

  function seek() {
    offset = offsetFor(linePos(player.time()));
    apply();
  }

  // --------------------------------------------------------------- driving

  function tick() {
    if (!open || !following || !player.playing()) {
      frame = null;
      return;
    }
    seek();
    frame = requestAnimationFrame(tick);
  }

  /** Restarts the loop if it should be running. Safe to call repeatedly. */
  function run() {
    if (frame === null) frame = requestAnimationFrame(tick);
  }

  function setFollowing(next: boolean) {
    following = next;
    panel.classList.toggle('detached', !next);
    if (next) {
      seek();
      run();
    }
  }

  function updatePlayButton() {
    playBtn.textContent = player.playing() ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', player.playing() ? 'Pause the ārati' : 'Play the ārati');
  }

  function setScript(next: Script) {
    script = next;
    for (const b of panel.querySelectorAll<HTMLElement>('.arati-script')) {
      b.classList.toggle('active', b.dataset.script === next);
    }
    build();
    measure();
    // The three scripts hold the same stanzas in the same order, so the place
    // in the text survives the switch even though every height changed.
    if (following) seek();
    else apply();
  }

  function setOpen(next: boolean) {
    open = next;
    panel.hidden = !next;
    toggle.classList.toggle('active', next);
    toggle.setAttribute('aria-expanded', String(next));
    if (!next) return;
    // Nothing above could be measured while the panel was hidden.
    measure();
    if (following) seek();
    else apply();
    run();
  }

  // ---------------------------------------------------------------- wiring

  build();
  updatePlayButton();

  toggle.addEventListener('click', () => setOpen(!open));

  for (const b of panel.querySelectorAll<HTMLElement>('.arati-script')) {
    b.addEventListener('click', () => setScript(b.dataset.script as Script));
  }

  playBtn.addEventListener('click', () => {
    // Play here is play there. Someone who pressed play on the words meant to
    // hear them sung, and a column moving in silence is the one outcome this
    // panel must not produce.
    if (player.playing()) player.pause();
    else player.play();
    setFollowing(true);
  });

  followBtn.addEventListener('click', () => setFollowing(true));

  stage.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      setFollowing(false);
      offset += e.deltaY;
      apply();
    },
    { passive: false },
  );

  // Touch and trackpad drag, the same gesture the garlands and the bell use.
  let dragging = false;
  let dragY = 0;
  stage.addEventListener('pointerdown', e => {
    dragging = true;
    dragY = e.clientY;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = e.clientY - dragY;
    if (dy === 0) return;
    dragY = e.clientY;
    setFollowing(false);
    offset -= dy;
    apply();
  });
  const drop = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener('pointerup', drop);
  stage.addEventListener('pointercancel', drop);

  // Both directions of the channel land here: our own play button and
  // YouTube's own controls both arrive as a change of the player's state.
  player.onChange(() => {
    updatePlayButton();
    if (following) seek();
    run();
  });

  window.addEventListener('resize', () => {
    if (!open || !overlay.classList.contains('active')) return;
    measure();
    if (following) seek();
    else apply();
  });

  return {
    activate() {
      if (!open) return;
      measure();
      if (following) seek();
      else apply();
      updatePlayButton();
      run();
    },
  };
}
