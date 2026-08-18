import { audio } from './audio';
import { bellStats, bellTap } from './bell-voice';

/**
 * A readout for the one failure this room cannot debug from a desk.
 *
 * The bell behaves differently on different hardware — on one tablet it rings
 * for a couple of seconds and then every sound on the page stops, including a
 * bed that was already playing — and the three things that could cause that
 * look identical from the outside: the device taking the context away, the
 * audio thread missing its deadlines until the output stream is torn down, or
 * the graph still running perfectly into an output that is no longer there.
 * Guessing between them costs a round trip to the device each time. Measuring
 * them costs this file.
 *
 * OPEN IT WITH `?bell-debug` and nothing else changes; without the flag not a
 * line of this runs and nothing is attached to the audio graph. Read it as:
 *
 *   - `state` leaves `running`     -> the device took the context away.
 *   - `lag` climbing (ms)          -> the audio clock is falling behind the
 *                                     wall clock: the render thread is
 *                                     starving. Stalled outright and the
 *                                     output stream is dead.
 *   - `peak` still moving, silence -> the graph is fine and the output is not.
 *   - `peak` reading `NaN`         -> something upstream has poisoned the mix,
 *                                     which silences everything sharing the
 *                                     destination and does not recover.
 *
 * The meter is hung on the bell's own bus, after the fold, so it reads what
 * leaves for the destination — including the moment a stack of tails walks
 * past what the fold can hold.
 */

/** How fast the peak hold falls back, per frame. Slow enough to read. */
const DECAY = 0.94;

export function initBellDebug(): void {
  if (!new URLSearchParams(location.search).has('bell-debug')) return;

  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed',
    'left:8px',
    'top:8px',
    'z-index:99999',
    'padding:6px 8px',
    'font:11px/1.45 ui-monospace,monospace',
    'white-space:pre',
    'color:#ffd9a0',
    'background:rgba(0,0,0,0.72)',
    'border-radius:4px',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(box);

  let analyser: AnalyserNode | null = null;
  let buf = new Float32Array(0);
  let peak = 0;
  let nan = false;
  let t0wall = 0;
  let t0ctx = 0;

  // The context may only be built inside a gesture, and the panel must not be
  // the thing that breaks that rule: it waits for the first touch anywhere,
  // exactly as the bell and the beds do.
  const attach = () => {
    const ctx = audio();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    buf = new Float32Array(analyser.fftSize);
    // The tap is the bus's output, which is already connected to the
    // destination; an analyser is a passive branch off it.
    bellTap().connect(analyser);
    t0wall = performance.now() / 1000;
    t0ctx = ctx.currentTime;
  };
  addEventListener('pointerdown', attach, { once: true, capture: true });

  const frame = () => {
    requestAnimationFrame(frame);
    const stats = bellStats();
    if (!analyser) {
      box.textContent = `bell  strikes ${stats.strikes}\ntouch anything to attach`;
      return;
    }
    const ctx = audio();
    analyser.getFloatTimeDomainData(buf);
    let now = 0;
    nan = false;
    for (const v of buf) {
      if (Number.isNaN(v)) nan = true;
      else if (Math.abs(v) > now) now = Math.abs(v);
    }
    peak = Math.max(now, peak * DECAY);
    const lag = (performance.now() / 1000 - t0wall - (ctx.currentTime - t0ctx)) * 1000;
    box.textContent = [
      `state   ${ctx.state}`,
      `rate    ${ctx.sampleRate} Hz`,
      `lag     ${lag.toFixed(0)} ms`,
      `peak    ${nan ? 'NaN' : peak.toFixed(3)}`,
      `rings   ${stats.rings}`,
      `strikes ${stats.strikes}`,
    ].join('\n');
  };
  requestAnimationFrame(frame);
}
