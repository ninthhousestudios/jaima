// sound-mode.ts — the room's ambient beds.
//
// Playback deliberately does NOT follow the overlay. The panel is a light
// switch, not the lamp: once a bed is on it keeps playing while you move to
// japa or back to the altar, because a temple that falls silent the moment you
// stop looking at the sound panel is not a temple. Only the panel hides.
//
// Beds loop through Web Audio rather than <audio loop> on purpose. Opus and
// AAC both carry encoder priming/padding that <audio loop> replays as a gap at
// the seam; decodeAudioData strips it, so an AudioBufferSourceNode with
// loop = true rejoins the buffer sample-accurately. The 100 s tanpura is cut
// to a whole number of pluck cycles to match (see tools/render-tanpura.py) —
// both halves of that have to hold or the seam becomes audible.

type TrackId = 'tanpura' | 'ocean';

// Opus first for size; AAC for anything that can't decode Opus.
// The sea is ocean1, the steadier of the two recordings in docs/ — a steady
// envelope is what hides a loop. ocean2 is rendered too and is a swap away.
const SOURCES: Record<TrackId, string[]> = {
  tanpura: ['/audio/tanpura.opus', '/audio/tanpura.m4a'],
  ocean: ['/audio/ocean1.opus', '/audio/ocean1.m4a'],
};

// Beds are mixable, not exclusive — a drone over the sea is what Amritapuri
// actually sounds like. Levels balance them by ear rather than by peak: the
// ocean is dense broadband noise and reads far louder than the tanpura at the
// same amplitude, so it sits well under.
const LEVELS: Record<TrackId, number> = {
  tanpura: 1.0,
  ocean: 0.55,
};

const FADE_S = 3.0; // a drone should arrive and leave, not switch

interface Bed {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  buffer: Promise<AudioBuffer> | null;
}

let ctx: AudioContext | null = null;
const beds = new Map<TrackId, Bed>();

function audio(): AudioContext {
  // Constructed on the first toggle, never at init: an AudioContext created
  // without a user gesture starts suspended and browsers log about it.
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function pick(urls: string[]): string {
  const probe = document.createElement('audio');
  for (const url of urls) {
    const type = url.endsWith('.opus')
      ? 'audio/ogg; codecs=opus'
      : 'audio/mp4; codecs=mp4a.40.2';
    if (probe.canPlayType(type)) return url;
  }
  return urls[urls.length - 1];
}

function bedFor(id: TrackId): Bed {
  let bed = beds.get(id);
  if (!bed) {
    const gain = audio().createGain();
    gain.gain.value = 0;
    gain.connect(audio().destination);
    bed = { gain, source: null, buffer: null };
    beds.set(id, bed);
  }
  return bed;
}

async function start(id: TrackId) {
  const bed = bedFor(id);
  // Fetched on first play, not on page load — the tanpura is ~775 KB and most
  // visitors never turn the sound on.
  if (!bed.buffer) {
    bed.buffer = fetch(pick(SOURCES[id]))
      .then(r => r.arrayBuffer())
      .then(b => audio().decodeAudioData(b));
  }
  const buffer = await bed.buffer;
  await audio().resume(); // the click that got us here is the unlock gesture

  if (bed.source) return; // toggled off and on again before the fetch landed

  const source = audio().createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(bed.gain);
  source.start();
  bed.source = source;

  const now = audio().currentTime;
  bed.gain.gain.cancelScheduledValues(now);
  bed.gain.gain.setValueAtTime(bed.gain.gain.value, now);
  bed.gain.gain.linearRampToValueAtTime(LEVELS[id], now + FADE_S);
}

function stop(id: TrackId) {
  const bed = beds.get(id);
  if (!bed?.source) return;

  const source = bed.source;
  bed.source = null;

  const now = audio().currentTime;
  bed.gain.gain.cancelScheduledValues(now);
  bed.gain.gain.setValueAtTime(bed.gain.gain.value, now);
  bed.gain.gain.linearRampToValueAtTime(0, now + FADE_S);
  // Stopped only after the ramp lands, or the fade is cut off mid-way.
  source.stop(now + FADE_S + 0.1);
}

export function initSoundMode(container: HTMLElement) {
  const el = document.createElement('div');
  el.className = 'sound-overlay mode-overlay';
  el.id = 'mode-sound';
  el.innerHTML = `
    <div class="sound-display">
      <div class="sound-tracks">
        <button class="sound-track" data-track="tanpura" aria-pressed="false">Tanpura</button>
        <button class="sound-track" data-track="ocean" aria-pressed="false">Ocean</button>
      </div>
    </div>
  `;

  el.querySelectorAll<HTMLButtonElement>('.sound-track[data-track]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.track as TrackId;
      const playing = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', String(!playing));
      button.classList.toggle('playing', !playing);
      if (playing) stop(id);
      else void start(id);
    });
  });

  container.appendChild(el);
}
