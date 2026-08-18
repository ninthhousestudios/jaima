/**
 * The room's one AudioContext, and the one way of getting a sound into it.
 *
 * Two things in the room make noise and they want completely different
 * playback — the beds loop for as long as you leave them on, the bell fires a
 * one-shot every time the clapper lands. What they share is everything before
 * that: a context that may only be created on a user gesture, a codec choice,
 * and a fetch-decode-cache that must not turn a failure into a permanent one.
 *
 * Beds go through `decodeAudioData` rather than `<audio loop>` because Opus and
 * AAC carry encoder padding that `<audio loop>` replays as a gap at the seam.
 * The bell is here for the other reason: `<audio>` cannot overlap a sound with
 * itself, and a bell rung fast is one strike ringing on into the next.
 */

let ctx: AudioContext | null = null;

/**
 * Constructed on first use, never at init: an AudioContext created without a
 * user gesture starts suspended and browsers log about it. Every caller
 * reaches this from a click.
 *
 * It is also watched from the moment it first runs. A phone or tablet takes
 * the audio device away for its own reasons — a call, another app, a route
 * change, the system deciding a glitching stream should be torn down — and
 * what the page sees is the context leaving `running` with no error anywhere.
 * Nothing here would notice: the bed's source node plays on into a stopped
 * context and the bell schedules strikes against a clock that is not moving,
 * so the room goes silent and stays silent until the visitor happens to touch
 * something that resumes it. Asking for it back is free and, if the device is
 * genuinely gone, fails quietly.
 */
export function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    const c = ctx;
    let ran = false;
    c.addEventListener('statechange', () => {
      // Only once it has run: before the first gesture it is legitimately
      // suspended, and chasing that would be asking for a resume the autoplay
      // policy is right to refuse.
      if (c.state === 'running') ran = true;
      // `interrupted` is not in the DOM's state union but is a real state on
      // Safari, and the point of the test is anything that is not running.
      else if (ran && (c.state as string) !== 'closed') void c.resume().catch(() => {});
    });
  }
  return ctx;
}

/** Opus first for size; AAC for anything that cannot decode it. */
export function pick(urls: string[]): string {
  const probe = document.createElement('audio');
  for (const url of urls) {
    const type = url.endsWith('.opus')
      ? 'audio/ogg; codecs=opus'
      : 'audio/mp4; codecs=mp4a.40.2';
    if (probe.canPlayType(type)) return url;
  }
  return urls[urls.length - 1];
}

const cache = new Map<string, Promise<AudioBuffer>>();

/**
 * Fetch and decode the first playable url, once.
 *
 * A rejection is dropped from the cache rather than kept, because a cached
 * rejected promise makes a transient failure permanent — every later attempt
 * would await the same rejection and never retry.
 */
export function load(urls: string[]): Promise<AudioBuffer> {
  const url = pick(urls);
  let buffer = cache.get(url);
  if (!buffer) {
    buffer = fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} fetching ${r.url}`);
        return r.arrayBuffer();
      })
      .then(b => audio().decodeAudioData(b))
      .catch(err => {
        cache.delete(url);
        throw err;
      });
    cache.set(url, buffer);
  }
  return buffer;
}
