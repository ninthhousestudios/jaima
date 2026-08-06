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
 */
export function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
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
