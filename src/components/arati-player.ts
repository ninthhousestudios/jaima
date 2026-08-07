/**
 * The ārati recording, and the channel to it.
 *
 * An `<iframe>` and no YouTube API script, built on first entry and never at
 * init — a visitor who never opens ārati mode never talks to YouTube at all,
 * and the room's first paint is not waiting on a third-party frame.
 *
 * `enablejsapi=1` opens a postMessage channel, and this module uses **both**
 * directions of it. Outward: `playVideo` / `pauseVideo`, which is how the
 * lyrics' own play button starts the recording and how leaving the mode stops
 * it. Inward: send `{event: 'listening'}` and the player answers with a stream
 * of `infoDelivery` messages carrying `currentTime` and `playerState`, which
 * is how the lyrics know where the singing has got to and how pressing play in
 * YouTube's own controls lights our button. That inward handshake is the same
 * one youtube.com/iframe_api performs; doing it here rather than loading that
 * script keeps every byte of ārati mode on youtube-nocookie.com.
 *
 * It is written so the inward half can fail and the mode still works. If the
 * player never answers, `time()` falls back to a clock started when we asked
 * it to play — the lyrics scroll on regardless, and the moment a real report
 * does arrive it overwrites the estimate. Nothing here throws or logs; there
 * is no visitor-facing failure, only a lyric column that can drift.
 */

/** docs/arati-youtube.md. Cheap to change, so it is one constant. */
const VIDEO_ID = 'tqMBR5lLUHI';

const ORIGIN = 'https://www.youtube-nocookie.com';

/**
 * The id we answer to on the channel. Any number does, as long as the `widgetid`
 * in the frame's src and the `id` in every message we send are the same one.
 */
const WIDGET_ID = 1;

/**
 * The player only starts answering once its own script is up, and there is no
 * event for that, so the handshake is repeated until it replies. Twenty tries
 * covers a slow connection; after that we are on the fallback clock and no
 * further postMessage is going to change that.
 */
const HANDSHAKE_MS = 400;
const HANDSHAKE_TRIES = 20;

/** YouTube's player states. Only these two are worth a name here. */
const PLAYING = 1;
const BUFFERING = 3;

export interface AratiPlayer {
  /** Builds the frame, if it is not built. Idempotent. */
  mount(): void;
  play(): void;
  pause(): void;
  /**
   * Seconds into the recording, extrapolated from the last report so it moves
   * smoothly at frame rate rather than stepping four times a second.
   */
  time(): number;
  playing(): boolean;
  /** Called when the recording starts or stops, from either set of controls. */
  onChange(fn: () => void): void;
}

export function createAratiPlayer(host: HTMLElement): AratiPlayer {
  let frame: HTMLIFrameElement | null = null;
  let handshake: number | null = null;
  let tries = 0;

  /** Has the player ever answered? Until it has, `time()` is our own guess. */
  let heard = false;
  /** Last position we believe the recording is at, and when we believed it. */
  let mark = 0;
  let markedAt = 0;
  let running = false;

  const listeners: Array<() => void> = [];

  function send(message: Record<string, unknown>) {
    frame?.contentWindow?.postMessage(JSON.stringify(message), ORIGIN);
  }

  function command(func: string) {
    send({ event: 'command', func, args: [] });
  }

  /** Records a position and the instant it was true of, wherever it came from. */
  function markAt(seconds: number) {
    mark = seconds;
    markedAt = performance.now();
  }

  /**
   * Where the recording is now: the last position it reported, plus however
   * long has passed since, so the lyrics move at frame rate rather than
   * stepping four times a second with the reports.
   *
   * A plain function and not the interface's `time` method, because
   * `setRunning` below needs it too and a method on the returned object is not
   * in this scope — calling it from here throws.
   */
  function now(): number {
    return running ? mark + (performance.now() - markedAt) / 1000 : mark;
  }

  function setRunning(next: boolean) {
    if (next === running) return;
    // Freeze the extrapolation where it had got to before the clock stops, or
    // the position jumps by however long the pause lasted.
    if (!next) markAt(now());
    else markedAt = performance.now();
    running = next;
    for (const fn of listeners) fn();
  }

  function receive(event: MessageEvent) {
    if (event.origin !== ORIGIN || event.source !== frame?.contentWindow) return;
    if (typeof event.data !== 'string') return;

    let message: { event?: string; info?: unknown };
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    // `readyToListen` is the player saying its own script is up and it will
    // now answer. It is NOT the channel being open: it carries no state, and
    // treating it as an answer stops the handshake one message short of the
    // reports we actually want, leaving the panel silently on its fallback
    // clock. Answer it and keep asking.
    if (message.event === 'readyToListen') {
      send({ event: 'listening', id: WIDGET_ID, channel: 'widget' });
      return;
    }

    // Anything that carries state does mean the channel is open, so the
    // fallback clock can stand down.
    heard = true;
    if (handshake !== null) {
      clearInterval(handshake);
      handshake = null;
    }

    const info = message.info as { currentTime?: unknown; playerState?: unknown } | undefined;
    // `initialDelivery` is the first one, sent in answer to `listening`; the
    // rest arrive as `infoDelivery` a few times a second while it plays.
    if ((message.event === 'infoDelivery' || message.event === 'initialDelivery') && info) {
      if (typeof info.currentTime === 'number') markAt(info.currentTime);
      // Buffering is still "playing" to a reader: the recording is on its way
      // and the lyrics should not stop dead at every stall.
      if (typeof info.playerState === 'number') {
        setRunning(info.playerState === PLAYING || info.playerState === BUFFERING);
      }
    } else if (message.event === 'onStateChange' && typeof message.info === 'number') {
      setRunning(message.info === PLAYING || message.info === BUFFERING);
    }
  }

  function mount() {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.title = 'Ārati';
    frame.allow = 'accelerometer; encrypted-media; gyroscope; picture-in-picture';
    frame.setAttribute('allowfullscreen', '');
    // youtube-nocookie: no tracking cookie until the visitor presses play.
    // No autoplay parameter anywhere — the visitor starts the ārati.
    frame.src =
      `${ORIGIN}/embed/${VIDEO_ID}` +
      `?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&widgetid=${WIDGET_ID}` +
      `&origin=${encodeURIComponent(window.location.origin)}`;

    window.addEventListener('message', receive);
    frame.addEventListener('load', () => {
      const listen = () => {
        if (heard || tries++ >= HANDSHAKE_TRIES) {
          if (handshake !== null) clearInterval(handshake);
          handshake = null;
          return;
        }
        send({ event: 'listening', id: WIDGET_ID, channel: 'widget' });
      };
      listen();
      handshake = window.setInterval(listen, HANDSHAKE_MS);
    });

    host.appendChild(frame);
  }

  return {
    mount,

    play() {
      mount();
      command('playVideo');
      // Believe ourselves until told otherwise. If the player is answering
      // this is overwritten within a frame or two by its own report; if it
      // never answers, this is the only clock the lyrics will ever have.
      if (!heard) setRunning(true);
    },

    pause() {
      command('pauseVideo');
      if (!heard) setRunning(false);
    },

    time: now,

    playing() {
      return running;
    },

    onChange(fn: () => void) {
      listeners.push(fn);
    },
  };
}
