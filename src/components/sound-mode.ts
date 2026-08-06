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
//
// The context, the codec choice and the fetch-decode-cache live in audio.ts,
// because the bell needs all three and none of the rest of this.

import { audio, load } from './audio';

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
}

const beds = new Map<TrackId, Bed>();

function bedFor(id: TrackId): Bed {
  let bed = beds.get(id);
  if (!bed) {
    const gain = audio().createGain();
    gain.gain.value = 0;
    gain.connect(audio().destination);
    bed = { gain, source: null };
    beds.set(id, bed);
  }
  return bed;
}

async function start(id: TrackId) {
  const ctx = audio();
  // Ask to resume FIRST, synchronously, and never await it. Two separate traps:
  // an AudioContext starts suspended and only resumes off a user gesture, so
  // awaiting a 775 KB fetch before asking spends the gesture the click gave us;
  // and a context the autoplay policy has blocked leaves this promise pending
  // for ever rather than rejecting, so awaiting it hangs the whole start with
  // nothing thrown. Fire it off and let the source play when the context runs.
  void ctx.resume();

  const bed = bedFor(id);
  // Fetched on first play, not on page load — the tanpura is ~775 KB and most
  // visitors never turn the sound on.
  const buffer = await load(SOURCES[id]);

  if (bed.source) return; // toggled off and on again before the fetch landed

  const source = ctx.createBufferSource();
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

      if (playing) {
        stop(id);
        return;
      }
      // .loading until the buffer lands: on a cold cache this is a second or
      // two of silence, and without it the button looks lit but dead.
      button.classList.add('loading');
      start(id)
        .catch(err => {
          console.error(`sound: ${id} failed to start`, err);
          button.setAttribute('aria-pressed', 'false');
          button.classList.remove('playing');
        })
        .finally(() => button.classList.remove('loading'));
    });
  });

  container.appendChild(el);
}
